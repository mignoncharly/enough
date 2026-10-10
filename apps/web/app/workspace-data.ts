import {
  POLICY_OVERRIDE_ACTIONS,
  POLICY_RULE_ACTIONS,
  type PolicyDecision,
  type PolicyOverride,
  type PolicyOverrideAction,
  type PolicyRule,
  type PolicyRuleAction,
  type PolicyRuleConditions,
  type PolicyRuleSchedule,
  PRODUCT_STAGE_LABELS,
  PRODUCT_STAGES,
  type ProductStage,
  TOOL_CLASSIFICATIONS,
  TOOL_KINDS,
  type ToolClassification,
  type ToolClassificationResolution,
  type ToolKind,
} from "@enough/shared";

export const productStages = PRODUCT_STAGES;
export const productStageLabels = PRODUCT_STAGE_LABELS;
export type { ProductStage };
export const toolClassifications = TOOL_CLASSIFICATIONS;
export const toolKinds = TOOL_KINDS;
export type { ToolClassification, ToolClassificationResolution, ToolKind };
export const policyRuleActions = POLICY_RULE_ACTIONS;
export const policyOverrideActions = POLICY_OVERRIDE_ACTIONS;
export type {
  PolicyDecision,
  PolicyOverride,
  PolicyOverrideAction,
  PolicyRule,
  PolicyRuleAction,
  PolicyRuleConditions,
  PolicyRuleSchedule,
};

