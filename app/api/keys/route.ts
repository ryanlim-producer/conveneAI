import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import type { SessionUser } from "@/lib/auth";
import { getDb, newId } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { validateDeepgramKey, validateVercelAIGatewayKey } from "@/lib/key-validation";

const VALID_PROVIDERS = ["deepgram", "vercel-ai-gateway"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

function isValidProvider(value: string): value is Provider {
  return VALID_PROVIDERS.includes(value as Provider);
}

async function handlePostKey(
  req: NextRequest,
  ctx: { user: SessionUser },
): Promise<NextResponse> {
  try {
    const body = await req.json();

    // Validate provider
    if (!body.provider || !isValidProvider(body.provider)) {
      return NextResponse.json(
        { error: "Invalid or missing provider. Must be 'deepgram' or 'vercel-ai-gateway'." },
        { status: 400 },
      );
    }

    // Validate key
    if (!body.key || typeof body.key !== "string" || body.key.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing or empty key." },
        { status: 400 },
      );
    }

    const trimmedKey = body.key.trim();

    // Validate the key against the provider's API
    let validation: { valid: boolean; error?: string };
    if (body.provider === "deepgram") {
      validation = await validateDeepgramKey(trimmedKey);
    } else {
      validation = await validateVercelAIGatewayKey(trimmedKey);
    }

    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Key validation failed." },
        { status: 400 },
      );
    }

    const userId = ctx.user.userId;
    const db = getDb();

    // Encrypt the key
    const encryptedKey = encrypt(trimmedKey);

    // Upsert: delete existing key for this user+provider, then insert
    const existing = db
      .prepare(
        "SELECT id FROM api_keys WHERE user_id = ? AND provider = ?",
      )
      .get(userId, body.provider) as { id: string } | undefined;

    if (existing) {
      db.prepare("UPDATE api_keys SET encrypted_key = ?, created_at = datetime('now') WHERE id = ?")
        .run(encryptedKey, existing.id);
    } else {
      db.prepare(
        "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
      ).run(newId(), userId, body.provider, encryptedKey);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/keys error:", error);
    return NextResponse.json(
      { error: "Failed to store API key." },
      { status: 500 },
    );
  }
}

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  if (key.length <= 8) {
    return key.slice(0, 4) + "***" + key.slice(-4);
  }
  return key.slice(0, 4) + "***" + key.slice(-4);
}

async function handleGetKeys(
  _req: NextRequest,
  ctx: { user: SessionUser },
): Promise<NextResponse> {
  try {
    const userId = ctx.user.userId;
    const db = getDb();

    const rows = db
      .prepare("SELECT provider, encrypted_key FROM api_keys WHERE user_id = ?")
      .all(userId) as { provider: string; encrypted_key: string }[];

    const keys: Record<string, string> = {};
    for (const row of rows) {
      try {
        const plainKey = decrypt(row.encrypted_key);
        keys[row.provider] = maskKey(plainKey);
      } catch {
        keys[row.provider] = "****";
      }
    }

    // Include env-level keys if no user key exists for that provider
    if (!keys["deepgram"] && process.env.DEEPGRAM_API_KEY) {
      keys["deepgram"] = "ENV_***_SET"; // env key exists but is hidden
    }
    if (!keys["vercel-ai-gateway"] && process.env.VERCEL_AI_GATEWAY_KEY) {
      keys["vercel-ai-gateway"] = "ENV_***_SET"; // env key exists but is hidden
    }

    return NextResponse.json({ keys });
  } catch (error) {
    console.error("GET /api/keys error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve API keys." },
      { status: 500 },
    );
  }
}

export const POST = withAuth(handlePostKey);
export const GET = withAuth(handleGetKeys);

// Exported for testing
export { handlePostKey, handleGetKeys };
