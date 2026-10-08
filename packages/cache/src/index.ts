import { env } from "@enough/config";
import Redis from "ioredis";

let redis: Redis | undefined;

export function getRedis(): Redis {
  redis ??= new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => (attempt <= 2 ? 250 : null),
    enableReadyCheck: true,
  });
  return redis;
}

export async function checkRedis(timeoutMs = 1500): Promise<boolean> {
  const client = getRedis();
  try {
    const ping = client.ping();
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Redis health check timed out")), timeoutMs).unref();
    });
    await Promise.race([ping, timeout]);
    return true;
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (!redis) return;
  const client = redis;
  redis = undefined;
  if (client.status === "wait") return;
  await client.quit();
}

export function bullMqConnectionOptions(): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
  maxRetriesPerRequest: null;
} {
  const url = new URL(env.REDIS_URL);
  const database = url.pathname.replace(/^\//, "");
  return {
    host: url.hostname || "127.0.0.1",
    port: Number(url.port) || (url.protocol === "rediss:" ? 6380 : 6379),
    ...(url.username && { username: decodeURIComponent(url.username) }),
    ...(url.password && { password: decodeURIComponent(url.password) }),
    ...(database && { db: Number(database) }),
    ...(url.protocol === "rediss:" && { tls: {} }),
    maxRetriesPerRequest: null,
  };
}
