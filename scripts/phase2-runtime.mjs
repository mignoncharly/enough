import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
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
const phase6 = process.argv.includes("--phase6");
const phase7 = process.argv.includes("--phase7");
const phase8 = process.argv.includes("--phase8");
const phase9 = process.argv.includes("--phase9");
const phase10 = process.argv.includes("--phase10");
const phase11 = process.argv.includes("--phase11");
const phase12 = process.argv.includes("--phase12");
const phase13 = process.argv.includes("--phase13");
const phase14 = process.argv.includes("--phase14");
const basePhase = phase14
  ? "phase14"
  : phase12
    ? "phase12"
    : phase9
      ? "phase9"
      : phase8
        ? "phase8"
        : phase7
          ? "phase7"
          : phase6
            ? "phase6"
            : phase5
              ? "phase5"
              : phase4
                ? "phase4"
                : phase3
                  ? "phase3"
                  : "phase2";
const phase = phase14
  ? "phase14"
  : phase13
    ? "phase13"
    : phase12
      ? "phase12"
      : phase11
        ? "phase11"
        : phase10
          ? "phase10"
          : basePhase;
const baseFixture =
  phase3 ||
  phase4 ||
  phase5 ||
  phase6 ||
  phase7 ||
  phase8 ||
  phase9 ||
  phase11 ||
  phase12 ||
  phase14
    ? join(tmpdir(), `enough-${basePhase}`)
    : join(root, ".runtime", basePhase);
const fixture = phase14
  ? join(tmpdir(), "enough-phase14")
  : phase13
    ? join(tmpdir(), "enough-phase13")
    : phase12
      ? join(tmpdir(), "enough-phase12")
      : phase11
        ? join(tmpdir(), "enough-phase11")
        : phase10
          ? join(tmpdir(), "enough-phase10")
          : baseFixture;
const basePgPort = phase12
  ? 55943
  : phase11
    ? 55942
    : phase9
      ? 55440
      : phase8
        ? 55439
        : phase7
          ? 55438
          : phase6
            ? 55437
            : phase5
              ? 55436
              : phase4
                ? 55435
                : phase3
                  ? 55434
                  : 55433;
const pgPort = phase14
  ? 55946
  : phase13
    ? 55944
    : phase12
      ? 55943
      : phase11
        ? 55942
        : phase10
          ? 55441
          : basePgPort;
const baseRedisPort = phase12
  ? 56405
  : phase11
    ? 56403
    : phase9
      ? 56397
      : phase8
        ? 56393
        : phase7
          ? 56391
          : phase6
            ? 56389
            : phase5
              ? 56387
              : phase4
                ? 56385
                : phase3
                  ? 56383
                  : 56381;
const redisPort = phase14
  ? 56409
  : phase13
    ? 56407
    : phase12
      ? 56405
      : phase11
        ? 56403
        : phase10
          ? 56401
          : baseRedisPort;
const baseWslRedisPort = phase12
  ? "56406"
  : phase11
    ? "56404"
    : phase9
      ? "56398"
      : phase8
        ? "56396"
        : phase7
          ? "56394"
          : phase6
            ? "56390"
            : phase5
              ? "56388"
              : phase4
                ? "56386"
                : phase3
                  ? "56384"
                  : "56382";
const wslRedisPort = phase14
  ? "56410"
  : phase13
    ? "56408"
    : phase12
      ? "56406"
      : phase11
        ? "56404"
        : phase10
          ? "56402"
          : baseWslRedisPort;
const baseApiPort = phase12
  ? 4422
  : phase11
    ? 4420
    : phase9
      ? 4416
      : phase8
        ? 4414
        : phase7
          ? 4412
          : phase6
            ? 4410
            : phase5
              ? 4408
              : phase4
                ? 4406
                : phase3
                  ? 4404
                  : 4402;
const apiPort = phase14
  ? 4426
  : phase13
    ? 4424
    : phase12
      ? 4422
      : phase11
        ? 4420
        : phase10
          ? 4418
          : baseApiPort;
