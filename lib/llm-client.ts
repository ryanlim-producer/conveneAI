import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

const FALLBACK_MAP: Record<string, string> = {
  "deepseek/deepseek-r1": "deepseek/deepseek-chat",
};

interface LLMCallOptions {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  max_tokens?: number;
}

function getApiKey(userId: string): string {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT encrypted_key FROM api_keys WHERE user_id = ? AND provider = 'vercel-ai-gateway'",
    )
    .get(userId) as { encrypted_key: string } | undefined;

  if (row) {
    return decrypt(row.encrypted_key);
  }

  if (process.env.VERCEL_AI_GATEWAY_KEY) {
    return process.env.VERCEL_AI_GATEWAY_KEY;
  }

  throw new Error("No Vercel AI Gateway key configured for this user.");
}

async function makeRequest(
  apiKey: string,
  options: LLMCallOptions,
): Promise<Response> {
  return fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? 1000,
    }),
  });
}

export async function callLLM(
  userId: string,
  options: LLMCallOptions,
): Promise<string> {
  const apiKey = getApiKey(userId);

  // Try primary model
  let response = await makeRequest(apiKey, options);

  // Fallback on 429
  if (response.status === 429) {
    const fallbackModel = FALLBACK_MAP[options.model];
    if (fallbackModel) {
      response = await makeRequest(apiKey, {
        ...options,
        model: fallbackModel,
      });
    }
  }

  if (!response.ok) {
    throw new Error(`LLM call failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}
