// Explicit opt-in launcher. The key never enters argv, subprocess env or a config output.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { phase15Fixture as fixture } from "./phase15-fixture-plan.mjs";
import { isolatedEnvironment } from "./subprocess-environment.mjs";

try {
  if (!process.argv.includes("--enable-bounded-development-provider")) throw new Error();
  const credentials = JSON.parse(
    await readFile(path.join(fixture.directory, "credentials.json"), "utf8"),
  );
  const { phase15Environment } = await import("./phase15-fixture-plan.mjs");
  const environment = phase15Environment(isolatedEnvironment(process.env), credentials);
  environment.ENOUGH_PHASE15_BOUNDED_PROVIDER = "1";
  const root = fileURLToPath(new URL("../", import.meta.url));
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(root, "scripts/phase15-provider-acceptance.mjs"),
      ...(process.argv.includes("--preflight") ? ["--preflight"] : []),
    ],
    {
      cwd: path.join(root, "apps/api"),
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Child output is never forwarded: only the exit category is disclosed.
  child.stdout.resume();
  child.stderr.resume();
  child.once("error", () => {
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    console.info(
      code === 0
        ? "Phase 15 bounded operation PASS; safe report retained in owned fixture."
        : "Phase 15 bounded operation BLOCKED; inspect safe owned report; do not retry.",
    );
    process.exitCode = code === 0 ? 0 : 1;
  });
} catch {
  console.error("Phase 15 bounded launcher preflight BLOCKED; no provider call made.");
  process.exitCode = 1;
}
