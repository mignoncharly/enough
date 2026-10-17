import { describe, expect, it } from "vitest";

const { createPhase16ReportClock } = await import(
  new URL("./phase16-report-clock.mjs", import.meta.url).href
);
const timestamp = "2024-03-01T12:34:56.000Z";
describe("Phase 16 report-only historical clock", () => {
  it("keeps startup and login/session expiry on real time", () => {
    const clock = createPhase16ReportClock(timestamp);
    expect(Math.abs(clock.Date.now() - Date.now())).toBeLessThan(1000);
    clock.runRequest("/auth/login", () => {
      expect(Math.abs(new clock.Date().getTime() - Date.now())).toBeLessThan(1000);
      expect(new clock.Date(clock.Date.now() + 86400000).getTime()).toBeGreaterThan(Date.now());
    });
  });
  it("preserves historical report time across asynchronous work", async () => {
    const clock = createPhase16ReportClock(timestamp);
    await clock.runRequest("/report-data?days=7", async () => {
      await Promise.resolve();
      expect(new clock.Date().toISOString()).toBe(timestamp);
      expect(clock.Date.now()).toBe(Date.parse(timestamp));
      expect(new clock.Date("2024-02-29T23:59:59Z").toISOString()).toBe("2024-02-29T23:59:59.000Z");
    });
    expect(Math.abs(clock.Date.now() - Date.now())).toBeLessThan(1000);
  });
  it("isolates concurrent auth and report requests without URL substring matching", async () => {
    const clock = createPhase16ReportClock(timestamp);
    await Promise.all([
      clock.runRequest("/report-data", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(clock.Date.now()).toBe(Date.parse(timestamp));
      }),
      ...["/auth/login", "/ready", "/auth/login?next=/report-data", "/report-data-other"].map(
        (url) =>
          clock.runRequest(url, async () => {
            await Promise.resolve();
            expect(Math.abs(clock.Date.now() - Date.now())).toBeLessThan(1000);
          }),
      ),
    ]);
  });
});
