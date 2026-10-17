import { describe, expect, it } from "vitest";
import {
  GA4_EVENT_MAP,
  ga4ProbePayload,
  ga4ReportRequest,
  ga4SettingPresence,
  parsePhase14Ga4Config,
} from "./phase14-ga4-config.mjs";

describe("Phase 14 GA4 local acceptance configuration", () => {
  const config =
    "GA4_PROPERTY_ID=123456\nGA4_STREAM_ID=654321\nGA4_MEASUREMENT_ID=G-SYNTHETIC1\nGA4_API_SECRET=synthetic-secret-only";
  it("accepts only four acceptance settings without changing other provider configuration", () => {
    const before = { ...process.env };
    expect(parsePhase14Ga4Config(config)).toMatchObject({
      propertyIdPresent: true,
      streamIdPresent: true,
      measurementIdPresent: true,
      apiSecretPresent: true,
    });
    expect(ga4SettingPresence({})).toEqual({
      propertyIdPresent: false,
      streamIdPresent: false,
      measurementIdPresent: false,
      apiSecretPresent: false,
    });
    expect(process.env).toEqual(before);
    expect(() =>
      parsePhase14Ga4Config(`${config}\nGOOGLE_INTEGRATION_CLIENT_SECRET=synthetic`),
    ).toThrow("Unsupported");
  });
  it("rejects missing and malformed identifiers and secrets safely", () => {
    for (const invalid of [
      "",
      `${config}\nGA4_PROPERTY_ID=123456`,
      config.replace("654321", "123456"),
      config.replace("654321", "stream/654321"),
      config.replace("synthetic-secret-only", " synthetic-secret-only"),
      config.replace("synthetic-secret-only", '"synthetic-secret-only"'),
      `${config}\nconsole.log("synthetic")`,
      config.replace("123456", "properties/123456"),
      config.replace("123456", "0"),
      config.replace("G-SYNTHETIC1", "bad"),
      config.replace("synthetic-secret-only", ""),
    ])
      expect(() => parsePhase14Ga4Config(invalid)).toThrow("invalid");
  });
  it("uses only the clean MP map and rejects arbitrary synthetic client/session values", () => {
    expect(ga4ReportRequest().dateRanges).toEqual([{ startDate: "6daysAgo", endDate: "today" }]);
    expect(ga4ReportRequest(true)).not.toHaveProperty("dateRanges");
    expect(GA4_EVENT_MAP).toEqual({ phase14_clean_mp_probe: "analytics.user_signup" });
    expect(ga4ReportRequest().dimensionFilter.filter.inListFilter.values).toEqual([
      "phase14_clean_mp_probe",
    ]);
    expect(() => ga4ProbePayload({ clientId: "12345.67890", sessionId: 67890 })).toThrow(
      "gtag seed fixture",
    );
    expect(() => ga4ProbePayload("12345.67890")).toThrow("gtag seed fixture");
  });
});
