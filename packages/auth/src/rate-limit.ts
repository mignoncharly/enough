import { createHmac } from "node:crypto";
import { getRedis } from "@enough/cache";
import { env } from "@enough/config";
import type { FastifyReply, FastifyRequest } from "fastify";

const incrementWithExpiry = `
  local value = redis.call('INCRBY', KEYS[1], ARGV[2])
  if value == tonumber(ARGV[2]) then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return { value, redis.call('TTL', KEYS[1]) }
`;

export async function checkRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
  cost = 1,
): Promise<boolean> {
  const fingerprint = createHmac("sha256", env.AUTH_SECRET).update(subject).digest("hex");
  const key = `enough:auth:rate:${scope}:${fingerprint}`;

  try {
    const result = (await getRedis().eval(
      incrementWithExpiry,
      1,
      key,
      String(windowSeconds),
      String(Math.max(1, Math.floor(cost))),
    )) as [number, number];
    const count = Number(result[0]);
    const remaining = Number(result[1]);
    if (count <= limit) return true;
    reply
      .header("retry-after", String(Math.max(1, remaining)))
      .code(429)
      .send({ error: "Too many requests. Try again later." });
    return false;
  } catch (error) {
    request.log.error({ err: error, scope }, "Rate limiter unavailable");
    reply.code(503).send({ error: "The service is temporarily unavailable." });
    return false;
  }
}
