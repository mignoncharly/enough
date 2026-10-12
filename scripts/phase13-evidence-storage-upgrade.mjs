import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const databasePackage = path.join(root, "packages", "db");
const apiPackage = path.join(root, "apps", "api");
const migrationScript = path.join(databasePackage, "src", "migrate.ts");
const objectUpgradeScript = path.join(apiPackage, "src", "phase13-migrate-evidence-objects.ts");

function run(args, env, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Evidence storage upgrade step failed${signal ? ` (${signal})` : ` (${code})`}.`,
          ),
        );
    });
  });
}

const baseEnvironment = { ...process.env };
const throughPrepare = {
  ...baseEnvironment,
  ENOUGH_MIGRATION_STOP_AFTER: "0018_evidence_object_storage_prepare.sql",
};
const completed = { ...baseEnvironment };
delete completed.ENOUGH_MIGRATION_STOP_AFTER;

await run(["--import", "tsx", migrationScript], throughPrepare, databasePackage);
await run(["--import", "tsx", objectUpgradeScript], completed, apiPackage);
await run(["--import", "tsx", migrationScript], completed, databasePackage);
console.info("Evidence object migration and BYTEA removal completed.");
