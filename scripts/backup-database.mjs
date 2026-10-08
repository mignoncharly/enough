import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { postgresCliEnvironment } from "./postgres-env.mjs";

process.umask(0o077);
const appRoot = process.env.ENOUGH_APP_ROOT || "/home/enough/apps/enough";
const backupDirectory = path.join(appRoot, "shared", "backups");
const databaseUrl = process.env.DATABASE_URL;
const recipient = process.env.BACKUP_AGE_RECIPIENT;
const remoteDestination = process.env.BACKUP_RCLONE_DEST?.trim();
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);

if (!databaseUrl || !recipient || !remoteDestination) {
  throw new Error(
    "DATABASE_URL, BACKUP_AGE_RECIPIENT, and BACKUP_RCLONE_DEST are required for production backups.",
  );
}
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
  throw new Error("BACKUP_RETENTION_DAYS must be an integer from 1 to 365.");
}

const backupRealPath = path.resolve(backupDirectory);
const expectedPrefix = path.resolve(appRoot, "shared") + path.sep;
if (
  !backupRealPath.startsWith(expectedPrefix) ||
  backupRealPath !== path.resolve(appRoot, "shared", "backups")
) {
  throw new Error("Refusing to write outside the configured shared backup directory.");
}
await mkdir(backupRealPath, { recursive: true, mode: 0o700 });

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

const timestamp = new Date()
  .toISOString()
  .replaceAll("-", "")
  .replaceAll(":", "")
  .replace(/\.\d{3}Z$/, "Z");
const filename = `enough-db-${timestamp}-${randomUUID().slice(0, 8)}.dump.age`;
const finalPath = path.join(backupRealPath, filename);
const partialPath = `${finalPath}.${randomUUID()}.partial`;
const toolEnvironment = { ...process.env };
for (const key of [
  "DATABASE_URL",
  "REDIS_URL",
  "AUTH_SECRET",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRETS",
  "OPENAI_API_KEY",
]) {
  delete toolEnvironment[key];
}
const pgDump = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl"], {
  stdio: ["ignore", "pipe", "inherit"],
  env: postgresCliEnvironment(databaseUrl),
});
const encrypt = spawn("age", ["--recipient", recipient, "--output", partialPath], {
  stdio: ["pipe", "inherit", "inherit"],
  env: toolEnvironment,
});
const pgDone = waitForExit(pgDump, "pg_dump");
const ageDone = waitForExit(encrypt, "age encryption");

try {
  await pipeline(pgDump.stdout, encrypt.stdin);
  await Promise.all([pgDone, ageDone]);
  await rename(partialPath, finalPath);
  const remotePath = `${remoteDestination.replace(/\/+$/, "")}/${filename}`;
  await run("rclone", ["copyto", finalPath, remotePath], { env: toolEnvironment });

  const entries = await readdir(backupRealPath, { withFileTypes: true });
  const backups = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() && /^enough-db-\d{8}T\d{6}Z-[0-9a-f]{8}\.dump\.age$/.test(entry.name),
      )
      .map(async (entry) => ({
        path: path.join(backupRealPath, entry.name),
        modifiedAt: (await stat(path.join(backupRealPath, entry.name))).mtimeMs,
      })),
  );
  backups.sort((a, b) => b.modifiedAt - a.modifiedAt);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60_000;
  for (const [index, backup] of backups.entries()) {
    if (index >= 3 && backup.modifiedAt < cutoff) await rm(backup.path);
  }

  console.info(`Encrypted database backup created and uploaded: ${filename}`);
} catch (error) {
  pgDump.kill();
  encrypt.kill();
  await Promise.allSettled([pgDone, ageDone]);
  await rm(partialPath, { force: true });
  throw error;
}
