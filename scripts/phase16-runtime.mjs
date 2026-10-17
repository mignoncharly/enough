import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertPhase16MigrationLedger,
  assertPhase16Ownership,
  phase16Fixture as fixture,
  phase16Environment,
  phase16MigrationFiles,
} from "./phase16-fixture-plan.mjs";
import { isolatedEnvironment } from "./subprocess-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = fixture.directory;
const markerPath = path.join(directory, fixture.markerFile);
const lockPath = path.join(directory, "runtime-lock.json");
const stopPath = path.join(directory, "stop-request.json");
const data = path.join(directory, "pgdata");
const command = process.argv[2] === "start" ? "serve" : (process.argv[2] ?? "test");
assert.ok(
  process.argv
    .slice(3)
    .every((arg) => ["--confirm-phase16", "--verify-seed", "--reseed"].includes(arg)),
  "Phase 16 unsupported arguments; no alternate roots allowed",
);
assert.ok(
  ["test", "serve", "stop", "clean", "status"].includes(command),
  "Use test, serve, stop, status or clean --confirm-phase16",
);
const safeEnv = isolatedEnvironment(process.env);
const children = new Set();
const streams = [];
let bridge;
let pgStarted = false;
let redisStarted = false;
let redisRunId;
let environment;
let lock;
let stopping;

function native(name, args, extra = {}) {
  try {
    return execFileSync(name, args, {
      cwd: root,
      env: safeEnv,
      windowsHide: true,
      encoding: "utf8",
      stdio: "pipe",
      ...extra,
    });
  } catch {
    throw new Error(`Phase 16 ${name} command failed; raw diagnostics withheld`);
  }
}
function live(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function metadata() {
  const info = await lstat(directory);
  const markerInfo = await lstat(markerPath);
  assert.ok(markerInfo.isFile() && !markerInfo.isSymbolicLink(), "Unsafe ownership marker");
  assertPhase16Ownership({
    resolvedDirectory: await realpath(directory),
    symbolicLink: info.isSymbolicLink(),
    marker: JSON.parse(await readFile(markerPath, "utf8")),
    activePorts: [],
  });
  for (const name of [
    "credentials.json",
    "runtime-lock.json",
    "stop-request.json",
    "pgdata",
    "seed.json",
    "runtime.env.json",
    "pg-password.txt",
    "web",
  ]) {
    const entry = await lstat(path.join(directory, name)).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    assert.ok(!entry?.isSymbolicLink(), "Unsafe linked fixture state");
  }
}
// Logs, state, pgdata and web sources must never redirect writes outside the
// owned root. Only exact dependency junctions used by the isolated web copy are allowed.
async function validateTree(current = directory) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    const info = await lstat(target);
    if (info.isSymbolicLink()) {
      const relative = path.relative(path.join(directory, "web/node_modules"), target);
      assert.ok(
        !relative.startsWith("..") && !path.isAbsolute(relative),
        "Unexpected fixture link",
      );
      const allowed = path.join(root, "apps/web/node_modules", relative);
      assert.equal(await realpath(target), await realpath(allowed), "Wrong dependency link");
    } else if (info.isDirectory()) await validateTree(target);
  }
}
async function freePort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error(`Phase 16 port ${port} is occupied`)));
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
async function stoppedPorts() {
  for (const port of Object.values(fixture.ports)) await freePort(port);
  native("wsl", [
    "-d",
    "Ubuntu",
    "--exec",
    "python3",
    "-c",
    `import socket
for port in ${JSON.stringify(Object.values(fixture.ports))}:
 s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('127.0.0.1',port)); s.close()`,
  ]);
}
function launch(name, args, label, options = {}) {
  const output = label
    ? createWriteStream(path.join(directory, `${label}.log`), { flags: "w", mode: 0o600 })
    : null;
  if (output) streams.push(output);
  const child = spawn(name, args, {
    cwd: root,
    env: environment ?? safeEnv,
    windowsHide: true,
    stdio: output ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "ignore"],
    ...options,
  });
  if (output) {
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
  }
  child.on("error", () => {});
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
async function run(args, label, cwd = root) {
  const child = launch(process.execPath, args, label, { cwd });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, `Phase 16 ${label} failed; inspect only the owned fixture log safely`);
}
async function ready(url, child) {
  for (let i = 0; i < 120; i++) {
    assert.equal(child.exitCode, null, "Fixture child exited before readiness");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error("Phase 16 readiness timeout");
}
async function cleanup() {
  if (stopping) return stopping;
  stopping = (async () => {
    // Only child handles created by this invocation are terminated; never kill by port/PID lookup.
    for (const child of children) {
      if (child.exitCode !== null) continue;
      if (process.platform === "win32" && child.pid) {
        // Next dev owns a child server. Stop only the tree of this retained child handle.
        try {
          native("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
        } catch {
          child.kill();
        }
      } else child.kill();
    }
    if (bridge) await new Promise((resolve) => bridge.close(resolve));
    for (const child of [...children])
      if (child.exitCode === null) await Promise.race([once(child, "exit"), delay(5000)]);
    if (redisStarted) {
      const info = native("wsl", [
        "-d",
        "Ubuntu",
        "--exec",
        "redis-cli",
        "-p",
        String(fixture.ports.wslRedis),
        "info",
        "server",
      ]);
      assert.equal(
        info.match(/run_id:([^\r\n]+)/)?.[1],
        redisRunId,
        "Redis process identity changed; refusing stop",
      );
      native("wsl", [
        "-d",
        "Ubuntu",
        "--exec",
        "redis-cli",
        "-p",
        String(fixture.ports.wslRedis),
        "shutdown",
        "nosave",
      ]);
    }
    if (pgStarted) native("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
    for (const stream of streams) await new Promise((resolve) => stream.end(resolve));
    if (lock) {
      await metadata();
      await validateTree();
      const archive = path.join(directory, "runs", lock.nonce);
      await mkdir(archive, { recursive: true });
      for (const entry of await readdir(directory)) {
        if (entry.endsWith(".log"))
          await copyFile(path.join(directory, entry), path.join(archive, entry));
      }
      assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), lock);
      await unlink(lockPath);
      await rm(stopPath, { force: true });
    }
  })();
  return stopping;
}

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void cleanup().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });

