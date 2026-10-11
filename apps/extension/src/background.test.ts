import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => unknown;
type DynamicRule = {
  id: number;
  priority?: number;
  action?: { type: string };
  condition?: { regexFilter?: string; resourceTypes?: string[] };
  [key: string]: unknown;
};
type RuleFixture = {
  id: string;
  version: number;
  name: string;
  enabled: boolean;
  priority: number;
  productId: string | null;
  deviceId: string | null;
  action: "ALLOW" | "BLOCK" | "WARN" | "REQUIRE_OVERRIDE";
  conditions: {
    toolKind?: string;
    toolKeys?: string[];
    contextKey?: string;
    contextValue?: string;
  };
  schedule: null | {
    timezone: string;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    startsAt?: string | null;
    endsAt?: string | null;
  };
  archivedAt?: string | null;
};

function makeEvent() {
  let listener: Listener | undefined;
  return {
    addListener(callback: Listener) {
      listener = callback;
    },
    emit(...args: unknown[]) {
      return listener?.(...args);
    },
  };
}

function makeBrowser(initialRules: DynamicRule[] = []) {
  const state: Record<string, unknown> = {};
  const dynamicRules = [...initialRules];
  const calls = {
    updates: [] as Array<{ removeRuleIds: number[]; addRules: DynamicRule[] }>,
    tabUpdates: [] as Array<{ tabId: number; url: string }>,
    alarmCreates: [] as unknown[][],
    alarmClears: [] as string[],
  };
  const runtimeOnMessage = makeEvent();
  const runtimeOnInstalled = makeEvent();
  const runtimeOnStartup = makeEvent();
  const alarmOnAlarm = makeEvent();
  const navigationBefore = makeEvent();
  const navigationCommitted = makeEvent();
  const api = {
    storage: {
      local: {
        async get(key: string | null) {
          if (key === null) return structuredClone(state);
          return { [key]: structuredClone(state[key]) };
        },
        async set(values: Record<string, unknown>) {
          Object.assign(state, structuredClone(values));
        },
        async setAccessLevel() {},
      },
    },
    permissions: {
      contains: vi.fn(async () => true),
    },
    declarativeNetRequest: {
      async isRegexSupported() {
        return { isSupported: true };
      },
      async getDynamicRules() {
        return structuredClone(dynamicRules);
      },
      async updateDynamicRules(change: { removeRuleIds: number[]; addRules: DynamicRule[] }) {
        calls.updates.push(structuredClone(change));
        for (const id of change.removeRuleIds) {
          const index = dynamicRules.findIndex((rule) => rule.id === id);
          if (index >= 0) dynamicRules.splice(index, 1);
        }
        dynamicRules.push(...structuredClone(change.addRules));
      },
    },
    runtime: {
      onMessage: runtimeOnMessage,
      onInstalled: runtimeOnInstalled,
      onStartup: runtimeOnStartup,
      getURL: (path: string) => `chrome-extension://pabcdefghijklmnoabcdefghijklmnop/${path}`,
      openOptionsPage: vi.fn(),
      connectNative: vi.fn(() => {
        throw new Error("Specified native messaging host not found.");
      }),
      lastError: null,
    },
    alarms: {
      onAlarm: alarmOnAlarm,
      create: vi.fn(async (...args: unknown[]) => calls.alarmCreates.push(args)),
      clear: vi.fn(async (name: string) => {
        calls.alarmClears.push(name);
        return true;
      }),
    },
    webNavigation: {
      onBeforeNavigate: navigationBefore,
      onCommitted: navigationCommitted,
    },
    tabs: {
      update: vi.fn(async (tabId: number, update: { url: string }) =>
        calls.tabUpdates.push({ tabId, ...update }),
      ),
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
  };

  return {
    api,
    state,
    dynamicRules,
    calls,
    runtimeOnMessage,
    runtimeOnStartup,
    alarmOnAlarm,
    navigationBefore,
    navigationCommitted,
  };
}

const product = { id: "product-p10", name: "Phase 10 fixture product" };
const alternateProduct = { id: "product-p10-alternate", name: "Phase 10 alternate product" };
const blockLocalhost: RuleFixture = {
  id: "rule-block-localhost",
  version: 1,
  name: "Block local fixture host",
  enabled: true,
  priority: 80,
  productId: product.id,
  deviceId: null,
  action: "BLOCK",
  conditions: { toolKind: "DOMAIN", toolKeys: ["127.0.0.1"] },
  schedule: null,
  archivedAt: null,
};
const blockGmail = {
  ...blockLocalhost,
  id: "rule-block-gmail",
  name: "Block Gmail in Build Mode",
  conditions: { toolKind: "DOMAIN", toolKeys: ["gmail.com"] },
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createHarness(
  options: {
    rules?: RuleFixture[];
    overrides?: unknown[];
    catalog?: Array<{ toolKind: string; toolKey: string }>;
    products?: Array<{ id: string; name: string }>;
    consent?: boolean;
  } = {},
) {
  const browser = makeBrowser();
  let revoked = false;
  let failConsent = false;
  let consentEnabled = options.consent ?? true;
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/login")
      return json({
        accessToken: "synthetic-extension-token",
        sessionId: "synthetic-session",
        deviceId: "synthetic-device",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
        user: { id: "synthetic-user", email: "phase10@example.test" },
      });
    if (url.pathname === "/auth/session/rotate")
      return json({
        accessToken: "synthetic-rotated-token",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      });
    if (revoked && url.pathname === "/privacy-consents")
      return json({ error: "Session revoked." }, 401);
    if (failConsent && url.pathname === "/privacy-consents")
      throw new Error("fixture API unavailable");
    if (url.pathname === "/privacy-consents")
      return json({ activityCollectionEnabled: consentEnabled, activityConsentRevision: "1" });
    if (url.pathname === "/rules")
      return json({ rules: options.rules ?? [], overrides: options.overrides ?? [] });
    if (url.pathname === "/classification/catalog") return json({ catalog: options.catalog ?? [] });
    if (url.pathname === "/classification/mappings") return json({ mappings: [] });
    if (url.pathname === "/products") return json({ products: options.products ?? [product] });
    if (url.pathname === "/activity/batch") return json({ accepted: true }, 202);
    return json({ error: `Unexpected fixture request ${url.pathname}` }, 404);
  });

  return {
    ...browser,
    fetch,
    setRevoked(value: boolean) {
      revoked = value;
    },
    setFailConsent(value: boolean) {
      failConsent = value;
    },
    setConsentEnabled(value: boolean) {
      consentEnabled = value;
    },
  };
}

