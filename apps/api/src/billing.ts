import { checkRateLimit } from "@enough/auth";
import { env } from "@enough/config";
import { type DbClient, pool } from "@enough/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "./api-auth.js";
import { stripeSignatureMatches } from "./billing-webhook.js";

type JsonRecord = Record<string, unknown>;
type PlanKey = "monthly" | "annual";

const planConfig: Record<
  PlanKey,
  { priceId: string | undefined; label: string; interval: "month" | "year" }
> = {
  monthly: { priceId: env.STRIPE_PRICE_MONTHLY, label: "Monthly", interval: "month" },
  annual: { priceId: env.STRIPE_PRICE_ANNUAL, label: "Annual", interval: "year" },
};

const checkoutSchema = z
  .object({
    planKey: z.enum(["monthly", "annual"]),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function idValue(value: unknown): string | null {
  return typeof value === "string" ? value : isRecord(value) ? stringValue(value.id) : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateFromUnix(value: unknown): Date | null {
  const seconds = numberValue(value);
  return seconds === null ? null : new Date(seconds * 1000);
}

function currencyCode(value: unknown): string {
  return typeof value === "string" && /^[a-z]{3}$/.test(value) ? value : "usd";
}

function stripeCredentialsReady(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRETS);
}

function stripeReady(): boolean {
  return stripeCredentialsReady() && Boolean(env.STRIPE_PRICE_MONTHLY || env.STRIPE_PRICE_ANNUAL);
}

async function stripeRequest(
  path: string,
  method: "GET" | "POST",
  fields?: URLSearchParams,
  idempotencyKey?: string,
): Promise<JsonRecord> {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Billing is not configured.");
  const headers: Record<string, string> = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (fields) headers["content-type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers,
    ...(fields ? { body: fields } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(result)) {
    const message =
      isRecord(result) && isRecord(result.error) && typeof result.error.message === "string"
        ? result.error.message.slice(0, 300)
        : "Stripe could not complete the billing request.";
    throw new Error(message);
  }
  return result;
}

function addField(
  fields: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined,
): void {
  if (value !== null && value !== undefined) fields.set(key, String(value));
}

async function retrievePrice(priceId: string): Promise<JsonRecord> {
  return stripeRequest(`/prices/${encodeURIComponent(priceId)}`, "GET");
}

async function publicPlan(key: PlanKey) {
  const config = planConfig[key];
  if (!config.priceId || !stripeReady()) return { key, label: config.label, available: false };
  try {
    const price = await retrievePrice(config.priceId);
    const recurring = isRecord(price.recurring) ? price.recurring : null;
    const correctInterval = recurring?.interval === config.interval;
    return {
      key,
      label: config.label,
      available: price.active === true && correctInterval,
      amountMinor: numberValue(price.unit_amount),
      currency: currencyCode(price.currency),
      interval: config.interval,
      trialDays: env.STRIPE_TRIAL_DAYS,
      automaticTax: env.STRIPE_AUTOMATIC_TAX,
    };
  } catch {
    return { key, label: config.label, available: false };
  }
}

function invoiceResponse(row: {
  stripe_invoice_id: string;
  invoice_number: string | null;
  status: string | null;
  currency: string;
  amount_due_minor: string;
  amount_paid_minor: string;
  tax_minor: string;
  due_at: Date | null;
  paid_at: Date | null;
  hosted_invoice_url: string | null;
  last_payment_error: string | null;
  stripe_created_at: Date;
}) {
  return {
    id: row.stripe_invoice_id,
    number: row.invoice_number,
    status: row.status,
    currency: row.currency,
    amountDueMinor: Number(row.amount_due_minor),
    amountPaidMinor: Number(row.amount_paid_minor),
    taxMinor: Number(row.tax_minor),
    dueAt: row.due_at?.toISOString() ?? null,
    paidAt: row.paid_at?.toISOString() ?? null,
    hostedInvoiceUrl: row.hosted_invoice_url,
    lastPaymentError: row.last_payment_error,
    createdAt: row.stripe_created_at.toISOString(),
  };
}

async function ensureStripeCustomer(
  userId: string,
  email: string,
  displayName: string | null,
): Promise<string> {
  const existing = await pool.query<{ stripe_customer_id: string }>(
    "SELECT stripe_customer_id FROM enough.billing_customers WHERE user_id = $1",
    [userId],
  );
  if (existing.rows[0]) return existing.rows[0].stripe_customer_id;

  const fields = new URLSearchParams();
  addField(fields, "email", email);
  addField(fields, "name", displayName);
  addField(fields, "metadata[user_id]", userId);
  const customer = await stripeRequest("/customers", "POST", fields, `enough-customer-${userId}`);
  const customerId = stringValue(customer.id);
  if (!customerId || !/^cus_[A-Za-z0-9]+$/.test(customerId))
    throw new Error("Stripe returned an invalid customer reference.");
  const inserted = await pool.query<{ stripe_customer_id: string }>(
    `INSERT INTO enough.billing_customers (user_id, stripe_customer_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
     RETURNING stripe_customer_id`,
    [userId, customerId],
  );
  return inserted.rows[0].stripe_customer_id;
}

function configuredPlanKey(priceId: string): PlanKey | null {
  // Only app-configured Stripe prices grant access; recurrence and metadata are not entitlement proof.
  if (priceId === env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === env.STRIPE_PRICE_ANNUAL) return "annual";
  return null;
}

function paymentError(invoice: JsonRecord): string | null {
  const lastError = isRecord(invoice.last_payment_error) ? invoice.last_payment_error : null;
  const finalization = isRecord(invoice.last_finalization_error)
    ? invoice.last_finalization_error
    : null;
  const message = stringValue(lastError?.message) ?? stringValue(finalization?.message);
  return message?.replace(/[\r\n\t]+/g, " ").slice(0, 500) ?? null;
}

async function findUserForCustomer(client: DbClient, customerId: string): Promise<string | null> {
  const result = await client.query<{ user_id: string }>(
    "SELECT user_id FROM enough.billing_customers WHERE stripe_customer_id = $1",
    [customerId],
  );
  return result.rows[0]?.user_id ?? null;
}

async function upsertInvoice(
  client: DbClient,
  invoice: JsonRecord,
  userId: string,
  customerId: string,
  eventCreatedAt: Date,
  eventId: string,
  paymentFailed: boolean,
): Promise<void> {
  const invoiceId = stringValue(invoice.id);
  if (!invoiceId || !/^in_[A-Za-z0-9]+$/.test(invoiceId)) return;
  const status = stringValue(invoice.status);
  const lastError =
    paymentError(invoice) ??
    (paymentFailed
      ? "A payment attempt failed. Update your payment method in the billing portal."
      : null);
  const taxLines = Array.isArray(invoice.total_taxes) ? invoice.total_taxes : [];
  const taxMinor = taxLines.reduce(
    (total, line) => total + (isRecord(line) ? (numberValue(line.amount) ?? 0) : 0),
    0,
  );
  const lines =
    isRecord(invoice.lines) && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
  const linePeriod =
    lines.find(isRecord) && isRecord(lines.find(isRecord)?.period)
      ? (lines.find(isRecord)?.period as JsonRecord)
      : null;
  const stripeCreatedAt = dateFromUnix(invoice.created) ?? new Date();
  const subscriptionId =
    idValue(invoice.subscription) ??
    (isRecord(invoice.parent) && isRecord(invoice.parent.subscription_details)
      ? idValue(invoice.parent.subscription_details.subscription)
      : null);
  const hostedUrl = stringValue(invoice.hosted_invoice_url);
  const safeHostedUrl = hostedUrl?.startsWith("https://") ? hostedUrl : null;
  await client.query(
    `INSERT INTO enough.billing_invoices
       (stripe_invoice_id, user_id, stripe_customer_id, stripe_subscription_id, invoice_number, status,
        currency, amount_due_minor, amount_paid_minor, tax_minor, period_start, period_end, due_at,
        paid_at, hosted_invoice_url, attempt_count, last_payment_error, stripe_created_at,
        latest_event_created_at, latest_event_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())
     ON CONFLICT (stripe_invoice_id) DO UPDATE SET
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       invoice_number = EXCLUDED.invoice_number,
       status = EXCLUDED.status,
       currency = EXCLUDED.currency,
       amount_due_minor = EXCLUDED.amount_due_minor,
       amount_paid_minor = EXCLUDED.amount_paid_minor,
       tax_minor = EXCLUDED.tax_minor,
       period_start = EXCLUDED.period_start,
       period_end = EXCLUDED.period_end,
       due_at = EXCLUDED.due_at,
       paid_at = EXCLUDED.paid_at,
       hosted_invoice_url = EXCLUDED.hosted_invoice_url,
       attempt_count = EXCLUDED.attempt_count,
       last_payment_error = EXCLUDED.last_payment_error,
       latest_event_created_at = EXCLUDED.latest_event_created_at,
       latest_event_id = EXCLUDED.latest_event_id,
       updated_at = now()
     WHERE enough.billing_invoices.user_id = EXCLUDED.user_id
       AND (enough.billing_invoices.latest_event_created_at, enough.billing_invoices.latest_event_id)
         <= (EXCLUDED.latest_event_created_at, EXCLUDED.latest_event_id)`,
    [
      invoiceId,
      userId,
      customerId,
      subscriptionId,
      stringValue(invoice.number),
      status,
      currencyCode(invoice.currency),
      numberValue(invoice.amount_due) ?? 0,
      numberValue(invoice.amount_paid) ?? 0,
      taxMinor || numberValue(invoice.tax) || 0,
      dateFromUnix(linePeriod?.start),
      dateFromUnix(linePeriod?.end),
      dateFromUnix(invoice.due_date),
      dateFromUnix(
        invoice.status_transitions && isRecord(invoice.status_transitions)
          ? invoice.status_transitions.paid_at
          : null,
      ),
      safeHostedUrl,
      numberValue(invoice.attempt_count) ?? 0,
      lastError,
      stripeCreatedAt,
      eventCreatedAt,
      eventId,
    ],
  );
}

async function refreshEntitlement(client: DbClient, userId: string): Promise<void> {
  const result = await client.query<{
    stripe_subscription_id: string;
    status: string;
    current_period_end: Date | null;
    cancel_at_period_end: boolean;
    grace_until: Date | null;
  }>(
    `SELECT stripe_subscription_id, status, current_period_end, cancel_at_period_end, grace_until
     FROM enough.billing_subscriptions WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );
  const now = Date.now();
  const active = result.rows.find(
    (subscription) =>
      ((subscription.status === "active" || subscription.status === "trialing") &&
        (!subscription.current_period_end || subscription.current_period_end.getTime() > now)) ||
      (subscription.cancel_at_period_end &&
        subscription.current_period_end &&
        subscription.current_period_end.getTime() > now),
  );
  const grace = result.rows.find(
    (subscription) =>
      subscription.status === "past_due" &&
      subscription.grace_until &&
      subscription.grace_until.getTime() > now,
  );
  const granted = active ?? grace;
  const status = active ? "ACTIVE" : grace ? "GRACE" : "INACTIVE";
  await client.query(
    `INSERT INTO enough.billing_entitlements (user_id, entitlement_key, status, source_subscription_id, expires_at, updated_at)
     VALUES ($1, 'paid_features', $2, $3, $4, now())
     ON CONFLICT (user_id, entitlement_key) DO UPDATE SET
       status = EXCLUDED.status,
       source_subscription_id = EXCLUDED.source_subscription_id,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()`,
    [
      userId,
      status,
      granted?.stripe_subscription_id ?? null,
      active?.cancel_at_period_end ? active.current_period_end : (grace?.grace_until ?? null),
    ],
  );
}

async function reconcileSubscription(
  client: DbClient,
  stripeSubscriptionId: string,
  eventCreatedAt: Date,
  eventId: string,
): Promise<void> {
  const subscription = await stripeRequest(
    `/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
    "GET",
  );
  const customerId = idValue(subscription.customer);
  if (!customerId) return;
  const userId = await findUserForCustomer(client, customerId);
  if (!userId) return;
  const items =
    isRecord(subscription.items) && Array.isArray(subscription.items.data)
      ? subscription.items.data
      : [];
  const item = items.find(isRecord);
  const price = item && isRecord(item.price) ? item.price : null;
  const priceId = stringValue(price?.id);
  const recurring = isRecord(price?.recurring) ? price.recurring : null;
  const planKey = priceId ? configuredPlanKey(priceId) : null;
  const status = stringValue(subscription.status);
  if (
    !priceId ||
    !planKey ||
    !status ||
    ![
      "incomplete",
      "incomplete_expired",
      "trialing",
      "active",
      "past_due",
      "canceled",
      "unpaid",
      "paused",
    ].includes(status)
  )
    return;
  const latestInvoiceId = idValue(subscription.latest_invoice);
  const currentPeriodStart =
    dateFromUnix(subscription.current_period_start) ?? dateFromUnix(item?.current_period_start);
  const currentPeriodEnd =
    dateFromUnix(subscription.current_period_end) ?? dateFromUnix(item?.current_period_end);
  await client.query(
    `INSERT INTO enough.billing_subscriptions
       (stripe_subscription_id, user_id, stripe_customer_id, stripe_price_id, plan_key, status, currency,
        billing_interval, unit_amount_minor, trial_start, trial_end, current_period_start, current_period_end,
        cancel_at_period_end, cancel_at, canceled_at, grace_until, latest_invoice_id, latest_event_created_at, latest_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        CASE WHEN $6 = 'past_due' AND $17::integer > 0 THEN now() + ($17::text || ' days')::interval END,
        $18, $19, $20)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       stripe_price_id = EXCLUDED.stripe_price_id,
       plan_key = EXCLUDED.plan_key,
       status = EXCLUDED.status,
       currency = EXCLUDED.currency,
       billing_interval = EXCLUDED.billing_interval,
       unit_amount_minor = EXCLUDED.unit_amount_minor,
       trial_start = EXCLUDED.trial_start,
       trial_end = EXCLUDED.trial_end,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       cancel_at = EXCLUDED.cancel_at,
       canceled_at = EXCLUDED.canceled_at,
       grace_until = CASE
         WHEN EXCLUDED.status = 'past_due' THEN COALESCE(enough.billing_subscriptions.grace_until, EXCLUDED.grace_until)
         ELSE NULL
       END,
       latest_invoice_id = EXCLUDED.latest_invoice_id,
       latest_event_created_at = EXCLUDED.latest_event_created_at,
       latest_event_id = EXCLUDED.latest_event_id,
       updated_at = now()
     WHERE enough.billing_subscriptions.user_id = EXCLUDED.user_id
       AND (enough.billing_subscriptions.latest_event_created_at, enough.billing_subscriptions.latest_event_id)
         <= (EXCLUDED.latest_event_created_at, EXCLUDED.latest_event_id)`,
    [
      stripeSubscriptionId,
      userId,
      customerId,
      priceId,
      planKey,
      status,
      currencyCode(price?.currency),
      stringValue(recurring?.interval) ?? "month",
      numberValue(price?.unit_amount),
      dateFromUnix(subscription.trial_start),
      dateFromUnix(subscription.trial_end),
      currentPeriodStart,
      currentPeriodEnd,
      subscription.cancel_at_period_end === true,
      dateFromUnix(subscription.cancel_at),
      dateFromUnix(subscription.canceled_at),
      env.BILLING_GRACE_DAYS,
      latestInvoiceId,
      eventCreatedAt,
      eventId,
    ],
  );
  await refreshEntitlement(client, userId);
}

function subscriptionIdFromInvoice(invoice: JsonRecord): string | null {
  const legacy = idValue(invoice.subscription);
  if (legacy) return legacy;
  const parent =
    isRecord(invoice.parent) && isRecord(invoice.parent.subscription_details)
      ? invoice.parent.subscription_details
      : null;
  return idValue(parent?.subscription);
}

async function processStripeEvent(
  client: DbClient,
  event: JsonRecord,
  eventCreatedAt: Date,
  eventId: string,
): Promise<void> {
  const type = stringValue(event.type);
  const data = isRecord(event.data) ? event.data : null;
  const object = data && isRecord(data.object) ? data.object : null;
  if (!type || !object) return;

  if (
    type === "checkout.session.completed" ||
    type === "checkout.session.async_payment_succeeded"
  ) {
    if (object.mode === "subscription") {
      const subscriptionId = idValue(object.subscription);
      if (subscriptionId)
        await reconcileSubscription(client, subscriptionId, eventCreatedAt, eventId);
    }
    return;
  }

  if (type.startsWith("customer.subscription.")) {
    const subscriptionId = stringValue(object.id);
    if (subscriptionId)
      await reconcileSubscription(client, subscriptionId, eventCreatedAt, eventId);
    return;
  }

  if (type.startsWith("invoice.")) {
    const customerId = idValue(object.customer);
    if (!customerId) return;
    const userId = await findUserForCustomer(client, customerId);
    if (!userId) return;
    const subscriptionId = subscriptionIdFromInvoice(object);
    if (subscriptionId)
      await reconcileSubscription(client, subscriptionId, eventCreatedAt, eventId);
    await upsertInvoice(
      client,
      object,
      userId,
      customerId,
      eventCreatedAt,
      eventId,
      type === "invoice.payment_failed",
    );
  }
}

async function processWebhookEvent(event: JsonRecord): Promise<void> {
  const eventId = stringValue(event.id);
  const eventType = stringValue(event.type);
  const eventTimestamp = dateFromUnix(event.created);
  if (!eventId || !/^evt_[A-Za-z0-9]+$/.test(eventId) || !eventType || !eventTimestamp)
    throw new Error("Invalid Stripe event envelope.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const createdAt = eventTimestamp;
    const inserted = await client.query(
      `INSERT INTO enough.billing_webhook_events
         (stripe_event_id, event_type, stripe_created_at, processing_status)
       VALUES ($1, $2, $3, 'PROCESSING')
       ON CONFLICT (stripe_event_id) DO NOTHING RETURNING stripe_event_id`,
      [eventId, eventType, createdAt],
    );
    if (!inserted.rowCount) {
      await client.query("COMMIT");
      return;
    }
    await processStripeEvent(client, event, createdAt, eventId);
    await client.query(
      `UPDATE enough.billing_webhook_events SET processing_status = 'PROCESSED', processed_at = now()
       WHERE stripe_event_id = $1`,
      [eventId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function hasBillingEntitlement(
  userId: string,
  entitlementKey = "paid_features",
): Promise<boolean> {
  if (entitlementKey !== "paid_features") return false;
  const result = await pool.query(
    `SELECT 1 FROM enough.billing_entitlements
     WHERE user_id = $1 AND entitlement_key = $2
       AND ((status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > now()))
         OR (status = 'GRACE' AND expires_at > now()))`,
    [userId, entitlementKey],
  );
  return result.rowCount === 1;
}

function sendBillingError(
  request: FastifyRequest,
  reply: FastifyReply,
  message = "Billing is temporarily unavailable.",
) {
  request.log.error({ url: request.url }, "Billing operation failed");
  return reply.code(503).send({ error: message });
}

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/billing-data", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !(await checkRateLimit(request, reply, "billing:read", session.id, 30, 60)))
      return;
    try {
      const [subscriptionResult, entitlementResult, invoiceResult, monthly, annual] =
        await Promise.all([
          pool.query<{
            plan_key: PlanKey;
            status: string;
            currency: string;
            billing_interval: string;
            unit_amount_minor: string | null;
            trial_start: Date | null;
            trial_end: Date | null;
            current_period_start: Date | null;
            current_period_end: Date | null;
            cancel_at_period_end: boolean;
            cancel_at: Date | null;
            canceled_at: Date | null;
            grace_until: Date | null;
            latest_invoice_id: string | null;
            updated_at: Date;
          }>(
            `SELECT plan_key, status, currency, billing_interval, unit_amount_minor, trial_start, trial_end,
                  current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at,
                  grace_until, latest_invoice_id, updated_at
           FROM enough.billing_subscriptions WHERE user_id = $1
           ORDER BY CASE WHEN status IN ('active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused') THEN 0 ELSE 1 END,
                    updated_at DESC LIMIT 1`,
            [session.id],
          ),
          pool.query<{ entitlement_key: string; status: string; expires_at: Date | null }>(
            `SELECT entitlement_key, status, expires_at FROM enough.billing_entitlements
           WHERE user_id = $1
             AND ((status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > now()))
               OR (status = 'GRACE' AND expires_at > now()))`,
            [session.id],
          ),
          pool.query<{
            stripe_invoice_id: string;
            invoice_number: string | null;
            status: string | null;
            currency: string;
            amount_due_minor: string;
            amount_paid_minor: string;
            tax_minor: string;
            due_at: Date | null;
            paid_at: Date | null;
            hosted_invoice_url: string | null;
            last_payment_error: string | null;
            stripe_created_at: Date;
          }>(
            `SELECT stripe_invoice_id, invoice_number, status, currency, amount_due_minor::text, amount_paid_minor::text,
                  tax_minor::text, due_at, paid_at, hosted_invoice_url, last_payment_error, stripe_created_at
           FROM enough.billing_invoices WHERE user_id = $1 ORDER BY stripe_created_at DESC LIMIT 20`,
            [session.id],
          ),
          publicPlan("monthly"),
          publicPlan("annual"),
        ]);
      const row = subscriptionResult.rows[0];
      const entitled = entitlementResult.rows.length > 0;
      const canManage = await pool.query(
        "SELECT 1 FROM enough.billing_customers WHERE user_id = $1",
        [session.id],
      );
      return reply.send({
        configured: stripeReady(),
        automaticTax: env.STRIPE_AUTOMATIC_TAX,
        trialDays: env.STRIPE_TRIAL_DAYS,
        graceDays: env.BILLING_GRACE_DAYS,
        plans: [monthly, annual].filter((plan) => plan.available),
        subscription: row
          ? {
              planKey: row.plan_key,
              status: row.status,
              currency: row.currency,
              interval: row.billing_interval,
              amountMinor: row.unit_amount_minor === null ? null : Number(row.unit_amount_minor),
              trialStart: row.trial_start?.toISOString() ?? null,
              trialEnd: row.trial_end?.toISOString() ?? null,
              currentPeriodStart: row.current_period_start?.toISOString() ?? null,
              currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
              cancelAtPeriodEnd: row.cancel_at_period_end,
              cancelAt: row.cancel_at?.toISOString() ?? null,
              canceledAt: row.canceled_at?.toISOString() ?? null,
              graceUntil: row.grace_until?.toISOString() ?? null,
              latestInvoiceId: row.latest_invoice_id,
              updatedAt: row.updated_at.toISOString(),
            }
          : null,
        entitlements: {
          hasPaidAccess: entitled,
          status: entitlementResult.rows[0]?.status ?? "INACTIVE",
          expiresAt: entitlementResult.rows[0]?.expires_at?.toISOString() ?? null,
        },
        canManage: canManage.rowCount === 1,
        invoices: invoiceResult.rows.map(invoiceResponse),
      });
    } catch {
      return sendBillingError(request, reply);
    }
  });

  app.post("/billing-checkout", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "billing:checkout", session.id, 5, 60 * 60))) return;
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Choose a valid subscription option." });
    if (!stripeReady())
      return reply.code(503).send({ error: "Subscriptions are not available yet." });
    const plan = planConfig[parsed.data.planKey];
    if (!plan.priceId)
      return reply.code(400).send({ error: "That subscription option is not available." });

    try {
      const price = await retrievePrice(plan.priceId);
      const recurring = isRecord(price.recurring) ? price.recurring : null;
      if (price.active !== true || recurring?.interval !== plan.interval) {
        return reply
          .code(503)
          .send({ error: "That subscription option is temporarily unavailable." });
      }
      const customerId = await ensureStripeCustomer(session.id, session.email, session.displayName);
      const client = await pool.connect();
      let checkoutUrl: string | null = null;
      try {
        await client.query("BEGIN");
        const current = await client.query<{ trial_claimed_at: Date | null }>(
          "SELECT trial_claimed_at FROM enough.billing_customers WHERE user_id = $1 FOR UPDATE",
          [session.id],
        );
        const existing = await client.query(
          `SELECT 1 FROM enough.billing_subscriptions
           WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused')
           LIMIT 1`,
          [session.id],
        );
        if (existing.rowCount) {
          await client.query("ROLLBACK");
          return reply
            .code(409)
            .send({ error: "Manage your current subscription from the billing portal." });
        }
        const trialDays = current.rows[0]?.trial_claimed_at ? 0 : env.STRIPE_TRIAL_DAYS;
        const fields = new URLSearchParams();
        addField(fields, "mode", "subscription");
        addField(fields, "customer", customerId);
        addField(fields, "client_reference_id", session.id);
        addField(fields, "line_items[0][price]", plan.priceId);
        addField(fields, "line_items[0][quantity]", 1);
        addField(fields, "success_url", `${env.APP_BASE_URL}/billing?checkout=success`);
        addField(fields, "cancel_url", `${env.APP_BASE_URL}/billing?checkout=cancelled`);
        addField(fields, "allow_promotion_codes", true);
        addField(fields, "billing_address_collection", "required");
        addField(fields, "tax_id_collection[enabled]", true);
        addField(fields, "automatic_tax[enabled]", env.STRIPE_AUTOMATIC_TAX);
        addField(fields, "customer_update[address]", "auto");
        addField(fields, "customer_update[name]", "auto");
        addField(fields, "metadata[user_id]", session.id);
        addField(fields, "metadata[plan_key]", parsed.data.planKey);
        addField(fields, "subscription_data[metadata][user_id]", session.id);
        addField(fields, "subscription_data[metadata][plan_key]", parsed.data.planKey);
        addField(fields, "subscription_data[trial_period_days]", trialDays || null);
        const checkout = await stripeRequest(
          "/checkout/sessions",
          "POST",
          fields,
          `enough-checkout-${session.id}-${parsed.data.idempotencyKey}`,
        );
        const url = stringValue(checkout.url);
        if (!url?.startsWith("https://checkout.stripe.com/"))
          throw new Error("Stripe returned an invalid Checkout URL.");
        checkoutUrl = url;
        if (trialDays > 0) {
          await client.query(
            "UPDATE enough.billing_customers SET trial_claimed_at = COALESCE(trial_claimed_at, now()), updated_at = now() WHERE user_id = $1",
            [session.id],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return reply.send({ checkoutUrl });
    } catch {
      return sendBillingError(
        request,
        reply,
        "Checkout could not be started. Try again in a moment.",
      );
    }
  });

  app.post("/billing-portal", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!(await checkRateLimit(request, reply, "billing:portal", session.id, 10, 60))) return;
    if (!stripeCredentialsReady())
      return reply.code(503).send({ error: "Billing management is not available yet." });
    try {
      const customer = await pool.query<{ stripe_customer_id: string }>(
        "SELECT stripe_customer_id FROM enough.billing_customers WHERE user_id = $1",
        [session.id],
      );
      if (!customer.rows[0])
        return reply.code(404).send({ error: "There is no billing account to manage." });
      const fields = new URLSearchParams();
      addField(fields, "customer", customer.rows[0].stripe_customer_id);
      addField(fields, "return_url", `${env.APP_BASE_URL}/billing`);
      const portal = await stripeRequest("/billing_portal/sessions", "POST", fields);
      const url = stringValue(portal.url);
      if (!url?.startsWith("https://billing.stripe.com/"))
        throw new Error("Stripe returned an invalid portal URL.");
      return reply.send({ portalUrl: url });
    } catch {
      return sendBillingError(request, reply, "The billing portal could not be opened.");
    }
  });

  app.post("/billing/stripe-webhook", { bodyLimit: 256 * 1024 }, async (request, reply) => {
    if (!(await checkRateLimit(request, reply, "billing:webhook:ip", request.ip, 300, 60))) return;
    const rawBody = (request as FastifyRequest & { rawJsonBody?: Buffer }).rawJsonBody;
    const signature = request.headers["stripe-signature"];
    if (
      !rawBody ||
      Array.isArray(signature) ||
      !stripeSignatureMatches(rawBody, signature, env.STRIPE_WEBHOOK_SECRETS)
    ) {
      return reply.code(400).send({ error: "Invalid webhook signature." });
    }
    let event: unknown;
    try {
      event = JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      return reply.code(400).send({ error: "Invalid webhook payload." });
    }
    if (!isRecord(event)) return reply.code(400).send({ error: "Invalid webhook payload." });
    try {
      await processWebhookEvent(event);
      return reply.code(200).send({ received: true });
    } catch {
      request.log.error({ eventType: stringValue(event.type) }, "Stripe webhook processing failed");
      return reply.code(503).send({ error: "Webhook processing is temporarily unavailable." });
    }
  });
}
