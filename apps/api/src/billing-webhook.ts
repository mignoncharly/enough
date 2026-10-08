import { createHmac, timingSafeEqual } from "node:crypto";

export function stripeSignatureMatches(
  rawBody: Buffer,
  header: string | undefined,
  configuredSecrets: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!header || !configuredSecrets) return false;
  const parts = header.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts
    .filter(([key]) => key === "v1")
    .map(([, value]) => value)
    .filter((value): value is string => Boolean(value));
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > 300) return false;
  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBody]);
  const secrets = configuredSecrets
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);
  return secrets.some((secret) => {
    const expected = createHmac("sha256", secret).update(signedPayload).digest();
    return signatures.some((signature) => {
      if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
      const provided = Buffer.from(signature, "hex");
      return provided.length === expected.length && timingSafeEqual(expected, provided);
    });
  });
}
