import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const nativeHostPath = fileURLToPath(new URL("./native-host.cjs", import.meta.url));
const fixtures = new Set<string>();

async function startNativeHost(dataRoot: string) {
  const child = spawn(process.execPath, [nativeHostPath], {
    env: {
      APPDATA: dataRoot,
      XDG_CONFIG_HOME: dataRoot,
      PATH: process.env.PATH,
      ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const readMessage = (): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const timer = setTimeout(() => finish(new Error("Native host response timed out.")), 3000);
      const onError = (error: Error) => finish(error);
      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < 4) return;
        const size = buffer.readUInt32LE(0);
        if (buffer.length < size + 4) return;
        finish(
          null,
          JSON.parse(buffer.subarray(4, size + 4).toString("utf8")) as Record<string, unknown>,
        );
      };
      const finish = (error: Error | null, value?: Record<string, unknown>) => {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.stdout.off("error", onError);
        error ? reject(error) : resolve(value as Record<string, unknown>);
      };
      child.stdout.on("data", onData);
      child.stdout.on("error", onError);
    });
  const send = (message: Record<string, unknown>) => {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    child.stdin.write(Buffer.concat([header, payload]));
  };
  const stop = async () => {
    child.kill();
    if (child.exitCode === null)
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  };
  return { readMessage, send, stop };
}

async function createDataRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "enough-native-host-"));
  fixtures.add(root);
  return root;
}

afterEach(async () => {
  await Promise.all([...fixtures].map((root) => rm(root, { recursive: true, force: true })));
  fixtures.clear();
});

describe("native messaging health protocol", () => {
  it("reports the fresh agent heartbeat and rejects unsupported requests", async () => {
    const dataRoot = await createDataRoot();
    const appData = path.join(dataRoot, "Enough");
    await mkdir(appData, { recursive: true });
    await writeFile(
      path.join(appData, "agent-status.json"),
      JSON.stringify({ running: true, updatedAt: Date.now(), version: "11.0.0-fixture" }),
    );
    const host = await startNativeHost(dataRoot);
    try {
      host.send({ type: "health-check" });
      expect(await host.readMessage()).toEqual({
        type: "health",
        status: "ok",
        agentRunning: true,
        version: "11.0.0-fixture",
      });
      host.send({ type: "unsupported-fixture-request" });
      expect(await host.readMessage()).toEqual({
        type: "error",
        error: "Unsupported native messaging request.",
      });
    } finally {
      await host.stop();
    }
  });

  it("reports a stale heartbeat as disconnected", async () => {
    const dataRoot = await createDataRoot();
    const appData = path.join(dataRoot, "Enough");
    await mkdir(appData, { recursive: true });
    await writeFile(
      path.join(appData, "agent-status.json"),
      JSON.stringify({ running: true, updatedAt: Date.now() - 25_000, version: "11.0.0-fixture" }),
    );
    const host = await startNativeHost(dataRoot);
    try {
      host.send({ type: "health-check" });
      expect(await host.readMessage()).toEqual({
        type: "health",
        status: "degraded",
        agentRunning: false,
        version: "11.0.0-fixture",
      });
    } finally {
      await host.stop();
    }
  });
});