try {
  const exists = await lstat(directory).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!exists) {
    assert.ok(command === "test" || command === "serve", "Phase 16 fixture does not exist");
    await mkdir(directory);
    await writeFile(
      markerPath,
      JSON.stringify({ fixture: fixture.owner, version: fixture.markerVersion }),
      { flag: "wx", mode: 0o600 },
    );
  }
  await metadata();
  await validateTree();
  const existingLock = await readFile(lockPath, "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (command === "status") {
    console.info(
      `Phase 16 owned fixture: supervisorActive=${Boolean(existingLock && live(existingLock.pid))}`,
    );
  } else if (command === "stop") {
    assert.ok(
      existingLock && live(existingLock.pid),
      "No active owned supervisor; refusing arbitrary process cleanup",
    );
    await writeFile(stopPath, JSON.stringify({ nonce: existingLock.nonce }), { mode: 0o600 });
    for (let i = 0; i < 60 && (await lstat(lockPath).catch(() => null)); i++) await delay(500);
    assert.equal(
      await lstat(lockPath).catch(() => null),
      null,
      "Owned supervisor has not finished stopping",
    );
    console.info("Phase 16 owned services stopped; state retained.");
  } else {
    assert.ok(!existingLock || !live(existingLock.pid), "Phase 16 supervisor is already active");
    await stoppedPorts();
    if (command === "clean") {
      assert.ok(process.argv.includes("--confirm-phase16"), "Explicit --confirm-phase16 required");
      await metadata();
      await validateTree();
      assert.equal(path.resolve(directory), path.resolve(fixture.directory));
      // Exact root and realpath/marker were checked above; do not follow links into other fixtures.
      await rm(directory, { recursive: true });
      console.info("Removed only the stopped, owned Phase 16 fixture.");
    } else {
      const { Client } = createRequire(path.join(root, "packages/db/package.json"))("pg");
      const Redis = createRequire(path.join(root, "packages/cache/package.json"))("ioredis");
      if (existingLock) await unlink(lockPath);
      lock = { fixture: fixture.owner, pid: process.pid, nonce: randomBytes(24).toString("hex") };
      await writeFile(lockPath, JSON.stringify(lock), { flag: "wx", mode: 0o600 });
      await rm(stopPath, { force: true });
      const credentialsPath = path.join(directory, "credentials.json");
      let credentials = await readFile(credentialsPath, "utf8")
        .then(JSON.parse)
        .catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      const fresh = !(await lstat(path.join(data, "PG_VERSION")).catch(() => null));
      if (!credentials) {
        assert.ok(fresh, "Existing cluster credentials missing; preserve state");
        credentials = Object.fromEntries(
          ["admin", "app", "auth"].map((key) => [key, randomBytes(32).toString("hex")]),
        );
        await writeFile(credentialsPath, JSON.stringify(credentials), { flag: "wx", mode: 0o600 });
      }
      assert.ok(
        [credentials.admin, credentials.app, credentials.auth].every(
          (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
        ),
        "Invalid fixture credentials",
      );
      const adminRole = `${fixture.role}_admin`;
      const passwordFile = path.join(directory, "pg-password.txt");
      await writeFile(passwordFile, credentials.admin, { mode: 0o600 });
      if (fresh)
        native("initdb", [
          "-D",
          data,
          "-U",
          adminRole,
          "--auth=scram-sha-256",
          "--encoding=UTF8",
          `--pwfile=${passwordFile}`,
        ]);
      await unlink(passwordFile);
      native(
        "pg_ctl",
        [
          "-D",
          data,
          "-o",
          `-h 127.0.0.1 -p ${fixture.ports.postgres} -c log_min_error_statement=panic -c log_error_verbosity=terse -c log_parameter_max_length_on_error=0`,
          "-l",
          path.join(directory, "postgres.log"),
          "-w",
          "start",
        ],
        { stdio: "ignore" },
      );
      pgStarted = true;
      const pgEnv = {
        ...safeEnv,
        PGHOST: "127.0.0.1",
        PGPORT: String(fixture.ports.postgres),
        PGUSER: adminRole,
        PGPASSWORD: credentials.admin,
        PGDATABASE: "postgres",
      };
      assert.equal(
        path.resolve(
          native("psql", ["-X", "-At", "-c", "SHOW data_directory"], { env: pgEnv }).trim(),
        ),
        path.resolve(data),
      );
      const provision = `SELECT 'CREATE ROLE ${fixture.role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ''${credentials.app}''' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${fixture.role}')\n\\gexec\nSELECT 'CREATE DATABASE ${fixture.database} OWNER ${fixture.role}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='${fixture.database}')\n\\gexec\n`;
      native("psql", ["-X", "-v", "ON_ERROR_STOP=1"], { env: pgEnv, input: provision });
      native(
        "psql",
        [
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `ALTER ROLE ${fixture.role} SET timezone TO 'America/Los_Angeles'; ALTER ROLE ${fixture.role} SET statement_timeout TO '15s';`,
        ],
        { env: pgEnv },
      );
      environment = phase16Environment(process.env, credentials);
      assert.equal(environment.OPENAI_API_KEY, "");
      await writeFile(path.join(directory, "runtime.env.json"), JSON.stringify(environment), {
        mode: 0o600,
      });
      await writeFile(path.join(directory, "egress-blocked.log"), "", { mode: 0o600 });
      native("wsl", [
        "-d",
        "Ubuntu",
        "--exec",
        "redis-server",
        "--bind",
        "127.0.0.1",
        "--port",
        String(fixture.ports.wslRedis),
        "--save",
        "",
        "--appendonly",
        "no",
        "--daemonize",
        "yes",
        "--logfile",
        "/dev/null",
      ]);
      redisStarted = true;
      redisRunId = native("wsl", [
        "-d",
        "Ubuntu",
        "--exec",
        "redis-cli",
        "-p",
        String(fixture.ports.wslRedis),
        "info",
        "server",
      ]).match(/run_id:([^\r\n]+)/)?.[1];
      assert.ok(redisRunId, "Missing owned Redis identity");
      bridge = createServer((socket) => {
        const relay = launch(
          "wsl",
          [
            "-d",
            "Ubuntu",
            "--exec",
            "python3",
            "-u",
            "-c",
            `import socket,sys,threading\ns=socket.create_connection(('127.0.0.1',${fixture.ports.wslRedis}))\ndef send():\n try:\n  while data:=sys.stdin.buffer.read1(65536): s.sendall(data)\n finally: s.shutdown(socket.SHUT_WR)\nthreading.Thread(target=send,daemon=True).start()\nwhile data:=s.recv(65536):\n sys.stdout.buffer.write(data); sys.stdout.buffer.flush()`,
          ],
          null,
        );
        socket.pipe(relay.stdin);
        relay.stdout.pipe(socket);
        relay.stdin.on("error", () => socket.destroy());
        socket.on("error", () => {});
        socket.on("close", () => relay.kill());
        relay.on("exit", () => socket.destroy());
      });
      bridge.listen(fixture.ports.redis, "127.0.0.1");
      await once(bridge, "listening");
      const redis = new Redis(environment.REDIS_URL, { lazyConnect: true, retryStrategy: null });
      redis.on("error", () => {});
      try {
        await redis.connect();
        assert.equal((await redis.info("server")).match(/run_id:([^\r\n]+)/)?.[1], redisRunId);
      } finally {
        redis.disconnect();
      }
      const files = await phase16MigrationFiles();
      const dbCwd = path.join(root, "packages/db");
      await run(["--import", "tsx", "src/migration-precheck.ts"], "precheck-before", dbCwd);
      await run(["--import", "tsx", "src/migrate.ts"], "migrate", dbCwd);
      await run(["--import", "tsx", "src/migration-precheck.ts"], "precheck-after", dbCwd);
      const db = new Client({ connectionString: environment.DATABASE_URL });
      await db.connect();
      try {
        const before = (
          await db.query(
            "SELECT id, checksum, applied_at FROM enough.schema_migrations ORDER BY id",
          )
        ).rows;
        await assertPhase16MigrationLedger(before.map((row) => row.id));
        const ordered = (
          await db.query("SELECT id FROM enough.schema_migrations ORDER BY applied_at,id")
        ).rows.map((row) => row.id);
        assert.deepEqual(ordered, files, "Wrong recorded migration order");
        for (const row of before)
          assert.equal(
            row.checksum,
            createHash("sha256")
              .update(await readFile(path.join(root, "packages/db/migrations", row.id)))
              .digest("hex"),
          );
        await run(["--import", "tsx", "src/migrate.ts"], "migrate-idempotent", dbCwd);
        assert.deepEqual(
          (
            await db.query(
              "SELECT id, checksum, applied_at FROM enough.schema_migrations ORDER BY id",
            )
          ).rows,
          before,
        );
        assert.ok(
          (await readFile(path.join(directory, "precheck-after.log"), "utf8")).includes(
            "No pending migrations.",
          ),
        );
        await writeFile(
          path.join(directory, "migration-evidence.json"),
          JSON.stringify({
            fresh,
            count: files.length,
            checksumMatch: true,
            orderMatch: true,
            recordedOnce: before.length === files.length,
            noPending: true,
            idempotent: true,
          }),
          { mode: 0o600 },
        );
        if (fresh)
          await copyFile(
            path.join(directory, "migration-evidence.json"),
            path.join(directory, "fresh-migration-evidence.json"),
          );
      } finally {
        await db.end();
      }
      console.info(
        `Phase 16 migrations: fresh=${fresh}, count=20, checksums/precheck/idempotency=PASS.`,
      );
      const webRoot = path.join(directory, "web");
      const paths = native("git", [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "apps/web",
      ])
        .split("\0")
        .filter(Boolean);
      for (const name of paths) {
        if (/^\.env(?:\.|$)/.test(path.basename(name))) continue;
        const target = path.join(webRoot, name.slice("apps/web/".length));
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(root, name), target);
      }
      const config = JSON.parse(await readFile(path.join(webRoot, "tsconfig.json"), "utf8"));
      config.extends = path.join(root, "tsconfig.base.json").replaceAll("\\", "/");
      await writeFile(path.join(webRoot, "tsconfig.json"), JSON.stringify(config));
      const webPackage = JSON.parse(await readFile(path.join(webRoot, "package.json"), "utf8"));
      for (const name of Object.keys({
        ...webPackage.dependencies,
        ...webPackage.devDependencies,
      })) {
        const target = path.join(webRoot, "node_modules", name);
        await mkdir(path.dirname(target), { recursive: true });
        if (!(await lstat(target).catch(() => null)))
          await symlink(
            await realpath(path.join(root, "apps/web/node_modules", name)),
            target,
            "junction",
          );
      }
      const api = launch(
        process.execPath,
        [
          "--import",
          pathToFileURL(path.join(root, "scripts/phase16-egress-guard.mjs")).href,
          "--import",
          "tsx",
          path.join(root, "scripts/phase16-api.mjs"),
        ],
        "api",
        {
          cwd: path.join(root, "apps/api"),
          env: { ...environment, ENOUGH_PHASE16_API_CLOCK: "1" },
        },
      );
      const web = launch(
        process.execPath,
        [
          path.join(root, "apps/web/node_modules/next/dist/bin/next"),
          "dev",
          "--webpack",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(fixture.ports.web),
        ],
        "web",
        {
          cwd: webRoot,
          env: {
            ...environment,
            NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, "scripts/phase16-egress-guard.mjs")).href}`,
          },
        },
      );
      await ready(`${environment.API_BASE_URL}/ready`, api);
      await ready(`${environment.APP_BASE_URL}/api/ready`, web);
      assert.equal((await fetch(`${environment.APP_BASE_URL}/reports`)).status, 200);
      if (
        process.argv.includes("--reseed") ||
        !(await lstat(path.join(directory, "seed.json")).catch(() => null))
      )
        await run(
          ["--import", "tsx", path.join(root, "scripts/phase16-seed.mjs")],
          "seed",
          path.join(root, "apps/api"),
        );
      if (process.argv.includes("--verify-seed")) {
        const prior = JSON.parse(await readFile(path.join(directory, "seed-proof.json"), "utf8"));
        await run(
          ["--import", "tsx", path.join(root, "scripts/phase16-seed.mjs")],
          "seed-reproduced",
          path.join(root, "apps/api"),
        );
        assert.deepEqual(
          JSON.parse(await readFile(path.join(directory, "seed-proof.json"), "utf8")),
          prior,
        );
        await writeFile(
          path.join(directory, "seed-reproduction.json"),
          JSON.stringify({ deterministic: true }),
          { mode: 0o600 },
        );
      }
      console.info(
        "Phase 16 API/web ready; providers disabled; synthetic reports seed ready; worker not needed.",
      );
      if (command === "test") {
        await run(
          [
            "node_modules/vitest/vitest.mjs",
            "run",
            "apps/api/src/reports.runtime.test.ts",
            "--maxWorkers=1",
            "--testTimeout=60000",
            "--hookTimeout=60000",
          ],
          "acceptance",
        );
        assert.equal(
          (await readFile(path.join(directory, "egress-blocked.log"), "utf8")).trim(),
          "",
          "Unexpected external API fetch attempt",
        );
        console.info("Phase 16 live acceptance PASS; outbound API fetch attempts=0.");
      } else {
        console.info(
          `Phase 16 serving at ${environment.APP_BASE_URL}; stop with node scripts/phase16-runtime.mjs stop.`,
        );
        while (true) {
          const stop = await readFile(stopPath, "utf8")
            .then(JSON.parse)
            .catch((error) => {
              if (error.code === "ENOENT") return null;
              throw error;
            });
          if (stop?.nonce === lock.nonce) break;
          assert.equal(api.exitCode, null, "Phase 16 API exited");
          assert.equal(web.exitCode, null, "Phase 16 web exited");
          await delay(500);
        }
      }
      await cleanup();
      await stoppedPorts();
      console.info("Phase 16 services stopped; owned fixture state retained.");
    }
  }
} catch (error) {
  // No command arguments, environment, provider/DB responses or child stderr.
  console.error(
    error instanceof assert.AssertionError
      ? "Phase 16 safety/acceptance assertion failed; state preserved."
      : error instanceof Error && error.message.startsWith("Phase 16")
        ? error.message
        : "Phase 16 fixture operation failed; raw details withheld.",
  );
  process.exitCode = 1;
} finally {
  if (lock)
    await cleanup().catch(() => {
      console.error("Phase 16 stop incomplete; preserve state for ownership inspection.");
      process.exitCode = 1;
    });
}
