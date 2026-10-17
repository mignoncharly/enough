// Fixture-only preload: never changes production provider configuration.
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { phase16Fixture as fixture } from "./phase16-fixture-plan.mjs";
import { createPhase16ReportClock } from "./phase16-report-clock.mjs";

assert.equal(process.env.ENOUGH_PHASE16_RUNTIME, "1");
assert.equal(process.env.OPENAI_API_KEY, "");
assert.equal(new URL(process.env.DATABASE_URL).port, String(fixture.ports.postgres));
assert.equal(new URL(process.env.DATABASE_URL).pathname, `/${fixture.database}`);
const hosts = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const ports = new Set(Object.values(fixture.ports).map(String));
// TSX attempts its own supervisor's local IPC pipe. This is not a network
// provider path; only that exact parent pipe is allowed, never arbitrary IPC.
const ipcFile = path.join(
  tmpdir(),
  `tsx-${process.geteuid ? process.geteuid() : userInfo().username}`,
  `${process.ppid}.pipe`,
);
const parentIpc = process.platform === "win32" ? `\\\\?\\pipe\\${ipcFile}` : ipcFile;
function blocked(kind = "NON_LOOPBACK", port = null) {
  appendFileSync(
    path.join(fixture.directory, "egress-blocked.log"),
    `${JSON.stringify({ category: "P16_CONNECTION_BLOCKED", kind, port })}\n`,
  );
  throw new Error("Phase 16 outbound connection disabled");
}
function permit(host, port) {
  if (!hosts.has(host ?? "localhost") || !ports.has(String(port)))
    blocked(hosts.has(host ?? "localhost") ? "LOCAL_PORT" : "NON_LOOPBACK", Number(port) || null);
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (
    process.env.ENOUGH_PHASE16_API_CLOCK !== "1" &&
    url.href === "https://registry.npmjs.org/-/package/next/dist-tags"
  ) {
    appendFileSync(
      path.join(fixture.directory, "tooling-offline.log"),
      "NEXT_VERSION_CHECK_SUPPRESSED\n",
    );
    throw new Error("Phase 16 offline development tooling");
  }
  permit(url.hostname, url.port);
  return originalFetch(input, options);
};
for (const transport of [http, https]) {
  const request = transport.request;
  transport.request = function (input, ...args) {
    const options = typeof input === "string" || input instanceof URL ? new URL(input) : input;
    permit(options.hostname ?? options.host, options.port);
    return request.call(this, input, ...args);
  };
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof first === "object") {
    if (first.path === parentIpc) return connect.apply(this, args);
    if (first.path) blocked("LOCAL_IPC");
    permit(first.host, first.port);
  } else if (typeof first === "number")
    permit(typeof args[1] === "string" ? args[1] : "localhost", first);
  else blocked("CONNECT_ARGUMENT");
  return connect.apply(this, args);
};

if (process.env.ENOUGH_PHASE16_API_CLOCK === "1") {
  const clock = createPhase16ReportClock(process.env.ENOUGH_PHASE16_NOW);
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, ...args) {
    if (event === "request")
      return clock.runRequest(args[0].url, () => emit.call(this, event, ...args));
    return emit.call(this, event, ...args);
  };
  globalThis.Date = clock.Date;
}
