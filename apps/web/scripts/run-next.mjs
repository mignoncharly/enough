import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  throw new Error("Usage: run-next.mjs <dev|start>");
}

const port = Number(process.env.WEB_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("WEB_PORT must be an integer between 1 and 65535.");
}

const cli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const cwd = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(
  process.execPath,
  [cli, mode, "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd,
    stdio: "inherit",
    env: process.env,
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error("Could not start Next.js:", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
