import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateDeepgramKey, validateVercelAIGatewayKey } from "@/lib/key-validation";

describe("validateDeepgramKey", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { valid: true } when Deepgram API responds 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ projects: [] }), { status: 200 }),
    );

    const result = await validateDeepgramKey("dg-valid-key");
    expect(result.valid).toBe(true);
  });

  it("returns { valid: false, error } when Deepgram API responds 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    const result = await validateDeepgramKey("dg-invalid-key");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Invalid");
  });

  it("returns { valid: false, error } when Deepgram API responds 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    );

    const result = await validateDeepgramKey("dg-forbidden-key");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns { valid: false, error } on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const result = await validateDeepgramKey("any-key");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("reach");
  });

  it("trims whitespace from the key before validating", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ projects: [] }), { status: 200 }),
    );

    await validateDeepgramKey("  dg-key-with-spaces  ");

    const calledHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(calledHeaders["Authorization"]).toBe("Token dg-key-with-spaces");
  });
});

describe("validateVercelAIGatewayKey", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { valid: true } when Vercel AI Gateway responds 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "model-1" }] }), {
        status: 200,
      }),
    );

    const result = await validateVercelAIGatewayKey("vck_valid-key");
    expect(result.valid).toBe(true);
  });

  it("returns { valid: false, error } when Vercel AI Gateway responds 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
      }),
    );

    const result = await validateVercelAIGatewayKey("vck_bad-key");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Invalid");
  });

  it("returns { valid: false, error } when Vercel AI Gateway responds 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    );

    const result = await validateVercelAIGatewayKey("vck_forbidden");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns { valid: false, error } on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Connection refused"),
    );

    const result = await validateVercelAIGatewayKey("any-key");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("reach");
  });

  it("trims whitespace from the key before validating", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "model-1" }] }), {
        status: 200,
      }),
    );

    await validateVercelAIGatewayKey("  vck_key-with-spaces  ");

    const calledHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(calledHeaders["Authorization"]).toBe("Bearer vck_key-with-spaces");
  });
});
