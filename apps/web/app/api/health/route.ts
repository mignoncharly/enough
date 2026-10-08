import { healthResponse } from "@enough/shared";

export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(healthResponse("web"));
}