export interface PolicyRuleRecord extends PolicyRule {
  productName: string | null;
  deviceName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyOverrideRecord extends PolicyOverride {
  productName: string | null;
  deviceName: string | null;
}

export interface AuthDeviceSummary {
  id: string;
  name: string;
  clientType: "web" | "desktop" | "extension";
  createdAt: string;
  lastSeenAt: string;
  revoked: boolean;
}

export interface PolicyRuleConfig {
  name: string;
  enabled: boolean;
  priority: number;
  action: PolicyRuleAction;
  productId: string | null;
  deviceId: string | null;
  conditions: PolicyRuleConditions;
  schedule: PolicyRuleSchedule | null;
}

export interface PolicyRuleVersion {
  version: number;
  snapshot: Record<string, unknown>;
  createdAt: string;
}

export interface ToolCatalogEntry {
  toolKind: ToolKind;
  toolKey: string;
  displayName: string;
  classification: ToolClassification;
}

export interface ToolMapping extends ToolCatalogEntry {
  id: string;
  productId: string | null;
  productName: string | null;
  contextKey: string;
  contextValue: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingAnswers {
  productDescription: string;
  targetCustomer: string;
  problemStatement: string;
  productStage: ProductStage;
  hasLaunched: boolean;
  userCount: number;
  payingUserCount: number;
  currentRevenue: string | null;
  revenueCurrency: string;
  nextGoal: string;
  buildTools: string[];
}

export interface OnboardingRecommendation {
  version: number;
  productStage: ProductStage;
  headline: string;
  firstAction: string;
  priorities: string[];
  signalsToNotice: string[];
  tasks: string[];
  recommendedRatio: { buildPercent: number; marketPercent: number };
  nextGoal: string;
  buildTools: string[];
  reviewPrompt: string;
}

export interface ProductGoal {
  id: string;
  goalType: string;
  title: string;
  description: string | null;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  targetValue: string | null;
  unit: string | null;
  isPrimary: boolean;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ProductMetric {
  id: string;
  metricKey: string;
  displayName: string;
  value: string;
  unit: string;
  recordedAt: string;
}

export interface ProductGuidance {
  productStage: ProductStage;
  productStageLabel: string;
  headline: string;
  buildPercent: number;
  marketPercent: number;
  priorities: string[];
  signals: string[];
  tasks: string[];
}

export interface ProductSummary {
  id: string;
  name: string;
  targetCustomer: string;
  problemStatement: string;
  productStage: ProductStage;
  productStageLabel: string;
  hasLaunched: boolean;
  userCount: number;
  payingUserCount: number;
  currentRevenue: string | null;
  revenueCurrency: string;
  createdAt: string;
  updatedAt: string;
  guidance: ProductGuidance;
}

export interface ProductStageHistoryItem {
  id: string;
  fromStage: ProductStage | null;
  fromStageLabel: string | null;
  toStage: ProductStage;
  toStageLabel: string;
  reason: string | null;
  changedAt: string;
}

export interface ProductDetail {
  product: ProductSummary;
  stageHistory: ProductStageHistoryItem[];
  goals: ProductGoal[];
  metrics: ProductMetric[];
}

export interface ProductReportDay {
  day: string;
  activityEvents: number;
  buildSeconds: number;
  growSeconds: number;
  marketSignals: number;
  signals: {
    outreach: number;
    replies: number;
    interviews: number;
    demos: number;
    feedbackCalls: number;
    salesCalls: number;
    onboardingCalls: number;
    retentionCalls: number;
    signups: number;
    activations: number;
    retained: number;
    payments: number;
  };
  payments: Array<{ currency: string; amountMinor: number; paymentCount: number }>;
  credits: { earned: number; spent: number; refunded: number; adjusted: number };
  tasksCompleted: number;
  tasksVerified: number;
}

export interface ProductReport {
  product: {
    id: string;
    name: string;
    productStage: ProductStage;
    productStageLabel: string;
    hasLaunched: boolean;
    userCount: number;
    payingUserCount: number;
    currentRevenue: string | null;
    revenueCurrency: string;
  };
  period: { days: number; startDate: string; endDate: string; timezone: "UTC" };
  stageGuidance: { buildPercent: number; marketPercent: number; priorities: string[] };
  days: ProductReportDay[];
  weeklyReview: {
    startDate: string;
    endDate: string;
    buildSeconds: number;
    growSeconds: number;
    buildShare: number | null;
    growShare: number | null;
    marketSignals: number;
    tasksCompleted: number;
    tasksVerified: number;
    tasksAwaitingReview: number;
    creditsEarned: number;
    creditsSpent: number;
    highestSignalTask: { title: string; signalStrength: number } | null;
    recommendation: string;
  };
  conversionFunnels: Array<{
    key: string;
    label: string;
    started: number;
    converted: number;
    conversionPercent: number | null;
  }>;
  stageHistory: ProductStageHistoryItem[];
  trustNotes: string[];
}

export interface WorkspaceNotification {
  id: string;
  type: "CREDIT_EARNED" | "STAGE_CHANGED" | "MARKET_SIGNAL" | "TASK_REVIEW";
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPreferences {
  webEnabled: boolean;
  desktopEnabled: boolean;
  emailEnabled: boolean;
  timezone: string;
  quietHours: { start: string; end: string } | null;
}

export interface GrowthTaskTemplate {
  id: string;
  productStage: ProductStage;
  productStageLabel: string;
  title: string;
  priority: number;
  signalStrength: number;
  estimatedMinutes: number;
  rewardCredits: number;
}

export interface GrowthTask {
  id: string;
  productId: string;
  templateId: string | null;
  seriesId: string;
  sequenceNumber: number;
  title: string;
  description: string | null;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  priority: number;
  signalStrength: number;
  estimatedMinutes: number;
  rewardCredits: number;
  recurrenceDays: number | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  verificationStatus: CompletionVerificationStatus | null;
}

export type CompletionVerificationStatus =
  | "SELF_REPORTED"
  | "AWAITING_EVIDENCE"
  | "AWAITING_REVIEW"
  | "VERIFIED"
  | "AUTOMATICALLY_VERIFIED"
  | "REJECTED";
export type TaskEvidenceType =
  | "SELF_REPORT"
  | "NOTE"
  | "URL"
  | "UPLOAD"
  | "SCREENSHOT"
  | "INTEGRATION";
export type TaskEvidenceStatus = "PENDING" | "VERIFIED" | "REJECTED";

export interface TaskEvidenceItem {
  id: string;
  completionId: string;
  taskId: string;
  productId: string;
  evidenceType: TaskEvidenceType;
  title: string;
  note: string | null;
  url: string | null;
  integrationProvider: string | null;
  integrationReference: string | null;
  provenance: "USER_SUBMITTED" | "SERVER_VERIFIED";
  fileName: string | null;
  contentType: string | null;
  fileSize: number | null;
  fileSha256: string | null;
  contentUrl: string | null;
  verificationStatus: TaskEvidenceStatus;
  verificationMethod: "MANUAL" | "AUTOMATIC";
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrivacyConsent {
  purpose: "ACTIVITY_COLLECTION" | "AI_PROVIDER_PROCESSING";
  enabled: boolean;
  policy_version?: string;
  revision?: string;
  source: "web" | "desktop" | "extension" | null;
  granted_at: string | null;
  revoked_at: string | null;
  updated_at?: string;
}

export interface PrivacyDashboardData {
  account: { email: string; emailVerified: boolean; createdAt: string; hasPassword: boolean };
  preferences: {
    activity_retention_days: number;
    notification_retention_days: number;
    audit_retention_days: number;
    updated_at: string;
  };
  retentionOptions: number[];
  consents: PrivacyConsent[];
  identities: Array<{ provider: string; created_at: string }>;
  devices: Array<{
    id: string;
    name: string;
    client_type: string;
    created_at: string;
    last_seen_at: string;
    revoked_at: string | null;
  }>;
  collectedActivity: Array<{
    id: string;
    product_id: string;
    product_name: string;
    device_id: string | null;
    device_name: string | null;
    event_type: string;
    effective_at: string;
    received_at: string;
    attributes: Record<string, unknown>;
  }>;
  evidence: { itemCount: number; liveCount: number; fileBytes: number };
  auditHistory: Array<{
    id: string;
    event_type: string;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }>;
}

export interface TaskEvidenceCompletion {
  id: string;
  taskId: string;
  productId: string;
  taskTitle: string;
  taskStatus: string;
  verificationStatus: CompletionVerificationStatus;
  rewardCredits: number;
  creditTransactionId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  completedAt: string;
  evidence: TaskEvidenceItem[];
}

export interface TaskEvidenceWorkspace {
  productId: string;
  completions: TaskEvidenceCompletion[];
}

export interface GrowthTaskWorkspace {
  productId: string;
  productStage: ProductStage;
  productStageLabel: string;
  templates: GrowthTaskTemplate[];
  tasks: GrowthTask[];
}

export type AiCapability =
  | "ONBOARDING_ANALYSIS"
  | "TASK_GENERATION"
  | "SCOPE_CHALLENGE"
  | "WEEKLY_DIAGNOSIS"
  | "NEXT_ACTION"
  | "OVERBUILDING_EXPLANATION"
  | "EVIDENCE_CLASSIFICATION";

export interface AiAdvice {
  headline: string;
  diagnosis: string;
  nextAction: string;
  rationale: string;
  scopeChallenge: string;
  overbuildingExplanation: string;
  tasks: Array<{
    title: string;
    description: string;
    priority: number;
    signalStrength: number;
    estimatedMinutes: number;
  }>;
  evidenceClassification: {
    category:
      | "CUSTOMER_FEEDBACK"
      | "CUSTOMER_COMMITMENT"
      | "USAGE_OR_TRACTION"
      | "REVENUE"
      | "BUILD_PROGRESS"
      | "OTHER"
      | "UNCLEAR";
    confidence: "LOW" | "MEDIUM" | "HIGH";
    rationale: string;
    missingInformation: string[];
  };
  caveat: string;
}

export interface AiCoachResult {
  source: "OPENAI" | "STAGE_GUIDANCE";
  advice: AiAdvice;
}

export interface AiProviderStatus {
  providerConfigured: boolean;
  providerConsentEnabled: boolean;
  model: string | null;
}

export interface OnboardingResult {
  completed: boolean;
  productId: string | null;
  completedAt: string | null;
  answers: OnboardingAnswers | null;
  recommendation: OnboardingRecommendation | null;
}

export interface CreditAccount {
  id: string;
  productId: string | null;
  availableBalance: number;
  reservedBalance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreditTransaction {
  id: string;
  action: string;
  amount: number;
  availableDelta: number;
  reservedDelta: number;
  balanceAfterAvailable: number;
  balanceAfterReserved: number;
  idempotencyKey: string;
  reservationId: string | null;
  relatedTransactionId: string | null;
  refundedAmount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreditReservation {
  id: string;
  status: "ACTIVE" | "RELEASED" | "SPENT" | "EXPIRED";
  amount: number;
  remainingAmount: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditWorkspace {
  account: CreditAccount;
  transactions: CreditTransaction[];
  reservations: CreditReservation[];
}

export interface ActivityEventRecord {
  id: string;
  productId: string;
  productName: string;
  deviceId: string | null;
  eventId: string;
  eventType: string;
  eventVersion: number;
  clientSequence: number;
  occurredAt: string;
  effectiveAt: string;
  receivedAt: string;
  clockAdjusted: boolean;
  attributes: Record<string, string | number | boolean | null>;
  batchId: string;
}

export interface ActivityEventPage {
  events: ActivityEventRecord[];
  nextCursor: { before: string; beforeId: string } | null;
}

export interface AuthSessionSummary {
  id: string;
  deviceId: string;
  deviceName: string;
  clientType: "web" | "desktop" | "extension";
  authMethod: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revoked: boolean;
  current: boolean;
}

export interface BillingPlan {
  key: "monthly" | "annual";
  label: string;
  available: boolean;
  amountMinor?: number | null;
  currency?: string;
  interval?: "month" | "year";
  trialDays?: number;
  automaticTax?: boolean;
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  status: string | null;
  currency: string;
  amountDueMinor: number;
  amountPaidMinor: number;
  taxMinor: number;
  dueAt: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  lastPaymentError: string | null;
  createdAt: string;
}

export interface BillingData {
  configured: boolean;
  automaticTax: boolean;
  trialDays: number;
  graceDays: number;
  plans: BillingPlan[];
  subscription: null | {
    planKey: "monthly" | "annual";
    status: string;
    currency: string;
    interval: string;
    amountMinor: number | null;
    trialStart: string | null;
    trialEnd: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    cancelAt: string | null;
    canceledAt: string | null;
    graceUntil: string | null;
    latestInvoiceId: string | null;
    updatedAt: string;
  };
  entitlements: {
    hasPaidAccess: boolean;
    status: "ACTIVE" | "GRACE" | "INACTIVE";
    expiresAt: string | null;
  };
  canManage: boolean;
  invoices: BillingInvoice[];
}

function readCsrfCookie(): string {
  const cookies = document.cookie.split(";").map((value) => value.trim());
  const cookie = cookies.find(
    (value) => value.startsWith("enough_csrf=") || value.startsWith("__Host-enough_csrf="),
  );
  return cookie ? decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)) : "";
}

export async function loadOnboarding(): Promise<OnboardingResult> {
  const response = await fetch("/api/onboarding", { credentials: "include", cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & OnboardingResult;
  if (!response.ok) {
    const error = new Error(payload.error ?? "Your workspace could not be loaded.") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function saveOnboarding(answers: OnboardingAnswers): Promise<OnboardingResult> {
  const csrfToken = readCsrfCookie();
  if (!csrfToken) throw new Error("Your secure session has expired. Sign in again and retry.");
  const response = await fetch("/api/onboarding", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(answers),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & OnboardingResult;
  if (!response.ok) throw new Error(payload.error ?? "Your answers could not be saved.");
  return payload;
}

export async function loadProducts(): Promise<ProductSummary[]> {
  const response = await fetch("/api/products", { credentials: "include", cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    products?: ProductSummary[];
  };
  if (!response.ok) {
    const error = new Error(payload.error ?? "Your products could not be loaded.") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return payload.products ?? [];
}

export async function loadProduct(productId: string): Promise<ProductDetail> {
  const response = await fetch(`/api/products/${productId}`, {
    credentials: "include",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & ProductDetail;
  if (!response.ok) {
    const error = new Error(payload.error ?? "The product could not be loaded.") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function loadProductReport(productId: string, days = 30): Promise<ProductReport> {
  const query = new URLSearchParams({ productId, days: String(days) });
  return loadWorkspaceJson(`/api/reports?${query}`, "The product report could not be loaded.");
}

export async function loadNotifications(): Promise<WorkspaceNotification[]> {
  const result = await loadWorkspaceJson<{ notifications: WorkspaceNotification[] }>(
    "/api/notifications?channel=WEB",
    "Notifications could not be loaded.",
  );
  return result.notifications ?? [];
}

export function loadBilling(): Promise<BillingData> {
  return loadWorkspaceJson("/api/billing", "Billing information could not be loaded.");
}

export function startBillingCheckout(
  planKey: "monthly" | "annual",
  idempotencyKey: string,
): Promise<{ checkoutUrl: string }> {
  return postProductAction("/api/billing/checkout", { planKey, idempotencyKey });
}

export function openBillingPortal(): Promise<{ portalUrl: string }> {
  return postProductAction("/api/billing/portal", {});
}

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  const result = await loadWorkspaceJson<{ preferences: NotificationPreferences }>(
    "/api/notification-preferences",
    "Notification preferences could not be loaded.",
  );
  return result.preferences;
}

export function saveNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<{ preferences: NotificationPreferences }> {
  return postProductAction("/api/notification-preferences", preferences, "PATCH");
}

export function markNotificationRead(notificationId: string): Promise<{ read: boolean }> {
  return postProductAction(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {});
}

export function markAllNotificationsRead(): Promise<{ markedRead: number }> {
  return postProductAction("/api/notifications/read-all", {});
}

async function postProductAction<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  const csrfToken = readCsrfCookie();
  if (!csrfToken) throw new Error("Your secure session has expired. Sign in again and retry.");
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    const error = new Error(
      payload.error ?? "The workspace update could not be saved.",
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function createProduct(body: {
  name: string;
  targetCustomer: string;
  problemStatement: string;
  productStage: ProductStage;
  initialGoal: string;
}): Promise<{ product: ProductSummary }> {
  return postProductAction("/api/products", body);
}

export function changeProductStage(
  productId: string,
  productStage: ProductStage,
  reason: string,
  expectedStage?: ProductStage,
): Promise<{ changed: boolean }> {
  return postProductAction(`/api/products/${productId}/stage`, {
    productStage,
    reason,
    expectedStage,
  });
}

export function createProductGoal(
  productId: string,
  title: string,
  isPrimary = false,
): Promise<{ goal: ProductGoal }> {
  return postProductAction(`/api/products/${productId}/goals`, {
    title,
    goalType: "CUSTOM",
    isPrimary,
  });
}

export function updateProductGoal(
  productId: string,
  goalId: string,
  status: ProductGoal["status"],
  expectedStatus?: ProductGoal["status"],
): Promise<{ goal: ProductGoal }> {
  return postProductAction(
    `/api/products/${productId}/goals/${goalId}`,
    { status, expectedStatus },
    "PATCH",
  );
}

export async function loadGrowthTasks(productId: string): Promise<GrowthTaskWorkspace> {
  const query = new URLSearchParams({ productId });
  return loadWorkspaceJson(`/api/tasks?${query}`, "Growth tasks could not be loaded.");
}

export function createGrowthTask(body: {
  productId: string;
  templateId?: string;
  title?: string;
  description?: string | null;
  priority?: number;
  signalStrength?: number;
  estimatedMinutes?: number;
  rewardCredits?: number;
  recurrenceDays?: number | null;
  dueAt?: string | null;
}): Promise<{ task: GrowthTask }> {
  return postProductAction("/api/tasks", body);
}

export async function loadAiProviderStatus(): Promise<AiProviderStatus> {
  return loadWorkspaceJson("/api/ai/status", "AI provider status could not be loaded.");
}

export function requestAiAdvice(body: {
  productId: string;
  capability: AiCapability;
  taskId?: string;
  evidenceId?: string;
}): Promise<AiCoachResult> {
  return postProductAction("/api/ai/coach", body);
}

export function updateGrowthTask(
  taskId: string,
  status: "CANCELLED",
): Promise<{ task: GrowthTask }> {
  return postProductAction(`/api/tasks/${taskId}`, { status }, "PATCH");
}

export function completeGrowthTask(taskId: string): Promise<{
  task: GrowthTask;
  completion: {
    id: string;
    verificationStatus: CompletionVerificationStatus;
    rewardCredits: number;
    creditTransactionId: string | null;
    completedAt: string;
  } | null;
  nextTask: GrowthTask | null;
  replayed: boolean;
}> {
  return postProductAction(`/api/tasks/${taskId}/complete`, {});
}

export async function loadTaskEvidence(productId: string): Promise<TaskEvidenceWorkspace> {
  const query = new URLSearchParams({ productId });
  return loadWorkspaceJson(`/api/evidence?${query}`, "Task evidence could not be loaded.");
}

export interface IntegrationEventSummary {
  id: string;
  eventId: string;
  eventType: string;
  verificationStatus: "AUTHENTICATED" | "REJECTED";
  occurredAt: string;
  receivedAt: string;
  completionId: string | null;
  evidenceId: string | null;
  amountMinor: number | null;
  currency: string | null;
}

export interface IntegrationAccountSummary {
  id: string;
  productId: string;
  provider: string;
  displayName: string;
  status: "ACTIVE" | "ERROR" | "REVOKED";
  health: "CONNECTED" | "IDLE" | "ERROR" | "REVOKED";
  lastReceivedAt: string | null;
  createdAt: string;
  recentEvents: IntegrationEventSummary[];
}

export interface IntegrationCatalogItem {
  provider: string;
  name: string;
  mode: string;
  available: boolean;
  eventTypes: string[];
}

export interface IntegrationWorkspace {
  productId: string;
  catalog: IntegrationCatalogItem[];
  accounts: IntegrationAccountSummary[];
}

export async function loadIntegrations(productId: string): Promise<IntegrationWorkspace> {
  const query = new URLSearchParams({ productId });
  return loadWorkspaceJson(`/api/integrations?${query}`, "Integrations could not be loaded.");
}

export function createIntegration(body: {
  productId: string;
  provider: "WEBHOOK" | "PUBLIC_API";
  displayName: string;
}): Promise<{
  account: IntegrationAccountSummary;
  credentials: {
    apiKey: string;
    signingSecret: string;
    contentType: string;
    signatureFormat: string;
  };
}> {
  return postProductAction("/api/integrations", body);
}

export function revokeIntegration(
  integrationId: string,
): Promise<{ integrationId: string; status: "REVOKED" }> {
  return postProductAction(`/api/integrations/${integrationId}/revoke`, {});
}

export function createTaskEvidence(body: {
  completionId: string;
  evidenceType: TaskEvidenceType;
  title?: string;
  note?: string;
  url?: string;
  integrationProvider?: string;
  integrationReference?: string;
  fileName?: string;
  contentType?: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  fileContentBase64?: string;
}): Promise<{ evidence: TaskEvidenceItem }> {
  return postProductAction("/api/evidence", body);
}

export function decideTaskEvidence(
  evidenceId: string,
  decision: "VERIFIED" | "REJECTED",
  reason?: string,
): Promise<{
  evidenceId: string;
  verificationStatus: TaskEvidenceStatus;
  completionStatus: CompletionVerificationStatus;
  creditTransactionId: string | null;
  rewardIssued: boolean;
  replayed: boolean;
}> {
  return postProductAction(`/api/evidence/${evidenceId}/decision`, {
    decision,
    ...(reason ? { reason } : {}),
  });
}

export async function deleteTaskEvidence(evidenceId: string): Promise<void> {
  await postProductAction(`/api/evidence/${evidenceId}`, {}, "DELETE");
}

export function loadPrivacyDashboard(): Promise<PrivacyDashboardData> {
  return loadWorkspaceJson("/api/privacy", "Privacy information could not be loaded.");
}

export function savePrivacyPreferences(preferences: {
  activityRetentionDays: number;
  notificationRetentionDays: number;
  auditRetentionDays: number;
}): Promise<{ preferences: PrivacyDashboardData["preferences"]; workerIntervalHours: number }> {
  return postProductAction("/api/privacy/settings", preferences, "PATCH");
}

export function setPrivacyConsent(
  purpose: PrivacyConsent["purpose"],
  enabled: boolean,
): Promise<{ consent: PrivacyConsent }> {
  return postProductAction(`/api/privacy/consents/${purpose}`, { enabled }, "PUT");
}

export function deleteActivityHistory(): Promise<{ deleted: number }> {
  return postProductAction("/api/privacy/activity", { confirmation: "DELETE" }, "DELETE");
}

export function disconnectOAuthIdentity(
  provider: string,
): Promise<{ provider: string; disconnected: boolean }> {
  return postProductAction(`/api/auth/identities/${encodeURIComponent(provider)}`, {}, "DELETE");
}

export function deleteCurrentAccount(body: {
  confirmationEmail: string;
  password?: string;
}): Promise<void> {
  return postProductAction<void>("/api/auth/account", body, "DELETE");
}

export function recordProductMetric(
  productId: string,
  body: {
    metricKey: string;
    displayName: string;
    value: string;
    unit: string;
    expectedValue?: string | null;
    expectedCurrency?: string;
  },
): Promise<{ metric: ProductMetric }> {
  return postProductAction(`/api/products/${productId}/metrics`, body);
}

export async function loadToolCatalog(search = "", kind = ""): Promise<ToolCatalogEntry[]> {
  const query = new URLSearchParams();
  if (search) query.set("q", search);
  if (kind) query.set("kind", kind);
  const queryString = query.toString();
  const response = await fetch(
    `/api/classification/catalog${queryString ? `?${queryString}` : ""}`,
    { credentials: "include", cache: "no-store" },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    catalog?: ToolCatalogEntry[];
  };
  if (!response.ok) {
    const error = new Error(payload.error ?? "The tool catalog could not be loaded.") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return payload.catalog ?? [];
}

export async function loadToolMappings(): Promise<ToolMapping[]> {
  const response = await fetch("/api/classification/mappings", {
    credentials: "include",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    mappings?: ToolMapping[];
  };
  if (!response.ok) {
    const error = new Error(payload.error ?? "Your tool mappings could not be loaded.") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return payload.mappings ?? [];
}

export function saveToolMapping(
  body: {
    toolKind: ToolKind;
    toolKey: string;
    displayName: string;
    classification: ToolClassification;
    productId: string | null;
    contextKey: string;
    contextValue: string;
  },
  mappingId?: string,
): Promise<{ mapping: ToolMapping }> {
  return postProductAction(
    mappingId ? `/api/classification/mappings/${mappingId}` : "/api/classification/mappings",
    body,
    mappingId ? "PATCH" : "POST",
  );
}

export async function deleteToolMapping(mappingId: string): Promise<void> {
  await postProductAction(`/api/classification/mappings/${mappingId}`, {}, "DELETE");
}

export function resolveTool(body: {
  toolKind: ToolKind;
  toolKey: string;
  productId: string | null;
  contextKey: string;
  contextValue: string;
}): Promise<{ resolution: ToolClassificationResolution }> {
  return postProductAction("/api/classification/resolve", body);
}

async function loadWorkspaceJson<T>(path: string, fallback: string): Promise<T> {
  const response = await fetch(path, { credentials: "include", cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    const error = new Error(payload.error ?? fallback) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function loadPolicyRules(): Promise<{
  rules: PolicyRuleRecord[];
  overrides: PolicyOverrideRecord[];
}> {
  return loadWorkspaceJson("/api/rules", "Rules could not be loaded.");
}

export async function loadAuthDevices(): Promise<AuthDeviceSummary[]> {
  const payload = await loadWorkspaceJson<{ devices: AuthDeviceSummary[] }>(
    "/api/auth/devices",
    "Devices could not be loaded.",
  );
  return payload.devices;
}

export async function loadAuthSessions(): Promise<AuthSessionSummary[]> {
  const payload = await loadWorkspaceJson<{ sessions: AuthSessionSummary[] }>(
    "/api/auth/sessions",
    "Sessions could not be loaded.",
  );
  return payload.sessions;
}

export async function revokeAuthDevice(deviceId: string): Promise<void> {
  await postProductAction(`/api/auth/devices/${deviceId}`, {}, "DELETE");
}

export async function revokeAuthSession(sessionId: string): Promise<void> {
  await postProductAction(`/api/auth/sessions/${sessionId}`, {}, "DELETE");
}

export function savePolicyRule(
  body: PolicyRuleConfig,
  ruleId?: string,
  expectedVersion?: number,
): Promise<{ rule: PolicyRuleRecord }> {
  const payload = expectedVersion === undefined ? body : { ...body, expectedVersion };
  return postProductAction(
    ruleId ? `/api/rules/${ruleId}` : "/api/rules",
    payload,
    ruleId ? "PATCH" : "POST",
  );
}

export async function archivePolicyRule(ruleId: string, expectedVersion: number): Promise<void> {
  await postProductAction(`/api/rules/${ruleId}`, { expectedVersion }, "DELETE");
}

export async function loadPolicyRuleVersions(ruleId: string): Promise<PolicyRuleVersion[]> {
  const payload = await loadWorkspaceJson<{ versions: PolicyRuleVersion[] }>(
    `/api/rules/${ruleId}/versions`,
    "Rule history could not be loaded.",
  );
  return payload.versions;
}

export function createPolicyOverride(body: {
  productId: string | null;
  deviceId: string | null;
  toolKind: ToolKind;
  toolKey: string;
  action: PolicyOverrideAction;
  reason: string;
  startsAt?: string;
  expiresAt: string;
}): Promise<{ override: PolicyOverrideRecord }> {
  return postProductAction("/api/rules/overrides", body);
}

export async function revokePolicyOverride(overrideId: string): Promise<void> {
  await postProductAction(`/api/rules/overrides/${overrideId}`, {}, "DELETE");
}

export function evaluatePolicy(body: {
  productId: string | null;
  deviceId: string | null;
  toolKind: ToolKind;
  toolKey: string;
  contextKey?: string;
  contextValue?: string;
}): Promise<{ decision: PolicyDecision; classification: ToolClassificationResolution }> {
  return postProductAction("/api/rules/evaluate", body);
}

export async function loadCredits(productId?: string): Promise<CreditWorkspace> {
  const query = productId ? `?${new URLSearchParams({ productId })}` : "";
  return loadWorkspaceJson(`/api/credits${query}`, "Credits could not be loaded.");
}

export function postCreditAction<T>(path: string, body: unknown): Promise<T> {
  return postProductAction(path, body);
}

export function createCreditIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function loadActivityEvents(
  options: {
    productId?: string;
    since?: string;
    before?: string;
    beforeId?: string;
    limit?: number;
  } = {},
): Promise<ActivityEventPage> {
  const query = new URLSearchParams();
  if (options.productId) query.set("productId", options.productId);
  if (options.since) query.set("since", options.since);
  if (options.before) query.set("before", options.before);
  if (options.beforeId) query.set("beforeId", options.beforeId);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  const serialized = query.toString();
  const suffix = serialized ? `?${serialized}` : "";
  return loadWorkspaceJson<ActivityEventPage>(
    `/api/activity/events${suffix}`,
    "Activity could not be loaded.",
  );
}
