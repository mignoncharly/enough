import { createPublicKey } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policySnapshotPublicKey = process.env.ENOUGH_POLICY_SNAPSHOT_PUBLIC_KEY?.trim() || "";
if (process.argv.includes("--release") && !policySnapshotPublicKey)
  throw new Error(
    "Set ENOUGH_POLICY_SNAPSHOT_PUBLIC_KEY to the matching Ed25519 PEM before a release build.",
  );
if (
  policySnapshotPublicKey &&
  createPublicKey(policySnapshotPublicKey).asymmetricKeyType !== "ed25519"
)
  throw new Error("ENOUGH_POLICY_SNAPSHOT_PUBLIC_KEY must be an Ed25519 public key.");
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
  define: {
    "process.env.ENOUGH_POLICY_SNAPSHOT_PUBLIC_KEY": JSON.stringify(policySnapshotPublicKey),
  },
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
