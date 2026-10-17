import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEnvironment } from "../packages/config/src/index.ts";
import { postgresCliEnvironment } from "./postgres-env.mjs";
import { commandEnvironment, isolatedEnvironment } from "./subprocess-environment.mjs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const sensitiveKeys = [
  "POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY",
  "EVIDENCE_STORAGE_ACCESS_KEY_ID",
  "EVIDENCE_STORAGE_SECRET_ACCESS_KEY",
  "GOOGLE_INTEGRATION_CLIENT_SECRET",
  "MICROSOFT_INTEGRATION_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_SECRET",
  "AUTH_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRETS",
  "OPENAI_API_KEY",
  "GA4_API_SECRET",
  "PLAUSIBLE_STATS_API_KEY",
  "POSTHOG_PERSONAL_API_KEY",
  "AWS_SESSION_TOKEN",
  "NPM_TOKEN",
  "NODE_OPTIONS",
  "BACKUP_AGE_IDENTITY_FILE",
  "RESTORE_ADMIN_DATABASE_URL",
];

describe("release child environment contract", () => {
  it.each(["--clean", "--test"])(
    "drops inherited credentials and startup injection in %s",
    (mode) => {
      const parent = {
        PATH: "/safe/bin",
        SystemRoot: "C:/Windows",
        LANG: "C.UTF-8",
        ...Object.fromEntries(sensitiveKeys.map((key) => [key, "synthetic-inherited-sensitive"])),
      };
      const before = { ...parent };
      const child = commandEnvironment(parent, mode);
      for (const key of sensitiveKeys) expect(child[key]).toBeUndefined();
      expect(child.PATH).toBe(parent.PATH);
      expect(child.SystemRoot).toBe(parent.SystemRoot);
      expect(child.LANG).toBe(parent.LANG);
      expect(parent).toEqual(before);
    },
  );
  it("permits explicitly supplied fixture credentials without inheriting production values", () => {
    const child = isolatedEnvironment(
      { DATABASE_URL: "synthetic-production", AUTH_SECRET: "synthetic-production" },
      { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture" },
    );
    expect(child.DATABASE_URL).toContain("fixture");
    expect(child.AUTH_SECRET).toBeUndefined();
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "process.stdout.write(String(Boolean(process.env.DATABASE_URL?.includes('fixture')) && !process.env.AUTH_SECRET))",
      ],
      { env: child, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("true");
  });
  it("builds with only public origins and disposable module-evaluation credentials", () => {
    const parent = {
      ...Object.fromEntries(sensitiveKeys.map((key) => [key, "synthetic-inherited-sensitive"])),
      APP_BASE_URL: "https://app.example.test",
      API_BASE_URL: "https://api.example.test",
    };
    const child = commandEnvironment(parent, "--build");
    expect(Object.values(child)).not.toContain("synthetic-inherited-sensitive");
    expect(child.API_BASE_URL).toBe(parent.API_BASE_URL);
    expect(parseEnvironment(child).NODE_ENV).toBe("production");
    expect(child.GOOGLE_INTEGRATION_CLIENT_SECRET).toBeUndefined();
    expect(child.EVIDENCE_STORAGE_SECRET_ACCESS_KEY).toBeUndefined();
  });
  it("fails closed on missing mode or credential-bearing build origins", () => {
    expect(() => commandEnvironment({}, undefined)).toThrow();
    expect(() =>
      commandEnvironment({ APP_BASE_URL: "https://user:password@example.test" }, "--build"),
    ).toThrow();
  });
  it("runtime configuration remains intact in an explicit trusted runtime invocation", () => {
    const source = { AUTH_SECRET: "synthetic-runtime" };
    expect(commandEnvironment(source, "--runtime")).toEqual(source);
    expect(commandEnvironment(source, "--runtime")).not.toBe(source);
  });
  it("scopes PostgreSQL CLI credentials to its explicit connection", () => {
    const child = postgresCliEnvironment(
      "postgresql://fixture:synthetic-pg@127.0.0.1:5432/fixture",
    );
    expect(child.PGPASSWORD).toBe("synthetic-pg");
    expect(child.PGDATABASE).toBe("fixture");
    for (const key of sensitiveKeys) expect(child[key]).toBeUndefined();
  });
  it("runs trusted offline preflight without connecting or echoing invalid values", () => {
    const loader = createRequire(import.meta.url).resolve("tsx", {
      paths: [fileURLToPath(new URL("../apps/api/", import.meta.url))],
    });
    const script = fileURLToPath(new URL("./release-config-preflight.ts", import.meta.url));
    const source = commandEnvironment(process.env, "--clean");
    const valid = commandEnvironment(
      {
        ...source,
        APP_BASE_URL: "https://app.example.test",
        API_BASE_URL: "https://api.example.test",
      },
      "--build",
    );
    for (const [env, expected] of [
      [valid, 0],
      [{ ...valid, POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY: "synthetic-invalid-sensitive" }, 1],
      [{ ...valid, DATABASE_URL: undefined }, 1],
      [{ ...valid, ENOUGH_PHASE14_MICROSOFT_LOCALHOST_CALLBACK: "1" }, 1],
    ] as const) {
      const child = spawnSync(process.execPath, ["--import", pathToFileURL(loader).href, script], {
        env,
        encoding: "utf8",
        timeout: 15000,
      });
      expect(child.status).toBe(expected);
      expect(child.stdout + child.stderr).not.toContain("synthetic-invalid-sensitive");
      expect(child.stdout + child.stderr).toContain(expected === 0 ? "PASS" : "BLOCKED");
    }
  }, 30000);
  it("release install/test/build call sites select isolation and production validation separately", () => {
    const deploy = read("scripts/deploy.sh");
    expect(deploy).toContain("run_with_env --clean /usr/bin/pnpm install --frozen-lockfile");
    expect(deploy).toContain("run_with_env --test /usr/bin/pnpm test");
    expect(deploy).toContain("run_with_env --build /usr/bin/pnpm --filter @enough/web build");
    expect(deploy).toContain(
      "run_with_env --runtime /usr/bin/pnpm --filter @enough/api exec tsx ../../scripts/release-config-preflight.ts",
    );
    expect(read("scripts/run-command.mjs")).toContain("checkout without dotenv credential files");
  });
});

describe("production environment documentation", () => {
  const example = read("infra/env/enough.env.example");
  const keys = [...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]);
  it("documents all runtime config keys without duplicates", () => {
    const schemaKeys = [
      ...read("packages/config/src/index.ts").matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm),
    ].map((match) => match[1]);
    expect(schemaKeys.length).toBeGreaterThan(35);
    for (const key of schemaKeys) {
      expect(keys).toContain(key);
      expect(read("infra/README.md")).toContain(`\`${key}\``);
    }
    for (const key of sensitiveKeys.slice(0, 5)) expect(keys).toContain(key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(example).not.toContain("BEGIN PRIVATE KEY");
  });
  it("a completed synthetic production template passes the runtime validator", () => {
    const template = Object.fromEntries(
      [...example.matchAll(/^([A-Z][A-Z0-9_]+)=(.*)$/gm)].map((match) => [
        match[1],
        match[2].trim(),
      ]),
    );
    expect(() => parseEnvironment(template)).toThrow("POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY");
    template.POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString()
      .replaceAll("\n", "\\n");
    template.RESEND_API_KEY = "synthetic-mail-credential";
    template.AUTH_EMAIL_FROM = "test@example.test";
    expect(parseEnvironment(template).NODE_ENV).toBe("production");
  });
});

