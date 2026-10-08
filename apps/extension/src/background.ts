import {
  appendBoundedEvent,
  isGrowthModeActive,
  isPolicyCacheStale,
  nextClientSequence,
  normalizeApiOrigin,
  pruneExpiredEvents,
} from "../../../packages/shared/src/client-runtime.ts";
import { evaluatePolicyRules } from "../../../packages/shared/src/policy-rules.ts";
import {
  normalizeToolKey,
  resolveToolClassification,
} from "../../../packages/shared/src/tool-classification.ts";

const api = globalThis.browser ?? globalThis.chrome;
const OWNED_RULE_ID_MIN = 1000;
const OWNED_RULE_ID_MAX = 2999;
const RULE_LIMIT = 900;
const SYNC_MINUTES = 5;
const GROWTH_SESSION_MINUTES = 60;
const POLICY_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
const CLOCK_CHANGE_TOLERANCE_MS = 60_000;
const CLOCK_PERSIST_INTERVAL_MS = 30_000;
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_QUEUED_EVENTS = 1000;
const eventName = "browser.domain_visited";
const allDomainsRegex = "^https?://[^/?#.:]+(?:\\.[^/?#.:]+)*(?::[0-9]+)?(?:[/?#]|$)";
const seedDomains = ["replit.com", "lovable.dev", "bolt.new", "v0.dev", "github.com", "localhost"];
const growthAllowlist = [
  "gmail.com",
  "outlook.live.com",
  "outlook.office.com",
  "linkedin.com",
  "x.com",
  "reddit.com",
  "calendar.google.com",
  "analytics.google.com",
  "hubspot.com",
  "salesforce.com",
];
let nativePort: any = null;
let activityConsentSynchronized = false;
let lastWallClockCheck = Date.now();
let lastMonotonicClockCheck = performance.now();
let eventFlushInFlight: Promise<void> | null = null;
let eventQueue: Promise<unknown> = Promise.resolve();

function serializeEventQueue<T>(operation: () => Promise<T>): Promise<T> {
  const task = eventQueue.then(operation, operation);
  eventQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task as Promise<T>;
}

type ExtensionRule = {
  id: string;
  version: number;
  name: string;
  enabled: boolean;
  priority: number;
  productId: string | null;
  deviceId: string | null;
  action: "ALLOW" | "BLOCK" | "WARN" | "REQUIRE_OVERRIDE";
  conditions: Record<string, unknown>;
  schedule: Record<string, unknown> | null;
  archivedAt?: string | null;
};
type ExtensionOverride = {
  id: string;
  productId: string | null;
  deviceId: string | null;
  toolKind: "APPLICATION" | "DOMAIN";
  toolKey: string;
  action: "ALLOW" | "BLOCK";
  reason: string;
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string | null;
};
type DomainCandidate = { key: string; evaluationHost: string; regex: string };
type QueuedEvent = {
  eventId: string;
  productId: string;
  eventType: string;
  eventVersion: number;
  clientSequence: number;
  occurredAt: string;
  attributes: Record<string, string | number | boolean | null>;
};

function runtimeUrl(path: string): string {
  return api.runtime.getURL(path);
}

function policyCacheExpired(state: Record<string, any>, now = Date.now()): boolean {
  return isPolicyCacheStale(state, now, POLICY_CACHE_MAX_AGE_MS);
}

function growthModeIsActive(state: Record<string, any>, now = Date.now()): boolean {
  return isGrowthModeActive(state, now, GROWTH_SESSION_MINUTES * 60_000);
}

async function readState(): Promise<Record<string, any>> {
  const state = (await api.storage.local.get(null)) ?? {};
  const now = Date.now();
  const monotonicNow = performance.now();
  const wallDelta = now - lastWallClockCheck;
  const monotonicDelta = monotonicNow - lastMonotonicClockCheck;
  const lastObserved = Date.parse(state.lastClockObservedAt ?? "");
  const clockChanged =
    (Number.isFinite(lastObserved) && now < lastObserved) ||
    Math.abs(wallDelta - monotonicDelta) > CLOCK_CHANGE_TOLERANCE_MS;
  lastWallClockCheck = now;
  lastMonotonicClockCheck = monotonicNow;
  const shouldPersistObservation =
    !Number.isFinite(lastObserved) || now - lastObserved >= CLOCK_PERSIST_INTERVAL_MS;
  if (!clockChanged && !shouldPersistObservation) return state;
  const patch = {
    lastClockObservedAt: new Date(now).toISOString(),
    ...(clockChanged
      ? {
          clockChangeDetected: true,
          mode: "BUILD",
          growthModeStartedAt: null,
          growthModeUntil: null,
        }
      : {}),
  };
  await api.storage.local.set(patch);
  return { ...state, ...patch };
}

