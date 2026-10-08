import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  equalBuffer,
  equalText,
  hashPassword,
  hashToken,
  newToken,
  normalizeEmail,
  validPassword,
  verifyPassword,
} from "./crypto.js";

describe("authentication crypto primitives", () => {
  it("creates high-entropy URL-safe tokens and stable one-way token hashes", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(token)).toHaveLength(32);
    expect(equalBuffer(hashToken(token), hashToken(token))).toBe(true);
    expect(equalBuffer(hashToken(token), hashToken(`${token}x`))).toBe(false);
  });

  it("compares equal-length text and buffers safely and rejects unequal lengths", () => {
    expect(equalText("same", "same")).toBe(true);
    expect(equalText("same", "else")).toBe(false);
    expect(equalText("a", "aa")).toBe(false);
    expect(equalBuffer(Buffer.from([1, 2]), Buffer.from([1, 2]))).toBe(true);
    expect(equalBuffer(Buffer.from([1, 2]), Buffer.from([1]))).toBe(false);
  });

  it("enforces password byte-length bounds and canonicalizes email addresses", () => {
    expect(validPassword("123456789012")).toBe(true);
    expect(validPassword("short")).toBe(false);
    expect(validPassword("x".repeat(1024))).toBe(true);
    expect(validPassword("x".repeat(1025))).toBe(false);
    expect(validPassword("é".repeat(6))).toBe(true); // 12 UTF-8 bytes.
    expect(normalizeEmail("  Founder@Example.COM  ")).toBe("founder@example.com");
  });

  it("hashes passwords with salted scrypt and verifies only the matching password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
    expect(await verifyPassword("incorrect password", encoded)).toBe(false);
    expect(await hashPassword("correct horse battery staple")).not.toBe(encoded);
  });

  it("fails closed on missing or malformed password hashes", async () => {
    expect(await verifyPassword("candidate password", null)).toBe(false);
    expect(await verifyPassword("candidate password", "bcrypt$12$bad")).toBe(false);
    expect(await verifyPassword("candidate password", "scrypt$32768$8$1$bad$bad$extra")).toBe(
      false,
    );
  });

  it("encrypts secrets with authenticated encryption and rejects tampering", () => {
    const cleartext = "provider-access-token";
    const encrypted = encryptSecret(cleartext);
    expect(decryptSecret(encrypted)).toBe(cleartext);
    expect(encryptSecret(cleartext).equals(encrypted)).toBe(false);
    const tampered = Buffer.from(encrypted);
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 1;
    expect(() => decryptSecret(tampered)).toThrow();
    expect(() => decryptSecret(Buffer.alloc(28))).toThrow("malformed");
  });
});
