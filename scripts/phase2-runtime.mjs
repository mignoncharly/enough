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
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Fixed, separately owned targets. Never loads the root .env or resets another service.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = join(root, ".runtime", "phase2");
const mode = process.argv[2] ?? "test";
assert.ok(["test", "serve", "prepare"].includes(mode), "Use test, serve or prepare.");
const extensionOrigins = process.argv[3] ?? "";
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
          "56382",
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
      [join(root, "scripts", "phase1-postgres.mjs"), "stop", "--phase2"],
      { windowsHide: true, stdio: "inherit" },
    );
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void cleanup().then(() => process.exit(0)));
}

try {
  // Refuse occupied ports, including a previously started fixture; never take it over.
  for (const port of [55433, 56381, 4402, 3302]) await freePort(port);
  // Check Redis's WSL network namespace as well as the Windows listener.
  execFileSync(
    "wsl",
    [
      "-d",
      "Ubuntu",
      "--exec",
      "python3",
      "-c",
      "import socket; s=socket.socket(); s.bind(('127.0.0.1',56382)); s.close()",
    ],
    { windowsHide: true, stdio: "pipe" },
  );
  await mkdir(fixture, { recursive: true });
  await runNode(["scripts/phase1-postgres.mjs", "start", "--phase2"]);
  postgresStarted = true;
  const environment = {
    ...process.env,
    ...parseEnv(await readFile(join(fixture, "fixture.env"), "utf8")),
  };
  environment.NODE_ENV = "development";
  environment.NEXT_TELEMETRY_DISABLED = "1";
  environment.CI = "1";
  environment.AUTH_ALLOWED_ORIGINS = extensionOrigins;
  environment.ENOUGH_PHASE2_INTEGRATION = "1";
  // The generated fixture explicitly blanks all provider credentials; no root env file is loaded.
  assert.equal(new URL(environment.DATABASE_URL).pathname, "/enough_phase2");
  assert.equal(new URL(environment.DATABASE_URL).port, "55433");
  assert.equal(environment.REDIS_URL, "redis://127.0.0.1:56381/0");
  const redis = launch("wsl", [
    "-d",
    "Ubuntu",
    "--exec",
    "redis-server",
    "--bind",
    "127.0.0.1",
    "--port",
    "56382",
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
        execFileSync("wsl", ["-d", "Ubuntu", "--exec", "redis-cli", "-p", "56382", "ping"], {
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
          "s=socket.create_connection(('127.0.0.1',56382))",
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
  redisBridge.listen(56381, "127.0.0.1");
  await once(redisBridge, "listening");
  const expectedInfo = execFileSync(
    "wsl",
    ["-d", "Ubuntu", "--exec", "redis-cli", "-p", "56382", "info", "server"],
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
  // Copy only tracked web sources. Its .next, generated tsconfig and caches stay in .runtime.
  const webRoot = join(fixture, "web");
  const paths = execFileSync("git", ["ls-files", "-z", "apps/web"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  })
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
      "3302",
    ],
    { cwd: webRoot, env: environment },
  );
  await ready("http://127.0.0.1:4402/ready", api);
  await ready("http://127.0.0.1:3302/api/ready", web);
  console.info(
    "Phase 2 isolated API/web ready at 4402/3302; existing 4400/3301 runtime untouched.",
  );
  if (mode === "test") {
    await runNode(["scripts/phase2-auth-tests.mjs"], { env: environment });
  } else {
    await runNode(["--import", "tsx", join(root, "scripts", "phase2-manual-account.mjs")], {
      cwd: join(root, "apps", "api"),
      env: environment,
    });
    if (mode === "prepare") {
      console.info("Manual fixture preparation verified; stopping fixture services.");
    } else {
      console.info(
        "Fixture serving. Ctrl+C stops only this fixture; data stays in ignored .runtime/phase2.",
      );
      await Promise.race([once(api, "exit"), once(web, "exit"), once(redis, "exit")]);
      throw new Error("A fixture service exited.");
    }
  }
} finally {
  await cleanup();
}
