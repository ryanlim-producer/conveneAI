import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

// Set a known ENCRYPTION_KEY for deterministic testing
const TEST_KEY = "a".repeat(64); // 64 hex chars = 32 bytes
process.env.ENCRYPTION_KEY = TEST_KEY;

describe("encrypt/decrypt", () => {
  it("round-trips: encrypt then decrypt returns the original plaintext", () => {
    const original = "sk-this-is-a-deepgram-api-key-12345";
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    const plaintext = "same-key-twice";
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
    // Both must decrypt to the original
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  it("throws when decrypting a tampered auth tag", () => {
    const encrypted = encrypt("secret-key-value");
    // Tamper with the auth tag (second segment)
    const parts = encrypted.split(":");
    parts[1] = "ff".repeat(16); // overwrite auth tag
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("throws when decrypting tampered ciphertext", () => {
    const encrypted = encrypt("secret-key-value");
    const parts = encrypted.split(":");
    // Flip bits in the ciphertext
    parts[2] = parts[2].slice(0, 10) + "0" + parts[2].slice(11);
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("throws when decrypting an invalid format string", () => {
    expect(() => decrypt("not-a-valid-format")).toThrow(
      "Invalid encrypted string format",
    );
  });

  it("throws when decrypting a completely empty string", () => {
    expect(() => decrypt("")).toThrow("Invalid encrypted string format");
  });

  it("handles empty string encryption/decryption", () => {
    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles special characters in keys", () => {
    const keyWithSpecials = "sk-!@#$%^&*()_+{}|:\"<>?[];',./`~";
    const encrypted = encrypt(keyWithSpecials);
    expect(decrypt(encrypted)).toBe(keyWithSpecials);
  });

  it("handles very long keys (e.g. JWTs)", () => {
    const longKey = "sk-" + "x".repeat(1000);
    const encrypted = encrypt(longKey);
    expect(decrypt(encrypted)).toBe(longKey);
  });
});