const baseWebPort = phase12
  ? 3313
  : phase11
    ? 3312
    : phase9
      ? 3309
      : phase8
        ? 3308
        : phase7
          ? 3307
          : phase6
            ? 3306
            : phase5
              ? 3305
              : phase4
                ? 3304
                : phase3
                  ? 3303
                  : 3302;
const webPort = phase14
  ? 3315
  : phase13
    ? 3314
    : phase12
      ? 3313
      : phase11
        ? 3312
        : phase10
          ? 3310
          : baseWebPort;
const phaseFlag = `--${phase}`;
const mode = process.argv[2] ?? "test";
assert.ok(["test", "serve", "prepare"].includes(mode), "Use test, serve or prepare.");
assert.ok(!phase5 || mode === "test", "Phase 5 is an automated ingestion fixture.");
assert.ok(!phase14 || mode === "test", "Phase 14 uses its isolated automated acceptance fixture.");
const extensionOrigins = phase10
  ? (process.argv.find((arg) => /^(?:chrome-extension:\/\/|moz-extension:\/\/)/.test(arg)) ?? "")
  : phase3 ||
      phase4 ||
      phase5 ||
      phase6 ||
      phase7 ||
      phase8 ||
      phase9 ||
      phase11 ||
      phase12 ||
      phase13 ||
      phase14
    ? ""
    : (process.argv[3] ?? "");
