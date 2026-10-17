import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./index.ts";

describe("manual credit controls environment policy", () => {
  it("defaults to disabled and can be enabled only by an explicit non-production setting", () => {
    expect(parseEnvironment({ NODE_ENV: "test" }).CREDITS_MANUAL_CONTROLS_ENABLED).toBe(false);
    expect(
      parseEnvironment({ NODE_ENV: "test", CREDITS_MANUAL_CONTROLS_ENABLED: "true" })
        .CREDITS_MANUAL_CONTROLS_ENABLED,
    ).toBe(true);
  });

  it("rejects manual issuance and adjustment in production", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        AUTH_SECRET: "p".repeat(48),
        APP_BASE_URL: "https://app.example.test",
        API_BASE_URL: "https://api.example.test",
        CREDITS_MANUAL_CONTROLS_ENABLED: "true",
      }),
    ).toThrow("CREDITS_MANUAL_CONTROLS_ENABLED");
  });
});

describe("desktop policy snapshot environment policy", () => {
  it("does not require a signing key for local test or development operation", () => {
    expect(
      parseEnvironment({ NODE_ENV: "test" }).POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY,
    ).toBeUndefined();
  });

  it("accepts only a valid Ed25519 signing key when configured", () => {
    const privateKey = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    expect(
      parseEnvironment({ NODE_ENV: "test", POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY: privateKey })
        .POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY,
    ).toBe(privateKey);
    expect(() =>
      parseEnvironment({ NODE_ENV: "test", POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY: "not a key" }),
    ).toThrow("must be a valid Ed25519 private key");
  });

  it("requires the server signing key in production", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        AUTH_SECRET: "p".repeat(48),
        APP_BASE_URL: "https://app.example.test",
        API_BASE_URL: "https://api.example.test",
        RESEND_API_KEY: "re_test",
        AUTH_EMAIL_FROM: "Enough <noreply@example.test>",
      }),
    ).toThrow("POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY");
  });
});

describe("production storage and origin contract", () => {
  it("requires explicit production database and cache connections", () => {
    const production = {
      NODE_ENV: "production",
      AUTH_SECRET: "synthetic-production-test-value".repeat(2),
      APP_BASE_URL: "https://app.example.test",
      API_BASE_URL: "https://api.example.test",
      RESEND_API_KEY: "synthetic-mail",
      AUTH_EMAIL_FROM: "test@example.test",
      POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY: generateKeyPairSync("ed25519")
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
    };
    expect(() => parseEnvironment(production)).toThrow(
      "DATABASE_URL: explicit production connection required",
    );
    expect(() =>
      parseEnvironment({
        ...production,
        DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
      }),
    ).toThrow("REDIS_URL: explicit production connection required");
  });
  const storage = {
    EVIDENCE_STORAGE_BUCKET: "synthetic-private-bucket",
    EVIDENCE_STORAGE_REGION: "eu-test-1",
    EVIDENCE_STORAGE_ACCESS_KEY_ID: "synthetic-access-id",
    EVIDENCE_STORAGE_SECRET_ACCESS_KEY: "synthetic-storage-secret",
  };
  it("allows storage disabled or a complete configured group", () => {
    expect(parseEnvironment({ NODE_ENV: "test" }).EVIDENCE_STORAGE_BUCKET).toBeUndefined();
    expect(parseEnvironment({ NODE_ENV: "test", ...storage }).EVIDENCE_STORAGE_BUCKET).toBe(
      storage.EVIDENCE_STORAGE_BUCKET,
    );
  });
  it("rejects partial storage configuration without disclosing credentials", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
        EVIDENCE_STORAGE_SECRET_ACCESS_KEY: storage.EVIDENCE_STORAGE_SECRET_ACCESS_KEY,
      }),
    ).toThrow("EVIDENCE_STORAGE_BUCKET");
    try {
      parseEnvironment({
        NODE_ENV: "test",
        EVIDENCE_STORAGE_SECRET_ACCESS_KEY: storage.EVIDENCE_STORAGE_SECRET_ACCESS_KEY,
      });
    } catch (error) {
      expect(String(error)).not.toContain(storage.EVIDENCE_STORAGE_SECRET_ACCESS_KEY);
    }
  });
  it.each(["https://storage.example.test", "http://127.0.0.1:9000"])(
    "accepts storage endpoint %s",
    (endpoint) => {
      expect(
        parseEnvironment({ NODE_ENV: "test", ...storage, EVIDENCE_STORAGE_ENDPOINT: endpoint })
          .EVIDENCE_STORAGE_ENDPOINT,
      ).toBe(endpoint);
    },
  );
  it.each([
    "http://storage.example.test",
    "https://user:secret@storage.example.test",
    "https://storage.example.test?secret=synthetic",
    "https://storage.example.test#secret",
    "not-a-url",
  ])("rejects unsafe endpoint %s", (endpoint) => {
    expect(() =>
      parseEnvironment({ NODE_ENV: "test", ...storage, EVIDENCE_STORAGE_ENDPOINT: endpoint }),
    ).toThrow("EVIDENCE_STORAGE_ENDPOINT");
  });
  it("rejects credential-bearing production public origins", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        APP_BASE_URL: "https://user:synthetic@app.example.test",
      }),
    ).toThrow("public HTTPS origin");
  });
});
