import assert from "node:assert/strict";
import { lstat, readFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const tempRoot = path.resolve(tmpdir());
const root = path.resolve(tempRoot, "enough-phase11");
const expected = path.join(tempRoot, "enough-phase11");
assert.equal(root, expected, "Refusing to clean an unexpected target.");
const target = await lstat(root).catch((error) =>
  error.code === "ENOENT" ? null : Promise.reject(error),
);
if (!target) {
  console.info("The Phase 11 temporary fixture is already absent.");
  process.exit(0);
}
assert.ok(
  target.isDirectory() && !target.isSymbolicLink(),
  "Refusing to clean a non-directory fixture target.",
);
const marker = JSON.parse(await readFile(path.join(root, "phase11-fixture.json"), "utf8"));
assert.equal(
  marker.fixture,
  "enough-phase11",
  "Refusing to clean an unmarked temporary directory.",
);
assert.equal(marker.version, 1);
const heartbeatPath = path.join(root, "desktop-data", "agent-status.json");
const heartbeat = await readFile(heartbeatPath, "utf8")
  .then((value) => JSON.parse(value))
  .catch((error) => (error.code === "ENOENT" ? null : Promise.reject(error)));
if (heartbeat?.running === true && Date.now() - heartbeat.updatedAt < 20_000)
  throw new Error("Close the Phase 11 desktop app before fixture cleanup.");

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

const ports = [55942, 56403, 4420, 4421, 3312];
const active = (
  await Promise.all(ports.map(async (port) => ((await listening(port)) ? port : null)))
).filter((port) => port !== null);
assert.equal(
  active.length,
  0,
  `Stop the Phase 11 fixture services before cleanup (ports: ${active.join(", ")}).`,
);
await rm(root, { recursive: true, force: true });
console.info("Removed only TEMP/enough-phase11 after confirming its services were stopped.");
