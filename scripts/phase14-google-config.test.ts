import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  integrationOAuthRuntimeFromEnvironment,
  oauthClientConfig,
} from "../apps/api/src/integration-oauth.js";
import { parseEnvironment } from "../packages/config/src/index.js";
import {
  assertPhase14GoogleIntegrationSettings,
  googleIntegrationSettingPresence,
  parsePhase14GoogleIntegrationConfig,
  readPhase14GoogleIntegrationConfig,
} from "./phase14-google-config.mjs";

const temporaryDirectories: string[] = [];
const syntheticConfig =
  "GOOGLE_INTEGRATION_CLIENT_ID=synthetic-google-client-id\n" +
  "GOOGLE_INTEGRATION_CLIENT_SECRET=synthetic-google-client-secret\n";
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await unlink(join(directory, "google-oauth.env")).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
  }
});

describe("Phase 14 Google runtime configuration", () => {
  it("accepts only the two dedicated Google integration settings and reports presence only", () => {
    expect(parsePhase14GoogleIntegrationConfig(syntheticConfig)).toMatchObject({
      clientIdPresent: true,
      clientSecretPresent: true,
    });
    expect(() =>
      parsePhase14GoogleIntegrationConfig(
        `${syntheticConfig}MICROSOFT_INTEGRATION_CLIENT_ID=not-allowed\n`,
      ),
    ).toThrow("may contain only the two integration client settings");
    expect(() =>
      parsePhase14GoogleIntegrationConfig("GOOGLE_INTEGRATION_CLIENT_ID=synthetic-only-id\n"),
    ).toThrow("must contain both non-empty client settings");
  });

  it("keeps Gmail, Calendar, and GA4 catalog providers unavailable without Google settings and available with a synthetic pair", () => {
    const providers = ["GMAIL", "GOOGLE_CALENDAR", "GA4"] as const;
    const absentRuntime = integrationOAuthRuntimeFromEnvironment(
      parseEnvironment({ GOOGLE_INTEGRATION_CLIENT_ID: "", GOOGLE_INTEGRATION_CLIENT_SECRET: "" }),
    );
    const configuredRuntime = integrationOAuthRuntimeFromEnvironment(
      parseEnvironment({
        GOOGLE_INTEGRATION_CLIENT_ID: "synthetic-google-client-id",
        GOOGLE_INTEGRATION_CLIENT_SECRET: "synthetic-google-client-secret",
      }),
    );

    for (const provider of providers) {
      expect(oauthClientConfig(provider, absentRuntime)).toBeNull();
      expect(oauthClientConfig(provider, configuredRuntime)).toMatchObject({
        clientId: "synthetic-google-client-id",
        clientSecret: "synthetic-google-client-secret",
      });
    }
    expect(configuredRuntime.microsoft).toBeUndefined();
  });

  it("reports only child-environment presence and enforces manual fixture readiness", () => {
    const configuredPresence = googleIntegrationSettingPresence({
      GOOGLE_INTEGRATION_CLIENT_ID: "synthetic-google-client-id",
      GOOGLE_INTEGRATION_CLIENT_SECRET: "synthetic-google-client-secret",
    });
    expect(configuredPresence).toEqual({ clientIdPresent: true, clientSecretPresent: true });
    expect(JSON.stringify(configuredPresence)).not.toContain("synthetic-google-client");
    expect(() => assertPhase14GoogleIntegrationSettings(configuredPresence, true)).not.toThrow();

    const absentPresence = googleIntegrationSettingPresence({
      GOOGLE_INTEGRATION_CLIENT_ID: "",
      GOOGLE_INTEGRATION_CLIENT_SECRET: "",
    });
    expect(absentPresence).toEqual({ clientIdPresent: false, clientSecretPresent: false });
    expect(() => assertPhase14GoogleIntegrationSettings(absentPresence, false)).not.toThrow();
    expect(() => assertPhase14GoogleIntegrationSettings(absentPresence, true)).toThrow(
      "configuration is required",
    );
  });

  it("reports missing config as unavailable and detects both keys in a synthetic local file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "enough-phase14-config-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "google-oauth.env");
    expect(await readPhase14GoogleIntegrationConfig(path)).toMatchObject({
      fileExists: false,
      clientIdPresent: false,
      clientSecretPresent: false,
    });
    await writeFile(path, syntheticConfig, { mode: 0o600 });
    expect(await readPhase14GoogleIntegrationConfig(path)).toMatchObject({
      fileExists: true,
      clientIdPresent: true,
      clientSecretPresent: true,
    });
  });
});
