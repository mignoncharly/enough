import { z } from "zod";

const optionalEnvironmentString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);
const DEVELOPMENT_AUTH_SECRET = "enough-local-development-secret-change-before-deploy";

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), {
        message: "must use postgres:// or postgresql://",
      })
      .default("postgresql://enough:enough@127.0.0.1:5432/enough"),
    REDIS_URL: z
      .string()
      .url()
      .refine((value) => ["redis:", "rediss:"].includes(new URL(value).protocol), {
        message: "must use redis:// or rediss://",
      })
      .default("redis://127.0.0.1:6379/0"),
    WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    APP_BASE_URL: optionalEnvironmentString.pipe(z.string().url().optional()),
    API_BASE_URL: optionalEnvironmentString.pipe(z.string().url().optional()),
    AUTH_SECRET: z
      .preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
        z.string().min(32).optional(),
      )
      .transform((value) => value ?? DEVELOPMENT_AUTH_SECRET),
    AUTH_SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    AUTH_DEV_SHOW_EMAIL_LINKS: z.preprocess(
      (value) =>
        typeof value === "string" ? ["true", "1", "yes"].includes(value.toLowerCase()) : value,
      z.boolean().default(false),
    ),
    AUTH_ALLOWED_ORIGINS: z.string().default(""),
    ADMIN_EMAILS: z.string().default(""),
    RESEND_API_KEY: optionalEnvironmentString,
    AUTH_EMAIL_FROM: optionalEnvironmentString,
    GOOGLE_CLIENT_ID: optionalEnvironmentString,
    GOOGLE_CLIENT_SECRET: optionalEnvironmentString,
    GITHUB_CLIENT_ID: optionalEnvironmentString,
    GITHUB_CLIENT_SECRET: optionalEnvironmentString,
    OPENAI_API_KEY: optionalEnvironmentString,
    OPENAI_MODEL: z.string().trim().min(1).max(120).default("gpt-6-astra"),
    STRIPE_SECRET_KEY: optionalEnvironmentString.pipe(
      z
        .string()
        .regex(/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+$/)
        .optional(),
    ),
    STRIPE_WEBHOOK_SECRETS: optionalEnvironmentString.pipe(
      z
        .string()
        .refine((value) =>
          value.split(",").every((secret) => /^whsec_[A-Za-z0-9+/=_-]+$/.test(secret.trim())),
        )
        .optional(),
    ),
    STRIPE_PRICE_MONTHLY: optionalEnvironmentString.pipe(
      z
        .string()
        .regex(/^price_[A-Za-z0-9]+$/)
        .optional(),
    ),
    STRIPE_PRICE_ANNUAL: optionalEnvironmentString.pipe(
      z
        .string()
        .regex(/^price_[A-Za-z0-9]+$/)
        .optional(),
    ),
    STRIPE_TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(0),
    BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(3),
    STRIPE_AUTOMATIC_TAX: z.preprocess(
      (value) =>
        typeof value === "string" ? ["true", "1", "yes"].includes(value.toLowerCase()) : value,
      z.boolean().default(true),
    ),
  })
  .superRefine((value, context) => {
    for (const [provider, clientId, clientSecret] of [
      ["Google", value.GOOGLE_CLIENT_ID, value.GOOGLE_CLIENT_SECRET],
      ["GitHub", value.GITHUB_CLIENT_ID, value.GITHUB_CLIENT_SECRET],
    ] as const) {
      if (Boolean(clientId) !== Boolean(clientSecret)) {
        context.addIssue({
          code: "custom",
          message: `${provider} OAuth requires both a client ID and client secret`,
          path: [`${provider.toUpperCase()}_CLIENT_ID`],
        });
      }
    }

    if (value.RESEND_API_KEY && !value.AUTH_EMAIL_FROM) {
      context.addIssue({
        code: "custom",
        message: "AUTH_EMAIL_FROM is required when RESEND_API_KEY is configured",
        path: ["AUTH_EMAIL_FROM"],
      });
    }

    if (Boolean(value.STRIPE_SECRET_KEY) !== Boolean(value.STRIPE_WEBHOOK_SECRETS)) {
      context.addIssue({
        code: "custom",
        message: "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRETS must be configured together",
        path: ["STRIPE_SECRET_KEY"],
      });
    }

    if ((value.STRIPE_PRICE_MONTHLY || value.STRIPE_PRICE_ANNUAL) && !value.STRIPE_SECRET_KEY) {
      context.addIssue({
        code: "custom",
        message:
          "A Stripe secret and webhook secret are required when a subscription price is configured",
        path: ["STRIPE_SECRET_KEY"],
      });
    }

    if (value.NODE_ENV === "production") {
      if (value.AUTH_SECRET === DEVELOPMENT_AUTH_SECRET) {
        context.addIssue({
          code: "custom",
          message: "AUTH_SECRET must be set to a unique value in production",
          path: ["AUTH_SECRET"],
        });
      }
      if (!value.RESEND_API_KEY || !value.AUTH_EMAIL_FROM) {
        context.addIssue({
          code: "custom",
          message: "RESEND_API_KEY and AUTH_EMAIL_FROM are required in production",
          path: ["RESEND_API_KEY"],
        });
      }
      if (!value.APP_BASE_URL || !value.API_BASE_URL) {
        context.addIssue({
          code: "custom",
          message: "APP_BASE_URL and API_BASE_URL must be explicitly set in production",
          path: ["APP_BASE_URL"],
        });
      }
      for (const [key, configuredUrl] of [
        ["APP_BASE_URL", value.APP_BASE_URL],
        ["API_BASE_URL", value.API_BASE_URL],
      ] as const) {
        if (configuredUrl && new URL(configuredUrl).protocol !== "https:") {
          context.addIssue({
            code: "custom",
            message: "must use HTTPS in production",
            path: [key],
          });
        }
      }
      if (value.AUTH_DEV_SHOW_EMAIL_LINKS) {
        context.addIssue({
          code: "custom",
          message: "Development email link previews must be disabled in production",
          path: ["AUTH_DEV_SHOW_EMAIL_LINKS"],
        });
      }
    }
  });

type ParsedEnvironment = z.infer<typeof environmentSchema>;
export type AppEnvironment = Omit<ParsedEnvironment, "APP_BASE_URL" | "API_BASE_URL"> & {
  APP_BASE_URL: string;
  API_BASE_URL: string;
};

export function parseEnvironment(source: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return {
    ...parsed.data,
    APP_BASE_URL: parsed.data.APP_BASE_URL ?? `http://127.0.0.1:${parsed.data.WEB_PORT}`,
    API_BASE_URL: parsed.data.API_BASE_URL ?? `http://127.0.0.1:${parsed.data.API_PORT}`,
  };
}

export const env = parseEnvironment();
