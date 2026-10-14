import {
  assertPhase14GoogleIntegrationSettings,
  googleIntegrationSettingPresence,
} from "./phase14-google-config.mjs";

const presence = googleIntegrationSettingPresence(process.env);

console.info(
  JSON.stringify({
    phase14ApiGoogleClientIdPresent: presence.clientIdPresent,
    phase14ApiGoogleClientSecretPresent: presence.clientSecretPresent,
  }),
);

assertPhase14GoogleIntegrationSettings(
  presence,
  process.env.ENOUGH_PHASE14_REQUIRE_GOOGLE_OAUTH_CONFIG === "1",
);
