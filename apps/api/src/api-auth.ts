import { type AuthSession, authenticate, validateSessionCsrf } from "@enough/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthSession | null> {
  try {
    const session = await authenticate(request);
    if (session) return session;
  } catch (error) {
    request.log.error({ err: error }, "Could not load authenticated API session");
    reply.code(503).send({ error: "Your workspace is temporarily unavailable." });
    return null;
  }
  reply.code(401).send({ error: "Sign in to continue." });
  return null;
}

export function requireCsrf(
  request: FastifyRequest,
  reply: FastifyReply,
  session: AuthSession,
): boolean {
  if (validateSessionCsrf(request, session)) return true;
  reply.code(403).send({ error: "The request could not be verified. Refresh and try again." });
  return false;
}
