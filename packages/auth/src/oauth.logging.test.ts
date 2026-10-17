import Fastify from "fastify";
import { expect, it, vi } from "vitest";

vi.mock("@enough/db", () => ({
  pool: {
    query: vi.fn(async () => {
      throw new Error("synthetic-provider-secret-in-error");
    }),
  },
}));
vi.mock("./rate-limit.js", () => ({ checkRateLimit: vi.fn(async () => true) }));

import { registerOAuthRoutes } from "./oauth.js";

it("observes a failed real sign-in callback without logging provider exception material", async () => {
  const lines: string[] = [];
  const app = Fastify({
    logger: {
      level: "info",
      redact: ["req.url"],
      stream: {
        write: (line: string) => {
          lines.push(line);
        },
      },
    },
  });
  try {
    await registerOAuthRoutes(app);
    const response = await app.inject({
      url: `/auth/oauth/google/callback?code=synthetic-code&state=${"s".repeat(48)}`,
    });
    expect(response.statusCode).toBe(302);
    const output = lines.join("");
    expect(output).toContain("OAuth sign-in did not complete");
    expect(output).not.toContain("synthetic-provider-secret-in-error");
    expect(output).not.toContain("synthetic-code");
  } finally {
    await app.close();
  }
});
