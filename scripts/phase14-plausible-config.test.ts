import { describe, expect, it } from "vitest";
import {
  parsePhase14PlausibleConfig,
  plausibleAcceptanceQuery,
  plausibleSettingPresence,
} from "./phase14-plausible-config.mjs";

describe("Phase 14 Plausible local config", () => {
  it("refreshes the explicit seven-day acceptance window for each poll", () => {
    const first = plausibleAcceptanceQuery("example.test", new Date("2026-10-15T12:00:00Z"));
    const next = plausibleAcceptanceQuery("example.test", new Date("2026-10-15T12:01:00Z"));
    expect(first.date_range).toEqual(["2026-10-08T12:00:00.000Z", "2026-10-15T12:00:00.000Z"]);
    expect(next.date_range).toEqual(["2026-10-08T12:01:00.000Z", "2026-10-15T12:01:00.000Z"]);
    expect(next.filters).toEqual([["is", "event:goal", ["phase14_acceptance_probe"]]]);
  });
  const validConfig = [
    "PLAUSIBLE_STATS_API_KEY=synthetic-stats-api-key",
    "PLAUSIBLE_SITE_ID=phase14-test.example.test",
  ].join("\n");

  it("accepts only the read-only Stats API key and configured site domain", () => {
    expect(parsePhase14PlausibleConfig(validConfig)).toMatchObject({
      statsApiKey: "synthetic-stats-api-key",
      siteId: "phase14-test.example.test",
      statsApiKeyPresent: true,
      siteIdPresent: true,
    });
    expect(
      plausibleSettingPresence({ PLAUSIBLE_STATS_API_KEY: "present", PLAUSIBLE_SITE_ID: "site" }),
    ).toEqual({ statsApiKeyPresent: true, siteIdPresent: true });
  });

  it("rejects a missing or malformed site ID without accepting unrelated provider settings", () => {
    expect(() =>
      parsePhase14PlausibleConfig("PLAUSIBLE_STATS_API_KEY=synthetic-stats-api-key"),
    ).toThrow("incomplete or invalid");
    expect(() => parsePhase14PlausibleConfig(`${validConfig}\nPOSTHOG_PROJECT_ID=12345`)).toThrow(
      "unsupported setting",
    );
    expect(() =>
      parsePhase14PlausibleConfig(
        "PLAUSIBLE_STATS_API_KEY=synthetic-stats-api-key\nPLAUSIBLE_SITE_ID=https://example.test/path",
      ),
    ).toThrow("incomplete or invalid");
  });
});
