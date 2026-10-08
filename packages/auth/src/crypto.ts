import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { env } from "@enough/config";

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 64;
const DUMMY_SALT = Buffer.alloc(16, 0x45);
const SECRET_KEY = createHash("sha256").update(env.AUTH_SECRET).digest();

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function equalText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function equalBuffer(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function derivePassword(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      length,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 128 * 1024 * 1024 },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt, SCRYPT_BYTES);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  if (!encoded) {
    await derivePassword(password, DUMMY_SALT, SCRYPT_BYTES);
    return false;
  }
  const [algorithm, n, r, p, saltValue, hashValue, extra] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    Number(n) !== SCRYPT_N ||
    Number(r) !== SCRYPT_R ||
    Number(p) !== SCRYPT_P ||
    !saltValue ||
    !hashValue ||
    extra !== undefined
  ) {
    await derivePassword(password, DUMMY_SALT, SCRYPT_BYTES);
    return false;
  }

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_BYTES) return false;
    const actual = await derivePassword(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function encryptSecret(value: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", SECRET_KEY, nonce);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}

export function decryptSecret(value: Buffer): string {
  if (value.length < 29) throw new Error("Encrypted authentication value is malformed.");
  const nonce = value.subarray(0, 12);
  const tag = value.subarray(12, 28);
  const encrypted = value.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", SECRET_KEY, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validPassword(password: string): boolean {
  const length = Buffer.byteLength(password, "utf8");
  return length >= 12 && length <= 1024;
}
