import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerOAuthRoutes } from "./oauth.js";

describe("OAuth route contracts", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function createApp() {
    const app = Fastify({ logger: false });
    apps.push(app);
    await registerOAuthRoutes(app);
    return app;
  }

  it("reports available sign-in methods without claiming passkey support", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/auth/providers" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      emailPassword: true,
      passwordless: true,
      google: expect.any(Boolean),
      github: expect.any(Boolean),
      passkeys: false,
    });
  });

  it("rejects unknown providers before entering callback processing", async () => {
    const app = await createApp();
    const start = await app.inject({ method: "POST", url: "/auth/oauth/not-a-provider/start" });
    const callback = await app.inject({
      method: "GET",
      url: "/auth/oauth/not-a-provider/callback?state=invalid",
    });
    expect(start.statusCode).toBe(404);
    expect(start.json()).toEqual({ error: "Provider not found." });
    expect(callback.statusCode).toBe(404);
    expect(callback.headers.location).toBeUndefined();
  });
});
