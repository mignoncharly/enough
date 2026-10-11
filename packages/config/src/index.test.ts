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
