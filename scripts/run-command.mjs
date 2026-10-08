import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const mode = argv[0] === "--clean" || argv[0] === "--test" ? argv.shift() : "";
const [command, ...args] = argv;
if (!command) throw new Error("Usage: run-command.mjs <command> [args...]");

const childEnvironment = { ...process.env };
if (mode) {
  for (const key of [
    "DATABASE_URL",
    "REDIS_URL",
    "AUTH_SECRET",
    "RESEND_API_KEY",
    "AUTH_EMAIL_FROM",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "OPENAI_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRETS",
    "STRIPE_PRICE_MONTHLY",
    "STRIPE_PRICE_ANNUAL",
    "ADMIN_EMAILS",
    "BACKUP_AGE_RECIPIENT",
    "BACKUP_RCLONE_DEST",
  ])
    delete childEnvironment[key];
}
if (mode === "--test") {
  childEnvironment.NODE_ENV = "test";
  childEnvironment.CI = "true";
}

const child = spawn(command, args, { stdio: "inherit", env: childEnvironment });
child.once("error", (error) => {
  console.error(`Could not start ${command}:`, error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
