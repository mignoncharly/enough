import { spawn } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { postgresCliEnvironment } from "./postgres-env.mjs";

const appRoot = process.env.ENOUGH_APP_ROOT || "/home/enough/apps/enough";
const backupDirectory = path.resolve(appRoot, "shared", "backups");
const connectionString = process.env.RESTORE_ADMIN_DATABASE_URL;
const identityFile = process.env.BACKUP_AGE_IDENTITY_FILE;
if (!connectionString || !identityFile) {
  throw new Error(
    "Set RESTORE_ADMIN_DATABASE_URL and BACKUP_AGE_IDENTITY_FILE for a manual restore test.",
  );
}
await access(identityFile);
const identityMetadata = await stat(identityFile);
if (
  (identityMetadata.mode & 0o777) !== 0o600 ||
  (process.getuid && identityMetadata.uid !== process.getuid())
) {
  throw new Error("The age identity file must be owned by the restore operator and mode 0600.");
}

let backupPath = process.argv[2];
if (!backupPath) {
  const entries = await readdir(backupDirectory, { withFileTypes: true });
  const names = entries
    .filter(
      (entry) =>
        entry.isFile() && /^enough-db-\d{8}T\d{6}Z-[0-9a-f]{8}\.dump\.age$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();
  backupPath = names[0] ? path.join(backupDirectory, names[0]) : undefined;
}
if (!backupPath) throw new Error(`No encrypted database backups found in ${backupDirectory}.`);
backupPath = path.resolve(backupPath);
if (
  path.dirname(backupPath) !== backupDirectory ||
  !/^enough-db-\d{8}T\d{6}Z-[0-9a-f]{8}\.dump\.age$/.test(path.basename(backupPath))
) {
  throw new Error("Restore tests only accept a named backup inside the managed backup directory.");
}
await access(backupPath);

const restoreDatabase = `enough_restore_test_${Date.now()}_${process.pid}`;
if (!/^enough_restore_test_\d+_\d+$/.test(restoreDatabase)) {
  throw new Error("Generated restore database name failed validation.");
}
const baseEnvironment = postgresCliEnvironment(connectionString, "postgres");
let created = false;

function waitForExit(child, command) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`,
          ),
        );
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`,
          ),
        );
    });
  });
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"], ...options });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve(output.trim());
      else
        reject(
          new Error(
            `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`,
          ),
        );
    });
  });
}

try {
  await run("createdb", ["--maintenance-db=postgres", "--template=template0", restoreDatabase], {
    env: baseEnvironment,
  });
  created = true;

  const decrypt = spawn("age", ["--decrypt", "--identity", identityFile, backupPath], {
    stdio: ["ignore", "pipe", "inherit"],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== "RESTORE_ADMIN_DATABASE_URL"),
    ),
  });
  const restore = spawn(
    "pg_restore",
    [`--dbname=${restoreDatabase}`, "--no-owner", "--no-acl", "--exit-on-error"],
    {
      stdio: ["pipe", "inherit", "inherit"],
      env: baseEnvironment,
    },
  );
  const decryptDone = waitForExit(decrypt, "age decryption");
  const restoreDone = waitForExit(restore, "pg_restore");
  await pipeline(decrypt.stdout, restore.stdin);
  await Promise.all([decryptDone, restoreDone]);

  const restoreEnvironment = postgresCliEnvironment(connectionString, restoreDatabase);
  const migrationCount = await capture(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--command=SELECT count(*) FROM enough.schema_migrations",
    ],
    { env: restoreEnvironment },
  );
  if (!/^\d+$/.test(migrationCount) || Number(migrationCount) < 1) {
    throw new Error("Restored database did not contain the migration ledger.");
  }
  console.info(
    `Restore verification passed for ${path.basename(backupPath)} (${migrationCount} migrations).`,
  );
} finally {
  if (created) {
    await run("dropdb", ["--maintenance-db=postgres", restoreDatabase], { env: baseEnvironment });
    console.info(`Removed isolated restore-test database ${restoreDatabase}.`);
  }
}
