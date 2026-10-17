import { generateKeyPairSync, randomBytes } from "node:crypto";

// Deliberately opt in OS/tool plumbing, never provider prefixes or arbitrary npm config.
// This is environment isolation, not an OS sandbox or a filesystem access boundary.
const safeKeys = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "CI",
  "PNPM_HOME",
]);

export function isolatedEnvironment(source, fixture = {}) {
  const child = Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => safeKeys.has(key.toUpperCase()) && value !== undefined,
    ),
  );
  // Only trusted test callers may explicitly supply fixture values after sanitization.
  // Never pass process.env as fixture. The release CLI exposes no override mechanism.
  return { ...child, ...fixture };
}

export function commandEnvironment(source, mode) {
  if (mode === "--runtime") return { ...source };
  const child = isolatedEnvironment(source);
  if (mode === "--test") return { ...child, NODE_ENV: "test", CI: "true" };
  if (mode === "--build") {
    // Next embeds rewrite destinations at build time. Pass only validated public origins.
    for (const key of ["APP_BASE_URL", "API_BASE_URL"]) {
      let url;
      try {
        url = new URL(source[key] ?? "");
      } catch {
        throw new Error(`${key} must be a public HTTPS origin for a release build`);
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      ) {
        throw new Error(`${key} must be a public HTTPS origin for a release build`);
      }
      child[key] = url.origin;
    }
    return {
      ...child,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      // Disposable build-only values satisfy module evaluation; never production credentials.
      AUTH_SECRET: randomBytes(48).toString("hex"),
      POLICY_SNAPSHOT_SIGNING_PRIVATE_KEY: generateKeyPairSync("ed25519")
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
      RESEND_API_KEY: "build-only-not-a-provider-credential",
      AUTH_EMAIL_FROM: "build@example.invalid",
      DATABASE_URL: "postgresql://build:build@127.0.0.1:1/build",
      REDIS_URL: "redis://127.0.0.1:1/0",
    };
  }
  if (mode !== "--clean") throw new Error("An explicit subprocess environment mode is required");
  return child;
}