async function dispatchMessage(
  harness: ReturnType<typeof createHarness>,
  message: unknown,
): Promise<Record<string, unknown>> {
  return await new Promise<Record<string, unknown>>((resolve) => {
    harness.runtimeOnMessage.emit(message, {}, (value: unknown) =>
      resolve(value as Record<string, unknown>),
    );
  });
}

async function connect(harness: ReturnType<typeof createHarness>) {
  return await dispatchMessage(harness, {
    type: "LOGIN",
    apiBaseUrl: "http://127.0.0.1:4418",
    email: "phase10@example.test",
    password: "fixture-only-password",
  });
}

describe("Phase 10 extension background client", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(async () => {
    vi.resetModules();
    harness = createHarness();
    vi.stubGlobal("browser", harness.api);
    vi.stubGlobal("fetch", harness.fetch);
    await import("./background.ts");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not contact an API origin until that exact host permission is granted", async () => {
    harness.api.permissions.contains.mockResolvedValueOnce(false);
    const response = await connect(harness);

    expect(response.error).toContain("Grant this extension access");
    expect(harness.api.permissions.contains).toHaveBeenCalledWith({
      origins: ["http://127.0.0.1:4418/*"],
    });
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it("rotates the extension session before expiry without changing its selected product", async () => {
    harness = createHarness();
    vi.stubGlobal("browser", harness.api);
    vi.stubGlobal("fetch", harness.fetch);
    vi.resetModules();
    await import("./background.ts");
    await connect(harness);
    harness.state.expiresAt = new Date(Date.now() + 23 * 60 * 60_000).toISOString();

    const synced = await dispatchMessage(harness, { type: "SYNC" });

    expect(synced.connected).toBe(true);
    expect(synced.selectedProductId).toBe(product.id);
    expect(harness.state.accessToken).toBe("synthetic-rotated-token");
    expect(
      harness.fetch.mock.calls.some(([input]) => String(input).includes("/auth/session/rotate")),
    ).toBe(true);
  });

  it("syncs the selected product policy, blocks top-level navigation, and records only opt-in hostnames", async () => {
    harness = createHarness({ rules: [blockLocalhost], consent: false });
    vi.stubGlobal("browser", harness.api);
    vi.stubGlobal("fetch", harness.fetch);
    vi.resetModules();
    await import("./background.ts");

    const connected = await connect(harness);
    expect(connected).toMatchObject({ connected: true, selectedProductId: product.id });
    const installed = harness.dynamicRules.find((rule) =>
      rule.condition?.regexFilter?.includes("127\\.0\\.0\\.1"),
    );
    expect(installed).toMatchObject({
      action: { type: "block" },
      condition: { resourceTypes: ["main_frame"] },
    });

    harness.navigationBefore.emit({
      frameId: 0,
      tabId: 9,
      url: "http://127.0.0.1:3310/private/path?secret=query",
    });
    await vi.waitFor(() => expect(harness.api.tabs.update).toHaveBeenCalled());
    expect(harness.calls.tabUpdates.at(-1)).toEqual({
      tabId: 9,
      url: "chrome-extension://pabcdefghijklmnoabcdefghijklmnop/block.html?tabId=9",
    });
    expect(await dispatchMessage(harness, { type: "BLOCK_INFO", tabId: 9 })).toMatchObject({
      host: "127.0.0.1",
    });
    expect(await dispatchMessage(harness, { type: "SET_TRACKING", enabled: true })).toMatchObject({
      error: expect.stringContaining("Activity collection consent is off"),
    });

    harness.setConsentEnabled(true);
    await dispatchMessage(harness, { type: "SYNC" });
    await dispatchMessage(harness, { type: "SET_TRACKING", enabled: true });
    harness.navigationCommitted.emit({
      frameId: 0,
      tabId: 10,
      timeStamp: Date.now(),
      url: "https://docs.example.test/private/path?secret=query",
    });
    await vi.waitFor(() => expect(harness.state.events).toHaveLength(1));
    await dispatchMessage(harness, { type: "FLUSH_EVENTS" });

    const upload = harness.fetch.mock.calls.find(([input]) =>
      String(input).includes("/activity/batch"),
    );
    const sent = JSON.parse(String(upload?.[1]?.body)).events[0];
    expect(sent.attributes).toEqual({
      hostname: "docs.example.test",
      policy_action: "ALLOW",
      mode: "BUILD",
    });
    expect(JSON.stringify(sent)).not.toMatch(/private|secret|query/);
    expect(
      harness.fetch.mock.calls.some(([input]) => String(input).includes("/activity/batch")),
    ).toBe(true);
  });

  it("switches the selected product and replaces its browser policy", async () => {
    harness = createHarness({
      products: [product, alternateProduct],
      rules: [blockLocalhost],
    });
    vi.stubGlobal("browser", harness.api);
    vi.stubGlobal("fetch", harness.fetch);
    vi.resetModules();
    await import("./background.ts");
    await connect(harness);

    expect(
      harness.dynamicRules.find((rule) => rule.condition?.regexFilter?.includes("127\\.0\\.0\\.1"))
        ?.action?.type,
    ).toBe("block");
    const switched = await dispatchMessage(harness, {
      type: "SET_PRODUCT",
      productId: alternateProduct.id,
    });
    expect(switched.selectedProductId).toBe(alternateProduct.id);
    expect(
      harness.dynamicRules.find((rule) => rule.condition?.regexFilter?.includes("127\\.0\\.0\\.1"))
        ?.action?.type,
    ).toBe("allow");
  });

  it("uses shared scheduled-rule and temporary-override precedence when installing domain rules", async () => {
    const now = Date.now();
    const scheduledBlock: RuleFixture = {
      ...blockLocalhost,
      schedule: {
        timezone: "UTC",
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "00:00",
        endTime: "23:59",
      },
    };
    harness = createHarness({
      rules: [scheduledBlock],
      overrides: [
        {
          id: "override-localhost-allow",
          productId: product.id,
          deviceId: null,
          toolKind: "DOMAIN",
          toolKey: "127.0.0.1",
          action: "ALLOW",
          reason: "Phase 10 evaluator parity",
          startsAt: new Date(now - 60_000).toISOString(),
          expiresAt: new Date(now + 60 * 60_000).toISOString(),
          createdAt: new Date(now).toISOString(),
        },
      ],
    });
    vi.stubGlobal("browser", harness.api);
    vi.stubGlobal("fetch", harness.fetch);
    vi.resetModules();
    await import("./background.ts");
    await connect(harness);

    expect(
      harness.dynamicRules.find((rule) => rule.condition?.regexFilter?.includes("127\\.0\\.0\\.1"))
        ?.action?.type,
    ).toBe("allow");
  });

  it("keeps local Growth Mode within its limit and gives its allowlist precedence over a block rule", async () => {
    harness = createHarness({ rules: [blockGmail] });
    vi.stubGlobal("browser", harness.api);
    vi.stubGlobal("fetch", harness.fetch);
    vi.resetModules();
    await import("./background.ts");
    await connect(harness);

    const growth = await dispatchMessage(harness, { type: "SET_MODE", mode: "GROWTH" });
    expect(growth.mode).toBe("GROWTH");
    const remainingGrowthMs = Number(growth.growthModeUntil) - Date.now();
    expect(remainingGrowthMs).toBeGreaterThan(0);
    expect(remainingGrowthMs).toBeLessThanOrEqual(60 * 60_000);
    expect(
      harness.dynamicRules.find(
        (rule) => rule.condition?.regexFilter?.includes("gmail\\.com") && rule.priority === 300_000,
      )?.action?.type,
    ).toBe("allow");

    await harness.alarmOnAlarm.emit({ name: "enough-growth-session-end" });
    await vi.waitFor(async () => {
      expect((await dispatchMessage(harness, { type: "GET_STATE" })).mode).toBe("BUILD");
    });
  });

  it("caps installed domain candidates at 900 and reports truncation", async () => {
    harness = createHarness({
      catalog: Array.from({ length: 1_000 }, (_, index) => ({
        toolKind: "DOMAIN",
        toolKey: `domain-${index}.example.test`,
      })),
    });
    vi.stubGlobal("browser", harness.api);
    vi.stubGlobal("fetch", harness.fetch);
    vi.resetModules();
    await import("./background.ts");

    const connected = await connect(harness);
    expect(connected.truncatedCandidates).toBe(true);
    expect(harness.dynamicRules.filter((rule) => rule.id >= 1100 && rule.id <= 1999)).toHaveLength(
      900,
    );
  });

  it("clears cached blocking rules when policy expires or the server revokes the extension session", async () => {
    harness = createHarness({ rules: [blockLocalhost] });
    vi.stubGlobal("browser", harness.api);
    vi.stubGlobal("fetch", harness.fetch);
    vi.resetModules();
    await import("./background.ts");
    await connect(harness);
    expect(harness.dynamicRules.some((rule) => rule.id >= 1000 && rule.id <= 2999)).toBe(true);

    harness.setFailConsent(true);
    const offlineSync = await dispatchMessage(harness, { type: "SYNC" });
    expect(offlineSync.error).toBe("fixture API unavailable");
    expect((await dispatchMessage(harness, { type: "GET_STATE" })).policyStale).toBe(false);
    expect(harness.dynamicRules.some((rule) => rule.id >= 1000 && rule.id <= 2999)).toBe(true);

    harness.state.lastSyncAt = new Date(Date.now() - 24 * 60 * 60_000 - 1).toISOString();
    const failedSync = await dispatchMessage(harness, { type: "SYNC" });
    expect(failedSync.error).toBe("fixture API unavailable");
    expect(harness.dynamicRules.some((rule) => rule.id >= 1000 && rule.id <= 2999)).toBe(false);
    expect((await dispatchMessage(harness, { type: "GET_STATE" })).policyStale).toBe(true);

    harness.setFailConsent(false);
    harness.setRevoked(true);
    const revokedSync = await dispatchMessage(harness, { type: "SYNC" });
    expect(revokedSync.error).toBe("Session revoked.");
    expect((await dispatchMessage(harness, { type: "GET_STATE" })).connected).toBe(false);
    expect(harness.dynamicRules.some((rule) => rule.id >= 1000 && rule.id <= 2999)).toBe(false);
    expect(harness.calls.alarmClears).toContain("enough-policy-sync");
  });

  it("clears extension-owned rules on browser startup when its stored session is absent", async () => {
    harness.dynamicRules.push({
      id: 1100,
      priority: 100,
      action: { type: "block" },
      condition: { regexFilter: "^https?://example\\.test", resourceTypes: ["main_frame"] },
    });
    harness.state.accessToken = null;
    await harness.runtimeOnStartup.emit();
    expect(harness.dynamicRules).toEqual([]);
  });

  it("restores cached policy and refreshes it after the browser worker restarts", async () => {
    harness = createHarness({ rules: [blockLocalhost] });
    vi.stubGlobal("browser", harness.api);
    vi.stubGlobal("fetch", harness.fetch);
    vi.resetModules();
    await import("./background.ts");
    await connect(harness);
    harness.dynamicRules.splice(0, harness.dynamicRules.length);

    await harness.runtimeOnStartup.emit();

    expect(
      harness.dynamicRules.some(
        (rule) =>
          rule.action?.type === "block" && rule.condition?.regexFilter?.includes("127\\.0\\.0\\.1"),
      ),
    ).toBe(true);
    expect(harness.state.lastSyncAt).not.toBeNull();
  });

  it("reports an unavailable native host without marking the desktop agent healthy", async () => {
    harness = createHarness();
    vi.stubGlobal("browser", harness.api);
    vi.stubGlobal("fetch", harness.fetch);
    vi.resetModules();
    await import("./background.ts");
    await connect(harness);

    const response = await dispatchMessage(harness, { type: "CONNECT_NATIVE" });

    expect(response.error).toBe("Specified native messaging host not found.");
    expect((await dispatchMessage(harness, { type: "GET_STATE" })).nativeAgent).toBe(false);
    expect(harness.api.runtime.connectNative).toHaveBeenCalledWith("com.enough.agent");
  });
});
