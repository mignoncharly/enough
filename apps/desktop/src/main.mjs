import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  powerMonitor,
  safeStorage,
  Tray,
} from "electron";
import { autoUpdater } from "electron-updater";
import { activeWindow } from "get-windows";
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

const APP_NAME = "Enough";
const IDLE_THRESHOLD_SECONDS = 300;
const POLICY_CACHE_WARNING_MS = 24 * 60 * 60_000;
const CLOCK_CHANGE_TOLERANCE_MS = 60_000;
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_QUEUED_EVENTS = 1000;
const MONITOR_INTERVAL_MS = 2000;
const GRACE_CHOICES = new Set([30, 60, 120, 300]);
const BYPASS_CHOICES = new Set([5, 15, 30, 60]);
const CLASSIFICATIONS = new Set(["BUILD", "GROWTH", "NEUTRAL", "CONTEXTUAL", "BLOCKED", "ALLOWED"]);
const defaultState = {
  stateVersion: 1,
  apiBaseUrl: "",
  accessToken: null,
  sessionId: null,
  deviceId: null,
  expiresAt: null,
  user: null,
  products: [],
  selectedProductId: "",
  rules: [],
  overrides: [],
  catalog: [],
  mappings: [],
  localClassifications: {},
  mode: "BUILD",
  growthModeStartedAt: null,
  growthModeUntil: null,
  sessionActive: true,
  sessionSeconds: 0,
  protectionEnabled: true,
  trackingEnabled: false,
  activityCollectionEnabled: false,
  activityConsentRevision: null,
  autoStart: false,
  gracePeriodSeconds: 60,
  pendingOverrides: [],
  events: [],
  eventSequences: {},
  discardedEventCount: 0,
  usageByApplication: {},
  lastSyncAt: null,
  lastClockObservedAt: null,
  clockChangeDetected: false,
  syncError: "",
  updateStatus: "Not checked",
};

app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let state = structuredClone(defaultState);
let mainWindow = null;
let lockWindow = null;
let tray = null;
let lastTraySignature = "";
let saveTimer = null;
let monitorTimer = null;
let syncTimer = null;
let notificationTimer = null;
let monitorBusy = false;
let activityConsentFresh = false;
let eventFlushInFlight = null;
let lockedBySystem = false;
let activeIdentity = null;
let activeSecondsSinceUpload = 0;
let blockedIdentity = null;
let blockedSinceMonotonic = 0;
let lastTick = performance.now();
let lastWallClockAt = Date.now();
let lastMonotonicClockAt = performance.now();
let lastNotificationAt = 0;
const shownNotificationIds = new Map();
let monitorWarning = "";
const monitorCapability =
  process.platform === "linux" && process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland"
    ? "unsupported-wayland"
    : process.platform === "win32" || process.platform === "darwin"
      ? "available"
      : "limited-lock-detection";
const statusPath = path.join(app.getPath("userData"), "agent-status.json");
const cachePath = path.join(app.getPath("userData"), "agent-cache.bin");

function encryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return safeStorage.getSelectedStorageBackend?.() !== "basic_text";
}

async function loadState() {
  await mkdir(app.getPath("userData"), { recursive: true });
  try {
    if (!encryptionAvailable()) return;
    const encrypted = await readFile(cachePath);
    const restored = JSON.parse(safeStorage.decryptString(encrypted));
    if (restored?.stateVersion === 1) state = { ...structuredClone(defaultState), ...restored };
  } catch {
    state = structuredClone(defaultState);
    monitorWarning =
      "The encrypted local cache could not be read. Sign in again to restore your policy.";
  }
  const now = Date.now();
  const lastObserved = Date.parse(state.lastClockObservedAt || "");
  if ((Number.isFinite(lastObserved) && now < lastObserved) || state.clockChangeDetected) {
    state = {
      ...state,
      clockChangeDetected: true,
      mode: "BUILD",
      growthModeStartedAt: null,
      growthModeUntil: null,
    };
    await persistState();
  }
  state = { ...state, lastClockObservedAt: new Date(now).toISOString() };
  lastWallClockAt = now;
  lastMonotonicClockAt = performance.now();
}

async function persistState() {
  if (!encryptionAvailable()) {
    monitorWarning =
      "Protected local storage is unavailable. Sign-in and offline policy cannot be saved on this system.";
    return false;
  }
  try {
    await mkdir(app.getPath("userData"), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(state));
    await writeFile(cachePath, encrypted, { mode: 0o600 });
    await chmod(cachePath, 0o600).catch(() => undefined);
    monitorWarning = "";
    return true;
  } catch {
    monitorWarning =
      "Protected local storage could not be written. Check the system keychain or keyring.";
    return false;
  }
}

function policyCacheIsStale(now = Date.now()) {
  return isPolicyCacheStale(state, now, POLICY_CACHE_WARNING_MS);
}

function growthModeIsActive(now = Date.now()) {
  return isGrowthModeActive(state, now);
}

function schedulePersist(immediate = false) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persistState(), immediate ? 0 : 8000);
}

function normalizeApiBase(raw) {
  return normalizeApiOrigin(raw);
}

