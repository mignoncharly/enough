import { registerAuthRoutes, registerOAuthRoutes } from "@enough/auth";
import { checkRedis, closeRedis } from "@enough/cache";
import { env } from "@enough/config";
import { checkDatabase, closeDatabase } from "@enough/db";
import { healthResponse } from "@enough/shared";
import Fastify from "fastify";
import { registerActivityRoutes } from "./activity.js";
import { registerAdminRoutes } from "./admin.js";
import { registerAiRoutes } from "./ai.js";
import { registerBillingRoutes } from "./billing.js";
import { registerClassificationRoutes } from "./classification.js";
import { registerCreditRoutes } from "./credits.js";
import { registerEvidenceRoutes } from "./evidence.js";
import { registerIntegrationRoutes } from "./integrations.js";
import { registerNotificationRoutes } from "./notifications.js";
import { registerOnboardingRoutes } from "./onboarding.js";
import { registerPrivacyRoutes } from "./privacy.js";
import { registerProductRoutes } from "./products.js";
import { registerReportRoutes } from "./reports.js";
import { registerRuleRoutes } from "./rules.js";
import { registerTaskRoutes } from "./tasks.js";

const app = Fastify({
  trustProxy: ["127.0.0.1", "::1"],
  logger: {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        "req.url",
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-enough-signature",
        "req.headers.stripe-signature",
      ],
      censor: "[REDACTED]",
    },
  },
  bodyLimit: 16 * 1024,
});

app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
  (request as typeof request & { rawJsonBody?: Buffer }).rawJsonBody = Buffer.isBuffer(body)
    ? body
    : Buffer.from(body, "utf8");
  try {
    done(null, JSON.parse(body.toString("utf8")) as unknown);
  } catch {
    done(new Error("Invalid JSON request body."), undefined);
  }
});

app.addContentTypeParser(
  "application/vnd.enough.event+json",
  { parseAs: "buffer" },
  (request, body, done) => {
    (request as typeof request & { rawIntegrationBody?: Buffer }).rawIntegrationBody =
      Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    try {
      done(null, JSON.parse(body.toString("utf8")) as unknown);
    } catch {
      done(new Error("Invalid integration event JSON."), undefined);
    }
  },
);

const allowedOrigins = new Set([
  new URL(env.APP_BASE_URL).origin,
  ...env.AUTH_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);
app.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    reply
      .header("access-control-allow-origin", origin)
      .header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
      .header(
        "access-control-allow-headers",
        "authorization, content-type, x-csrf-token, x-enough-timestamp, x-enough-signature, stripe-signature",
      )
      .header("access-control-max-age", "600")
      .header("vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) return reply.code(403).send();
    return reply.code(204).send();
  }
});

app.addHook("onSend", async (request, reply, payload) => {
  if (
    request.url.startsWith("/auth/") ||
    request.url.startsWith("/onboarding") ||
    request.url.startsWith("/products") ||
    request.url.startsWith("/activity") ||
    request.url.startsWith("/classification") ||
    request.url.startsWith("/rules") ||
    request.url.startsWith("/credits") ||
    request.url.startsWith("/growth-tasks") ||
    request.url.startsWith("/task-evidence") ||
    request.url.startsWith("/integrations") ||
    request.url.startsWith("/ai/") ||
    request.url.startsWith("/report-data") ||
    request.url.startsWith("/notification-data") ||
    request.url.startsWith("/notification-preferences") ||
    request.url.startsWith("/billing") ||
    request.url.startsWith("/privacy") ||
    request.url.startsWith("/admin") ||
    request.url.startsWith("/v1/events")
  ) {
    reply.header("cache-control", "no-store").header("pragma", "no-cache");
  }
  return payload;
});

await registerAuthRoutes(app);
await registerOAuthRoutes(app);
await registerOnboardingRoutes(app);
await registerProductRoutes(app);
await registerActivityRoutes(app);
await registerClassificationRoutes(app);
await registerRuleRoutes(app);
await registerCreditRoutes(app);
await registerTaskRoutes(app);
await registerEvidenceRoutes(app);
await registerIntegrationRoutes(app);
await registerAiRoutes(app);
await registerReportRoutes(app);
await registerNotificationRoutes(app);
await registerBillingRoutes(app);
await registerPrivacyRoutes(app);
await registerAdminRoutes(app);

app.get("/health", async () => healthResponse("api"));

app.get("/ready", async (_request, reply) => {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const ready = database && redis;
  if (!ready) reply.code(503);
  return {
    ...healthResponse("api", ready ? "ok" : "degraded"),
    dependencies: {
      database: database ? "ok" : "unavailable",
      redis: redis ? "ok" : "unavailable",
    },
  };
});

async function stop(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down API");
  await app.close();
  await Promise.all([closeDatabase(), closeRedis()]);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stop(signal).catch((error: unknown) => {
      app.log.error(error, "API shutdown failed");
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ host: "127.0.0.1", port: env.API_PORT });
} catch (error) {
  app.log.fatal(error, "API failed to start");
  await Promise.all([closeDatabase(), closeRedis()]);
  process.exit(1);
}