const suppliedOrigins = extensionOrigins.split(",").filter(Boolean);
assert.ok(
  suppliedOrigins.every((origin) =>
    /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9-]{36})$/.test(origin),
  ),
  "Supply only exact installed extension origins.",
);
assert.ok(
  !phase10 ||
    mode === "test" ||
    (suppliedOrigins.length === 2 &&
      suppliedOrigins.some((origin) => origin.startsWith("chrome-extension://")) &&
      suppliedOrigins.some((origin) => origin.startsWith("moz-extension://"))),
  "Phase 10 requires one exact Chromium and one exact Firefox extension origin.",
);
const children = [];
let postgresStarted = false;
let redisStarted = false;
let closing = false;
let redisBridge;
let evidenceStorageServer;
const evidenceStoragePort = 55945;

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
  if (redisStarted) {
    try {
      execFileSync("wsl", ["-d", "Ubuntu", "--exec", "redis-cli", "-p", wslRedisPort, "shutdown"], {
        windowsHide: true,
        stdio: "ignore",
      });
      redisStarted = false;
    } catch {}
  }
  if (redisBridge) redisBridge.close();
  if (evidenceStorageServer) {
    await evidenceStorageServer.close().catch(() => undefined);
    evidenceStorageServer = undefined;
  }
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
  for (const port of [
    pgPort,
    redisPort,
    apiPort,
    webPort,
    ...(phase13 ? [evidenceStoragePort] : []),
    ...(phase11 ? [4421] : []),
    ...(phase12 ? [4423] : []),
    ...(phase13 ? [4425] : []),
    ...(phase14 ? [4427] : []),
    ...(phase9 ? [4417] : []),
    ...(phase10 ? [4419] : []),
  ]) {
    await freePort(port);
  }
  // Check Redis's WSL network namespace as well as the Windows listener.
  execFileSync(
    "wsl",
    [
      "-d",
      "Ubuntu",
      "--exec",
      "python3",
      "-c",
      `import socket; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('127.0.0.1',${wslRedisPort})); s.close()`,
    ],
    { windowsHide: true, stdio: "pipe" },
  );
  if (phase11 || phase12 || phase13 || phase14) {
    const markerPath = join(fixture, `${phase}-fixture.json`);
    const existingFixture = await lstat(fixture).catch((error) =>
      error.code === "ENOENT" ? null : Promise.reject(error),
    );
    if (existingFixture) {
      assert.ok(existingFixture.isDirectory() && !existingFixture.isSymbolicLink());
      const marker = JSON.parse(await readFile(markerPath, "utf8"));
      assert.equal(marker.fixture, `enough-${phase}`);
      assert.equal(marker.version, 1);
    } else {
      await mkdir(fixture, { recursive: true });
      await writeFile(
        markerPath,
        `${JSON.stringify({ fixture: `enough-${phase}`, version: 1 })}\n`,
        {
          mode: 0o600,
          flag: "wx",
        },
      );
    }
  }
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
  environment.ENOUGH_PHASE9_MANUAL_ACCOUNT = phase9 ? "1" : "0";
  environment.ENOUGH_PHASE10_MANUAL_ACCOUNT = phase10 ? "1" : "0";
  environment.ENOUGH_PHASE11_MANUAL_ACCOUNT = phase11 ? "1" : "0";
  environment.ENOUGH_PHASE12_MANUAL_ACCOUNT = phase12 ? "1" : "0";
  environment.ENOUGH_PHASE13_MANUAL_ACCOUNT = phase13 ? "1" : "0";
  environment.ENOUGH_PHASE14_MANUAL_ACCOUNT = "0";
  if (phase11) {
    const privatePath = join(fixture, "policy-snapshot-private.pem");
    const publicPath = join(fixture, "policy-snapshot-public.pem");
    const privateExists = Boolean(await lstat(privatePath).catch(() => null));
    const publicExists = Boolean(await lstat(publicPath).catch(() => null));
    assert.equal(privateExists, publicExists, "Preserve the existing Phase 11 signing-key pair.");
    if (privateExists) {
      environment.POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY = await readFile(privatePath, "utf8");
    } else {
      const pair = generateKeyPairSync("ed25519");
      environment.POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY = pair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString();
      await writeFile(privatePath, environment.POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY, {
        mode: 0o600,
        flag: "wx",
      });
      await writeFile(publicPath, pair.publicKey.export({ type: "spki", format: "pem" }), {
        mode: 0o600,
        flag: "wx",
      });
    }
  }
  environment.ENOUGH_PHASE2_INTEGRATION =
    phase9 || phase10 || phase11 || phase12 || phase13 || phase14
      ? "0"
      : phase3 || phase4 || phase5 || phase6 || phase7 || phase8
        ? "0"
        : "1";
  environment.ENOUGH_PHASE3_INTEGRATION =
    phase9 || phase10 || phase11 || phase12 || phase13 || phase14
      ? "0"
      : phase3 || phase4 || phase5 || phase6 || phase7 || phase8
        ? "1"
        : "0";
  environment.ENOUGH_PHASE4_INTEGRATION =
    phase9 || phase10 || phase11 || phase12 || phase13 || phase14
      ? "0"
      : phase4 || phase5 || phase6 || phase7 || phase8
        ? "1"
        : "0";
  environment.ENOUGH_PHASE5_INTEGRATION =
    phase9 || phase10 || phase11 || phase12 || phase13 || phase14
      ? "0"
      : phase5 || phase6 || phase7 || phase8
        ? "1"
        : "0";
  environment.ENOUGH_PHASE6_INTEGRATION = phase6 || phase7 || phase8 ? "1" : "0";
  environment.ENOUGH_PHASE7_INTEGRATION = phase7 || phase8 ? "1" : "0";
  environment.ENOUGH_PHASE8_INTEGRATION = phase8 ? "1" : "0";
  environment.ENOUGH_PHASE12_INTEGRATION = phase12 ? "1" : "0";
  environment.ENOUGH_PHASE13_INTEGRATION = phase13 ? "1" : "0";
  environment.ENOUGH_PHASE14_INTEGRATION = phase14 ? "1" : "0";
  if (phase13) {
    const apiRequire = createRequire(join(root, "apps/api/package.json"));
    const S3rver = apiRequire("s3rver");
    const accountModel = apiRequire("s3rver/lib/models/account");
    const accessKeyId = randomBytes(20).toString("hex").toUpperCase();
    const secretAccessKey = randomBytes(40).toString("base64url");
    const bucket = `phase13-evidence-${randomBytes(6).toString("hex")}`;
    accountModel.DUMMY_ACCOUNT.createKeyPair(accessKeyId, secretAccessKey);
    const objectDirectory = join(fixture, "object-store");
    await mkdir(objectDirectory, { recursive: true });
    evidenceStorageServer = new S3rver({
      address: "127.0.0.1",
      port: evidenceStoragePort,
      directory: objectDirectory,
      configureBuckets: [{ name: bucket }],
      silent: true,
      vhostBuckets: false,
    });
    evidenceStorageServer.middleware.unshift(async (ctx, next) => {
      if (!ctx.get("authorization")) {
        ctx.status = 403;
        ctx.body = "Access denied";
        return;
      }
      await next();
    });
    await evidenceStorageServer.run();
    environment.EVIDENCE_STORAGE_ENDPOINT = `http://127.0.0.1:${evidenceStoragePort}`;
    environment.EVIDENCE_STORAGE_BUCKET = bucket;
    environment.EVIDENCE_STORAGE_REGION = "us-east-1";
    environment.EVIDENCE_STORAGE_ACCESS_KEY_ID = accessKeyId;
    environment.EVIDENCE_STORAGE_SECRET_ACCESS_KEY = secretAccessKey;
  }
  environment.CREDITS_MANUAL_CONTROLS_ENABLED = phase8 ? "true" : "false";
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
  const worker =
    phase9 || phase10 || phase11 || phase12 || phase13 || phase14
      ? launch(process.execPath, ["--import", "tsx", "src/server.ts"], {
          cwd: join(root, "apps", "worker"),
          env: environment,
        })
      : null;
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
  if (worker) await ready(`http://127.0.0.1:${environment.WORKER_PORT}/ready`, worker);
  if (phase9) {
    for (const path of [
      "/",
      "/products",
      "/dashboard",
      "/today",
      "/activity",
      "/growth",
      "/tasks",
      "/notifications",
      "/evidence",
      "/rules",
      "/integrations",
      "/reports",
      "/devices",
      "/billing",
      "/settings",
    ]) {
      const response = await fetch(`http://127.0.0.1:${webPort}${path}`);
      assert.equal(response.status, 200, `Phase 9 route failed: ${path}`);
    }
  }
  if (phase12) {
    const response = await fetch(`http://127.0.0.1:${webPort}/tasks`);
    assert.equal(response.status, 200, "Phase 12 task page failed.");
  }
  if (phase13) {
    for (const path of ["/tasks", "/evidence", "/credits"]) {
      const response = await fetch(`http://127.0.0.1:${webPort}${path}`);
      assert.equal(response.status, 200, `Phase 13 page failed: ${path}`);
    }
  }
  if (phase14) {
    const response = await fetch(`http://127.0.0.1:${webPort}/integrations`);
    assert.equal(response.status, 200, "Phase 14 integrations page failed.");
  }
  console.info(
    phase9 || phase10 || phase11 || phase12 || phase13 || phase14
      ? `Isolated PostgreSQL/Redis/API/worker/web ready at ${pgPort}/${redisPort}/${apiPort}/${environment.WORKER_PORT}/${webPort}${phase9 ? "; all Phase 9 routes returned 200" : phase12 ? "; task page returned 200" : phase13 ? "; tasks, evidence and credits pages returned 200" : phase14 ? "; integrations page returned 200" : ""}.`
      : `Isolated API/web ready at ${apiPort}/${webPort}; other runtimes untouched.`,
  );
  if ((phase9 || phase10 || phase11 || phase12 || phase13 || phase14) && mode === "test") {
    console.info(
      `Phase ${phase14 ? "14" : phase13 ? "13" : phase12 ? "12" : phase11 ? "11" : phase10 ? "10" : "9"} isolated migration and full-stack readiness smoke checks passed.`,
    );
    if (phase14) {
      await runNode(
        [
          join(root, "node_modules", "vitest", "vitest.mjs"),
          "run",
          "apps/api/src/integration-adapters.test.ts",
          "apps/api/src/integrations.integration.test.ts",
          "--hookTimeout=60000",
          "--testTimeout=60000",
          "--maxWorkers=1",
        ],
        { env: environment },
      );
    }
    if (phase13) {
      const fixtureCredentials = JSON.parse(
        await readFile(join(fixture, "credentials.json"), "utf8"),
      );
      const integrationEnvironment = {
        ...environment,
        PHASE13_RESTORE_ADMIN_DATABASE_URL: `postgresql://enough_phase13_admin:${fixtureCredentials.admin}@127.0.0.1:${pgPort}/postgres`,
      };
      await runNode(
        [
          join(root, "node_modules", "vitest", "vitest.mjs"),
          "run",
          "apps/api/src/evidence-storage-migration.integration.test.ts",
          "apps/api/src/evidence.integration.test.ts",
          "--hookTimeout=60000",
          "--testTimeout=60000",
          "--maxWorkers=1",
        ],
        { env: integrationEnvironment },
      );
    }
    if (phase12) {
      await runNode(
        [
          join(root, "node_modules", "vitest", "vitest.mjs"),
          "run",
          "apps/api/src/tasks.integration.test.ts",
          "--hookTimeout=60000",
          "--testTimeout=60000",
          "--maxWorkers=1",
        ],
        { env: environment },
      );
    }
  } else if (mode === "test") {
    if (phase8) {
      await runNode([join(root, "scripts", "phase8-migration-check.mjs")], { env: environment });
    }
    await runNode(
      phase8
        ? [
            join(root, "node_modules", "vitest", "vitest.mjs"),
            "run",
            "apps/api/src/credits.integration.test.ts",
            "--hookTimeout=60000",
            "--testTimeout=60000",
            "--maxWorkers=1",
          ]
        : phase7
          ? [
              join(root, "node_modules", "vitest", "vitest.mjs"),
              "run",
              "apps/api/src/rules.integration.test.ts",
              "--hookTimeout=60000",
              "--testTimeout=60000",
              "--maxWorkers=1",
            ]
          : phase3 || phase4 || phase5 || phase6
            ? [
                join(root, "node_modules", "vitest", "vitest.mjs"),
                "run",
                "apps/api/src/onboarding.integration.test.ts",
                ...(phase4 || phase5 || phase6
                  ? ["apps/api/src/products.integration.test.ts"]
                  : []),
                ...(phase5 || phase6 ? ["apps/api/src/activity.integration.test.ts"] : []),
                ...(phase6 || phase7 ? ["apps/api/src/classification.integration.test.ts"] : []),
                ...(phase7 ? ["apps/api/src/rules.integration.test.ts"] : []),
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
          phase13
            ? "phase13-manual-account.mjs"
            : phase12
              ? "phase12-manual-account.mjs"
              : phase11
                ? "phase11-manual-account.mjs"
                : phase10
                  ? "phase10-manual-account.mjs"
                  : phase9
                    ? "phase3-manual-account.mjs"
                    : phase8
                      ? "phase8-manual-account.mjs"
                      : phase7
                        ? "phase7-manual-account.mjs"
                        : phase6
                          ? "phase6-manual-account.mjs"
                          : phase3 || phase4
                            ? "phase3-manual-account.mjs"
                            : "phase2-manual-account.mjs",
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
        phase3 ||
          phase4 ||
          phase6 ||
          phase7 ||
          phase8 ||
          phase9 ||
          phase10 ||
          phase11 ||
          phase12 ||
          phase13
          ? `Fixture serving. Ctrl+C stops this fixture; data stays in TEMP/enough-${phase}.`
          : "Fixture serving. Ctrl+C stops only this fixture; data stays in ignored .runtime/phase2.",
      );
      await Promise.race([
        once(api, "exit"),
        once(web, "exit"),
        ...(worker ? [once(worker, "exit")] : []),
        once(redis, "exit"),
      ]);
      throw new Error("A fixture service exited.");
    }
  }
} finally {
  await cleanup();
}
