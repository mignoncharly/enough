import {
  normalizeToolKey,
  type ToolClassification,
  type ToolKind,
  toolKeyMatches,
} from "./tool-classification.ts";

export const POLICY_RULE_ACTIONS = ["ALLOW", "BLOCK", "WARN", "REQUIRE_OVERRIDE"] as const;
export type PolicyRuleAction = (typeof POLICY_RULE_ACTIONS)[number];
export const POLICY_OVERRIDE_ACTIONS = ["ALLOW", "BLOCK"] as const;
export type PolicyOverrideAction = (typeof POLICY_OVERRIDE_ACTIONS)[number];

export interface PolicyRuleConditions {
  classifications?: ToolClassification[];
  toolKind?: ToolKind;
  toolKeys?: string[];
  contextKey?: string;
  contextValue?: string;
}

export interface PolicyRuleSchedule {
  timezone: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface PolicyRule {
  id: string;
  version: number;
  name: string;
  enabled: boolean;
  priority: number;
  productId: string | null;
  deviceId: string | null;
  action: PolicyRuleAction;
  conditions: PolicyRuleConditions;
  schedule: PolicyRuleSchedule | null;
  archivedAt?: string | null;
}

export interface PolicyOverride {
  id: string;
  productId: string | null;
  deviceId: string | null;
  toolKind: ToolKind;
  toolKey: string;
  action: PolicyOverrideAction;
  reason: string;
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string | null;
}

export interface PolicyEvaluationInput {
  toolKind: ToolKind;
  toolKey: string;
  classification: ToolClassification;
  productId: string | null;
  deviceId: string | null;
  contextKey?: string;
  contextValue?: string;
  evaluatedAt: string;
}

export interface PolicyDecision {
  action: PolicyRuleAction | PolicyOverrideAction;
  allowed: boolean;
  source: "OVERRIDE" | "RULE" | "DEFAULT";
  evaluatedAt: string;
  matchedRuleId: string | null;
  matchedRuleVersion: number | null;
  matchedOverrideId: string | null;
  reason: string;
}

const ACTION_RESTRICTIVENESS: Record<PolicyRuleAction, number> = {
  BLOCK: 4,
  REQUIRE_OVERRIDE: 3,
  WARN: 2,
  ALLOW: 1,
};

export function isValidPolicyTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function parsedTime(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function localClock(instant: Date, timezone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value ?? "";
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: days[value("weekday")] ?? 0,
    minute: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function scheduleMatches(schedule: PolicyRuleSchedule | null, instant: Date): boolean {
  if (!schedule) return true;
  const millis = instant.getTime();
  if (schedule.startsAt && millis < Date.parse(schedule.startsAt)) return false;
  if (schedule.endsAt && millis >= Date.parse(schedule.endsAt)) return false;
  const { day, minute } = localClock(instant, schedule.timezone);
  const start = parsedTime(schedule.startTime);
  const end = parsedTime(schedule.endTime);
  const days = new Set(schedule.daysOfWeek);
  if (start === end) return days.has(day);
  if (start < end) return days.has(day) && minute >= start && minute < end;
  if (minute >= start) return days.has(day);
  if (minute < end) return days.has((day + 6) % 7);
  return false;
}

function ruleMatches(
  rule: PolicyRule,
  input: PolicyEvaluationInput,
  inputKey: string,
  instant: Date,
): boolean {
  if (!rule.enabled || rule.archivedAt) return false;
  if (rule.productId && rule.productId !== input.productId) return false;
  if (rule.deviceId && rule.deviceId !== input.deviceId) return false;
  if (!scheduleMatches(rule.schedule, instant)) return false;
  const conditions = rule.conditions;
  if (
    conditions.classifications?.length &&
    !conditions.classifications.includes(input.classification)
  )
    return false;
  if (conditions.toolKind && conditions.toolKind !== input.toolKind) return false;
  if (conditions.toolKeys?.length) {
    if (
      conditions.toolKind !== input.toolKind ||
      !conditions.toolKeys.some((key) => toolKeyMatches(input.toolKind, key, inputKey))
    )
      return false;
  }
  const contextKey = input.contextKey?.trim().toLocaleLowerCase("en-US") ?? "";
  const contextValue = input.contextValue?.trim().toLocaleLowerCase("en-US") ?? "";
  if (conditions.contextKey && contextKey !== conditions.contextKey.toLocaleLowerCase("en-US"))
    return false;
  if (
    conditions.contextValue &&
    contextValue !== conditions.contextValue.toLocaleLowerCase("en-US")
  )
    return false;
  return true;
}

function ruleSpecificity(rule: PolicyRule, inputKey: string): number {
  let score = Number(Boolean(rule.productId)) + Number(Boolean(rule.deviceId));
  const conditions = rule.conditions;
  if (conditions.classifications?.length) score += 1;
  if (conditions.contextKey || conditions.contextValue) score += 1;
  if (conditions.toolKeys?.length) {
    const bestKey = conditions.toolKeys
      .filter((key) => toolKeyMatches(conditions.toolKind ?? "APPLICATION", key, inputKey))
      .sort(
        (a, b) => Number(a.startsWith("*.")) - Number(b.startsWith("*.")) || b.length - a.length,
      )[0];
    if (bestKey) score += bestKey.startsWith("*.") ? 1 : 2;
  }
  return score;
}

function overrideMatches(
  override: PolicyOverride,
  input: PolicyEvaluationInput,
  inputKey: string,
  instant: Date,
): boolean {
  const millis = instant.getTime();
  return (
    !override.revokedAt &&
    millis >= Date.parse(override.startsAt) &&
    millis < Date.parse(override.expiresAt) &&
    (!override.productId || override.productId === input.productId) &&
    (!override.deviceId || override.deviceId === input.deviceId) &&
    override.toolKind === input.toolKind &&
    toolKeyMatches(input.toolKind, override.toolKey, inputKey)
  );
}

function overrideSpecificity(override: PolicyOverride): number {
  return (
    Number(Boolean(override.productId)) +
    Number(Boolean(override.deviceId)) +
    (override.toolKey.startsWith("*.") ? 0 : 1)
  );
}

function compareId(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

export function evaluatePolicyRules(
  input: PolicyEvaluationInput,
  rules: readonly PolicyRule[],
  overrides: readonly PolicyOverride[],
): PolicyDecision {
  const evaluatedMillis = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedMillis))
    throw new Error("Evaluation time must be a valid timestamp.");
  const evaluatedAt = new Date(evaluatedMillis).toISOString();
  const instant = new Date(evaluatedMillis);
  const toolKey = normalizeToolKey(input.toolKind, input.toolKey);

  const matchingOverrides = overrides.filter((override) =>
    overrideMatches(override, input, toolKey, instant),
  );
  matchingOverrides.sort(
    (a, b) =>
      overrideSpecificity(b) - overrideSpecificity(a) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      Number(b.action === "BLOCK") - Number(a.action === "BLOCK") ||
      compareId(a.id, b.id),
  );
  const override = matchingOverrides[0];
  if (override) {
    return {
      action: override.action,
      allowed: override.action === "ALLOW",
      source: "OVERRIDE",
      evaluatedAt,
      matchedRuleId: null,
      matchedRuleVersion: null,
      matchedOverrideId: override.id,
      reason: override.reason,
    };
  }

  const matchingRules = rules.filter((rule) => ruleMatches(rule, input, toolKey, instant));
  matchingRules.sort(
    (a, b) =>
      b.priority - a.priority ||
      ruleSpecificity(b, toolKey) - ruleSpecificity(a, toolKey) ||
      ACTION_RESTRICTIVENESS[b.action] - ACTION_RESTRICTIVENESS[a.action] ||
      compareId(a.id, b.id),
  );
  const rule = matchingRules[0];
  if (!rule) {
    return {
      action: "ALLOW",
      allowed: true,
      source: "DEFAULT",
      evaluatedAt,
      matchedRuleId: null,
      matchedRuleVersion: null,
      matchedOverrideId: null,
      reason: "No active rule matched.",
    };
  }
  return {
    action: rule.action,
    allowed: rule.action === "ALLOW" || rule.action === "WARN",
    source: "RULE",
    evaluatedAt,
    matchedRuleId: rule.id,
    matchedRuleVersion: rule.version,
    matchedOverrideId: null,
    reason: `Matched rule: ${rule.name}`,
  };
}
