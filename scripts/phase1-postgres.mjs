import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Dedicated local fixture. Never reads .env or targets the application's existing database.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const phase2 = process.argv.includes("--phase2");
const phase = phase2 ? "phase2" : "phase1";
const fixture = join(root, ".runtime", phase);
const data = join(fixture, "pgdata");
const port = phase2 ? "55433" : "55432";
const admin = `enough_${phase}_admin`;
const database = `enough_${phase}`;
const redisPort = phase2 ? "56381" : "56379";
const webPort = phase2 ? "3302" : "3301";
const apiPort = phase2 ? "4402" : "4400";
const credentialPath = join(fixture, "credentials.json");
const action = process.argv[2] ?? "start";
if (!["start", "stop", "status"].includes(action)) throw new Error("Use start, stop or status.");

function native(command, args, options = {}) {
  try {
    return execFileSync(command, args, { windowsHide: true, stdio: "pipe", ...options });
  } catch (error) {
    // SQL diagnostics can echo password literals from role provisioning.
    if (command === "psql")
      throw new Error(
        `psql failed (exit ${error.status ?? "unknown"}); SQL output withheld to protect fixture credentials.`,
      );
    throw error;
  }
}

if (action !== "start") {
  native("pg_ctl", ["-D", data, ...(action === "stop" ? ["-m", "fast", "-w"] : []), action], {
    stdio: "inherit",
  });
} else {
  mkdirSync(fixture, { recursive: true });
  if (existsSync(join(data, "PG_VERSION")) && !existsSync(credentialPath)) {
    throw new Error(
      "Fixture credentials are missing. Preserve the existing cluster for inspection.",
    );
  }
  if (!existsSync(credentialPath)) {
    writeFileSync(
      credentialPath,
      JSON.stringify({
        admin: randomBytes(32).toString("hex"),
        app: randomBytes(32).toString("hex"),
        auth: randomBytes(32).toString("hex"),
      }),
      { mode: 0o600, flag: "wx" },
    );
  }
  const credentials = JSON.parse(readFileSync(credentialPath, "utf8"));
  if (
    ![credentials.admin, credentials.app, credentials.auth].every(
      (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    )
  ) {
    throw new Error("Fixture credentials are invalid; preserve them for inspection.");
  }
  const passwordFile = join(fixture, "admin-password.txt");
  writeFileSync(passwordFile, credentials.admin, { mode: 0o600 });
  if (!existsSync(join(data, "PG_VERSION"))) {
    native("initdb", [
      "-D",
      data,
      "-U",
      admin,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      `--pwfile=${passwordFile}`,
    ]);
  }
  const status = spawnSync("pg_ctl", ["-D", data, "status"], { windowsHide: true, stdio: "pipe" });
  if (status.status !== 0) {
    // A Windows server can inherit captured pipe handles and keep execFileSync waiting.
    // PostgreSQL diagnostics go to postgres.log instead of the parent's pipes.
    native(
      "pg_ctl",
      [
        "-D",
        data,
        "-o",
        `-h 127.0.0.1 -p ${port}`,
        "-l",
        join(fixture, "postgres.log"),
        "-w",
        "start",
      ],
      { stdio: "ignore" },
    );
  }
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) if (name.startsWith("PG")) delete environment[name];
  Object.assign(environment, {
    PGHOST: "127.0.0.1",
    PGPORT: port,
    PGUSER: admin,
    PGPASSWORD: credentials.admin,
    PGDATABASE: "postgres",
  });
  // Refuse to provision if the listener belongs to another PostgreSQL cluster.
  const actual = native("psql", ["-X", "-At", "-c", "SHOW data_directory"], { env: environment })
    .toString()
    .trim();
  if (actual.replaceAll("\\", "/").toLowerCase() !== data.replaceAll("\\", "/").toLowerCase()) {
    throw new Error("Port belongs to another database cluster. No provisioning performed.");
  }
  const sql = `SELECT 'CREATE ROLE ${database} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ''${credentials.app}''' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${database}')\n\\gexec\nSELECT 'CREATE DATABASE ${database} OWNER ${database}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${database}')\n\\gexec\n`;
  native("psql", ["-X", "-v", "ON_ERROR_STOP=1"], { env: environment, input: sql });
  writeFileSync(
    join(fixture, "fixture.env"),
    [
      "NODE_ENV=test",
      `DATABASE_URL=postgresql://${database}:${credentials.app}@127.0.0.1:${port}/${database}`,
      `REDIS_URL=redis://127.0.0.1:${redisPort}/0`,
      `WEB_PORT=${webPort}`,
      `API_PORT=${apiPort}`,
      `WORKER_PORT=${phase2 ? "4403" : "4401"}`,
      `APP_BASE_URL=http://127.0.0.1:${webPort}`,
      `API_BASE_URL=http://127.0.0.1:${apiPort}`,
      `AUTH_SECRET=${credentials.auth}`,
      "AUTH_DEV_SHOW_EMAIL_LINKS=false",
      ...[
        "RESEND_API_KEY",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
        "OPENAI_API_KEY",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRETS",
        "STRIPE_PRICE_MONTHLY",
        "STRIPE_PRICE_ANNUAL",
      ].map((name) => `${name}=`),
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.info(
    `Isolated PostgreSQL ready on 127.0.0.1:${port}; database ${database}. Credentials remain in ignored .runtime/${phase}.`,
  );
  console.info(
    `Redis must be provisioned separately using a supported version on port ${redisPort}. No migrations have been run.`,
  );
}
