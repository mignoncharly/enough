import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const ALLOWED_KEYS = new Set(["PLAUSIBLE_STATS_API_KEY", "PLAUSIBLE_SITE_ID"]);
const SITE_ID_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/;

export function plausibleAcceptanceQuery(siteId, now = new Date()) {
  return {
    site_id: siteId,
    metrics: ["events"],
    date_range: [new Date(now.getTime() - 7 * 86_400_000).toISOString(), now.toISOString()],
    dimensions: ["time:day"],
    filters: [["is", "event:goal", ["phase14_acceptance_probe"]]],
  };
}

export function plausibleSettingPresence(source) {
  return {
    statsApiKeyPresent: Boolean(source.PLAUSIBLE_STATS_API_KEY),
    siteIdPresent: Boolean(source.PLAUSIBLE_SITE_ID),
  };
}

export function parsePhase14PlausibleConfig(contents) {
  let values;
  try {
    values = parseEnv(contents);
  } catch {
    throw new Error("The isolated Phase 14 Plausible config is malformed.");
  }
  if (Object.keys(values).some((key) => !ALLOWED_KEYS.has(key))) {
    throw new Error("The isolated Phase 14 Plausible config contains an unsupported setting.");
  }

  const statsApiKey = values.PLAUSIBLE_STATS_API_KEY ?? "";
  const siteId = values.PLAUSIBLE_SITE_ID ?? "";
  const presence = plausibleSettingPresence({
    PLAUSIBLE_STATS_API_KEY: statsApiKey,
    PLAUSIBLE_SITE_ID: siteId,
  });
  if (
    statsApiKey.trim() !== statsApiKey ||
    statsApiKey.length < 12 ||
    statsApiKey.length > 4096 ||
    siteId.trim() !== siteId ||
    siteId.length > 253 ||
    !SITE_ID_PATTERN.test(siteId)
  ) {
    throw new Error("The isolated Phase 14 Plausible config is incomplete or invalid.");
  }
  return { statsApiKey, siteId, ...presence };
}

export async function readPhase14PlausibleConfig(path) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        fileExists: false,
        statsApiKey: "",
        siteId: "",
        statsApiKeyPresent: false,
        siteIdPresent: false,
      };
    }
    throw new Error("Unable to read the isolated Phase 14 Plausible config.");
  }
  return { fileExists: true, ...parsePhase14PlausibleConfig(contents) };
}
