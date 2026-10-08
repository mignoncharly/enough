import { createServer } from "node:http";
import { bullMqConnectionOptions, checkRedis, closeRedis } from "@enough/cache";
import { env } from "@enough/config";
import { checkDatabase, closeDatabase } from "@enough/db";
import { MAIN_QUEUE_NAME } from "@enough/queue";
import { healthResponse } from "@enough/shared";
import { Worker } from "bullmq";
import { drainPendingNotificationEmails } from "./notifications.js";
import { pruneExpiredPrivacyData } from "./privacy-retention.js";

let workerReady = false;
let notificationEmailBusy = false;
let privacyRetentionBusy = false;
const notificationEmailTimer = setInterval(() => {
  if (notificationEmailBusy) return;
  notificationEmailBusy = true;
  void drainPendingNotificationEmails()
    .catch((error: unknown) => console.error("Notification email delivery failed:", error))
    .finally(() => {
      notificationEmailBusy = false;
    });
}, 30_000);
const privacyRetentionTimer = setInterval(
  () => {
    if (privacyRetentionBusy) return;
    privacyRetentionBusy = true;
    void pruneExpiredPrivacyData()
      .then((result) => console.info("Privacy retention completed.", result))
      .catch((error: unknown) => console.error("Privacy retention failed:", error))
      .finally(() => {
        privacyRetentionBusy = false;
      });
  },
  6 * 60 * 60 * 1000,
);
setTimeout(() => {
  if (notificationEmailBusy) return;
  notificationEmailBusy = true;
  void drainPendingNotificationEmails()
    .catch((error: unknown) => console.error("Notification email delivery failed:", error))
    .finally(() => {
      notificationEmailBusy = false;
    });
}, 5_000);
setTimeout(() => {
  if (privacyRetentionBusy) return;
  privacyRetentionBusy = true;
  void pruneExpiredPrivacyData()
    .then((result) => console.info("Initial privacy retention completed.", result))
    .catch((error: unknown) => console.error("Initial privacy retention failed:", error))
    .finally(() => {
      privacyRetentionBusy = false;
    });
}, 10_000);
const worker = new Worker(
  MAIN_QUEUE_NAME,
  async (job) => {
    if (job.name === "healthcheck") return { healthy: true };
    throw new Error(`No worker handler is registered for job type: ${job.name}`);
  },
  { connection: bullMqConnectionOptions(), concurrency: 4 },
);

worker.on("ready", () => {
  workerReady = true;
  console.info("Worker connected to Redis and is ready.");
});
worker.on("error", (error) => {
  workerReady = false;
  console.error("Worker connection error:", error);
});
const server = createServer(async (request, response) => {
  if (request.method !== "GET" || (request.url !== "/health" && request.url !== "/ready")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(healthResponse("worker")));
    return;
  }

  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const ready = workerReady && database && redis;
  response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      ...healthResponse("worker", ready ? "ok" : "degraded"),
      dependencies: {
        worker: workerReady ? "ok" : "unavailable",
        database: database ? "ok" : "unavailable",
        redis: redis ? "ok" : "unavailable",
      },
    }),
  );
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(env.WORKER_PORT, "127.0.0.1", resolve);
});
console.info(`Worker health endpoint listening on port ${env.WORKER_PORT}.`);

async function shutdown(signal: string): Promise<void> {
  clearInterval(notificationEmailTimer);
  clearInterval(privacyRetentionTimer);
  console.info(`Shutting down worker after ${signal}.`);
  workerReady = false;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await Promise.all([worker.close(), closeDatabase(), closeRedis()]);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      console.error("Worker shutdown failed:", error);
      process.exitCode = 1;
    });
  });
}
