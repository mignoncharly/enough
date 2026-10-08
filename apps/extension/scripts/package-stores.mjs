import { spawnSync } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const output = path.join(dist, "store-packages");
const packages = [
  { source: path.join(dist, "chrome"), name: "enough-chrome-web-store.zip" },
  { source: path.join(dist, "chrome"), name: "enough-edge-addons.zip" },
  { source: path.join(dist, "firefox"), name: "enough-firefox-addons.zip" },
];

await mkdir(output, { recursive: true });
for (const item of packages) {
  await access(path.join(item.source, "manifest.json"));
  const archive = path.join(output, item.name);
  await rm(archive, { force: true });
  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `$ErrorActionPreference = 'Stop'; Compress-Archive -Path '${path.join(item.source, "*").replaceAll("'", "''")}' -DestinationPath '${archive.replaceAll("'", "''")}' -CompressionLevel Optimal`,
          ],
          { stdio: "inherit" },
        )
      : spawnSync("zip", ["-qr", archive, "."], { cwd: item.source, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not create ${item.name}.`);
  console.log(`Created ${path.relative(root, archive)}`);
}
