import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const account = JSON.parse(
  await readFile(join(tmpdir(), "enough-phase10", "manual-account.json"), "utf8"),
);
assert.equal(account.fixture, "enough-phase10");
assert.equal(account.apiBaseUrl, "http://127.0.0.1:4418");
assert.match(account.chromeSessionId, /^[0-9a-f-]{36}$/i);
assert.ok(account.revocationControlToken);
assert.ok(account.revocationControlCsrf);

const response = await fetch(
  `${account.apiBaseUrl}/auth/sessions/${encodeURIComponent(account.chromeSessionId)}`,
  {
    method: "DELETE",
    headers: {
      cookie: `enough_session=${account.revocationControlToken}; enough_csrf=${account.revocationControlCsrf}`,
      "x-csrf-token": account.revocationControlCsrf,
      origin: "http://127.0.0.1:3310",
    },
    signal: AbortSignal.timeout(15_000),
  },
);
assert.equal(
  response.status,
  204,
  `Prepared extension-session revocation failed (${response.status}).`,
);
console.info("Revoked the prepared Chromium extension target in the isolated Phase 10 fixture.");
