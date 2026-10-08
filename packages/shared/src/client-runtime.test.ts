import { describe, expect, it } from "vitest";
import {
  appendBoundedEvent,
  DEFAULT_EVENT_QUEUE_LIMIT,
  DEFAULT_EVENT_RETENTION_MS,
  isGrowthModeActive,
  isPolicyCacheStale,
  nextClientSequence,
  normalizeApiOrigin,
  pruneExpiredEvents,
} from "./client-runtime.js";

describe("API origin contract shared by desktop and extension", () => {
  it.each([
    [" https://api.example.com/ ", "https://api.example.com"],
    ["http://localhost:3000/", "http://localhost:3000"],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["http://[::1]:8080", "http://[::1]:8080"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeApiOrigin(raw)).toBe(expected);
  });

  it.each([
    "http://api.example.com",
    "file:///tmp/api",
    "https://user:pass@api.example.com",
    "https://api.example.com/v1",
    "https://api.example.com?debug=true",
    "not a URL",
  ])("rejects an unsafe API base %s", (value) => {
    expect(() => normalizeApiOrigin(value)).toThrow();
  });
});

describe("offline policy cache and growth mode", () => {
  const now = Date.parse("2026-05-01T12:00:00Z");

  it("marks a signed-in cache stale when missing, expired, or affected by clock rollback", () => {
    expect(isPolicyCacheStale({ accessToken: "token", lastSyncAt: null }, now)).toBe(true);
    expect(
      isPolicyCacheStale({ accessToken: "token", lastSyncAt: "2026-04-30T11:59:59Z" }, now),
    ).toBe(true);
    expect(
      isPolicyCacheStale(
        { accessToken: "token", lastSyncAt: "2026-05-01T11:00:00Z", clockChangeDetected: true },
        now,
      ),
    ).toBe(true);
    expect(
      isPolicyCacheStale({ accessToken: "token", lastSyncAt: "2026-05-01T13:00:00Z" }, now),
    ).toBe(true);
  });

  it("keeps a fresh cache through the exact max-age boundary and ignores an empty signed-out cache", () => {
    expect(
      isPolicyCacheStale({ accessToken: "token", lastSyncAt: "2026-04-30T12:00:00Z" }, now),
    ).toBe(false);
    expect(isPolicyCacheStale({ accessToken: null, rules: [], overrides: [] }, now)).toBe(false);
    expect(isPolicyCacheStale({ accessToken: null, rules: [{ id: 1 }] }, now)).toBe(true);
  });

  it("accepts only bounded active growth sessions and fails closed after clock changes", () => {
    const state = { mode: "GROWTH", growthModeStartedAt: now, growthModeUntil: now + 60 * 60_000 };
    expect(isGrowthModeActive(state, now)).toBe(true);
    expect(isGrowthModeActive(state, now + 60 * 60_000)).toBe(false);
    expect(isGrowthModeActive({ ...state, growthModeUntil: now + 60 * 60_001 }, now)).toBe(false);
    expect(isGrowthModeActive({ ...state, clockChangeDetected: true }, now)).toBe(false);
  });
});

describe("offline event queue contracts", () => {
  it("increments sequences independently per product without mutating the prior map", () => {
    const original = { productA: 4 };
    const first = nextClientSequence(original, "productA");
    const second = nextClientSequence(first.eventSequences, "productB");
    expect(first).toEqual({ clientSequence: 5, eventSequences: { productA: 5 } });
    expect(second).toEqual({ clientSequence: 1, eventSequences: { productA: 5, productB: 1 } });
    expect(original).toEqual({ productA: 4 });
  });

  it("keeps the newest events under the queue limit and reports all dropped items", () => {
    const prior = Array.from({ length: DEFAULT_EVENT_QUEUE_LIMIT }, (_, id) => id);
    const result = appendBoundedEvent(prior, DEFAULT_EVENT_QUEUE_LIMIT);
    expect(result.events).toHaveLength(DEFAULT_EVENT_QUEUE_LIMIT);
    expect(result.events[0]).toBe(1);
    expect(result.events.at(-1)).toBe(DEFAULT_EVENT_QUEUE_LIMIT);
    expect(result.dropped).toBe(1);
  });

  it("rejects invalid queue limits", () => {
    expect(() => appendBoundedEvent([], "event", 0)).toThrow("positive integer");
    expect(() => appendBoundedEvent([], "event", 1.5)).toThrow("positive integer");
  });

  it("prunes expired and malformed timestamps while retaining the exact cutoff", () => {
    const now = Date.parse("2026-05-08T12:00:00Z");
    const cutoff = now - DEFAULT_EVENT_RETENTION_MS;
    const result = pruneExpiredEvents(
      [
        { id: "old", occurredAt: new Date(cutoff - 1).toISOString() },
        { id: "cutoff", occurredAt: new Date(cutoff).toISOString() },
        { id: "new", occurredAt: new Date(now).toISOString() },
        { id: "invalid", occurredAt: "bad timestamp" },
      ],
      now,
    );
    expect(result.events.map((event) => event.id)).toEqual(["cutoff", "new"]);
    expect(result.expired).toBe(2);
  });
});
