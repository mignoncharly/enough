import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "@enough/config";
import { Client } from "pg";

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const client = new Client({
  connectionString: env.DATABASE_URL,
  application_name: "enough-migrate",
});

async function migrate(): Promise<void> {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtext('enough:migrations'))");
  await client.query("CREATE SCHEMA IF NOT EXISTS enough");
  await client.query(`
    CREATE TABLE IF NOT EXISTS enough.schema_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  const stopAfter = process.env.ENOUGH_MIGRATION_STOP_AFTER;
  if (stopAfter && !/^\d{4}_[a-z0-9_]+\.sql$/.test(stopAfter)) {
    throw new Error("ENOUGH_MIGRATION_STOP_AFTER must name a migration file.");
  }
  if (stopAfter && !names.includes(stopAfter)) {
    throw new Error("ENOUGH_MIGRATION_STOP_AFTER does not match a migration file.");
  }
  let appliedCount = 0;

  for (const name of names) {
    const sql = await readFile(join(migrationsDirectory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query<{ checksum: string }>(
      "SELECT checksum FROM enough.schema_migrations WHERE id = $1",
      [name],
    );

    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration ${name} has changed; create a new migration instead.`);
      }
      if (name === stopAfter) break;
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO enough.schema_migrations (id, checksum) VALUES ($1, $2)", [
        name,
        checksum,
      ]);
      await client.query("COMMIT");
      appliedCount += 1;
      console.info(`Applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    if (name === stopAfter) break;
  }

  console.info(appliedCount ? `Applied ${appliedCount} migration(s).` : "Database is up to date.");
}

try {
  await migrate();
} catch (error) {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
} finally {
  try {
    await client.query("SELECT pg_advisory_unlock(hashtext('enough:migrations'))");
  } catch {
    // The connection can already be closed when connection or lock acquisition fails.
  }
  await client.end().catch(() => undefined);
}
