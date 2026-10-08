export type HealthStatus = "ok" | "degraded";

export interface ServiceHealth {
  service: string;
  status: HealthStatus;
  timestamp: string;
}

export function healthResponse(service: string, status: HealthStatus = "ok"): ServiceHealth {
  return { service, status, timestamp: new Date().toISOString() };
}

export type {
  GrowthModeState,
  OfflinePolicyCacheState,
  TimestampedQueueItem,
} from "./client-runtime.ts";
export {
  appendBoundedEvent,
  DEFAULT_EVENT_QUEUE_LIMIT,
  DEFAULT_EVENT_RETENTION_MS,
  DEFAULT_GROWTH_MODE_MAX_DURATION_MS,
  DEFAULT_POLICY_CACHE_MAX_AGE_MS,
  isGrowthModeActive,
  isPolicyCacheStale,
  nextClientSequence,
  normalizeApiOrigin,
  pruneExpiredEvents,
} from "./client-runtime.ts";
export { isWithinQuietHours, nextAllowedNotificationTime } from "./notification-time.ts";
export type {
  PolicyDecision,
  PolicyEvaluationInput,
  PolicyOverride,
  PolicyOverrideAction,
  PolicyRule,
  PolicyRuleAction,
  PolicyRuleConditions,
  PolicyRuleSchedule,
} from "./policy-rules.ts";
export {
  evaluatePolicyRules,
  isValidPolicyTimezone,
  POLICY_OVERRIDE_ACTIONS,
  POLICY_RULE_ACTIONS,
} from "./policy-rules.ts";
export type { ProductStage, ProductStageGuidance } from "./product-stage.ts";
export {
  isLaunchedProductStage,
  LAUNCHED_PRODUCT_STAGES,
  PRODUCT_STAGE_GUIDANCE,
  PRODUCT_STAGE_LABELS,
  PRODUCT_STAGES,
} from "./product-stage.ts";
export type {
  ToolClassification,
  ToolClassificationEntry,
  ToolClassificationInput,
  ToolClassificationResolution,
  ToolKind,
} from "./tool-classification.ts";
export {
  normalizeToolKey,
  resolveToolClassification,
  TOOL_CLASSIFICATIONS,
  TOOL_KINDS,
  toolKeyMatches,
} from "./tool-classification.ts";
