import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Fixed, separately owned targets. Never loads the root .env or resets another service.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const phase3 = process.argv.includes("--phase3");
const phase4 = process.argv.includes("--phase4");
const phase5 = process.argv.includes("--phase5");
const phase = phase5 ? "phase5" : phase4 ? "phase4" : phase3 ? "phase3" : "phase2";
const fixture =
  phase3 || phase4 || phase5 ? join(tmpdir(), `enough-${phase}`) : join(root, ".runtime", phase);
const pgPort = phase5 ? 55436 : phase4 ? 55435 : phase3 ? 55434 : 55433;
const redisPort = phase5 ? 56387 : phase4 ? 56385 : phase3 ? 56383 : 56381;
const wslRedisPort = phase5 ? "56388" : phase4 ? "56386" : phase3 ? "56384" : "56382";
const apiPort = phase5 ? 4408 : phase4 ? 4406 : phase3 ? 4404 : 4402;
const webPort = phase5 ? 3305 : phase4 ? 3304 : phase3 ? 3303 : 3302;
const phaseFlag = `--${phase}`;
const mode = process.argv[2] ?? "test";
assert.ok(["test", "serve", "prepare"].includes(mode), "Use test, serve or prepare.");
assert.ok(!phase5 || mode === "test", "Phase 5 is an automated ingestion fixture.");
const extensionOrigins = phase3 || phase4 || phase5 ? "" : (process.argv[3] ?? "");
assert.ok(
  extensionOrigins
    .split(",")
    .filter(Boolean)
    .every((origin) =>
      /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9-]{36})$/.test(origin),
    ),
  "Supply only exact installed extension origins.",
);
const children = [];
let postgresStarted = false;
let redisStarted = false;
let closing = false;
let redisBridge;

async function freePort(port) {
  const server = createServer();
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function launch(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    windowsHide: true,
    stdio: "inherit",
    ...options,
  });
  children.push(child);
  child.on("error", (error) => console.error(`Fixture process failed: ${error.message}`));
  return child;
}

async function runNode(args, options = {}) {
  const child = launch(process.execPath, args, options);
  const [code] = await once(child, "exit");
  assert.equal(code, 0, `Fixture command failed: ${args.at(-1)}`);
}

