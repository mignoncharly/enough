import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = join(tmpdir(), "enough-phase11");
const account = JSON.parse(await readFile(join(fixture, "manual-account.json"), "utf8"));
assert.equal(account.fixture, "enough-phase11");
assert.equal(account.apiBaseUrl, "http://127.0.0.1:4420");
const response = await fetch(`${account.apiBaseUrl}/auth/sessions/${account.desktopSessionId}`, {
  method: "DELETE",
  headers: {
    cookie: `enough_session=${account.controlSessionToken}; enough_csrf=${account.controlSessionCsrf}`,
    "x-csrf-token": account.controlSessionCsrf,
    origin: "http://127.0.0.1:3312",
  },
  signal: AbortSignal.timeout(15_000),
});
assert.equal(response.status, 204, `Phase 11 fixture revocation failed (${response.status}).`);
console.info(
  "Revoked the prepared Phase 11 desktop session; fixture token values were not printed.",
);
