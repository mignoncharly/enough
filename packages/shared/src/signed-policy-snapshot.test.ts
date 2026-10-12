import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  POLICY_SNAPSHOT_MAX_AGE_MS,
  signPolicySnapshot,
  verifyPolicySnapshot,
} from "./signed-policy-snapshot.ts";

describe("signed desktop policy snapshots", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const keys = generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const payload = {
    version: 1 as const,
    userId: "user-a",
    deviceId: "device-a",
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + POLICY_SNAPSHOT_MAX_AGE_MS).toISOString(),
    rules: [{ id: "rule-a", enabled: true }],
    overrides: [{ id: "override-a", action: "ALLOW" }],
    catalog: [{ toolKind: "APPLICATION", toolKey: "ide.exe", classification: "BUILD" }],
    mappings: [{ toolKind: "APPLICATION", toolKey: "ide.exe", productId: null }],
    productIds: ["product-a"],
  };

  it("verifies the canonical signed policy for its account and device", () => {
    const snapshot = signPolicySnapshot(payload, privateKey);
    expect(
      verifyPolicySnapshot(snapshot, publicKey, { userId: "user-a", deviceId: "device-a" }, now),
    ).toEqual(payload);
  });

  it("rejects modified data, a different account or device, and an expired snapshot", () => {
    const snapshot = signPolicySnapshot(payload, privateKey);
    expect(
      verifyPolicySnapshot(
        { ...snapshot, rules: [{ id: "tampered", enabled: false }] },
        publicKey,
        { userId: "user-a", deviceId: "device-a" },
        now,
      ),
    ).toBeNull();
    expect(
      verifyPolicySnapshot(
        { ...snapshot, productIds: ["another-product"] },
        publicKey,
        { userId: "user-a", deviceId: "device-a" },
        now,
      ),
    ).toBeNull();
    expect(
      verifyPolicySnapshot(snapshot, publicKey, { userId: "user-b", deviceId: "device-a" }, now),
    ).toBeNull();
    expect(
      verifyPolicySnapshot(snapshot, publicKey, { userId: "user-a", deviceId: "device-b" }, now),
    ).toBeNull();
    const otherPublicKey = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    expect(
      verifyPolicySnapshot(
        snapshot,
        otherPublicKey,
        { userId: "user-a", deviceId: "device-a" },
        now,
      ),
    ).toBeNull();
    expect(
      verifyPolicySnapshot(
        snapshot,
        publicKey,
        { userId: "user-a", deviceId: "device-a" },
        now + POLICY_SNAPSHOT_MAX_AGE_MS,
      ),
    ).toBeNull();
  });

  it("rejects an overlong validity window and a key of the wrong type", () => {
    const overlong = signPolicySnapshot(
      { ...payload, expiresAt: new Date(now + POLICY_SNAPSHOT_MAX_AGE_MS + 1).toISOString() },
      privateKey,
    );
    expect(
      verifyPolicySnapshot(overlong, publicKey, { userId: "user-a", deviceId: "device-a" }, now),
    ).toBeNull();
    expect(() =>
      signPolicySnapshot(
        payload,
        generateKeyPairSync("rsa", { modulusLength: 2048 })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      ),
    ).toThrow("Ed25519");
  });
});
