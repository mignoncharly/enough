import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { integrationCatalog } from "../apps/api/src/integration-adapters.js";
import {
  integrationOAuthRuntimeFromEnvironment,
  oauthClientConfig,
  requiredOAuthScopes,
} from "../apps/api/src/integration-oauth.js";
import { parseEnvironment } from "../packages/config/src/index.js";
import {
  assertPhase14MicrosoftIntegrationSettings,
  microsoftIntegrationSettingPresence,
  parsePhase14MicrosoftIntegrationConfig,
  readPhase14MicrosoftIntegrationConfig,
} from "./phase14-microsoft-config.mjs";

const temporaryDirectories: string[] = [];
const syntheticConfig =
  "MICROSOFT_INTEGRATION_CLIENT_ID=synthetic-microsoft-client-id\n" +
  "MICROSOFT_INTEGRATION_CLIENT_SECRET=synthetic-microsoft-client-secret\n";

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await unlink(join(directory, "microsoft-oauth.env")).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
  }
});

describe("Phase 14 Microsoft runtime configuration", () => {
  it("accepts only the two dedicated Microsoft settings and reports presence only", () => {
    expect(parsePhase14MicrosoftIntegrationConfig(syntheticConfig)).toMatchObject({
      clientIdPresent: true,
      clientSecretPresent: true,
    });
    expect(() =>
      parsePhase14MicrosoftIntegrationConfig(
        `${syntheticConfig}GOOGLE_INTEGRATION_CLIENT_ID=not-allowed\n`,
      ),
    ).toThrow("may contain only the two integration client settings");
    expect(() =>
      parsePhase14MicrosoftIntegrationConfig("MICROSOFT_INTEGRATION_CLIENT_ID=synthetic-only-id\n"),
    ).toThrow("must contain both non-empty client settings");
  });

  it("configures Outlook and Microsoft Calendar without enabling unrelated providers", () => {
    const absentRuntime = integrationOAuthRuntimeFromEnvironment(
      parseEnvironment({
        GOOGLE_INTEGRATION_CLIENT_ID: "",
        GOOGLE_INTEGRATION_CLIENT_SECRET: "",
        MICROSOFT_INTEGRATION_CLIENT_ID: "",
        MICROSOFT_INTEGRATION_CLIENT_SECRET: "",
      }),
    );
    const configuredRuntime = integrationOAuthRuntimeFromEnvironment(
      parseEnvironment({
        GOOGLE_INTEGRATION_CLIENT_ID: "",
        GOOGLE_INTEGRATION_CLIENT_SECRET: "",
        MICROSOFT_INTEGRATION_CLIENT_ID: "synthetic-microsoft-client-id",
        MICROSOFT_INTEGRATION_CLIENT_SECRET: "synthetic-microsoft-client-secret",
      }),
    );

    for (const provider of ["OUTLOOK", "MICROSOFT_CALENDAR"] as const) {
      expect(oauthClientConfig(provider, absentRuntime)).toBeNull();
      expect(oauthClientConfig(provider, configuredRuntime)).toMatchObject({
        clientId: "synthetic-microsoft-client-id",
        clientSecret: "synthetic-microsoft-client-secret",
      });
      expect(requiredOAuthScopes(provider)).toContain("offline_access");
    }
    expect(requiredOAuthScopes("OUTLOOK")).toEqual([
      "openid",
      "offline_access",
      "User.Read",
      "Mail.ReadBasic",
    ]);
    expect(requiredOAuthScopes("MICROSOFT_CALENDAR")).toEqual([
      "openid",
      "offline_access",
      "User.Read",
      "Calendars.Read",
    ]);
    const catalogAvailability = (
      runtime: ReturnType<typeof integrationOAuthRuntimeFromEnvironment>,
    ) =>
      Object.fromEntries(
        integrationCatalog.map((item) => [
          item.provider,
          item.mode === "OAUTH"
            ? oauthClientConfig(
                item.provider as
                  | "OUTLOOK"
                  | "MICROSOFT_CALENDAR"
                  | "GMAIL"
                  | "GOOGLE_CALENDAR"
                  | "GA4",
                runtime,
              ) !== null
            : item.available,
        ]),
      );
    expect(catalogAvailability(absentRuntime)).toMatchObject({
      OUTLOOK: false,
      MICROSOFT_CALENDAR: false,
    });
    expect(catalogAvailability(configuredRuntime)).toMatchObject({
      OUTLOOK: true,
      MICROSOFT_CALENDAR: true,
      GMAIL: false,
      GOOGLE_CALENDAR: false,
      GA4: false,
      STRIPE: false,
      POSTHOG: false,
      PLAUSIBLE: false,
    });
    for (const provider of ["GMAIL", "GOOGLE_CALENDAR", "GA4"] as const) {
      expect(oauthClientConfig(provider, configuredRuntime)).toBeNull();
    }
    expect(configuredRuntime.google).toBeUndefined();
  });

  it("requires Microsoft settings only for an explicitly selected manual Microsoft fixture", () => {
    const present = microsoftIntegrationSettingPresence({
      MICROSOFT_INTEGRATION_CLIENT_ID: "synthetic-microsoft-client-id",
      MICROSOFT_INTEGRATION_CLIENT_SECRET: "synthetic-microsoft-client-secret",
    });
    expect(present).toEqual({ clientIdPresent: true, clientSecretPresent: true });
    expect(JSON.stringify(present)).not.toContain("synthetic-microsoft-client");
    expect(() => assertPhase14MicrosoftIntegrationSettings(present, true)).not.toThrow();

    const absent = microsoftIntegrationSettingPresence({
      MICROSOFT_INTEGRATION_CLIENT_ID: "",
      MICROSOFT_INTEGRATION_CLIENT_SECRET: "",
    });
    expect(absent).toEqual({ clientIdPresent: false, clientSecretPresent: false });
    expect(() => assertPhase14MicrosoftIntegrationSettings(absent, false)).not.toThrow();
    expect(() => assertPhase14MicrosoftIntegrationSettings(absent, true)).toThrow(
      "configuration is required",
    );
  });

  it("reports a missing file and reads a synthetic isolated config without returning file contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "enough-phase14-ms-config-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "microsoft-oauth.env");
    expect(await readPhase14MicrosoftIntegrationConfig(path)).toMatchObject({
      fileExists: false,
      clientIdPresent: false,
      clientSecretPresent: false,
    });
    await writeFile(path, syntheticConfig, { mode: 0o600 });
    const loaded = await readPhase14MicrosoftIntegrationConfig(path);
    expect(loaded).toMatchObject({
      fileExists: true,
      clientIdPresent: true,
      clientSecretPresent: true,
    });
    expect(
      JSON.stringify({
        fileExists: loaded.fileExists,
        clientIdPresent: loaded.clientIdPresent,
        clientSecretPresent: loaded.clientSecretPresent,
      }),
    ).not.toContain("synthetic-microsoft-client");
  });
});
