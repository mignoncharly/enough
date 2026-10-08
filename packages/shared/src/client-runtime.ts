export const DEFAULT_EVENT_QUEUE_LIMIT = 1_000;
export const DEFAULT_EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const DEFAULT_POLICY_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
export const DEFAULT_GROWTH_MODE_MAX_DURATION_MS = 60 * 60_000;

export interface OfflinePolicyCacheState {
  accessToken?: unknown;
  lastSyncAt?: string | null;
  lastClockObservedAt?: string | null;
  clockChangeDetected?: boolean;
  rules?: readonly unknown[] | null;
  overrides?: readonly unknown[] | null;
}

export interface GrowthModeState {
  mode?: string | null;
  growthModeStartedAt?: unknown;
  growthModeUntil?: unknown;
  clockChangeDetected?: boolean;
}

export interface TimestampedQueueItem {
  occurredAt: string;
}

export function normalizeApiOrigin(raw: string): string {
  const value = String(raw || "")
    .trim()
    .replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid API origin.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      "Use HTTPS for a remote API. Plain HTTP is allowed only for loopback development.",
    );
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Enter the API origin only, such as https://api.example.com.");
  }
  return url.origin;
}

export function isPolicyCacheStale(
  state: OfflinePolicyCacheState,
  now = Date.now(),
  maxAgeMs = DEFAULT_POLICY_CACHE_MAX_AGE_MS,
): boolean {
  if (!state.accessToken)
    return Boolean(state.lastSyncAt || state.rules?.length || state.overrides?.length);
  if (state.clockChangeDetected) return true;
  const lastObserved = Date.parse(state.lastClockObservedAt ?? "");
  if (Number.isFinite(lastObserved) && now < lastObserved) return true;
  const syncedAt = Date.parse(state.lastSyncAt ?? "");
  const age = now - syncedAt;
  return !Number.isFinite(syncedAt) || age < 0 || age > maxAgeMs;
}

export function isGrowthModeActive(
  state: GrowthModeState,
  now = Date.now(),
  maxDurationMs = DEFAULT_GROWTH_MODE_MAX_DURATION_MS,
): boolean {
  if (state.clockChangeDetected) return false;
  const startedAt = Number(state.growthModeStartedAt);
  const until = Number(state.growthModeUntil);
  const duration = until - startedAt;
  return (
    state.mode === "GROWTH" &&
    Number.isFinite(startedAt) &&
    Number.isFinite(until) &&
    duration > 0 &&
    duration <= maxDurationMs &&
    now >= startedAt &&
    now < until
  );
}

export function nextClientSequence(
  eventSequences: Readonly<Record<string, number>>,
  productId: string,
): { clientSequence: number; eventSequences: Record<string, number> } {
  const nextSequences = { ...eventSequences };
  const clientSequence = Number(nextSequences[productId] || 0) + 1;
  nextSequences[productId] = clientSequence;
  return { clientSequence, eventSequences: nextSequences };
}

export function appendBoundedEvent<T>(
  events: readonly T[],
  event: T,
  limit = DEFAULT_EVENT_QUEUE_LIMIT,
): { events: T[]; dropped: number } {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("Event queue limit must be a positive integer.");
  const queued = [...events, event];
  const dropped = Math.max(0, queued.length - limit);
  return { events: queued.slice(-limit), dropped };
}

export function pruneExpiredEvents<T extends TimestampedQueueItem>(
  events: readonly T[],
  now = Date.now(),
  retentionMs = DEFAULT_EVENT_RETENTION_MS,
): { events: T[]; expired: number } {
  const cutoff = now - retentionMs;
  const retained = events.filter((event) => Date.parse(event.occurredAt) >= cutoff);
  return { events: retained, expired: events.length - retained.length };
}
