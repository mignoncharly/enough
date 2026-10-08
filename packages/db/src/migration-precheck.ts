import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "@enough/config";
import { Client } from "pg";

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const client = new Client({
  connectionString: env.DATABASE_URL,
  application_name: "enough-migration-precheck",
});
let locked = false;

async function precheck(): Promise<void> {
  await client.connect();
  const lock = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext('enough:migrations')) AS locked",
  );
  locked = Boolean(lock.rows[0]?.locked);
  if (!locked) throw new Error("Another migration process is running; retry after it finishes.");

  const serverVersion = await client.query<{ version: number }>(
    "SELECT current_setting('server_version_num')::integer AS version",
  );
  if ((serverVersion.rows[0]?.version ?? 0) < 140000) {
    throw new Error("PostgreSQL 14 or newer is required.");
  }

  const ledger = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('enough.schema_migrations') IS NOT NULL AS exists",
  );
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  if (names.length === 0) throw new Error("No SQL migrations were found.");

  const known = new Set(names);
  const applied = ledger.rows[0]?.exists
    ? await client.query<{ id: string; checksum: string }>(
        "SELECT id, checksum FROM enough.schema_migrations ORDER BY id",
      )
    : { rows: [] as Array<{ id: string; checksum: string }> };

  for (const item of applied.rows) {
    if (!known.has(item.id)) throw new Error(`The database contains unknown migration ${item.id}.`);
    const sql = await readFile(join(migrationsDirectory, item.id), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    if (checksum !== item.checksum) {
      throw new Error(
        `Applied migration ${item.id} differs from its recorded checksum; add a new migration instead.`,
      );
    }
  }

  const appliedIds = new Set(applied.rows.map((item) => item.id));
  const pending = names.filter((name) => !appliedIds.has(name));
  console.info(
    `Migration precheck passed on PostgreSQL ${Math.floor((serverVersion.rows[0]?.version ?? 0) / 10000)}.`,
  );
  console.info(
    pending.length ? `Pending migrations: ${pending.join(", ")}` : "No pending migrations.",
  );
}

try {
  await precheck();
} catch (error) {
  console.error("Migration precheck failed:", error);
  process.exitCode = 1;
} finally {
  if (locked)
    await client
      .query("SELECT pg_advisory_unlock(hashtext('enough:migrations'))")
      .catch(() => undefined);
  await client.end().catch(() => undefined);
}
