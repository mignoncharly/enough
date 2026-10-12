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