describe("offline Nginx OAuth protection", () => {
  const nginx = read("infra/nginx/enough.conf");
  const patterns = [...nginx.matchAll(/^\s*~(\S+) 0;/gm)].map((match) => new RegExp(match[1]));
  it.each([
    "/auth/oauth/google/callback",
    "/auth/oauth/github/callback",
    "/integrations/oauth/google/callback",
    "/integrations/oauth/microsoft/callback",
    "/integrations/oauth/unknown/callback",
    "/api/integrations/oauth/google/callback",
  ])("excludes %s from access logging by path", (route) => {
    expect(
      patterns.some((pattern) =>
        pattern.test(
          new URL(`${route}?code=synthetic&state=synthetic`, "https://api.example.test").pathname,
        ),
      ),
    ).toBe(true);
  });
  it("keeps ordinary traffic logged and installs the condition on every server", () => {
    for (const route of ["/health", "/integrations/providers", "/auth/login", "/api/products"])
      expect(patterns.some((pattern) => pattern.test(route))).toBe(false);
    expect(nginx.match(/if=\$enough_access_log;/g)?.length).toBe(
      nginx.match(/^server \{/gm)?.length,
    );
    expect(nginx).toContain("proxy_pass http://enough_api;");
    expect(nginx).toContain("proxy_pass http://enough_web;");
    expect(nginx.match(/error_log \/dev\/null;/g)).toHaveLength(2);
  });
  it("matches actual generic callback registrations and excludes raw sign-in errors", () => {
    const auth = read("packages/auth/src/oauth.ts");
    expect(auth).toContain('app.get("/auth/oauth/:provider/callback"');
    expect(auth).toContain('request.log.warn({ provider }, "OAuth sign-in did not complete")');
    expect(read("apps/api/src/integration-provider-routes.ts")).toContain(
      'app.get("/integrations/oauth/:family/callback"',
    );
  });
});
