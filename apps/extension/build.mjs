import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifestTemplate = JSON.parse(await readFile(path.join(root, "manifest.base.json"), "utf8"));

for (const target of ["chrome", "firefox"]) {
  const outDir = path.join(root, "dist", target);
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: true,
      target: "es2022",
      rollupOptions: {
        input: { background: path.join(root, "src", "background.ts") },
        output: {
          format: "iife",
          entryFileNames: "background.js",
          assetFileNames: "[name][extname]",
        },
      },
    },
  });

  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      target: "es2022",
      rollupOptions: {
        input: {
          popup: path.join(root, "popup.html"),
          options: path.join(root, "options.html"),
          block: path.join(root, "block.html"),
        },
        output: { format: "es", entryFileNames: "[name].js", assetFileNames: "[name][extname]" },
      },
    },
  });

  const manifest = structuredClone(manifestTemplate);
  if (target === "firefox") {
    manifest.background = { scripts: ["background.js"] };
    manifest.browser_specific_settings = {
      gecko: { id: "enough@example.com", strict_min_version: "128.0" },
    };
    delete manifest.minimum_chrome_version;
  }
  await writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}
