import { describe, expect, it } from "vitest";
import { isWithinQuietHours, nextAllowedNotificationTime } from "./notification-time.js";

describe("notification quiet hours", () => {
  it("uses a start-inclusive and end-exclusive interval in the requested timezone", () => {
    expect(isWithinQuietHours("UTC", "09:00", "17:00", new Date("2026-05-01T09:00:00Z"))).toBe(
      true,
    );
    expect(isWithinQuietHours("UTC", "09:00", "17:00", new Date("2026-05-01T16:59:00Z"))).toBe(
      true,
    );
    expect(isWithinQuietHours("UTC", "09:00", "17:00", new Date("2026-05-01T17:00:00Z"))).toBe(
      false,
    );
  });

  it("supports overnight quiet hours and no-op configurations", () => {
    expect(isWithinQuietHours("UTC", "22:00", "07:00", new Date("2026-05-01T23:00:00Z"))).toBe(
      true,
    );
    expect(isWithinQuietHours("UTC", "22:00", "07:00", new Date("2026-05-02T06:59:00Z"))).toBe(
      true,
    );
    expect(isWithinQuietHours("UTC", "22:00", "07:00", new Date("2026-05-02T07:00:00Z"))).toBe(
      false,
    );
    expect(isWithinQuietHours("UTC", null, "07:00", new Date("2026-05-01T23:00:00Z"))).toBe(false);
    expect(isWithinQuietHours("UTC", "09:00", "09:00", new Date("2026-05-01T09:30:00Z"))).toBe(
      false,
    );
  });

  it("finds the next allowed instant in local time across a daylight-saving transition", () => {
    const now = new Date("2026-03-29T00:30:00Z"); // 01:30 CET; clocks jump to 03:00.
    expect(isWithinQuietHours("Europe/Berlin", "22:00", "03:30", now)).toBe(true);
    expect(nextAllowedNotificationTime("Europe/Berlin", "22:00", "03:30", now)?.toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });

  it("returns null when quiet hours do not apply", () => {
    expect(
      nextAllowedNotificationTime("UTC", null, "07:00", new Date("2026-05-01T23:00:00Z")),
    ).toBeNull();
    expect(
      nextAllowedNotificationTime("UTC", "09:00", "17:00", new Date("2026-05-01T20:00:00Z")),
    ).toBeNull();
  });
});