async function ready(url, child) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Fixture exited before readiness: ${url}`);
    try {
      const result = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (result.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error(`Fixture readiness timeout: ${url}`);
}

async function cleanup() {
  if (closing) return;
  closing = true;
  if (redisBridge) redisBridge.close();
  for (const child of children.toReversed()) {
    if (child.exitCode === null && !child.killed) {
      child.kill();
      await Promise.race([once(child, "exit").catch(() => {}), delay(3000)]);
    }
  }
  if (redisStarted) {
    try {
      execFileSync(
        "wsl",
        [
          "-d",
          "Ubuntu",
          "--exec",
          "redis-cli",
          "-h",
          "127.0.0.1",
          "-p",
          wslRedisPort,
          "shutdown",
          "nosave",
        ],
        { windowsHide: true, stdio: "ignore" },
      );
    } catch {}
  }
  if (postgresStarted) {
    execFileSync(
      process.execPath,
      [join(root, "scripts", "phase1-postgres.mjs"), "stop", phaseFlag],
      { windowsHide: true, stdio: "inherit" },
    );
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void cleanup().then(() => process.exit(0)));
}

try {
  // Refuse occupied ports, including a previously started fixture; never take it over.
  for (const port of [pgPort, redisPort, apiPort, webPort]) await freePort(port);
  // Check Redis's WSL network namespace as well as the Windows listener.
  execFileSync(
    "wsl",
    [
      "-d",
      "Ubuntu",
      "--exec",
      "python3",
      "-c",
      `import socket; s=socket.socket(); s.bind(('127.0.0.1',${wslRedisPort})); s.close()`,
    ],
    { windowsHide: true, stdio: "pipe" },
  );
  await mkdir(fixture, { recursive: true });
  await runNode(["scripts/phase1-postgres.mjs", "start", phaseFlag]);
  postgresStarted = true;
  const environment = {
    ...process.env,
    ...parseEnv(await readFile(join(fixture, "fixture.env"), "utf8")),
  };
  environment.NODE_ENV = "development";
  environment.NEXT_TELEMETRY_DISABLED = "1";
  environment.CI = "1";
  environment.AUTH_ALLOWED_ORIGINS = extensionOrigins;
  environment.ENOUGH_PHASE2_INTEGRATION = phase3 || phase4 || phase5 ? "0" : "1";
  environment.ENOUGH_PHASE3_INTEGRATION = phase3 || phase4 || phase5 ? "1" : "0";
  environment.ENOUGH_PHASE4_INTEGRATION = phase4 || phase5 ? "1" : "0";
  environment.ENOUGH_PHASE5_INTEGRATION = phase5 ? "1" : "0";
  // The generated fixture explicitly blanks all provider credentials; no root env file is loaded.
  assert.equal(new URL(environment.DATABASE_URL).pathname, `/enough_${phase}`);
  assert.equal(new URL(environment.DATABASE_URL).port, String(pgPort));
  assert.equal(environment.REDIS_URL, `redis://127.0.0.1:${redisPort}/0`);
  const redis = launch("wsl", [
    "-d",
    "Ubuntu",
    "--exec",
    "redis-server",
    "--bind",
    "127.0.0.1",
    "--port",
    wslRedisPort,
    "--save",
    "",
    "--appendonly",
    "no",
    "--daemonize",
    "no",
  ]);
  redisStarted = true;
  let pong = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      pong =
        execFileSync("wsl", ["-d", "Ubuntu", "--exec", "redis-cli", "-p", wslRedisPort, "ping"], {
          windowsHide: true,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim() === "PONG";
      if (pong) break;
    } catch {}
    if (redis.exitCode !== null) throw new Error("Fixture Redis exited.");
    await delay(500);
  }
  assert.ok(pong, "Fixture Redis did not become ready.");
  // WSL localhost forwarding is not reliable on this host. Use a fixture-owned
  // loopback-only byte relay; Redis remains bound to loopback inside WSL too.
  redisBridge = createServer((socket) => {
    const relay = launch(
      "wsl",
      [
        "-d",
        "Ubuntu",
        "--exec",
        "python3",
        "-u",
        "-c",
        [
          "import socket,sys,threading",
          `s=socket.create_connection(('127.0.0.1',${wslRedisPort}))`,
          "def send():",
          " try:",
          "  while data:=sys.stdin.buffer.read1(65536): s.sendall(data)",
          " finally: s.shutdown(socket.SHUT_WR)",
          "threading.Thread(target=send,daemon=True).start()",
          "while data:=s.recv(65536):",
          " sys.stdout.buffer.write(data); sys.stdout.buffer.flush()",
        ].join("\n"),
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    socket.pipe(relay.stdin);
    relay.stdout.pipe(socket);
    relay.stdin.on("error", () => socket.destroy());
    socket.on("error", () => {});
    socket.on("close", () => relay.kill());
    relay.on("exit", () => socket.destroy());
  });
  redisBridge.listen(redisPort, "127.0.0.1");
  await once(redisBridge, "listening");
  const expectedInfo = execFileSync(
    "wsl",
    ["-d", "Ubuntu", "--exec", "redis-cli", "-p", wslRedisPort, "info", "server"],
    { windowsHide: true, encoding: "utf8" },
  );
  const Redis = createRequire(join(root, "packages/cache/package.json"))("ioredis");
  const redisProbe = new Redis(environment.REDIS_URL, {
    lazyConnect: true,
    retryStrategy: (attempt) => (attempt < 60 ? 500 : null),
    maxRetriesPerRequest: 60,
  });
  redisProbe.on("error", () => {});
  try {
    await redisProbe.connect();
    const actualInfo = await redisProbe.info("server");
    const expectedId = expectedInfo.match(/run_id:([^\r\n]+)/)?.[1];
    assert.ok(expectedId);
    assert.equal(
      actualInfo.match(/run_id:([^\r\n]+)/)?.[1],
      expectedId,
      "Redis endpoint must be this fixture's WSL process",
    );
  } finally {
    redisProbe.disconnect();
  }
  for (const script of ["src/migrate.ts", "src/migration-precheck.ts"]) {
    await runNode(["--import", "tsx", script], {
      cwd: join(root, "packages", "db"),
      env: environment,
    });
  }
  // Copy web sources; builds and generated configuration stay inside the fixture.
  const webRoot = join(fixture, "web");
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "apps/web"],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  )
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    const destination = join(webRoot, path.slice("apps/web/".length));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, path), destination);
  }
  const webTsconfig = JSON.parse(await readFile(join(webRoot, "tsconfig.json"), "utf8"));
  webTsconfig.extends = join(root, "tsconfig.base.json").replaceAll("\\", "/");
  await writeFile(join(webRoot, "tsconfig.json"), `${JSON.stringify(webTsconfig, null, 2)}\n`);
  const modules = join(webRoot, "node_modules");
  // Link individual canonical targets; relative pnpm links break through a directory junction.
  if ((await lstat(modules).catch(() => null))?.isSymbolicLink()) await unlink(modules);
  await mkdir(modules, { recursive: true });
  const webPackage = JSON.parse(await readFile(join(webRoot, "package.json"), "utf8"));
  for (const name of Object.keys({ ...webPackage.dependencies, ...webPackage.devDependencies })) {
    const destination = join(modules, name);
    await mkdir(dirname(destination), { recursive: true });
    if (!(await lstat(destination).catch(() => null)))
      await symlink(
        await realpath(join(root, "apps/web/node_modules", name)),
        destination,
        "junction",
      );
  }
  const api = launch(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: join(root, "apps", "api"),
    env: environment,
  });
  const web = launch(
    process.execPath,
    [
      join(root, "apps", "web", "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    { cwd: webRoot, env: environment },
  );
  await ready(`http://127.0.0.1:${apiPort}/ready`, api);
  await ready(`http://127.0.0.1:${webPort}/api/ready`, web);
  console.info(`Isolated API/web ready at ${apiPort}/${webPort}; other runtimes untouched.`);
  if (mode === "test") {
    await runNode(
      phase3 || phase4 || phase5
        ? [
            join(root, "node_modules", "vitest", "vitest.mjs"),
            "run",
            "apps/api/src/onboarding.integration.test.ts",
            ...(phase4 || phase5 ? ["apps/api/src/products.integration.test.ts"] : []),
            ...(phase5 ? ["apps/api/src/activity.integration.test.ts"] : []),
            "--hookTimeout=60000",
            "--testTimeout=60000",
            "--maxWorkers=1",
          ]
        : ["scripts/phase2-auth-tests.mjs"],
      { env: environment },
    );
  } else {
    await runNode(
      [
        "--import",
        "tsx",
        join(
          root,
          "scripts",
          phase3 || phase4 ? "phase3-manual-account.mjs" : "phase2-manual-account.mjs",
        ),
      ],
      {
        cwd: join(root, "apps", "api"),
        env: environment,
      },
    );
    if (mode === "prepare") {
      console.info("Manual fixture preparation verified; stopping fixture services.");
    } else {
      console.info(
        phase3 || phase4
          ? `Fixture serving. Ctrl+C stops this fixture; data stays in TEMP/enough-${phase}.`
          : "Fixture serving. Ctrl+C stops only this fixture; data stays in ignored .runtime/phase2.",
      );
      await Promise.race([once(api, "exit"), once(web, "exit"), once(redis, "exit")]);
      throw new Error("A fixture service exited.");
    }
  }
} finally {
  await cleanup();
}
