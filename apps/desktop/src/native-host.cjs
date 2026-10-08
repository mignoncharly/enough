const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_MESSAGE_BYTES = 4096;
const appData = process.env.APPDATA
  ? path.join(process.env.APPDATA, "Enough")
  : process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "Enough")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Enough");
const statusPath = path.join(appData, "agent-status.json");
let input = Buffer.alloc(0);
let healthTimer = null;

function writeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function currentStatus() {
  try {
    const file = fs.lstatSync(statusPath);
    if (!file.isFile() || file.size > 4096) return { agentRunning: false, version: "unknown" };
    const heartbeat = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    const age = Date.now() - heartbeat.updatedAt;
    const fresh = Number.isFinite(heartbeat.updatedAt) && age >= 0 && age < 20_000;
    return {
      agentRunning: Boolean(fresh && heartbeat.running === true),
      version: heartbeat.version || "unknown",
    };
  } catch {
    return { agentRunning: false, version: "unknown" };
  }
}

function reportHealth() {
  const status = currentStatus();
  writeMessage({ type: "health", status: status.agentRunning ? "ok" : "degraded", ...status });
}

function handle(payload) {
  let message;
  try {
    message = JSON.parse(payload.toString("utf8"));
  } catch {
    writeMessage({ type: "error", error: "Invalid native messaging JSON." });
    return;
  }

  if (message?.type === "health-check") {
    reportHealth();
    if (healthTimer === null) healthTimer = setInterval(reportHealth, 5000);
    return;
  }
  writeMessage({ type: "error", error: "Unsupported native messaging request." });
}

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const size = input.readUInt32LE(0);
    if (size > MAX_MESSAGE_BYTES) {
      process.exitCode = 1;
      process.stdin.destroy(new Error("Native message exceeded the size limit."));
      return;
    }
    if (input.length < size + 4) return;
    handle(input.subarray(4, size + 4));
    input = input.subarray(size + 4);
  }
});

process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(1));
