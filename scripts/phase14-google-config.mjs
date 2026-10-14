import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const ALLOWED_KEYS = new Set(["GOOGLE_INTEGRATION_CLIENT_ID", "GOOGLE_INTEGRATION_CLIENT_SECRET"]);

export function googleIntegrationSettingPresence(source) {
  return {
    clientIdPresent: Boolean(source.GOOGLE_INTEGRATION_CLIENT_ID),
    clientSecretPresent: Boolean(source.GOOGLE_INTEGRATION_CLIENT_SECRET),
  };
}

export function assertPhase14GoogleIntegrationSettings(presence, required) {
  if (required && (!presence.clientIdPresent || !presence.clientSecretPresent)) {
    throw new Error("Phase 14 Google OAuth client configuration is required for this fixture.");
  }
}

export function parsePhase14GoogleIntegrationConfig(contents) {
  let values;
  try {
    values = parseEnv(contents);
  } catch {
    throw new Error("The isolated Phase 14 Google OAuth config is malformed.");
  }
  if (Object.keys(values).some((key) => !ALLOWED_KEYS.has(key))) {
    throw new Error(
      "The isolated Phase 14 Google OAuth config may contain only the two integration client settings.",
    );
  }

  const clientId = values.GOOGLE_INTEGRATION_CLIENT_ID ?? "";
  const clientSecret = values.GOOGLE_INTEGRATION_CLIENT_SECRET ?? "";
  if (
    Boolean(clientId) !== Boolean(clientSecret) ||
    clientId.trim() !== clientId ||
    clientSecret.trim() !== clientSecret
  ) {
    throw new Error(
      "The isolated Phase 14 Google OAuth config must contain both non-empty client settings.",
    );
  }
  return {
    clientId,
    clientSecret,
    clientIdPresent: Boolean(clientId),
    clientSecretPresent: Boolean(clientSecret),
  };
}

export async function readPhase14GoogleIntegrationConfig(path) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        fileExists: false,
        clientId: "",
        clientSecret: "",
        clientIdPresent: false,
        clientSecretPresent: false,
      };
    }
    throw new Error("Unable to read the isolated Phase 14 Google OAuth config.");
  }
  return { fileExists: true, ...parsePhase14GoogleIntegrationConfig(contents) };
}
