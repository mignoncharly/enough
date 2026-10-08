import { checkRedis } from "@enough/cache";
import { checkDatabase } from "@enough/db";
import { healthResponse } from "@enough/shared";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const ready = database && redis;
  return Response.json(
    {
      ...healthResponse("web", ready ? "ok" : "degraded"),
      dependencies: {
        database: database ? "ok" : "unavailable",
        redis: redis ? "ok" : "unavailable",
      },
    },
    { status: ready ? 200 : 503 },
  );
}
