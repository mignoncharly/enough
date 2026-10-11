export const MAX_BUILD_SESSION_RESERVE_MINUTES = 60;
export const BUILD_SESSION_HEARTBEAT_TIMEOUT_SECONDS = 90;

export type BuildSessionStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "EXHAUSTED" | "EXPIRED";

export interface BuildSessionMeter {
  status: BuildSessionStatus;
  reservedMinutes: number;
  activeMilliseconds: number;
  lastHeartbeatAt: Date;
  expiresAt: Date;
  leaseVersion: number;
}

export interface BuildSessionTransition extends BuildSessionMeter {
  activeSeconds: number;
  addedMilliseconds: number;
  billableMinutes: number;
}

function billableMinutes(activeMilliseconds: number): number {
  return Math.ceil(activeMilliseconds / 60_000);
}

function transition(
  session: BuildSessionMeter,
  now: Date,
  mode: "heartbeat" | "settle" | "resume",
): BuildSessionTransition {
  if (!Number.isFinite(now.getTime())) throw new Error("A valid server timestamp is required.");
  const expiresAt = session.expiresAt;
  const expired = now.getTime() >= expiresAt.getTime();

  if (mode === "resume") {
    if (
      expired ||
      session.status === "EXPIRED" ||
      session.status === "COMPLETED" ||
      session.status === "EXHAUSTED"
    ) {
      return {
        ...session,
        status: "EXPIRED",
        lastHeartbeatAt: now,
        activeSeconds: Math.floor(session.activeMilliseconds / 1000),
        addedMilliseconds: 0,
        billableMinutes: billableMinutes(session.activeMilliseconds),
      };
    }
    const gapSeconds = Math.max(
      0,
      Math.floor((now.getTime() - session.lastHeartbeatAt.getTime()) / 1000),
    );
    if (session.status !== "PAUSED" && gapSeconds <= BUILD_SESSION_HEARTBEAT_TIMEOUT_SECONDS) {
      throw new Error("The build session is still leased to its current device.");
    }
    return {
      ...session,
      status: "ACTIVE",
      lastHeartbeatAt: now,
      leaseVersion: session.leaseVersion + 1,
      activeSeconds: Math.floor(session.activeMilliseconds / 1000),
      addedMilliseconds: 0,
      billableMinutes: billableMinutes(session.activeMilliseconds),
    };
  }

  if (session.status !== "ACTIVE") {
    if (mode === "heartbeat")
      throw new Error("Only an active build session can receive a heartbeat.");
    return {
      ...session,
      status: expired ? "EXPIRED" : session.status,
      activeSeconds: Math.floor(session.activeMilliseconds / 1000),
      addedMilliseconds: 0,
      billableMinutes: billableMinutes(session.activeMilliseconds),
    };
  }

  const effectiveNow = expired ? expiresAt : now;
  const elapsedMilliseconds = Math.max(
    0,
    effectiveNow.getTime() - session.lastHeartbeatAt.getTime(),
  );
  const gapExpired = elapsedMilliseconds > BUILD_SESSION_HEARTBEAT_TIMEOUT_SECONDS * 1000;
  const addedMilliseconds = gapExpired
    ? 0
    : Math.min(
        elapsedMilliseconds,
        Math.max(0, session.reservedMinutes * 60_000 - session.activeMilliseconds),
      );
  const activeMilliseconds = session.activeMilliseconds + addedMilliseconds;
  const activeSeconds = Math.floor(activeMilliseconds / 1000);
  const exhausted = activeMilliseconds >= session.reservedMinutes * 60_000;
  const status = exhausted
    ? "EXHAUSTED"
    : expired
      ? "EXPIRED"
      : gapExpired
        ? "PAUSED"
        : session.status;

  return {
    ...session,
    status,
    activeMilliseconds,
    activeSeconds,
    lastHeartbeatAt: now,
    addedMilliseconds,
    billableMinutes: billableMinutes(activeMilliseconds),
  };
}

export function heartbeatBuildSession(
  session: BuildSessionMeter,
  now: Date,
): BuildSessionTransition {
  return transition(session, now, "heartbeat");
}

export function resumeBuildSession(session: BuildSessionMeter, now: Date): BuildSessionTransition {
  return transition(session, now, "resume");
}

export function settleBuildSession(session: BuildSessionMeter, now: Date): BuildSessionTransition {
  const result = transition(session, now, "settle");
  return {
    ...result,
    status:
      result.status === "EXPIRED" || result.status === "EXHAUSTED" ? result.status : "COMPLETED",
  };
}
