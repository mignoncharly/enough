import { spawn } from "node:child_process";
import net from "node:net";

function endpointFromUrl(value, fallbackPort) {
  try {
    const url = new URL(value);
    const port = Number(url.port);
    return {
      host: url.hostname || "127.0.0.1",
      port: Number.isInteger(port) && port > 0 ? port : fallbackPort,
    };
  } catch {
    return { host: "127.0.0.1", port: fallbackPort };
  }
}

function checkPort({ host, port }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 900 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("close", () => resolve(false));
  });
}

const database = endpointFromUrl(process.env.DATABASE_URL, 5432);
const redis = endpointFromUrl(process.env.REDIS_URL, 6379);
const services = await Promise.all([checkPort(database), checkPort(redis)]);

if (!services[0] || !services[1]) {
  const unavailable = [
    !services[0] && `PostgreSQL on ${database.host}:${database.port}`,
    !services[1] && `Redis on ${redis.host}:${redis.port}`,
  ].filter(Boolean);
  console.error(`Start the required local services before development: ${unavailable.join(", ")}.`);
  console.error("Check DATABASE_URL and REDIS_URL in .env, then start both services.");
  process.exit(1);
}

const args = [
  "--parallel",
  "--stream",
  "--filter",
  "@enough/web",
  "--filter",
  "@enough/api",
  "--filter",
  "@enough/worker",
  "dev",
];
const pnpmScript = process.env.npm_execpath;
const child = pnpmScript
  ? spawn(process.execPath, [pnpmScript, ...args], { stdio: "inherit" })
  : spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error("Could not start the workspace development processes:", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
