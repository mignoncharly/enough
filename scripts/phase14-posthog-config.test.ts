import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parsePhase14PostHogConfig,
  posthogRegionHosts,
  posthogSettingPresence,
  readPhase14PostHogConfig,
} from "./phase14-posthog-config.mjs";

const temporaryDirectories: string[] = [];
const syntheticConfig = [
  "POSTHOG_PERSONAL_API_KEY=synthetic-posthog-personal-api-key",
  "POSTHOG_PROJECT_TOKEN=synthetic-posthog-project-token",
  "POSTHOG_PROJECT_ID=314159",
  "POSTHOG_REGION=eu",
  "",
].join("\n");

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await unlink(join(directory, "posthog.env")).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
  }
});

describe("Phase 14 PostHog local configuration", () => {
  it("parses the dedicated PostHog read credential and project settings without exposing values in presence output", () => {
    const parsed = parsePhase14PostHogConfig(syntheticConfig);
    expect(parsed).toMatchObject({
      personalApiKeyPresent: true,
      projectTokenPresent: true,
      projectIdPresent: true,
      regionPresent: true,
      projectId: "314159",
      region: "eu",
    });
    expect(
      JSON.stringify(
        posthogSettingPresence({
          POSTHOG_PERSONAL_API_KEY: "synthetic-posthog-personal-api-key",
          POSTHOG_PROJECT_TOKEN: "synthetic-posthog-project-token",
          POSTHOG_PROJECT_ID: "314159",
          POSTHOG_REGION: "eu",
        }),
      ),
    ).not.toContain("synthetic-posthog");
  });

  it("selects only the explicit US and EU private API and ingestion hosts", () => {
    expect(posthogRegionHosts("us")).toEqual({
      apiBaseUrl: "https://us.posthog.com",
      ingestionUrl: "https://us.i.posthog.com/i/v0/e/",
    });
    expect(posthogRegionHosts("eu")).toEqual({
      apiBaseUrl: "https://eu.posthog.com",
      ingestionUrl: "https://eu.i.posthog.com/i/v0/e/",
    });
    expect(() => posthogRegionHosts("apac")).toThrow("must be us or eu");
  });

  it("rejects missing or invalid project IDs, regions, and provider credentials", () => {
    for (const contents of [
      syntheticConfig.replace("POSTHOG_PROJECT_ID=314159\n", ""),
      syntheticConfig.replace("POSTHOG_PROJECT_ID=314159", "POSTHOG_PROJECT_ID=abc"),
      syntheticConfig.replace("POSTHOG_REGION=eu", "POSTHOG_REGION=apac"),
      syntheticConfig.replace("POSTHOG_PERSONAL_API_KEY=synthetic-posthog-personal-api-key", ""),
      syntheticConfig.replace("POSTHOG_PROJECT_TOKEN=synthetic-posthog-project-token", ""),
    ]) {
      expect(() => parsePhase14PostHogConfig(contents)).toThrow("incomplete or invalid");
    }
    expect(() =>
      parsePhase14PostHogConfig(`${syntheticConfig}GOOGLE_INTEGRATION_CLIENT_ID=synthetic\n`),
    ).toThrow("unsupported setting");
    expect(() =>
      parsePhase14PostHogConfig(`${syntheticConfig}MICROSOFT_INTEGRATION_CLIENT_ID=synthetic\n`),
    ).toThrow("unsupported setting");
    expect(() =>
      parsePhase14PostHogConfig(`${syntheticConfig}PLAUSIBLE_API_TOKEN=synthetic\n`),
    ).toThrow("unsupported setting");
    expect(() => parsePhase14PostHogConfig(`${syntheticConfig}GA4_PROPERTY_ID=314159\n`)).toThrow(
      "unsupported setting",
    );
    expect(() =>
      parsePhase14PostHogConfig(`${syntheticConfig}STRIPE_SECRET_KEY=synthetic\n`),
    ).toThrow("unsupported setting");
  });

  it("reports only presence when reading a dedicated local TEMP file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "enough-phase14-posthog-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "posthog.env");
    expect(await readPhase14PostHogConfig(path)).toMatchObject({
      fileExists: false,
      personalApiKeyPresent: false,
      projectTokenPresent: false,
      projectIdPresent: false,
      regionPresent: false,
    });
    await writeFile(path, syntheticConfig, { mode: 0o600 });
    expect(await readPhase14PostHogConfig(path)).toMatchObject({
      fileExists: true,
      personalApiKeyPresent: true,
      projectTokenPresent: true,
      projectIdPresent: true,
      regionPresent: true,
    });
  });
});