async function apiRequest(source, route, options = {}) {
  if (!source.apiBaseUrl) throw new Error("Set the API address before connecting.");
  const headers = new Headers(options.headers || {});
  if (source.accessToken) headers.set("authorization", `Bearer ${source.accessToken}`);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${source.apiBaseUrl}${route}`, {
    ...options,
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Enough API returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function safeState() {
  const active = state.currentApplication || null;
  const currentMode = growthModeIsActive() ? "GROWTH" : "BUILD";
  const applications = Object.entries(state.usageByApplication || {})
    .map(([toolKey, row]) => ({ toolKey, ...row }))
    .sort((a, b) => Number(b.seconds) - Number(a.seconds))
    .slice(0, 20);
  return {
    connected: Boolean(state.accessToken),
    email: state.user?.email || "",
    apiBaseUrl: state.apiBaseUrl,
    products: state.products,
    selectedProductId: state.selectedProductId,
    mode: currentMode,
    growthModeUntil: currentMode === "GROWTH" ? state.growthModeUntil : null,
    sessionActive: Boolean(state.sessionActive),
    sessionSeconds: Math.floor(state.sessionSeconds || 0),
    protectionEnabled: Boolean(state.protectionEnabled),
    trackingEnabled: Boolean(state.trackingEnabled),
    activityCollectionEnabled: Boolean(state.activityCollectionEnabled && activityConsentFresh),
    autoStart: Boolean(state.autoStart),
    gracePeriodSeconds: state.gracePeriodSeconds,
    currentApplication: active ? { ...active } : null,
    applications,
    isIdle: Boolean(state.isIdle),
    isLocked: Boolean(state.isLocked),
    decision: state.currentDecision || null,
    blockedUntil: blockedIdentity
      ? Date.now() +
        Math.max(
          0,
          Number(state.gracePeriodSeconds) * 1000 - (performance.now() - blockedSinceMonotonic),
        )
      : null,
    lastSyncAt: state.lastSyncAt,
    policyStale: policyCacheIsStale(),
    discardedEvents: Math.max(0, Number(state.discardedEventCount) || 0),
    syncError: state.syncError,
    storageAvailable: encryptionAvailable(),
    monitorWarning,
    monitorCapability,
    updateStatus: state.updateStatus,
    localClassifications: state.localClassifications || {},
  };
}

function broadcastState() {
  const value = safeState();
  for (const window of [mainWindow, lockWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("enough:state", value);
  }
  if (tray) refreshTray();
}

async function updateState(patch, { persist = true, immediate = false } = {}) {
  state = { ...state, ...patch };
  if (persist) schedulePersist(immediate);
  broadcastState();
  return safeState();
}

async function login(credentials) {
  if (!encryptionAvailable())
    throw new Error(
      "Enable a system keychain or keyring before signing in. Enough encrypts the session and offline policy on this device.",
    );
  const apiBaseUrl = normalizeApiBase(credentials.apiBaseUrl);
  const payload = await apiRequest({ apiBaseUrl }, "/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: String(credentials.email || "").trim(),
      password: String(credentials.password || ""),
      clientType: "desktop",
      deviceName: "Enough desktop agent",
    }),
  });
  if (!payload.accessToken || !payload.deviceId)
    throw new Error("The API did not return a desktop session.");
  activityConsentFresh = false;
  state = {
    ...state,
    apiBaseUrl,
    accessToken: payload.accessToken,
    sessionId: payload.sessionId,
    deviceId: payload.deviceId,
    expiresAt: payload.expiresAt,
    user: payload.user,
    products: [],
    rules: [],
    overrides: [],
    catalog: [],
    mappings: [],
    selectedProductId: "",
    mode: "BUILD",
    growthModeStartedAt: null,
    growthModeUntil: null,
    pendingOverrides: [],
    usageByApplication: {},
    discardedEventCount: 0,
    lastSyncAt: null,
    syncError: "",
    sessionActive: true,
    trackingEnabled: false,
    activityCollectionEnabled: false,
    activityConsentRevision: null,
    events: [],
    eventSequences: {},
  };
  await persistState();
  await syncPolicy();
  if (!state.accessToken)
    throw new Error(state.syncError || "The desktop session could not be confirmed.");
  return safeState();
}

async function loginWithToken(credentials) {
  if (!encryptionAvailable())
    throw new Error(
      "Enable a system keychain or keyring before signing in. Enough encrypts the session and offline policy on this device.",
    );
  const apiBaseUrl = normalizeApiBase(credentials.apiBaseUrl);
  const accessToken = String(credentials.accessToken || "").trim();
  const payload = await apiRequest({ apiBaseUrl, accessToken }, "/auth/me");
  if (!payload.user?.id || !payload.session?.id || !payload.session?.deviceId)
    throw new Error("That desktop access token is invalid or expired.");
  activityConsentFresh = false;
  state = {
    ...state,
    apiBaseUrl,
    accessToken,
    sessionId: payload.session.id,
    deviceId: payload.session.deviceId,
    expiresAt: payload.session.expiresAt,
    user: payload.user,
    products: [],
    rules: [],
    overrides: [],
    catalog: [],
    mappings: [],
    selectedProductId: "",
    mode: "BUILD",
    growthModeStartedAt: null,
    growthModeUntil: null,
    pendingOverrides: [],
    usageByApplication: {},
    discardedEventCount: 0,
    lastSyncAt: null,
    syncError: "",
    sessionActive: true,
    trackingEnabled: false,
    activityCollectionEnabled: false,
    activityConsentRevision: null,
    events: [],
    eventSequences: {},
  };
  await persistState();
  await syncPolicy();
  if (!state.accessToken)
    throw new Error(state.syncError || "The desktop session could not be confirmed.");
  return safeState();
}

async function ensureFreshToken() {
  if (state.expiresAt && Date.parse(state.expiresAt) - Date.now() < 24 * 60 * 60_000) {
    const rotated = await apiRequest(state, "/auth/session/rotate", { method: "POST" });
    state = { ...state, accessToken: rotated.accessToken, expiresAt: rotated.expiresAt };
  }
}

function classificationEntries() {
  const local = Object.entries(state.localClassifications || {}).map(
    ([toolKey, classification]) => ({
      toolKind: "APPLICATION",
      toolKey,
      displayName: toolKey,
      classification,
      productId: state.selectedProductId || null,
    }),
  );
  const localKeys = new Set(local.map((entry) => entry.toolKey));
  const mappings = [
    ...(state.mappings || []).filter(
      (entry) => !(entry.toolKind === "APPLICATION" && localKeys.has(entry.toolKey)),
    ),
    ...local,
  ];
  return { mappings, catalog: state.catalog || [] };
}

function flushEvents() {
  if (eventFlushInFlight) return eventFlushInFlight;
  eventFlushInFlight = flushEventsOnce().finally(() => {
    eventFlushInFlight = null;
  });
  return eventFlushInFlight;
}

async function flushEventsOnce() {
  if (!activityConsentFresh) return;
  if (!state.activityCollectionEnabled) {
    if (state.events?.length) state = { ...state, events: [] };
    return;
  }
  if (!state.accessToken || !state.events?.length) return;
  const initialPrune = pruneExpiredEvents(state.events, Date.now(), EVENT_RETENTION_MS);
  let remaining = initialPrune.events;
  const expired = initialPrune.expired;
  state = {
    ...state,
    events: remaining,
    discardedEventCount: Math.max(0, Number(state.discardedEventCount) || 0) + expired,
  };
  while (remaining.length) {
    const batch = remaining.slice(0, 100);
    await apiRequest(state, "/activity/batch", {
      method: "POST",
      body: JSON.stringify({ events: batch }),
    });
    const ids = new Set(batch.map((event) => event.eventId));
    remaining = (state.events || []).filter((event) => !ids.has(event.eventId));
    const nextPrune = pruneExpiredEvents(remaining, Date.now(), EVENT_RETENTION_MS);
    remaining = nextPrune.events;
    const expiredDuringUpload = nextPrune.expired;
    state = {
      ...state,
      events: remaining,
      discardedEventCount:
        Math.max(0, Number(state.discardedEventCount) || 0) + expiredDuringUpload,
    };
  }
}

async function publishPendingOverrides() {
  if (!state.accessToken || !state.pendingOverrides?.length) return;
  const remaining = [...state.pendingOverrides];
  for (const local of [...remaining]) {
    try {
      const result = await apiRequest(state, "/rules/overrides", {
        method: "POST",
        body: JSON.stringify({
          productId: local.productId,
          deviceId: local.deviceId,
          toolKind: local.toolKind,
          toolKey: local.toolKey,
          action: local.action,
          reason: local.reason,
          startsAt: local.startsAt,
          expiresAt: local.expiresAt,
        }),
      });
      const created = result.override || result;
      const pending = remaining.filter((item) => item.id !== local.id);
      const overrides = [
        ...(state.overrides || []).filter(
          (item) =>
            item.id !== local.id &&
            !(
              item.toolKind === local.toolKind &&
              item.toolKey === local.toolKey &&
              item.reason === local.reason
            ),
        ),
        created,
      ];
      state = { ...state, pendingOverrides: pending, overrides };
      remaining.splice(
        remaining.findIndex((item) => item.id === local.id),
        1,
      );
    } catch (error) {
      if (error.status === 401 || error.status === 403 || error.status === 400) throw error;
    }
  }
}

async function syncPolicy() {
  if (!state.accessToken) return safeState();
  let consentChecked = false;
  let serverActivityConsent = false;
  try {
    await ensureFreshToken();
    const consent = await apiRequest(state, "/privacy-consents");
    consentChecked = true;
    const activityCollectionEnabled = consent.activityCollectionEnabled === true;
    activityConsentFresh = true;
    serverActivityConsent = activityCollectionEnabled;
    const consentChanged = state.activityConsentRevision !== consent.activityConsentRevision;
    state = {
      ...state,
      activityCollectionEnabled,
      activityConsentRevision: consent.activityConsentRevision,
      ...(!activityCollectionEnabled || consentChanged
        ? { trackingEnabled: false, events: [] }
        : {}),
    };
    await publishPendingOverrides();
    const [products, policy, catalog, mappings] = await Promise.all([
      apiRequest(state, "/products"),
      apiRequest(state, "/rules"),
      apiRequest(state, "/classification/catalog?kind=APPLICATION"),
      apiRequest(state, "/classification/mappings"),
    ]);
    const productList = Array.isArray(products.products) ? products.products : [];
    const selectedProductId = productList.some((product) => product.id === state.selectedProductId)
      ? state.selectedProductId
      : productList[0]?.id || "";
    state = {
      ...state,
      activityCollectionEnabled,
      trackingEnabled: activityCollectionEnabled && Boolean(state.trackingEnabled),
      events: activityCollectionEnabled ? state.events : [],
      products: productList,
      selectedProductId,
      rules: Array.isArray(policy.rules) ? policy.rules : [],
      overrides: [
        ...(Array.isArray(policy.overrides) ? policy.overrides : []),
        ...(state.pendingOverrides || []).filter((item) => Date.parse(item.expiresAt) > Date.now()),
      ],
      catalog: Array.isArray(catalog.catalog) ? catalog.catalog : [],
      mappings: Array.isArray(mappings.mappings) ? mappings.mappings : [],
      lastSyncAt: new Date().toISOString(),
      lastClockObservedAt: new Date().toISOString(),
      clockChangeDetected: false,
      syncError: "",
    };
    await flushEvents();
    schedulePersist(true);
    broadcastState();
    return safeState();
  } catch (error) {
    const consentDenied =
      error.status === 403 &&
      String(error.message || "").includes("Activity collection is disabled");
    const syncMessage = error instanceof Error ? error.message : "Policy sync failed.";
    const policyStatusMessage = policyCacheIsStale()
      ? `${syncMessage} Cached policy expired or the system clock moved backwards; local enforcement is paused until sync succeeds.`
      : syncMessage;
    if (error.status === 401) {
      activityConsentFresh = false;
      state = {
        ...state,
        accessToken: null,
        sessionId: null,
        deviceId: null,
        expiresAt: null,
        user: null,
        products: [],
        selectedProductId: "",
        rules: [],
        overrides: [],
        catalog: [],
        mappings: [],
        pendingOverrides: [],
        events: [],
        eventSequences: {},
        mode: "BUILD",
        growthModeStartedAt: null,
        growthModeUntil: null,
        clockChangeDetected: false,
        lastClockObservedAt: new Date().toISOString(),
        discardedEventCount: 0,
        trackingEnabled: false,
        activityCollectionEnabled: false,
        activityConsentRevision: null,
        lastSyncAt: null,
        syncError:
          "This desktop session expired or was revoked. Sign in again to connect this device.",
      };
      await persistState();
    } else if (consentDenied || !consentChecked || !serverActivityConsent) {
      if (consentDenied || !consentChecked) activityConsentFresh = false;
      state = {
        ...state,
        activityCollectionEnabled: false,
        trackingEnabled: false,
        ...(consentDenied ? { events: [] } : {}),
        syncError: policyStatusMessage,
      };
    } else {
      state = { ...state, syncError: policyStatusMessage };
    }
    schedulePersist();
    broadcastState();
    return safeState();
  }
}

function enqueueEvent(eventType, attributes) {
  if (
    !activityConsentFresh ||
    !state.trackingEnabled ||
    !state.activityCollectionEnabled ||
    !state.selectedProductId
  )
    return;
  const productId = state.selectedProductId;
  const { clientSequence, eventSequences } = nextClientSequence(
    state.eventSequences || {},
    productId,
  );
  const event = {
    eventId: randomUUID(),
    productId,
    eventType,
    eventVersion: 1,
    clientSequence,
    occurredAt: new Date().toISOString(),
    attributes,
  };
  const { events, dropped } = appendBoundedEvent(state.events || [], event, MAX_QUEUED_EVENTS);
  state = {
    ...state,
    eventSequences,
    events,
    discardedEventCount: Math.max(0, Number(state.discardedEventCount) || 0) + dropped,
  };
  schedulePersist();
}

async function finishCurrentApplication() {
  if (!activeIdentity || activeSecondsSinceUpload <= 0) return;
  enqueueEvent("desktop.app_foreground", {
    application_key: activeIdentity.toolKey,
    classification: activeIdentity.classification,
    policy_action: state.currentDecision?.action || "ALLOW",
    mode: state.mode,
    duration_seconds: Math.max(1, Math.round(activeSecondsSinceUpload)),
  });
  activeSecondsSinceUpload = 0;
}

function applicationKey(owner) {
  const rawName = String(owner?.name || "Unknown application").trim();
  const basename = path.basename(String(owner?.path || "")).replace(/\.(app|exe|bin)$/i, "");
  const possible = [owner?.bundleId, basename, rawName].filter(
    (value) => typeof value === "string" && value.trim(),
  );
  const entries = [...(state.mappings || []), ...(state.catalog || [])].filter(
    (entry) => entry.toolKind === "APPLICATION",
  );
  for (const candidate of possible) {
    const matched = entries.find(
      (entry) =>
        entry.displayName?.trim().toLocaleLowerCase("en-US") ===
          candidate.trim().toLocaleLowerCase("en-US") ||
        entry.toolKey.toLocaleLowerCase("en-US") === candidate.trim().toLocaleLowerCase("en-US"),
    );
    if (matched) return matched.toolKey;
  }
  const stable = owner?.bundleId || basename || rawName;
  try {
    return normalizeToolKey("APPLICATION", stable);
  } catch {
    return normalizeToolKey(
      "APPLICATION",
      rawName.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 200) || "unknown-application",
    );
  }
}

function evaluateApplication(toolKey) {
  const { mappings, catalog } = classificationEntries();
  const classification = resolveToolClassification(
    {
      toolKind: "APPLICATION",
      toolKey,
      productId: state.selectedProductId || null,
    },
    mappings,
    catalog,
  );
  const now = new Date().toISOString();
  const decision = policyCacheIsStale()
    ? {
        action: "ALLOW",
        allowed: true,
        source: "DEFAULT",
        reason:
          "Cached policy expired or the system clock moved backwards. Enforcement is paused until policy sync succeeds.",
      }
    : evaluatePolicyRules(
        {
          toolKind: "APPLICATION",
          toolKey,
          classification: classification.classification,
          productId: state.selectedProductId || null,
          deviceId: state.deviceId || null,
          contextKey: "mode",
          contextValue: growthModeIsActive() ? "growth" : "build",
          evaluatedAt: now,
        },
        state.rules || [],
        (state.overrides || []).filter(
          (item) => Date.parse(item.expiresAt) > Date.now() && !item.revokedAt,
        ),
      );
  return { classification, decision };
}

function showNotification(title, body) {
  const now = Date.now();
  if (!Notification.isSupported() || now - lastNotificationAt < 30_000) return false;
  lastNotificationAt = now;
  new Notification({ title, body, silent: true }).show();
  return true;
}

async function syncDesktopNotifications() {
  if (!state.accessToken) return;
  try {
    const result = await apiRequest(state, "/notification-data?channel=DESKTOP");
    const notifications = Array.isArray(result.notifications) ? result.notifications : [];
    for (const item of notifications) {
      if (!item?.id || !item.title || !item.body) continue;
      const alreadyShown = shownNotificationIds.has(item.id);
      if (!alreadyShown && !showNotification(item.title, item.body)) return;
      if (!alreadyShown) {
        shownNotificationIds.set(item.id, Date.now());
        if (shownNotificationIds.size > 200) {
          const oldest = shownNotificationIds.keys().next().value;
          if (oldest) shownNotificationIds.delete(oldest);
        }
      }
      await apiRequest(
        state,
        `/notification-data/${encodeURIComponent(item.id)}/desktop-delivered`,
        { method: "POST" },
      );
    }
  } catch {
    // Leave pending alerts on the server until the next authenticated poll.
  }
}

function showLock() {
  if (lockWindow && !lockWindow.isDestroyed()) {
    lockWindow.show();
    lockWindow.focus();
    lockWindow.webContents.send("enough:state", safeState());
    return;
  }
  lockWindow = new BrowserWindow({
    fullscreen: true,
    alwaysOnTop: true,
    frame: false,
    movable: false,
    minimizable: false,
    closable: false,
    skipTaskbar: false,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "lock-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  lockWindow.setAlwaysOnTop(true, "screen-saver");
  guardWindow(lockWindow, "lock.html");
  lockWindow.loadFile(rendererFile("lock.html"));
  lockWindow.once("ready-to-show", () => lockWindow?.show());
  lockWindow.on("closed", () => {
    lockWindow = null;
  });
}

function hideLock() {
  if (lockWindow && !lockWindow.isDestroyed()) lockWindow.hide();
}

function trayImage() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="3" y="3" width="26" height="26" rx="8" fill="#2d6a4f"/><path d="M10 16.5 14 21l9-10" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip("Enough focus agent");
  tray.on("double-click", () => showMainWindow());
  refreshTray();
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  const product = state.products.find((item) => item.id === state.selectedProductId);
  const activeName =
    state.currentApplication?.displayName ||
    state.currentApplication?.toolKey ||
    "No active app detected";
  const currentMode = growthModeIsActive() ? "GROWTH" : "BUILD";
  const growthMinutes =
    currentMode === "GROWTH"
      ? Math.max(0, Math.ceil((Number(state.growthModeUntil) - Date.now()) / 60_000))
      : 0;
  const signature = JSON.stringify([
    currentMode,
    growthMinutes,
    product?.name || "",
    activeName,
    state.sessionActive,
  ]);
  if (signature === lastTraySignature) return;
  lastTraySignature = signature;
  const context = Menu.buildFromTemplate([
    {
      label: currentMode === "GROWTH" ? `Growth Mode (${growthMinutes} min)` : "Build Mode",
      enabled: false,
    },
    { label: `Product: ${product?.name || "Not selected"}`, enabled: false },
    { label: `Active: ${activeName}`, enabled: false },
    { type: "separator" },
    { label: "Open Enough", click: showMainWindow },
    { label: "Start Build session", click: () => void setMode("BUILD") },
    { label: "Start 60 minute Growth session", click: () => void setMode("GROWTH") },
    {
      label: state.sessionActive ? "Pause session" : "Resume session",
      click: () => void setPaused(!state.sessionActive),
    },
    { label: "Sync policy now", click: () => void syncPolicy() },
    { type: "separator" },
    { label: "Quit Enough", click: () => app.quit() },
  ]);
  tray.setContextMenu(context);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({
      width: 870,
      height: 770,
      minWidth: 640,
      minHeight: 600,
      show: false,
      title: "Enough",
      webPreferences: {
        preload: path.join(app.getAppPath(), "dist", "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    guardWindow(mainWindow, "index.html");
    mainWindow.loadFile(rendererFile("index.html"));
    mainWindow.once("ready-to-show", () => mainWindow?.show());
    mainWindow.on("close", (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow?.hide();
      }
    });
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function rendererFile(filename) {
  return path.join(app.getAppPath(), "renderer", filename);
}

function guardWindow(window, filename) {
  const expectedPath = path.resolve(rendererFile(filename));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, destination) => {
    try {
      const url = new URL(destination);
      if (url.protocol !== "file:" || path.resolve(fileURLToPath(url)) !== expectedPath)
        event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

function isTrustedRenderer(frame) {
  try {
    if (!frame || frame.parent !== null) return false;
    const url = new URL(frame.url);
    if (url.protocol !== "file:") return false;
    const senderPath = path.resolve(fileURLToPath(url));
    return (
      senderPath === path.resolve(rendererFile("index.html")) ||
      senderPath === path.resolve(rendererFile("lock.html"))
    );
  } catch {
    return false;
  }
}

function handleTrustedIpc(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedRenderer(event.senderFrame))
      throw new Error("This Enough action is not permitted from this window.");
    return handler(event, ...args);
  });
}

async function setMode(mode) {
  const normalized = mode === "GROWTH" ? "GROWTH" : "BUILD";
  const startedAt = normalized === "GROWTH" ? Date.now() : null;
  await finishCurrentApplication();
  state = {
    ...state,
    mode: normalized,
    growthModeStartedAt: startedAt,
    growthModeUntil: startedAt === null ? null : startedAt + 60 * 60_000,
    sessionActive: true,
    sessionSeconds: 0,
  };
  blockedIdentity = null;
  blockedSinceMonotonic = 0;
  hideLock();
  enqueueEvent("focus.session_started", {
    mode: normalized,
    duration_minutes: normalized === "GROWTH" ? 60 : null,
  });
  await persistState();
  broadcastState();
  return safeState();
}

async function setPaused(paused) {
  if (paused && state.sessionActive) {
    enqueueEvent("focus.session_ended", {
      mode: state.mode,
      duration_seconds: Math.floor(state.sessionSeconds || 0),
    });
    await finishCurrentApplication();
  }
  state = { ...state, sessionActive: !paused };
  if (!paused) enqueueEvent("focus.session_started", { mode: state.mode, duration_minutes: null });
  if (paused) {
    blockedIdentity = null;
    hideLock();
  }
  await persistState();
  broadcastState();
  return safeState();
}

async function setProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) throw new Error("Choose one of your synced products.");
  await finishCurrentApplication();
  state = { ...state, selectedProductId: productId, sessionSeconds: 0 };
  blockedIdentity = null;
  hideLock();
  await persistState();
  broadcastState();
  return safeState();
}

async function setLocalClassification(toolKey, classification) {
  const key = normalizeToolKey("APPLICATION", String(toolKey || ""));
  const localClassifications = { ...(state.localClassifications || {}) };
  if (classification === "") delete localClassifications[key];
  else {
    if (!CLASSIFICATIONS.has(classification))
      throw new Error("Choose a supported application classification.");
    localClassifications[key] = classification;
  }
  const usageByApplication = { ...(state.usageByApplication || {}) };
  if (usageByApplication[key] && classification)
    usageByApplication[key] = { ...usageByApplication[key], classification };
  state = { ...state, localClassifications, usageByApplication };
  await persistState();
  broadcastState();
  return safeState();
}

async function emergencyBypass(input) {
  const reason = String(input.reason || "").trim();
  const minutes = Number(input.minutes);
  const key = state.currentApplication?.toolKey;
  if (!key) throw new Error("There is no restricted app to unlock.");
  if (reason.length < 2 || reason.length > 300)
    throw new Error("Enter a short reason for the emergency bypass.");
  if (!BYPASS_CHOICES.has(minutes)) throw new Error("Choose a bypass from 5 to 60 minutes.");
  const startsAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const override = {
    id: `local-${randomUUID()}`,
    productId: state.selectedProductId || null,
    deviceId: state.deviceId || null,
    toolKind: "APPLICATION",
    toolKey: key,
    action: "ALLOW",
    reason,
    startsAt,
    expiresAt,
    createdAt: startsAt,
    revokedAt: null,
  };
  state = {
    ...state,
    overrides: [
      ...(state.overrides || []).filter(
        (item) =>
          !(
            item.toolKind === "APPLICATION" &&
            item.toolKey === key &&
            Date.parse(item.expiresAt) > Date.now()
          ),
      ),
      override,
    ],
    pendingOverrides: [...(state.pendingOverrides || []), override],
  };
  blockedIdentity = null;
  hideLock();
  enqueueEvent("desktop.emergency_bypass", { application_key: key, duration_minutes: minutes });
  await persistState();
  if (state.accessToken) await publishPendingOverrides().catch(() => undefined);
  broadcastState();
  return safeState();
}

async function logout() {
  activityConsentFresh = false;
  if (state.accessToken)
    await apiRequest(state, "/auth/logout", { method: "POST" }).catch(() => undefined);
  state = {
    ...state,
    accessToken: null,
    sessionId: null,
    deviceId: null,
    expiresAt: null,
    user: null,
    activityCollectionEnabled: false,
    activityConsentRevision: null,
    trackingEnabled: false,
    products: [],
    selectedProductId: "",
    rules: [],
    overrides: [],
    catalog: [],
    mappings: [],
    mode: "BUILD",
    growthModeStartedAt: null,
    growthModeUntil: null,
    pendingOverrides: [],
    events: [],
    eventSequences: {},
    discardedEventCount: 0,
    lastSyncAt: null,
    syncError: "",
  };
  await persistState();
  broadcastState();
  return safeState();
}

async function setProtection(enabled) {
  state = { ...state, protectionEnabled: Boolean(enabled) };
  if (!enabled) {
    blockedIdentity = null;
    hideLock();
  }
  await persistState();
  broadcastState();
  return safeState();
}

async function applyAutoStart(enabled) {
  state = { ...state, autoStart: Boolean(enabled) };
  if (process.platform === "win32" || process.platform === "darwin") {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      args: app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"],
    });
  } else if (process.platform === "linux") {
    const startupDirectory = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "autostart",
    );
    const startupFile = path.join(startupDirectory, "enough.desktop");
    if (enabled) {
      await mkdir(startupDirectory, { recursive: true });
      const execPath = app.isPackaged
        ? process.execPath
        : `${process.execPath} ${app.getAppPath()}`;
      await writeFile(
        startupFile,
        `[Desktop Entry]\nType=Application\nName=Enough\nExec=${execPath.replace(/\\/g, "\\\\").replace(/ /g, "\\ ")} --hidden\nX-GNOME-Autostart-enabled=true\n`,
        { mode: 0o600 },
      );
    } else {
      await rm(startupFile, { force: true });
    }
  }
  await persistState();
  broadcastState();
  return safeState();
}

async function updateNow() {
  if (!app.isPackaged)
    return updateState(
      { updateStatus: "Updates are available in packaged builds." },
      { persist: false },
    );
  try {
    state = { ...state, updateStatus: "Checking for updates…" };
    broadcastState();
    await autoUpdater.checkForUpdates();
    return safeState();
  } catch (error) {
    return updateState(
      { updateStatus: error instanceof Error ? error.message : "Update check failed." },
      { persist: false },
    );
  }
}

async function writeHeartbeat(running) {
  try {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(
      statusPath,
      JSON.stringify({ running, updatedAt: Date.now(), version: app.getVersion() }),
      { mode: 0o600 },
    );
    await chmod(statusPath, 0o600).catch(() => undefined);
  } catch {
    /* Native messaging will report the agent as disconnected. */
  }
}

async function monitorTick() {
  if (monitorBusy || !app.isReady()) return;
  monitorBusy = true;
  try {
    const now = Date.now();
    const monotonicNow = performance.now();
    const elapsedSeconds = Math.max(0, Math.min(10, (monotonicNow - lastTick) / 1000));
    lastTick = monotonicNow;
    const wallDelta = now - lastWallClockAt;
    const monotonicDelta = monotonicNow - lastMonotonicClockAt;
    const lastObserved = Date.parse(state.lastClockObservedAt || "");
    const clockChanged =
      (Number.isFinite(lastObserved) && now < lastObserved) ||
      Math.abs(wallDelta - monotonicDelta) > CLOCK_CHANGE_TOLERANCE_MS;
    lastWallClockAt = now;
    lastMonotonicClockAt = monotonicNow;
    state = {
      ...state,
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
    if (clockChanged) await persistState();
    if (state.mode === "GROWTH" && !growthModeIsActive(now)) await setMode("BUILD");
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const idleState = powerMonitor.getSystemIdleState(IDLE_THRESHOLD_SECONDS);
    const isLocked = lockedBySystem || idleState === "locked";
    const isIdle = isLocked || idleSeconds >= IDLE_THRESHOLD_SECONDS || idleState === "idle";
    if (isLocked || isIdle || !state.sessionActive) {
      if (activeIdentity) await finishCurrentApplication();
      activeIdentity = null;
      blockedIdentity = null;
      if (isLocked) hideLock();
      state = { ...state, currentApplication: null, currentDecision: null, isIdle: true, isLocked };
      await writeHeartbeat(true);
      broadcastState();
      return;
    }

    if (monitorCapability === "unsupported-wayland") {
      monitorWarning =
        "Active-app monitoring is unavailable in this Linux Wayland session. Use an X11 session for desktop policy enforcement.";
      state = {
        ...state,
        currentApplication: null,
        currentDecision: null,
        isIdle: false,
        isLocked: false,
      };
      await writeHeartbeat(true);
      broadcastState();
      return;
    }

    const foreground = await activeWindow({
      accessibilityPermission: false,
      screenRecordingPermission: false,
    });
    if (foreground?.owner?.processId === process.pid) {
      if (lockWindow && !lockWindow.isDestroyed() && lockWindow.isVisible()) {
        await writeHeartbeat(true);
        broadcastState();
        return;
      }
      await finishCurrentApplication();
      activeIdentity = null;
      activeSecondsSinceUpload = 0;
      blockedIdentity = null;
      state = {
        ...state,
        currentApplication: null,
        currentDecision: null,
        isIdle: false,
        isLocked: false,
      };
      await writeHeartbeat(true);
      broadcastState();
      return;
    }
    if (!foreground?.owner?.name) {
      await finishCurrentApplication();
      activeIdentity = null;
      activeSecondsSinceUpload = 0;
      blockedIdentity = null;
      hideLock();
      state = {
        ...state,
        currentApplication: null,
        currentDecision: null,
        isIdle: false,
        isLocked: false,
      };
      await writeHeartbeat(true);
      broadcastState();
      return;
    }

    const toolKey = applicationKey(foreground.owner);
    const appName = String(foreground.owner.name).slice(0, 120);
    let classification;
    let decision;
    try {
      ({ classification, decision } = evaluateApplication(toolKey));
    } catch (error) {
      monitorWarning = `Local policy could not be evaluated: ${error instanceof Error ? error.message : "invalid cache"}`;
      classification = { classification: "NEUTRAL", displayName: appName };
      decision = {
        action: "ALLOW",
        allowed: true,
        source: "DEFAULT",
        reason: "Policy cache unavailable.",
      };
    }
    const identity = `${toolKey}\u0000${state.selectedProductId || ""}`;
    if (activeIdentity?.identity !== identity) {
      await finishCurrentApplication();
      activeSecondsSinceUpload = 0;
      activeIdentity = {
        identity,
        toolKey,
        appName,
        classification: classification.classification,
        lastUploadedAt: now,
      };
    }
    activeSecondsSinceUpload += elapsedSeconds;
    if (state.sessionActive)
      state = { ...state, sessionSeconds: Number(state.sessionSeconds || 0) + elapsedSeconds };
    const usageByApplication = { ...(state.usageByApplication || {}) };
    const oldUsage = usageByApplication[toolKey] || {
      displayName: appName,
      seconds: 0,
      classification: classification.classification,
    };
    usageByApplication[toolKey] = {
      displayName: appName,
      seconds: Number(oldUsage.seconds || 0) + elapsedSeconds,
      classification: classification.classification,
      lastSeenAt: new Date(now).toISOString(),
    };
    state = {
      ...state,
      usageByApplication,
      currentApplication: {
        toolKey,
        displayName: appName,
        classification: classification.classification,
      },
      currentDecision: decision,
      isIdle: false,
      isLocked: false,
    };
    if (activeSecondsSinceUpload >= 60) {
      await finishCurrentApplication();
      activeIdentity.lastUploadedAt = now;
    }
    if (state.protectionEnabled && !decision.allowed) {
      if (blockedIdentity !== identity) {
        blockedIdentity = identity;
        blockedSinceMonotonic = performance.now();
        showNotification(
          "Enough focus reminder",
          `${appName} is restricted by your current focus policy.`,
        );
      }
      if (performance.now() - blockedSinceMonotonic >= Number(state.gracePeriodSeconds) * 1000)
        showLock();
    } else {
      blockedIdentity = null;
      blockedSinceMonotonic = 0;
      hideLock();
      if (decision.action === "WARN")
        showNotification(
          "Enough focus reminder",
          decision.reason || `${appName} matches a focus warning.`,
        );
    }
    if (now % 8_000 < MONITOR_INTERVAL_MS) schedulePersist();
    await writeHeartbeat(true);
    broadcastState();
  } catch (error) {
    monitorWarning =
      error instanceof Error
        ? `App monitoring unavailable: ${error.message}`
        : "App monitoring is unavailable on this session.";
    state = { ...state, currentApplication: null, currentDecision: null };
    await writeHeartbeat(true);
    broadcastState();
  } finally {
    monitorBusy = false;
  }
}

function wireUpdater() {
  autoUpdater.on("checking-for-update", () => {
    state = { ...state, updateStatus: "Checking for updates…" };
    broadcastState();
  });
  autoUpdater.on("update-available", (info) => {
    state = { ...state, updateStatus: `Version ${info.version} is downloading.` };
    broadcastState();
  });
  autoUpdater.on("update-not-available", () => {
    state = { ...state, updateStatus: "Enough is up to date." };
    broadcastState();
  });
  autoUpdater.on("download-progress", (progress) => {
    state = { ...state, updateStatus: `Downloading update: ${Math.round(progress.percent)}%` };
    broadcastState();
  });
  autoUpdater.on("update-downloaded", (info) => {
    state = { ...state, updateStatus: `Version ${info.version} is ready to install on quit.` };
    broadcastState();
  });
  autoUpdater.on("error", (error) => {
    state = { ...state, updateStatus: `Update error: ${error.message}` };
    broadcastState();
  });
}

function registerIpc() {
  handleTrustedIpc("enough:get-state", () => safeState());
  handleTrustedIpc("enough:login", (_event, credentials) => login(credentials));
  handleTrustedIpc("enough:login-token", (_event, credentials) => loginWithToken(credentials));
  handleTrustedIpc("enough:logout", () => logout());
  handleTrustedIpc("enough:sync", () => syncPolicy());
  handleTrustedIpc("enough:set-product", (_event, productId) =>
    setProduct(String(productId || "")),
  );
  handleTrustedIpc("enough:set-mode", (_event, mode) => setMode(mode));
  handleTrustedIpc("enough:set-paused", (_event, paused) => setPaused(Boolean(paused)));
  handleTrustedIpc("enough:set-protection", (_event, enabled) => setProtection(Boolean(enabled)));
  handleTrustedIpc("enough:set-tracking", async (_event, enabled) => {
    if (enabled && (!activityConsentFresh || !state.activityCollectionEnabled))
      throw new Error(
        "Activity collection consent is off or has not synced. Grant it in Enough Privacy settings, sync the desktop app, then enable local tracking.",
      );
    return updateState({ trackingEnabled: Boolean(enabled) }, { immediate: true });
  });
  handleTrustedIpc("enough:set-autostart", (_event, enabled) => applyAutoStart(Boolean(enabled)));
  handleTrustedIpc("enough:set-grace", async (_event, seconds) => {
    const value = Number(seconds);
    if (!GRACE_CHOICES.has(value)) throw new Error("Choose a grace period from the list.");
    return updateState({ gracePeriodSeconds: value }, { immediate: true });
  });
  handleTrustedIpc("enough:set-local-classification", async (_event, toolKey, classification) => {
    return setLocalClassification(String(toolKey || ""), String(classification || ""));
  });
  handleTrustedIpc("enough:emergency-bypass", (_event, input) => emergencyBypass(input || {}));
  handleTrustedIpc("enough:update", () => updateNow());
  handleTrustedIpc("enough:dismiss-lock", () => {
    if (state.currentDecision?.allowed) hideLock();
    return safeState();
  });
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    await loadState();
    registerIpc();
    createTray();
    wireUpdater();
    powerMonitor.on("lock-screen", () => {
      lockedBySystem = true;
      blockedIdentity = null;
      hideLock();
      void finishCurrentApplication();
    });
    powerMonitor.on("unlock-screen", () => {
      lockedBySystem = false;
      lastTick = performance.now();
    });
    powerMonitor.on("suspend", () => {
      lockedBySystem = true;
      blockedIdentity = null;
      hideLock();
      void finishCurrentApplication();
    });
    powerMonitor.on("resume", () => {
      lockedBySystem = false;
      lastTick = performance.now();
      void syncPolicy();
    });
    app.on("second-instance", () => showMainWindow());
    app.on("activate", () => showMainWindow());
    app.on("before-quit", () => {
      app.isQuitting = true;
    });
    app.on("will-quit", () => {
      clearInterval(monitorTimer);
      clearInterval(syncTimer);
      clearInterval(notificationTimer);
      clearInterval(heartbeatTimer);
      void writeHeartbeat(false);
      void persistState();
    });
    await writeHeartbeat(true);
    heartbeatTimer = setInterval(() => void writeHeartbeat(true), 5000);
    monitorTimer = setInterval(() => void monitorTick(), MONITOR_INTERVAL_MS);
    syncTimer = setInterval(() => void syncPolicy(), 5 * 60_000);
    notificationTimer = setInterval(() => void syncDesktopNotifications(), 60_000);
    setTimeout(
      () => {
        if (process.argv.includes("--hidden")) return;
        showMainWindow();
      },
      process.argv.includes("--hidden") ? 500 : 0,
    );
    if (state.accessToken) {
      await applyAutoStart(state.autoStart).catch(() => undefined);
      await syncPolicy();
      await syncDesktopNotifications();
    }
    void updateNow();
  });
}

let heartbeatTimer = null;
