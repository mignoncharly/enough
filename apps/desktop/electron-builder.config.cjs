const { build } = require("./package.json");

const updateUrl = String(process.env.ENOUGH_UPDATE_URL || "").trim();
const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const releaseBuild = process.env.ENOUGH_RELEASE_BUILD === "true";

if (process.platform === "win32") {
  process.env.CSC_LINK ||= process.env.WIN_CSC_LINK;
  process.env.CSC_KEY_PASSWORD ||= process.env.WIN_CSC_KEY_PASSWORD;
}

function genericPublishConfig(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ENOUGH_UPDATE_URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("ENOUGH_UPDATE_URL must be a clean HTTPS feed URL.");
  }
  return { provider: "generic", url: `${url.origin}${url.pathname.replace(/\/+$/, "")}/` };
}

const config = structuredClone(build);
if (updateUrl) {
  config.publish = [genericPublishConfig(updateUrl)];
} else if (/^[^/]+\/[^/]+$/.test(repository)) {
  const [owner, repo] = repository.split("/");
  config.publish = [{ provider: "github", owner, repo }];
} else if (releaseBuild) {
  throw new Error("Set GITHUB_REPOSITORY or ENOUGH_UPDATE_URL before producing a release build.");
} else {
  delete config.publish;
}

if (releaseBuild) {
  if (process.platform === "win32" && !process.env.WIN_CSC_LINK && !process.env.CSC_LINK) {
    throw new Error("A Windows signing certificate is required for release builds (WIN_CSC_LINK).");
  }
  if (process.platform === "darwin") {
    const hasAppleApiKey =
      process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER;
    const hasAppleId =
      process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
    if (!process.env.CSC_LINK || (!hasAppleApiKey && !hasAppleId)) {
      throw new Error(
        "macOS release builds require Developer ID signing and Apple notarization credentials.",
      );
    }
    config.mac = { ...config.mac, notarize: true };
  }
  config.forceCodeSigning = process.platform !== "linux";
}

module.exports = config;
