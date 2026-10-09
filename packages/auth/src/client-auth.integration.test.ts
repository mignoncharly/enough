import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.ENOUGH_PHASE2_INTEGRATION === "1";
const root = process.cwd();
const apiBaseUrl = "http://127.0.0.1:4402";
type ClientState = { accessToken: string | null; sessionId: string | null };
type ClientExports = {
  login(input: { apiBaseUrl: string; email: string; password: string }): Promise<unknown>;
  loginWithToken(input: { apiBaseUrl: string; accessToken: string }): Promise<unknown>;
  syncPolicy(): Promise<unknown>;
  persistState(): Promise<unknown>;
  snapshot(): ClientState | Promise<ClientState>;
  expireSoon(): unknown;
};

// Execute the actual client functions with in-memory OS/browser adapters. No
// installed client, native host, keychain, personal storage or UI is opened.
async function client(kind: "desktop" | "extension") {
  const file = path.join(
    root,
    kind === "desktop" ? "apps/desktop/src/main.mjs" : "apps/extension/src/background.ts",
  );
  const source = await readFile(file, "utf8");
  const instrumentation =
    kind === "desktop"
      ? "export { login, loginWithToken, syncPolicy, persistState }; export const snapshot = () => state; export const expireSoon = () => { state.expiresAt = new Date(Date.now() + 60000).toISOString(); };"
      : "export { login, loginWithDeviceToken as loginWithToken, syncPolicy }; export const snapshot = () => readState(); export const expireSoon = () => writeState({expiresAt: new Date(Date.now() + 60000).toISOString()}); export const persistState = async () => {};";
  const require = createRequire(path.join(root, "apps/desktop/package.json"));
  const { build } = require("esbuild");
  const result = await build({
    stdin: {
      contents: `${source}\n${instrumentation}`,
      resolveDir: path.dirname(file),
      loader: kind === "desktop" ? "js" : "ts",
    },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    external: ["electron", "electron-updater", "get-windows"],
    logLevel: "silent",
  });
  let saved = {};
  let encrypted = "";
  const noop = () => {};
  const event = { addListener: noop };
  const browser = {
    runtime: {
      onInstalled: event,
      onStartup: event,
      onMessage: event,
      getURL: (value: string) => `chrome-extension://fixture/${value}`,
    },
    storage: {
      local: {
        get: async () => structuredClone(saved),
        set: async (values: object) => {
          saved = { ...saved, ...structuredClone(values) };
        },
      },
    },
    permissions: { contains: async () => true },
    alarms: { create: async () => {}, clear: async () => true, onAlarm: event },
    webNavigation: { onBeforeNavigate: event, onCommitted: event },
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {},
      isRegexSupported: async () => ({ isSupported: true }),
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  const electron = {
    app: {
      setName: noop,
      setPath: noop,
      getPath: () => "/in-memory-fixture",
      requestSingleInstanceLock: () => false,
      quit: noop,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "fixture",
      encryptString: (value: string) => value,
    },
  };
  const module = { exports: {} as ClientExports };
  runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "electron") return electron;
      if (name === "electron-updater") return { autoUpdater: {} };
      if (name === "get-windows") return { activeWindow: noop };
      if (name === "node:fs/promises")
        return {
          mkdir: async () => {},
          writeFile: async (_path: string, value: string) => {
            encrypted = value;
          },
          chmod: async () => {},
        };
      return require(name);
    },
    browser,
    process: { platform: "win32", env: {} },
    structuredClone,
    URL,
    Headers,
    Response,
    AbortSignal,
    performance,
    Date,
    setTimeout: () => 0,
    clearTimeout: noop,
    fetch: (input: string, options: RequestInit) => {
      expect(new URL(input).origin).toBe(apiBaseUrl);
      return fetch(input, options);
    },
  });
  return {
    ...module.exports,
    persisted: () => (kind === "desktop" ? JSON.parse(encrypted) : saved),
  };
}

describe.skipIf(!enabled)("Actual client auth against isolated HTTP", () => {
  let pool: typeof import("@enough/db").pool;
  const ids: string[] = [];
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
    expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
      "127.0.0.1",
      "55433",
      "/enough_phase2",
      "enough_phase2",
    ]);
    expect(process.env.API_BASE_URL).toBe(apiBaseUrl);
    ({ pool } = await import("@enough/db"));
  });
  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM enough.auth_audit_events WHERE user_id = ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM enough.auth_users WHERE id = ANY($1::uuid[])", [ids]);
    await pool.end();
  });
  it.each(["desktop", "extension"] as const)(
    "%s rejects bad credentials, persists renewal, rejects the old token and clears revoked auth",
    async (kind) => {
      const id = randomUUID();
      const email = `phase2-client-${id}@example.test`;
      const password = randomBytes(24).toString("base64url");
      const { hashPassword } = await import("./crypto.js");
      ids.push(id);
      await pool.query(
        "INSERT INTO enough.auth_users (id, email, email_normalized, password_hash, email_verified_at) VALUES ($1, $2, $2, $3, now())",
        [id, email, await hashPassword(password)],
      );
      const agent = await client(kind);
      await expect(
        agent.login({ apiBaseUrl, email, password: "incorrect-password" }),
      ).rejects.toThrow();
      await expect(
        agent.loginWithToken({ apiBaseUrl, accessToken: "invalid-disposable-token" }),
      ).rejects.toThrow();
      expect((await agent.snapshot()).accessToken).toBeFalsy();
      expect(await agent.login({ apiBaseUrl, email, password })).toMatchObject({
        connected: true,
        email,
      });
      const original = await agent.snapshot();
      await agent.expireSoon();
      expect(await agent.syncPolicy()).toMatchObject({ connected: true, email, syncError: "" });
      await agent.persistState();
      const renewed = await agent.snapshot();
      expect(renewed.accessToken).not.toBe(original.accessToken);
      expect(renewed.sessionId).toBe(original.sessionId);
      expect(agent.persisted().accessToken).toBe(renewed.accessToken);
      const me = (token: string) =>
        fetch(`${apiBaseUrl}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
      expect((await me(String(original.accessToken))).status).toBe(401);
      expect((await me(String(renewed.accessToken))).status).toBe(200);
      await pool.query(
        "UPDATE enough.auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2",
        [renewed.sessionId, id],
      );
      if (kind === "extension") await expect(agent.syncPolicy()).rejects.toThrow("Sign in");
      else expect(await agent.syncPolicy()).toMatchObject({ connected: false });
      await agent.persistState();
      expect(agent.persisted().accessToken).toBeNull();
      expect((await me(String(renewed.accessToken))).status).toBe(401);
    },
  );
});
