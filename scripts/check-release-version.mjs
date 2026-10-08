import { readFile } from "node:fs/promises";

const tag = process.env.RELEASE_TAG || "";
const packagePaths = ["apps/desktop/package.json", "apps/extension/package.json"];

if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`Release tag must be vX.Y.Z; received ${tag || "<empty>"}.`);
}

const versions = await Promise.all(
  packagePaths.map(async (packagePath) => {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    return [packagePath, packageJson.version];
  }),
);
const expectedTag = `v${versions[0][1]}`;

if (versions.some(([, version]) => version !== versions[0][1]) || tag !== expectedTag) {
  const details = versions.map(([packagePath, version]) => `${packagePath}=${version}`).join(", ");
  throw new Error(`Release tag ${tag} must match both package versions (${details}).`);
}

console.log(`Release tag ${tag} matches desktop and extension package versions.`);
