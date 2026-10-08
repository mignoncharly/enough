import { env } from "@enough/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export type { PoolClient as DbClient } from "pg";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
  application_name: "enough",
});

export const db = drizzle(pool);

export async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
