import { describe, expect, it } from "vitest";
import { shouldKeepReminderForInteraction } from "./reminder-focus.ts";

describe("restricted-app reminder focus", () => {
  it("keeps a visible focused reminder open when the foreground owner lookup misses Enough", () => {
    expect(
      shouldKeepReminderForInteraction({
        reminderVisible: true,
        reminderFocused: true,
        foregroundProcessId: 123,
        appProcessId: 456,
      }),
    ).toBe(true);
    expect(
      shouldKeepReminderForInteraction({
        reminderVisible: true,
        reminderFocused: true,
        foregroundProcessId: undefined,
        appProcessId: 456,
      }),
    ).toBe(true);
  });

  it("keeps the reminder for a foreground Enough process while focus reporting catches up", () => {
    expect(
      shouldKeepReminderForInteraction({
        reminderVisible: true,
        reminderFocused: false,
        foregroundProcessId: 456,
        appProcessId: 456,
      }),
    ).toBe(true);
  });

  it("resumes normal policy monitoring when the reminder is hidden or another app has focus", () => {
    expect(
      shouldKeepReminderForInteraction({
        reminderVisible: false,
        reminderFocused: true,
        foregroundProcessId: 456,
        appProcessId: 456,
      }),
    ).toBe(false);
    expect(
      shouldKeepReminderForInteraction({
        reminderVisible: true,
        reminderFocused: false,
        foregroundProcessId: 789,
        appProcessId: 456,
      }),
    ).toBe(false);
  });
});
