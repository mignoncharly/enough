import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, "resources"), { recursive: true });
await copyFile(
  path.join(root, "src", "native-host.cjs"),
  path.join(root, "resources", "native-host.cjs"),
);

await build({
  entryPoints: [path.join(root, "src", "main.mjs")],
  outfile: path.join(root, "dist", "main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron", "electron-updater", "get-windows"],
});

await build({
  entryPoints: [path.join(root, "src", "preload.cjs")],
  outfile: path.join(root, "dist", "preload.cjs"),
  bundle: false,
  platform: "node",
  format: "cjs",
  target: "node22",
});

await build({
  entryPoints: [path.join(root, "src", "lock-preload.cjs")],
  outfile: path.join(root, "dist", "lock-preload.cjs"),
  bundle: false,
  platform: "node",
  format: "cjs",
  target: "node22",
});
