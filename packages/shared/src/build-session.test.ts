import { describe, expect, it } from "vitest";
import {
  BUILD_SESSION_HEARTBEAT_TIMEOUT_SECONDS,
  type BuildSessionMeter,
  heartbeatBuildSession,
  MAX_BUILD_SESSION_RESERVE_MINUTES,
  resumeBuildSession,
  settleBuildSession,
} from "./build-session.ts";

function meter(overrides: Partial<BuildSessionMeter> = {}): BuildSessionMeter {
  return {
    status: "ACTIVE",
    reservedMinutes: 2,
    activeMilliseconds: 0,
    lastHeartbeatAt: new Date("2026-10-11T10:00:00.000Z"),
    expiresAt: new Date("2026-10-11T11:00:00.000Z"),
    leaseVersion: 1,
    ...overrides,
  };
}

describe("server-authoritative build-session metering", () => {
  it("caps a reservation at sixty minutes and charges partial minutes upward", () => {
    expect(MAX_BUILD_SESSION_RESERVE_MINUTES).toBe(60);
    const result = settleBuildSession(meter(), new Date("2026-10-11T10:01:01.000Z"));
    expect(result.status).toBe("COMPLETED");
    expect(result.activeSeconds).toBe(61);
    expect(result.billableMinutes).toBe(2);
    expect(result.activeMilliseconds).toBe(61_000);
  });

  it("meters server elapsed time and stops at the reserved minute limit", () => {
    const result = heartbeatBuildSession(
      meter({ reservedMinutes: 1 }),
      new Date("2026-10-11T10:01:00.000Z"),
    );
    expect(result.status).toBe("EXHAUSTED");
    expect(result.activeSeconds).toBe(60);
    expect(result.billableMinutes).toBe(1);
  });

  it("pauses without billing a heartbeat gap over ninety seconds", () => {
    const result = heartbeatBuildSession(
      meter(),
      new Date(
        meter().lastHeartbeatAt.getTime() + (BUILD_SESSION_HEARTBEAT_TIMEOUT_SECONDS + 1) * 1000,
      ),
    );
    expect(result.status).toBe("PAUSED");
    expect(result.activeSeconds).toBe(0);
    expect(result.addedMilliseconds).toBe(0);
  });

  it("allows stale-session recovery with a new lease version and fences the old lease", () => {
    const paused = heartbeatBuildSession(meter(), new Date("2026-10-11T10:02:00.000Z"));
    const resumed = resumeBuildSession(paused, new Date("2026-10-11T10:02:01.000Z"));
    expect(resumed.status).toBe("ACTIVE");
    expect(resumed.leaseVersion).toBe(2);
    expect(() => resumeBuildSession(meter(), new Date("2026-10-11T10:00:30.000Z"))).toThrow(
      "still leased",
    );
  });

  it("does not meter beyond the lease expiry", () => {
    const result = heartbeatBuildSession(
      meter({ expiresAt: new Date("2026-10-11T10:00:30.000Z") }),
      new Date("2026-10-11T10:01:00.000Z"),
    );
    expect(result.status).toBe("EXPIRED");
    expect(result.activeSeconds).toBe(30);
  });

  it("preserves fractional-second heartbeats without dropping elapsed time", () => {
    const started = meter();
    const first = heartbeatBuildSession(started, new Date(started.lastHeartbeatAt.getTime() + 500));
    const second = heartbeatBuildSession(
      { ...started, ...first },
      new Date(started.lastHeartbeatAt.getTime() + 1000),
    );
    expect(second.activeMilliseconds).toBe(1000);
    expect(second.activeSeconds).toBe(1);
  });
});