async function writeState(values: Record<string, unknown>): Promise<void> {
  await api.storage.local.set(values);
}

function apiBaseFrom(state: Record<string, any>): string {
  const value = String(state.apiBaseUrl ?? "");
  return value ? normalizeApiBase(value) : "";
}

async function apiRequest<T>(
  state: Record<string, any>,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const base = apiBaseFrom(state);
  if (!base) throw new Error("Set your Enough API address in extension settings first.");
  const headers = new Headers(init.headers);
  if (state.accessToken) headers.set("authorization", `Bearer ${state.accessToken}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    const error = new Error(payload.error ?? `Enough API returned ${response.status}.`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return payload;
}

function normalizeApiBase(raw: string): string {
  return normalizeApiOrigin(raw);
}

async function login(message: {
  apiBaseUrl: string;
  email: string;
  password: string;
  deviceName?: string;
}) {
  const apiBaseUrl = normalizeApiBase(message.apiBaseUrl);
  const originPattern = `${new URL(apiBaseUrl).origin}/*`;
  const allowed = await api.permissions.contains({ origins: [originPattern] });
  if (!allowed)
    throw new Error("Grant this extension access to your API origin, then sign in again.");
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: message.email.trim(),
      password: message.password,
      clientType: "extension",
      deviceName: message.deviceName || "Enough browser extension",
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Extension sign-in failed.");
  if (typeof payload.accessToken !== "string" || typeof payload.deviceId !== "string") {
    throw new Error("The API did not return an extension session token.");
  }
  activityConsentSynchronized = false;
  await clearOwnedRules();
  await writeState({
    apiBaseUrl,
    accessToken: payload.accessToken,
    sessionId: payload.sessionId,
    deviceId: payload.deviceId,
    expiresAt: payload.expiresAt,
    user: payload.user,
    mode: "BUILD",
    growthModeStartedAt: null,
    growthModeUntil: null,
    rules: [],
    overrides: [],
    catalog: [],
    mappings: [],
    products: [],
    selectedProductId: "",
    lastSyncAt: null,
    trackingEnabled: false,
    activityCollectionEnabled: false,
    activityConsentRevision: null,
    events: [],
    eventSequences: {},
    discardedEventCount: 0,
    blockedTabs: {},
  });
  await syncPolicy().catch(() => undefined);
  await api.alarms.create("enough-policy-sync", { periodInMinutes: SYNC_MINUTES });
  return safeState(await readState());
}

async function loginWithDeviceToken(message: { apiBaseUrl: string; accessToken: string }) {
  const apiBaseUrl = normalizeApiBase(message.apiBaseUrl);
  const originPattern = `${new URL(apiBaseUrl).origin}/*`;
  if (!(await api.permissions.contains({ origins: [originPattern] }))) {
    throw new Error("Grant this extension access to your API origin, then connect again.");
  }
  const response = await fetch(`${apiBaseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${message.accessToken.trim()}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "The extension token is invalid or expired.");
  if (!payload.user?.id || !payload.session?.id || !payload.session?.deviceId) {
    throw new Error("The API did not return an active extension session.");
  }
  activityConsentSynchronized = false;
  await clearOwnedRules();
  await writeState({
    apiBaseUrl,
    accessToken: message.accessToken.trim(),
    sessionId: payload.session.id,
    deviceId: payload.session.deviceId,
    expiresAt: payload.session.expiresAt,
    user: payload.user,
    mode: "BUILD",
    growthModeStartedAt: null,
    growthModeUntil: null,
    rules: [],
    overrides: [],
    catalog: [],
    mappings: [],
    products: [],
    selectedProductId: "",
    lastSyncAt: null,
    trackingEnabled: false,
    activityCollectionEnabled: false,
    activityConsentRevision: null,
    events: [],
    eventSequences: {},
    discardedEventCount: 0,
    blockedTabs: {},
  });
  await syncPolicy().catch(() => undefined);
  await api.alarms.create("enough-policy-sync", { periodInMinutes: SYNC_MINUTES });
  return safeState(await readState());
}

function safeState(state: Record<string, any>) {
  const now = Date.now();
  const growthActive = growthModeIsActive(state, now);
  return {
    connected: Boolean(state.accessToken),
    email: state.user?.email ?? "",
    apiBaseUrl: state.apiBaseUrl ?? "",
    mode: growthActive ? "GROWTH" : "BUILD",
    growthModeUntil: growthActive ? state.growthModeUntil : null,
    products: state.products ?? [],
    selectedProductId: state.selectedProductId ?? "",
    lastSyncAt: state.lastSyncAt ?? null,
    policyStale: policyCacheExpired(state, now),
    trackingEnabled: Boolean(state.trackingEnabled),
    activityCollectionEnabled: Boolean(
      state.activityCollectionEnabled && activityConsentSynchronized,
    ),
    queuedEvents: Array.isArray(state.events) ? state.events.length : 0,
    discardedEvents: Math.max(0, Number(state.discardedEventCount) || 0),
    syncError: state.syncError ?? "",
    blockingRules: Number(state.blockingRules ?? 0),
    unsupportedRules: Number(state.unsupportedRules ?? 0),
    truncatedCandidates: Boolean(state.truncatedCandidates),
    missingPermissions: Number(state.missingPermissions ?? 0),
    nativeAgent: state.nativeAgent === true,
  };
}

function hostRegex(domainKey: string): string {
  const wildcard = domainKey.startsWith("*.");
  const domain = wildcard ? domainKey.slice(2) : domainKey;
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return wildcard
    ? `^https?://(?:[^/?#.:]+\\.)+${escaped}(?::[0-9]+)?(?:[/?#]|$)`
    : `^https?://${escaped}(?::[0-9]+)?(?:[/?#]|$)`;
}

function candidateFromKey(rawKey: string): DomainCandidate | null {
  try {
    const key = normalizeToolKey("DOMAIN", rawKey);
    return {
      key,
      evaluationHost: key.startsWith("*.") ? `sample.${key.slice(2)}` : key,
      regex: hostRegex(key),
    };
  } catch {
    return null;
  }
}

function gatherCandidates(
  rules: ExtensionRule[],
  overrides: ExtensionOverride[],
  catalog: any[],
  mappings: any[],
) {
  const found = new Map<string, DomainCandidate>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const candidate = candidateFromKey(value);
    if (candidate) found.set(candidate.key, candidate);
  };
  for (const host of seedDomains) add(host);
  for (const entry of [...catalog, ...mappings])
    if (entry?.toolKind === "DOMAIN") add(entry.toolKey);
  for (const rule of rules) {
    const conditions = rule.conditions as { toolKind?: string; toolKeys?: string[] };
    if (conditions.toolKind === "DOMAIN") conditions.toolKeys?.forEach(add);
  }
  for (const override of overrides) if (override.toolKind === "DOMAIN") add(override.toolKey);
  const all = [...found.values()];
  return { candidates: all.slice(0, RULE_LIMIT), truncated: all.length > RULE_LIMIT };
}

async function createDynamicRules(state: Record<string, any>) {
  if (policyCacheExpired(state)) {
    await clearOwnedRules();
    return {
      blockingRules: 0,
      missingPermissions: 0,
      unsupportedRules: 0,
      truncatedCandidates: false,
    };
  }
  const rules = (state.rules ?? []) as ExtensionRule[];
  const overrides = (state.overrides ?? []) as ExtensionOverride[];
  const catalog = state.catalog ?? [];
  const mappings = state.mappings ?? [];
  const productId = state.selectedProductId || null;
  const deviceId = state.deviceId || null;
  const mode = growthModeIsActive(state) ? "growth" : "build";
  const { candidates, truncated } = gatherCandidates(rules, overrides, catalog, mappings);
  const updatedRules: any[] = [];
  const blocked = new Set<string>();
  let unsupported = 0;
  const [exactRegexSupport, wildcardRegexSupport] = await Promise.all([
    api.declarativeNetRequest.isRegexSupported({ regex: hostRegex("example.com") }),
    api.declarativeNetRequest.isRegexSupported({ regex: hostRegex("*.example.com") }),
  ]);

  const hasFallbackDomainPolicy = rules.some((rule) => {
    const conditions = rule.conditions as { toolKind?: string; toolKeys?: unknown[] };
    return (
      rule.enabled &&
      !rule.archivedAt &&
      (conditions.toolKind === "DOMAIN" || !conditions.toolKind) &&
      !conditions.toolKeys?.length
    );
  });
  if (hasFallbackDomainPolicy) {
    const catchAll = await api.declarativeNetRequest.isRegexSupported({ regex: allDomainsRegex });
    const decision = isDenied(state, new URL("https://enough-extension-probe.invalid/"));
    if (catchAll.isSupported) {
      updatedRules.push({
        id: OWNED_RULE_ID_MIN,
        priority: 1,
        action: { type: decision.allowed ? "allow" : "block" },
        condition: { regexFilter: allDomainsRegex, resourceTypes: ["main_frame"] },
      });
      if (!decision.allowed) blocked.add("*");
    } else if (!catchAll.isSupported) unsupported += 1;
  }

  for (const [candidateIndex, candidate] of candidates.entries()) {
    const toolKey = normalizeToolKey("DOMAIN", candidate.evaluationHost);
    const classification = resolveToolClassification(
      { toolKind: "DOMAIN", toolKey, productId },
      mappings,
      catalog,
    );
    const decision = evaluatePolicyRules(
      {
        toolKind: "DOMAIN",
        toolKey,
        classification: classification.classification,
        productId,
        deviceId,
        contextKey: "mode",
        contextValue: mode,
        evaluatedAt: new Date().toISOString(),
      },
      rules,
      overrides,
    );
    const regexSupported = candidate.key.startsWith("*.")
      ? wildcardRegexSupport.isSupported
      : exactRegexSupport.isSupported;
    if (!regexSupported) {
      unsupported += 1;
      continue;
    }
    const wildcard = candidate.key.startsWith("*.");
    updatedRules.push({
      id: OWNED_RULE_ID_MIN + 100 + candidateIndex,
      priority: wildcard ? 50_000 + candidate.key.length : 100_000 + candidate.key.length,
      action: { type: decision.allowed ? "allow" : "block" },
      condition: { regexFilter: candidate.regex, resourceTypes: ["main_frame"] },
    });
    if (!decision.allowed) blocked.add(candidate.key);
  }

  if (mode === "growth") {
    for (const domain of growthAllowlist) {
      const candidate = candidateFromKey(domain);
      if (!candidate) continue;
      if (!exactRegexSupport.isSupported) {
        unsupported += 1;
        continue;
      }
      updatedRules.push({
        id: OWNED_RULE_ID_MIN + 1000 + growthAllowlist.indexOf(domain),
        priority: 300_000,
        action: { type: "allow" },
        condition: { regexFilter: candidate.regex, resourceTypes: ["main_frame"] },
      });
    }
  }

  if (updatedRules.length > 1900)
    throw new Error(
      "The current policy creates more browser rules than this extension can safely install.",
    );
  const oldRules = await api.declarativeNetRequest.getDynamicRules();
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRules
      .filter((rule: any) => rule.id >= OWNED_RULE_ID_MIN && rule.id <= OWNED_RULE_ID_MAX)
      .map((rule: any) => rule.id),
    addRules: updatedRules,
  });
  return {
    blockingRules: blocked.size,
    missingPermissions: 0,
    unsupportedRules: unsupported,
    truncatedCandidates: truncated,
  };
}

async function syncPolicy() {
  let state = await readState();
  if (!state.accessToken) return safeState(state);
  let consentChecked = false;
  let serverActivityConsent = false;
  try {
    if (state.expiresAt && Date.parse(state.expiresAt) - Date.now() < 24 * 60 * 60_000) {
      const rotated = await apiRequest<{ accessToken: string; expiresAt: string }>(
        state,
        "/auth/session/rotate",
        { method: "POST" },
      );
      await writeState({ accessToken: rotated.accessToken, expiresAt: rotated.expiresAt });
      state = await readState();
    }
    const consentData = await apiRequest<{
      activityCollectionEnabled: boolean;
      activityConsentRevision: string | null;
    }>(state, "/privacy-consents");
    consentChecked = true;
    const activityCollectionEnabled = consentData.activityCollectionEnabled === true;
    serverActivityConsent = activityCollectionEnabled;
    activityConsentSynchronized = true;
    const consentChanged = state.activityConsentRevision !== consentData.activityConsentRevision;
    await writeState({
      activityCollectionEnabled,
      activityConsentRevision: consentData.activityConsentRevision,
      ...(!activityCollectionEnabled || consentChanged
        ? { trackingEnabled: false, events: [] }
        : {}),
    });
    state = await readState();
    const [ruleData, catalogData, mappingData, productData] = await Promise.all([
      apiRequest<{ rules: ExtensionRule[]; overrides: ExtensionOverride[] }>(state, "/rules"),
      apiRequest<{ catalog: any[] }>(state, "/classification/catalog?kind=DOMAIN"),
      apiRequest<{ mappings: any[] }>(state, "/classification/mappings"),
      apiRequest<{ products: Array<{ id: string; name: string }> }>(state, "/products"),
    ]);
    const products = productData.products ?? [];
    const selectedProductId = products.some((product) => product.id === state.selectedProductId)
      ? state.selectedProductId
      : (products[0]?.id ?? "");
    const trackingEnabled = activityCollectionEnabled && Boolean(state.trackingEnabled);
    const events = activityCollectionEnabled
      ? (state.events ?? []).filter((event: QueuedEvent) =>
          products.some((product) => product.id === event.productId),
        )
      : [];
    await writeState({
      rules: ruleData.rules ?? [],
      overrides: ruleData.overrides ?? [],
      catalog: catalogData.catalog ?? [],
      mappings: mappingData.mappings ?? [],
      products,
      selectedProductId,
      activityCollectionEnabled,
      trackingEnabled,
      events,
      lastSyncAt: new Date().toISOString(),
      lastClockObservedAt: new Date().toISOString(),
      clockChangeDetected: false,
      syncError: "",
    });
    const freshState = await readState();
    const result = await createDynamicRules(freshState);
    await writeState(result);
    await api.action.setBadgeText({
      text: result.blockingRules ? String(Math.min(result.blockingRules, 99)) : "",
    });
    await api.action.setBadgeBackgroundColor({ color: "#245b48" });
    return safeState(await readState());
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Policy sync failed.";
    const consentDenied =
      (cause as { status?: number })?.status === 403 &&
      message.includes("Activity collection is disabled");
    if (consentDenied) {
      activityConsentSynchronized = false;
      await writeState({
        activityCollectionEnabled: false,
        trackingEnabled: false,
        events: [],
        syncError: message,
      });
    } else if (!consentChecked || !serverActivityConsent) {
      if (!consentChecked) activityConsentSynchronized = false;
      await writeState({
        activityCollectionEnabled: false,
        trackingEnabled: false,
        syncError: message,
      });
    } else if ((cause as { status?: number })?.status !== 401) {
      await writeState({ syncError: message });
    } else {
      await writeState({ syncError: message });
    }
    if ((cause as { status?: number })?.status === 401) {
      activityConsentSynchronized = false;
      await clearOwnedRules().catch(() => undefined);
      await writeState({
        accessToken: null,
        sessionId: null,
        deviceId: null,
        expiresAt: null,
        user: null,
        mode: "BUILD",
        growthModeStartedAt: null,
        growthModeUntil: null,
        rules: [],
        overrides: [],
        catalog: [],
        mappings: [],
        events: [],
        discardedEventCount: 0,
        lastSyncAt: null,
        clockChangeDetected: false,
        lastClockObservedAt: new Date().toISOString(),
        blockingRules: 0,
        trackingEnabled: false,
        activityCollectionEnabled: false,
        activityConsentRevision: null,
      });
      await api.alarms.clear("enough-policy-sync");
    }
    const latestState = await readState();
    if (policyCacheExpired(latestState)) {
      await clearOwnedRules().catch(() => undefined);
      await writeState({
        syncError: latestState.accessToken
          ? `${message} Cached policy expired; extension enforcement is paused until policy sync succeeds.`
          : message,
      });
    }
    throw cause;
  }
}

function isDenied(state: Record<string, any>, url: URL) {
  if (policyCacheExpired(state)) {
    return {
      allowed: true,
      reason: "Cached policy expired; enforcement is paused until sync succeeds.",
      action: "ALLOW",
    };
  }
  const productId = state.selectedProductId || null;
  const toolKey = normalizeToolKey("DOMAIN", url.hostname);
  const classification = resolveToolClassification(
    { toolKind: "DOMAIN", toolKey, productId },
    state.mappings ?? [],
    state.catalog ?? [],
  );
  const mode = growthModeIsActive(state) ? "growth" : "build";
  if (
    mode === "growth" &&
    growthAllowlist.some((domain) => toolKey === domain || toolKey.endsWith(`.${domain}`))
  ) {
    return { allowed: true, reason: "Growth Mode allowlist", action: "ALLOW" };
  }
  return evaluatePolicyRules(
    {
      toolKind: "DOMAIN",
      toolKey,
      classification: classification.classification,
      productId,
      deviceId: state.deviceId || null,
      contextKey: "mode",
      contextValue: mode,
      evaluatedAt: new Date().toISOString(),
    },
    state.rules ?? [],
    state.overrides ?? [],
  );
}

async function handleNavigation(details: any) {
  if (details.frameId !== 0 || !details.url.startsWith("http")) return;
  let url: URL;
  try {
    url = new URL(details.url);
  } catch {
    return;
  }
  const state = await readState();
  if (!state.accessToken) return;
  if (policyCacheExpired(state)) {
    await clearOwnedRules().catch(() => undefined);
    return;
  }
  try {
    const decision = isDenied(state, url);
    if (decision.allowed) return;
    const block = {
      host: url.hostname,
      reason: decision.reason,
      action: decision.action,
      at: Date.now(),
    };
    const blockedTabs = { ...(state.blockedTabs ?? {}), [String(details.tabId)]: block };
    const recentBlockedTabs = Object.fromEntries(Object.entries(blockedTabs).slice(-100));
    await writeState({ blockedTabs: recentBlockedTabs });
    await api.tabs.update(details.tabId, {
      url: `${runtimeUrl("block.html")}?tabId=${details.tabId}`,
    });
  } catch {
    // If cached policy cannot be evaluated, the installed DNR rules remain the enforcement fallback.
  }
}

async function enqueueVisit(details: any) {
  if (details.frameId !== 0 || !details.url.startsWith("http")) return;
  const state = await readState();
  if (policyCacheExpired(state)) {
    await clearOwnedRules().catch(() => undefined);
    return;
  }
  if (
    !activityConsentSynchronized ||
    !state.accessToken ||
    !state.trackingEnabled ||
    !state.activityCollectionEnabled ||
    !state.selectedProductId
  )
    return;
  let url: URL;
  try {
    url = new URL(details.url);
  } catch {
    return;
  }
  const decision = isDenied(state, url);
  if (!decision.allowed) return;
  const productId = state.selectedProductId as string;
  const { clientSequence, eventSequences } = nextClientSequence(
    state.eventSequences ?? {},
    productId,
  );
  const currentEvents = Array.isArray(state.events) ? (state.events as QueuedEvent[]) : [];
  const occurredAt = Number(details.timeStamp);
  const event = {
    eventId: crypto.randomUUID(),
    productId,
    eventType: eventName,
    eventVersion: 1,
    clientSequence,
    occurredAt: new Date(
      Number.isFinite(occurredAt) && occurredAt > 0 ? occurredAt : Date.now(),
    ).toISOString(),
    attributes: {
      hostname: url.hostname,
      policy_action: decision.action,
      mode: state.mode ?? "BUILD",
    },
  };
  const { events, dropped } = appendBoundedEvent(currentEvents, event, MAX_QUEUED_EVENTS);
  await writeState({
    events,
    eventSequences,
    discardedEventCount: Math.max(0, Number(state.discardedEventCount) || 0) + dropped,
  });
}

function flushEvents(): Promise<void> {
  if (eventFlushInFlight) return eventFlushInFlight;
  eventFlushInFlight = flushEventsOnce().finally(() => {
    eventFlushInFlight = null;
  });
  return eventFlushInFlight;
}

async function flushEventsOnce(): Promise<void> {
  const initial = await serializeEventQueue(async () => {
    const state = await readState();
    if (!activityConsentSynchronized) return { state, remaining: [] as QueuedEvent[] };
    if (!state.activityCollectionEnabled) {
      if (state.events?.length) await writeState({ events: [] });
      return { state, remaining: [] as QueuedEvent[] };
    }
    const queuedEvents = Array.isArray(state.events) ? (state.events as QueuedEvent[]) : [];
    const pruned = pruneExpiredEvents(queuedEvents, Date.now(), EVENT_RETENTION_MS);
    const remaining = pruned.events;
    const expired = pruned.expired;
    await writeState({
      events: remaining,
      discardedEventCount: Math.max(0, Number(state.discardedEventCount) || 0) + expired,
    });
    return { state, remaining };
  });
  let { state, remaining } = initial;
  if (
    !activityConsentSynchronized ||
    !state.activityCollectionEnabled ||
    !state.accessToken ||
    remaining.length === 0
  )
    return;
  while (remaining.length) {
    const batch = remaining.slice(0, 100);
    try {
      await apiRequest(state, "/activity/batch", {
        method: "POST",
        body: JSON.stringify({ events: batch }),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Activity submission failed.";
      if (
        (cause as { status?: number })?.status === 403 &&
        message.includes("Activity collection is disabled")
      ) {
        activityConsentSynchronized = false;
        await writeState({
          activityCollectionEnabled: false,
          trackingEnabled: false,
          events: [],
          syncError: message,
        });
      }
      throw cause;
    }
    const acceptedIds = new Set(batch.map((event: QueuedEvent) => event.eventId));
    remaining = await serializeEventQueue(async () => {
      const latest = await readState();
      const unacknowledged = (
        Array.isArray(latest.events) ? (latest.events as QueuedEvent[]) : []
      ).filter((event) => !acceptedIds.has(event.eventId));
      const nextPrune = pruneExpiredEvents(unacknowledged, Date.now(), EVENT_RETENTION_MS);
      const next = nextPrune.events;
      const expiredDuringUpload = nextPrune.expired;
      await writeState({
        events: next,
        discardedEventCount:
          Math.max(0, Number(latest.discardedEventCount) || 0) + expiredDuringUpload,
      });
      return next;
    });
  }
}

async function setMode(mode: "BUILD" | "GROWTH") {
  const growthModeStartedAt = mode === "GROWTH" ? Date.now() : null;
  const growthModeUntil =
    growthModeStartedAt === null ? null : growthModeStartedAt + GROWTH_SESSION_MINUTES * 60_000;
  await writeState({ mode, growthModeStartedAt, growthModeUntil });
  if (mode === "GROWTH")
    await api.alarms.create("enough-growth-session-end", { when: growthModeUntil });
  else await api.alarms.clear("enough-growth-session-end");
  const state = await readState();
  if (state.accessToken) {
    await createDynamicRules(state);
    await syncPolicy().catch(() => undefined);
  }
  return safeState(await readState());
}

async function logout() {
  const state = await readState();
  if (state.accessToken) {
    await apiRequest(state, "/auth/logout", { method: "POST" }).catch(() => undefined);
  }
  await writeState({
    accessToken: null,
    sessionId: null,
    deviceId: null,
    expiresAt: null,
    user: null,
    mode: "BUILD",
    growthModeStartedAt: null,
    growthModeUntil: null,
    rules: [],
    overrides: [],
    catalog: [],
    mappings: [],
    events: [],
    eventSequences: {},
    discardedEventCount: 0,
    lastSyncAt: null,
    clockChangeDetected: false,
    lastClockObservedAt: new Date().toISOString(),
    syncError: "",
    nativeAgent: false,
    trackingEnabled: false,
    activityCollectionEnabled: false,
    activityConsentRevision: null,
  });
  activityConsentSynchronized = false;
  nativePort?.disconnect();
  nativePort = null;
  await clearOwnedRules();
  await api.action.setBadgeText({ text: "" });
  await api.alarms.clear("enough-policy-sync");
  await api.alarms.clear("enough-growth-session-end");
  return safeState(await readState());
}

async function clearOwnedRules() {
  const dynamic = await api.declarativeNetRequest.getDynamicRules();
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: dynamic
      .filter((rule: any) => rule.id >= OWNED_RULE_ID_MIN && rule.id <= OWNED_RULE_ID_MAX)
      .map((rule: any) => rule.id),
    addRules: [],
  });
  await writeState({ blockingRules: 0 });
  await api.action.setBadgeText({ text: "" });
}

async function connectNativeAgent() {
  const state = await readState();
  if (!state.accessToken) throw new Error("Sign in before connecting the desktop agent.");
  if (nativePort) nativePort.disconnect();
  try {
    const port = api.runtime.connectNative("com.enough.agent");
    nativePort = port;
    await writeState({ nativeAgent: false });
    return await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        port.disconnect();
        reject(
          new Error(
            "The native messaging host did not respond. Check its installation and restart the browser.",
          ),
        );
      }, 3000);
      port.onDisconnect.addListener(() => {
        nativePort = null;
        void writeState({ nativeAgent: false });
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(
          new Error(
            api.runtime.lastError?.message ??
              "The native messaging host disconnected before replying.",
          ),
        );
      });
      port.onMessage.addListener(async (message: any) => {
        if (message?.type !== "health") return;
        const running = message.status === "ok" && message.agentRunning === true;
        void writeState({ nativeAgent: running });
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!running) {
          nativePort = null;
          port.disconnect();
          reject(
            new Error("The native messaging host is installed, but Enough Desktop is not running."),
          );
          return;
        }
        resolve(safeState(await readState()));
      });
      port.postMessage({ type: "health-check" });
    });
  } catch (cause) {
    nativePort?.disconnect();
    nativePort = null;
    await writeState({ nativeAgent: false });
    throw new Error(
      cause instanceof Error
        ? cause.message
        : "Could not reach the Enough native host. Install the desktop browser bridge and restart the browser.",
    );
  }
}

async function handleMessage(message: any) {
  if (!message || typeof message.type !== "string") throw new Error("Unknown extension action.");
  if (message.type === "GET_STATE") return safeState(await readState());
  if (message.type === "LOGIN") return login(message);
  if (message.type === "LOGIN_TOKEN") return loginWithDeviceToken(message);
  if (message.type === "LOGOUT") return logout();
  if (message.type === "SYNC") return syncPolicy();
  if (message.type === "SET_PRODUCT") {
    const productId = String(message.productId ?? "");
    const state = await readState();
    if (!state.products?.some((product: any) => product.id === productId))
      throw new Error("Choose a product in your account.");
    await writeState({ selectedProductId: productId });
    const updated = await readState();
    await createDynamicRules(updated);
    await syncPolicy().catch(() => undefined);
    return safeState(await readState());
  }
  if (message.type === "SET_MODE") return setMode(message.mode === "GROWTH" ? "GROWTH" : "BUILD");
  if (message.type === "SET_TRACKING") {
    const state = await readState();
    if (message.enabled && (!activityConsentSynchronized || !state.activityCollectionEnabled))
      throw new Error(
        "Activity collection consent is off or has not synced. Grant it in Enough Privacy settings, sync this extension, then enable local tracking.",
      );
    await writeState({ trackingEnabled: Boolean(message.enabled) });
    return safeState(await readState());
  }
  if (message.type === "CONNECT_NATIVE") return connectNativeAgent();
  if (message.type === "BLOCK_INFO") {
    const state = await readState();
    const block = state.blockedTabs?.[String(message.tabId)];
    return block && Date.now() - Number(block.at) < 5 * 60_000 ? block : null;
  }
  if (message.type === "START_GROWTH") {
    const state = await readState();
    const block = state.blockedTabs?.[String(message.tabId)];
    await setMode("GROWTH");
    if (block?.host && Number.isInteger(message.tabId)) {
      await api.tabs.update(message.tabId, { url: `https://${block.host}/` });
    }
    return safeState(await readState());
  }
  if (message.type === "FLUSH_EVENTS") {
    await flushEvents();
    return safeState(await readState());
  }
  throw new Error("Unknown extension action.");
}

api.runtime.onInstalled.addListener(async () => {
  if (api.storage.local.setAccessLevel)
    await api.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await api.alarms.create("enough-policy-sync", { periodInMinutes: SYNC_MINUTES });
});

api.runtime.onStartup.addListener(async () => {
  const state = await readState();
  if (!state.accessToken) {
    await clearOwnedRules().catch(() => undefined);
    return;
  }
  if (state.mode === "GROWTH" && !growthModeIsActive(state)) {
    await writeState({ mode: "BUILD", growthModeStartedAt: null, growthModeUntil: null });
  }
  await createDynamicRules(await readState()).catch(() => undefined);
  await syncPolicy().catch(() => undefined);
});

api.alarms.onAlarm.addListener((alarm: any) => {
  if (alarm.name === "enough-policy-sync") void syncPolicy().catch(() => undefined);
  if (alarm.name === "enough-growth-session-end") void setMode("BUILD").catch(() => undefined);
  if (alarm.name === "enough-event-flush") void flushEvents().catch(() => undefined);
});

api.webNavigation.onBeforeNavigate.addListener((details: any) => {
  void handleNavigation(details);
});
api.webNavigation.onCommitted.addListener((details: any) => {
  void serializeEventQueue(() => enqueueVisit(details)).catch(() => undefined);
});

api.runtime.onMessage.addListener(
  (message: any, _sender: any, sendResponse: (value: unknown) => void) => {
    void handleMessage(message)
      .then(sendResponse)
      .catch((cause: unknown) => {
        sendResponse({
          error: cause instanceof Error ? cause.message : "The extension request failed.",
        });
      });
    return true;
  },
);

void api.alarms.create("enough-event-flush", { periodInMinutes: 5 });
void readState()
  .then(async (state) => {
    if (!state.accessToken || policyCacheExpired(state)) await clearOwnedRules();
  })
  .catch(() => undefined);
