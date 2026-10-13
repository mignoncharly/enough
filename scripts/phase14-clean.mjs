import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, readFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const tempRoot = path.resolve(tmpdir());
const root = path.resolve(tempRoot, "enough-phase14");
assert.equal(root, path.resolve(tempRoot, "enough-phase14"));
const target = await lstat(root).catch((error) =>
  error.code === "ENOENT" ? null : Promise.reject(error),
);
if (!target) {
  console.info("The Phase 14 temporary fixture is already absent.");
  process.exit(0);
}
assert.ok(target.isDirectory() && !target.isSymbolicLink());
const marker = JSON.parse(await readFile(path.join(root, "phase14-fixture.json"), "utf8"));
assert.equal(marker.fixture, "enough-phase14");
assert.equal(marker.version, 1);

async function listening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const ports = [55946, 56409, 4426, 4427, 3315];
const active = (
  await Promise.all(ports.map(async (port) => ((await listening(port)) ? port : null)))
).filter((port) => port !== null);
assert.equal(
  active.length,
  0,
  `Stop the Phase 14 fixture services before cleanup (ports: ${active.join(", ")}).`,
);
let redisResponse = null;
try {
  redisResponse = execFileSync(
    "wsl",
    ["-d", "Ubuntu", "--exec", "redis-cli", "-h", "127.0.0.1", "-p", "56410", "ping"],
    { windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
} catch {}
assert.notEqual(redisResponse, "PONG", "Stop the Phase 14 WSL Redis process before cleanup.");
await rm(root, { recursive: true, force: true });
console.info("Removed only TEMP/enough-phase14 after confirming its services were stopped.");
