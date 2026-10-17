import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { requestLoggerOptions } from "./logging.js";

describe("OAuth request logging", () => {
  it.each([
    "/auth/oauth/google/callback",
    "/integrations/oauth/google/callback",
    "/integrations/oauth/microsoft/callback",
  ])(
    "redacts query credentials while retaining status and safe failure messages: %s",
    async (route) => {
      const lines: string[] = [];
      const app = Fastify({
        logger: {
          ...requestLoggerOptions("info"),
          stream: {
            write: (line: string) => {
              lines.push(line);
            },
          },
        },
      });
      app.get(route, async (request, reply) => {
        request.log.warn(
          { provider: "google", req: { query: request.query } },
          "OAuth sign-in did not complete",
        );
        return reply.code(400).send({ error: "OAuth failed" });
      });
      try {
        await app.inject({
          url: `${route}?code=synthetic-code-sensitive&state=synthetic-state-sensitive`,
          headers: {
            authorization: "Bearer synthetic-access-sensitive",
            cookie: "session=synthetic-session-sensitive",
          },
        });
        const output = lines.join("");
        for (const value of [
          "synthetic-code-sensitive",
          "synthetic-state-sensitive",
          "synthetic-access-sensitive",
          "synthetic-session-sensitive",
        ])
          expect(output).not.toContain(value);
        expect(output).toContain('"statusCode":400');
        expect(output).toContain("OAuth sign-in did not complete");
      } finally {
        await app.close();
      }
    },
  );
});
