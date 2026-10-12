import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

export const POLICY_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60_000;
const POLICY_SNAPSHOT_CLOCK_TOLERANCE_MS = 5 * 60_000;

export interface PolicySnapshotPayload {
  version: 1;
  userId: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
  rules: unknown[];
  overrides: unknown[];
  catalog: unknown[];
  mappings: unknown[];
  productIds: string[];
}

export interface SignedPolicySnapshot extends PolicySnapshotPayload {
  keyId: string;
  signature: string;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  throw new Error("Policy snapshot contains a non-JSON value.");
}

function signedFields(snapshot: Omit<SignedPolicySnapshot, "signature">): string {
  return canonicalize(snapshot);
}

export function policySnapshotKeyId(key: string | Buffer): string {
  const publicKey = createPublicKey(key);
  if (publicKey.asymmetricKeyType !== "ed25519")
    throw new Error("Policy snapshot keys must use Ed25519.");
  const der = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 24);
}

export function signPolicySnapshot(
  payload: PolicySnapshotPayload,
  privateKeyPem: string,
): SignedPolicySnapshot {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("Policy snapshot keys must use Ed25519.");
  const fields = {
    ...payload,
    keyId: policySnapshotKeyId(createPublicKey(privateKey).export({ type: "spki", format: "pem" })),
  };
  const signature = cryptoSign(null, Buffer.from(signedFields(fields)), privateKey).toString(
    "base64url",
  );
  return { ...fields, signature };
}

export function verifyPolicySnapshot(
  value: unknown,
  publicKeyPem: string,
  expected: { userId: string; deviceId: string },
  now = Date.now(),
): PolicySnapshotPayload | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const snapshot = value as Partial<SignedPolicySnapshot>;
    if (
      snapshot.version !== 1 ||
      typeof snapshot.userId !== "string" ||
      snapshot.userId !== expected.userId ||
      typeof snapshot.deviceId !== "string" ||
      snapshot.deviceId !== expected.deviceId ||
      typeof snapshot.issuedAt !== "string" ||
      typeof snapshot.expiresAt !== "string" ||
      !Array.isArray(snapshot.rules) ||
      !Array.isArray(snapshot.overrides) ||
      !Array.isArray(snapshot.catalog) ||
      !Array.isArray(snapshot.mappings) ||
      !Array.isArray(snapshot.productIds) ||
      !snapshot.productIds.every((id) => typeof id === "string") ||
      typeof snapshot.keyId !== "string" ||
      typeof snapshot.signature !== "string" ||
      !/^[A-Za-z0-9_-]{80,100}$/.test(snapshot.signature)
    )
      return null;

    const issuedAt = Date.parse(snapshot.issuedAt);
    const expiresAt = Date.parse(snapshot.expiresAt);
    const duration = expiresAt - issuedAt;
    if (
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      duration <= 0 ||
      duration > POLICY_SNAPSHOT_MAX_AGE_MS ||
      issuedAt > now + POLICY_SNAPSHOT_CLOCK_TOLERANCE_MS ||
      expiresAt <= now
    )
      return null;

    const keyId = policySnapshotKeyId(publicKeyPem);
    if (snapshot.keyId !== keyId) return null;
    const fields = {
      version: snapshot.version,
      userId: snapshot.userId,
      deviceId: snapshot.deviceId,
      issuedAt: snapshot.issuedAt,
      expiresAt: snapshot.expiresAt,
      rules: snapshot.rules,
      overrides: snapshot.overrides,
      catalog: snapshot.catalog,
      mappings: snapshot.mappings,
      productIds: snapshot.productIds,
      keyId: snapshot.keyId,
    } as Omit<SignedPolicySnapshot, "signature">;
    if (
      !cryptoVerify(
        null,
        Buffer.from(signedFields(fields)),
        createPublicKey(publicKeyPem),
        Buffer.from(snapshot.signature, "base64url"),
      )
    )
      return null;
    return {
      version: snapshot.version,
      userId: snapshot.userId,
      deviceId: snapshot.deviceId,
      issuedAt: snapshot.issuedAt,
      expiresAt: snapshot.expiresAt,
      rules: snapshot.rules,
      overrides: snapshot.overrides,
      catalog: snapshot.catalog,
      mappings: snapshot.mappings,
      productIds: snapshot.productIds,
    };
  } catch {
    return null;
  }
}
