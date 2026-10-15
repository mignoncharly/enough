import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const ALLOWED_KEYS = new Set([
  "POSTHOG_PERSONAL_API_KEY",
  "POSTHOG_PROJECT_TOKEN",
  "POSTHOG_PROJECT_ID",
  "POSTHOG_REGION",
]);

export function posthogSettingPresence(source) {
  return {
    personalApiKeyPresent: Boolean(source.POSTHOG_PERSONAL_API_KEY),
    projectTokenPresent: Boolean(source.POSTHOG_PROJECT_TOKEN),
    projectIdPresent: Boolean(source.POSTHOG_PROJECT_ID),
    regionPresent: Boolean(source.POSTHOG_REGION),
  };
}

export function posthogRegionHosts(region) {
  if (region === "us") {
    return {
      apiBaseUrl: "https://us.posthog.com",
      ingestionUrl: "https://us.i.posthog.com/i/v0/e/",
    };
  }
  if (region === "eu") {
    return {
      apiBaseUrl: "https://eu.posthog.com",
      ingestionUrl: "https://eu.i.posthog.com/i/v0/e/",
    };
  }
  throw new Error("The isolated Phase 14 PostHog region must be us or eu.");
}

export function parsePhase14PostHogConfig(contents) {
  let values;
  try {
    values = parseEnv(contents);
  } catch {
    throw new Error("The isolated Phase 14 PostHog config is malformed.");
  }
  if (Object.keys(values).some((key) => !ALLOWED_KEYS.has(key))) {
    throw new Error("The isolated Phase 14 PostHog config contains an unsupported setting.");
  }

  const personalApiKey = values.POSTHOG_PERSONAL_API_KEY ?? "";
  const projectToken = values.POSTHOG_PROJECT_TOKEN ?? "";
  const projectId = values.POSTHOG_PROJECT_ID ?? "";
  const region = values.POSTHOG_REGION ?? "";
  const config = { personalApiKey, projectToken, projectId, region };
  const presence = posthogSettingPresence({
    POSTHOG_PERSONAL_API_KEY: personalApiKey,
    POSTHOG_PROJECT_TOKEN: projectToken,
    POSTHOG_PROJECT_ID: projectId,
    POSTHOG_REGION: region,
  });

  if (
    Object.values(config).some((value) => value.trim() !== value) ||
    personalApiKey.length < 12 ||
    personalApiKey.length > 4096 ||
    projectToken.length < 8 ||
    projectToken.length > 512 ||
    !/^\d{1,12}$/.test(projectId) ||
    !["us", "eu"].includes(region)
  ) {
    throw new Error("The isolated Phase 14 PostHog config is incomplete or invalid.");
  }

  return { ...config, ...presence };
}

export async function readPhase14PostHogConfig(path) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        fileExists: false,
        personalApiKey: "",
        projectToken: "",
        projectId: "",
        region: "",
        personalApiKeyPresent: false,
        projectTokenPresent: false,
        projectIdPresent: false,
        regionPresent: false,
      };
    }
    throw new Error("Unable to read the isolated Phase 14 PostHog config.");
  }
  return { fileExists: true, ...parsePhase14PostHogConfig(contents) };
}
