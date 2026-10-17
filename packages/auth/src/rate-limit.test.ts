import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ eval: vi.fn() }));
vi.mock("@enough/cache", () => ({ getRedis: () => ({ eval: mocks.eval }) }));
vi.mock("@enough/config", () => ({ env: { AUTH_SECRET: "synthetic-auth-secret" } }));

import { checkRateLimit } from "./rate-limit.js";

afterEach(() => vi.resetAllMocks());

it.each(["allowed", "limited", "unavailable"])(
  "Coach rate limiter is %s without raw errors/subjects in logs",
  async (scenario) => {
    const logs: string[] = [];
    const app = Fastify({
      logger: {
        level: "info",
        stream: {
          write(line: string) {
            logs.push(line);
          },
        },
      },
    });
    mocks.eval.mockResolvedValue(scenario === "limited" ? [9, 30] : [8, 30]);
    if (scenario === "unavailable")
      mocks.eval.mockRejectedValue(new Error("synthetic-redis-private-canary"));
    app.post("/ai/coach", async (request, reply) => {
      if (!(await checkRateLimit(request, reply, "ai:coach", "synthetic-user-canary", 8, 60)))
        return;
      return { ok: true };
    });
    try {
      const response = await app.inject({ method: "POST", url: "/ai/coach" });
      expect(response.statusCode).toBe(
        scenario === "allowed" ? 200 : scenario === "limited" ? 429 : 503,
      );
      if (scenario === "limited") expect(response.headers["retry-after"]).toBe("30");
      for (const value of [
        "synthetic-redis-private-canary",
        "synthetic-user-canary",
        "synthetic-auth-secret",
      ])
        expect(logs.join("")).not.toContain(value);
    } finally {
      await app.close();
    }
  },
);
