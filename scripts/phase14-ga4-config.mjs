import { readFile } from "node:fs/promises";
import { isGtagSeedIdentity } from "./phase14-ga4-gtag-seed.mjs";

const keys = ["GA4_PROPERTY_ID", "GA4_STREAM_ID", "GA4_MEASUREMENT_ID", "GA4_API_SECRET"];
export const GA4_PROBE_NAME = "phase14_clean_mp_probe";
export const GA4_EVENT_MAP = { [GA4_PROBE_NAME]: "analytics.user_signup" };
export function ga4SettingPresence(values) {
  return {
    propertyIdPresent: Boolean(values.GA4_PROPERTY_ID),
    streamIdPresent: Boolean(values.GA4_STREAM_ID),
    measurementIdPresent: Boolean(values.GA4_MEASUREMENT_ID),
    apiSecretPresent: Boolean(values.GA4_API_SECRET),
  };
}
export function parsePhase14Ga4Config(contents) {
  const lines = contents.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const values = {};
  for (const line of lines) {
    const separator = line.indexOf("=");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (separator < 1 || !keys.includes(key))
      throw new Error("Unsupported or invalid local GA4 setting.");
    if (
      Object.hasOwn(values, key) ||
      !value ||
      /[\s'"`]/u.test(value) ||
      [...value].some(
        (character) =>
          character.charCodeAt(0) < 32 ||
          (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159),
      )
    )
      throw new Error("Incomplete or invalid local GA4 config.");
    values[key] = value;
  }
  if (lines.length !== keys.length) throw new Error("Incomplete or invalid local GA4 config.");
  if (
    !/^[1-9]\d{0,19}$/.test(values.GA4_PROPERTY_ID ?? "") ||
    !/^[1-9]\d{0,19}$/.test(values.GA4_STREAM_ID ?? "") ||
    values.GA4_PROPERTY_ID === values.GA4_STREAM_ID ||
    !/^G-[A-Z0-9]{5,30}$/.test(values.GA4_MEASUREMENT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{12,256}$/.test(values.GA4_API_SECRET ?? "")
  )
    throw new Error("Incomplete or invalid local GA4 config.");
  return {
    propertyId: values.GA4_PROPERTY_ID,
    streamId: values.GA4_STREAM_ID,
    measurementId: values.GA4_MEASUREMENT_ID,
    apiSecret: values.GA4_API_SECRET,
    ...ga4SettingPresence(values),
  };
}
export async function readPhase14Ga4Config(path) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { fileExists: false, ...ga4SettingPresence({}) };
    throw new Error("Unable to read local GA4 config.");
  }
  return { fileExists: true, ...parsePhase14Ga4Config(contents) };
}
export function ga4ReportRequest(realtime = false, eventName = GA4_PROBE_NAME) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(eventName))
    throw new Error("Invalid acceptance event name.");
  return {
    ...(!realtime ? { dateRanges: [{ startDate: "6daysAgo", endDate: "today" }] } : {}),
    dimensions: realtime ? [{ name: "eventName" }] : [{ name: "date" }, { name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        inListFilter: { values: [eventName], caseSensitive: true },
      },
    },
    limit: "500",
  };
}
export function ga4ProbePayload(identity) {
  if (!isGtagSeedIdentity(identity))
    throw new Error("A client/session received from the local gtag seed fixture is required.");
  return {
    client_id: identity.clientId,
    events: [
      {
        name: GA4_PROBE_NAME,
        params: { session_id: identity.sessionId, engagement_time_msec: 1 },
      },
    ],
  };
}
