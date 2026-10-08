import { createHash } from "node:crypto";
import { env } from "@enough/config";

export type AuthEmailPurpose = "verify_email" | "password_reset" | "magic_link";

const messages: Record<
  AuthEmailPurpose,
  { subject: string; heading: string; action: string; ttl: string }
> = {
  verify_email: {
    subject: "Verify your email for Enough",
    heading: "Verify your email address",
    action: "Verify email",
    ttl: "This link expires in 24 hours.",
  },
  password_reset: {
    subject: "Reset your Enough password",
    heading: "Reset your password",
    action: "Reset password",
    ttl: "This link expires in 1 hour.",
  },
  magic_link: {
    subject: "Your sign-in link for Enough",
    heading: "Sign in to Enough",
    action: "Sign in",
    ttl: "This link expires in 15 minutes and can be used once.",
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escapes: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escapes[character] ?? character;
  });
}

export async function sendAuthEmail(
  purpose: AuthEmailPurpose,
  recipient: string,
  actionUrl: string,
  tokenHash: Buffer,
): Promise<void> {
  const message = messages[purpose];
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) {
    if (env.NODE_ENV === "development" && env.AUTH_DEV_SHOW_EMAIL_LINKS) {
      console.info(JSON.stringify({ event: "auth.email.preview", purpose, url: actionUrl }));
    }
    return;
  }

  const idempotencyKey = createHash("sha256")
    .update(purpose)
    .update("\0")
    .update(tokenHash)
    .digest("hex");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(message.subject)}</title></head><body style="margin:0;background:#f4f4f0;color:#172321;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;padding:32px 20px"><p style="font-size:13px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:#326653">Enough</p><h1 style="font-size:26px;line-height:1.25">${escapeHtml(message.heading)}</h1><p style="font-size:16px;line-height:1.6">Use the button below to continue. If you did not request this, you can ignore this email.</p><p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;min-height:44px;padding:12px 20px;border-radius:8px;background:#245b48;color:#fff;text-decoration:none;font-weight:bold">${escapeHtml(message.action)}</a></p><p style="font-size:14px;line-height:1.5;color:#52615c">${escapeHtml(message.ttl)}</p><p style="font-size:13px;line-height:1.5;color:#52615c">If the button does not work, copy this address into your browser:<br><a href="${escapeHtml(actionUrl)}">${escapeHtml(actionUrl)}</a></p></div></body></html>`;
  const text = `${message.heading}\n\nUse this link to continue: ${actionUrl}\n\n${message.ttl}\nIf you did not request this, ignore this email.`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          from: env.AUTH_EMAIL_FROM,
          to: [recipient],
          subject: message.subject,
          html,
          text,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return;
      lastError = new Error(`Transactional email provider returned HTTP ${response.status}`);
      if (response.status < 500 || attempt === 1) break;
    } catch (error) {
      lastError = error;
      if (attempt === 1) break;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError instanceof Error ? lastError : new Error("Transactional email delivery failed");
}
