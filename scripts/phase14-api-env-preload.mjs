import {
  assertPhase14GoogleIntegrationSettings,
  googleIntegrationSettingPresence,
} from "./phase14-google-config.mjs";
import {
  assertPhase14MicrosoftIntegrationSettings,
  microsoftIntegrationSettingPresence,
} from "./phase14-microsoft-config.mjs";

const googlePresence = googleIntegrationSettingPresence(process.env);
const microsoftPresence = microsoftIntegrationSettingPresence(process.env);

console.info(
  JSON.stringify({
    phase14ApiGoogleClientIdPresent: googlePresence.clientIdPresent,
    phase14ApiGoogleClientSecretPresent: googlePresence.clientSecretPresent,
    phase14ApiMicrosoftClientIdPresent: microsoftPresence.clientIdPresent,
    phase14ApiMicrosoftClientSecretPresent: microsoftPresence.clientSecretPresent,
  }),
);

assertPhase14GoogleIntegrationSettings(
  googlePresence,
  process.env.ENOUGH_PHASE14_REQUIRE_GOOGLE_OAUTH_CONFIG === "1",
);
assertPhase14MicrosoftIntegrationSettings(
  microsoftPresence,
  process.env.ENOUGH_PHASE14_REQUIRE_MICROSOFT_OAUTH_CONFIG === "1",
);
