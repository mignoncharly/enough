// Read-only scan of the owned fixture; never prints secrets or matching content.
import assert from "node:assert/strict";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { assertPhase16Ownership, phase16Fixture as fixture } from "./phase16-fixture-plan.mjs";

const directory = fixture.directory;
const info = await lstat(directory);
assertPhase16Ownership({
  resolvedDirectory: await realpath(directory),
  symbolicLink: info.isSymbolicLink(),
  marker: JSON.parse(await readFile(path.join(directory, fixture.markerFile), "utf8")),
  activePorts: [],
});
async function json(name) {
  const file = path.join(directory, name);
  assert.equal((await lstat(file)).isSymbolicLink(), false);
  return JSON.parse(await readFile(file, "utf8"));
}
const credentials = await json("credentials.json"),
  seed = await json("seed.json"),
  manual = await json("manual-account.json");
const secrets = [
  ...Object.values(credentials),
  manual.password,
  ...seed.accounts.flatMap((a) => [a.session.token, a.session.csrfToken]),
  ...seed.canaries,
  "P16_SQL_PRIVATE_CANARY",
].filter(Boolean);
let count = 0;
async function scan(current) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const file = path.join(current, entry.name),
      stat = await lstat(file);
    if (stat.isSymbolicLink()) {
      assert.ok(
        file.startsWith(path.join(directory, "web/node_modules") + path.sep),
        "Unexpected fixture log path link",
      );
      continue;
    }
    if (stat.isDirectory()) await scan(file);
    else if (entry.name.endsWith(".log")) {
      const text = await readFile(file, "utf8");
      assert.ok(
        secrets.every((value) => !text.includes(value)),
        "Phase 16 log privacy failure; matching content withheld",
      );
      assert.ok(
        !/enough_session=|enough_csrf=|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@|authorization\s*[:=]\s*["']?(Bearer|Basic)\s+/i.test(
          text,
        ),
        "Phase 16 log credential-pattern failure; content withheld",
      );
      count++;
    }
  }
}
await scan(directory);
assert.equal((await readFile(path.join(directory, "egress-blocked.log"), "utf8")).trim(), "");
console.info(
  `Phase 16 privacy PASS: ${count} retained runtime/archive/development logs scanned; provider connections=0; no matching values printed.`,
);
