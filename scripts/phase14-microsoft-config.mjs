import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const ALLOWED_KEYS = new Set([
  "MICROSOFT_INTEGRATION_CLIENT_ID",
  "MICROSOFT_INTEGRATION_CLIENT_SECRET",
]);

export function microsoftIntegrationSettingPresence(source) {
  return {
    clientIdPresent: Boolean(source.MICROSOFT_INTEGRATION_CLIENT_ID),
    clientSecretPresent: Boolean(source.MICROSOFT_INTEGRATION_CLIENT_SECRET),
  };
}

export function assertPhase14MicrosoftIntegrationSettings(presence, required) {
  if (required && (!presence.clientIdPresent || !presence.clientSecretPresent)) {
    throw new Error("Phase 14 Microsoft OAuth client configuration is required for this fixture.");
  }
}

export function parsePhase14MicrosoftIntegrationConfig(contents) {
  let values;
  try {
    values = parseEnv(contents);
  } catch {
    throw new Error("The isolated Phase 14 Microsoft OAuth config is malformed.");
  }
  if (Object.keys(values).some((key) => !ALLOWED_KEYS.has(key))) {
    throw new Error(
      "The isolated Phase 14 Microsoft OAuth config may contain only the two integration client settings.",
    );
  }

  const clientId = values.MICROSOFT_INTEGRATION_CLIENT_ID ?? "";
  const clientSecret = values.MICROSOFT_INTEGRATION_CLIENT_SECRET ?? "";
  if (
    Boolean(clientId) !== Boolean(clientSecret) ||
    clientId.trim() !== clientId ||
    clientSecret.trim() !== clientSecret
  ) {
    throw new Error(
      "The isolated Phase 14 Microsoft OAuth config must contain both non-empty client settings.",
    );
  }
  return {
    clientId,
    clientSecret,
    clientIdPresent: Boolean(clientId),
    clientSecretPresent: Boolean(clientSecret),
  };
}

export async function readPhase14MicrosoftIntegrationConfig(path) {
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
    throw new Error("Unable to read the isolated Phase 14 Microsoft OAuth config.");
  }
  return { fileExists: true, ...parsePhase14MicrosoftIntegrationConfig(contents) };
}
