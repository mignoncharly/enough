import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@enough/config";
import type { NormalizedIntegrationEvent, VerifiedEventType } from "./integration-adapters.js";
import { ProviderApiError } from "./integration-provider-adapters.js";

export interface VerifiedStripeEvent extends NormalizedIntegrationEvent {
  providerOriginVerified: true;
  automaticVerificationEligible: boolean;
}

interface StripePayload {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  account?: string;
  data: { object: Record<string, unknown> };
}

const eventTypeMap: Record<string, VerifiedEventType> = {
  "payment_intent.succeeded": "revenue.payment_received",
  "checkout.session.completed": "revenue.checkout_completed",
  "customer.subscription.created": "revenue.subscription_created",
  "invoice.paid": "revenue.invoice_paid",
  "customer.subscription.deleted": "revenue.subscription_cancelled",
  "charge.refunded": "revenue.payment_refunded",
  "refund.created": "revenue.payment_refunded",
};

export function verifyStripeSignature(input: {
  rawBody: Buffer;
  signatureHeader: string;
  signingSecret: string;
  now?: Date;
}): boolean {
  const components = input.signatureHeader.split(",").map((part) => part.trim().split("=", 2));
  const timestampValue = components.find(([name]) => name === "t")?.[1];
  const signatures = components
    .filter(([name]) => name === "v1")
    .map(([, value]) => value)
    .filter((value): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
  if (!timestampValue || !/^\d{1,12}$/.test(timestampValue) || signatures.length === 0)
    return false;
  const timestamp = Number(timestampValue);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;
  const expected = createHmac("sha256", input.signingSecret)
    .update(timestampValue)
    .update(".")
    .update(input.rawBody)
    .digest();
  return signatures.some((signature) => {
    const supplied = Buffer.from(signature, "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

function parseStripePayload(input: Buffer): StripePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.toString("utf8")) as unknown;
  } catch {
    throw new ProviderApiError("INVALID_STRIPE_EVENT");
  }
  if (!parsed || typeof parsed !== "object") throw new ProviderApiError("INVALID_STRIPE_EVENT");
  const body = parsed as Record<string, unknown>;
  const data =
    body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : null;
  const eventObject =
    data?.object && typeof data.object === "object"
      ? (data.object as Record<string, unknown>)
      : null;
  if (
    typeof body.id !== "string" ||
    !/^evt_[A-Za-z0-9]+$/.test(body.id) ||
    typeof body.type !== "string" ||
    typeof body.created !== "number" ||
    !Number.isSafeInteger(body.created) ||
    typeof body.livemode !== "boolean" ||
    (body.account !== undefined &&
      body.account !== null &&
      (typeof body.account !== "string" || !/^acct_[A-Za-z0-9]+$/.test(body.account))) ||
    !eventObject
  )
    throw new ProviderApiError("INVALID_STRIPE_EVENT");
  return {
    id: body.id,
    type: body.type,
    created: body.created,
    livemode: body.livemode,
    ...(typeof body.account === "string" ? { account: body.account } : {}),
    data: { object: eventObject },
  };
}

function meaningfulObjectId(value: unknown): string | null {
  const object = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return typeof object?.id === "string" && object.id.length <= 255 ? object.id : null;
}

function completionIdFrom(object: Record<string, unknown>): string | undefined {
  const metadata =
    object.metadata && typeof object.metadata === "object"
      ? (object.metadata as Record<string, unknown>)
      : null;
  const subscriptionDetails =
    object.subscription_details && typeof object.subscription_details === "object"
      ? (object.subscription_details as Record<string, unknown>)
      : null;
  const nestedMetadata =
    subscriptionDetails?.metadata && typeof subscriptionDetails.metadata === "object"
      ? (subscriptionDetails.metadata as Record<string, unknown>)
      : null;
  const value = metadata?.enough_task_completion_id ?? nestedMetadata?.enough_task_completion_id;
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

function normalizedStripeEvent(event: StripePayload): VerifiedStripeEvent {
  const eventType = eventTypeMap[event.type];
  if (!eventType) throw new ProviderApiError("UNSUPPORTED_STRIPE_EVENT");
  const object = event.data.object;
  const eventObjectId = meaningfulObjectId(object);
  if (!eventObjectId) throw new ProviderApiError("INVALID_STRIPE_EVENT");
  const occurredAt = new Date(event.created * 1000).toISOString();
  const amountValue =
    event.type === "payment_intent.succeeded"
      ? object.amount_received
      : event.type === "checkout.session.completed"
        ? object.amount_total
        : event.type === "invoice.paid"
          ? object.amount_paid
          : event.type === "charge.refunded"
            ? object.amount_refunded
            : event.type === "refund.created"
              ? object.amount
              : undefined;
  const currencyValue =
    typeof object.currency === "string" ? object.currency.toUpperCase() : undefined;
  const amount =
    typeof amountValue === "number" && Number.isSafeInteger(amountValue) && amountValue >= 0
      ? amountValue
      : undefined;
  const currency = currencyValue && /^[A-Z]{3}$/.test(currencyValue) ? currencyValue : undefined;
  const completionId = completionIdFrom(object);
  return {
    eventId: `stripe-${createHmac("sha256", env.AUTH_SECRET).update(event.id).digest("hex")}`,
    eventType,
    occurredAt,
    ...(completionId ? { completionId } : {}),
    ...(amount !== undefined && currency ? { amountMinor: amount, currency } : {}),
    providerOriginVerified: true,
    automaticVerificationEligible:
      eventType === "revenue.payment_received" &&
      Boolean(completionId) &&
      amount !== undefined &&
      amount > 0 &&
      currency !== undefined,
  };
}

export async function validateStripeRestrictedKey(input: {
  apiKey: string;
  accountId?: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  const anonymousSandboxKey = /^rkcs_test_[A-Za-z0-9]+$/.test(input.apiKey);
  const ordinaryRestrictedKey = /^rk_(?:test|live)_[A-Za-z0-9]+$/.test(input.apiKey);
  if (!anonymousSandboxKey && !ordinaryRestrictedKey)
    throw new ProviderApiError("INVALID_STRIPE_CREDENTIAL");
  if (input.accountId !== undefined && !/^acct_[A-Za-z0-9]+$/.test(input.accountId))
    throw new ProviderApiError("INVALID_STRIPE_CREDENTIAL");
  if (anonymousSandboxKey && !input.accountId)
    throw new ProviderApiError("INVALID_STRIPE_CREDENTIAL");

  const request = async (url: string): Promise<Response> => {
    try {
      return await (input.fetcher ?? fetch)(url, {
        headers: { authorization: `Bearer ${input.apiKey}`, accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ProviderApiError("PROVIDER_UNAVAILABLE");
    }
  };

  let accountId = input.accountId;
  if (!anonymousSandboxKey) {
    const accountResponse = await request("https://api.stripe.com/v1/account");
    if (!accountResponse.ok) throw new ProviderApiError("PROVIDER_AUTHENTICATION_FAILED");
    const accountBody = (await accountResponse.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (typeof accountBody?.id !== "string" || !/^acct_[A-Za-z0-9]+$/.test(accountBody.id))
      throw new ProviderApiError("INVALID_PROVIDER_RESPONSE");
    if (accountId && accountId !== accountBody.id)
      throw new ProviderApiError("INVALID_STRIPE_CREDENTIAL");
    accountId = accountBody.id;
  }

  const eventsResponse = await request("https://api.stripe.com/v1/events?limit=1");
  if (!eventsResponse.ok) throw new ProviderApiError("PROVIDER_AUTHENTICATION_FAILED");
  const eventsBody = (await eventsResponse.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (eventsBody?.object !== "list" || !Array.isArray(eventsBody.data))
    throw new ProviderApiError("INVALID_PROVIDER_RESPONSE");
  if (!accountId) throw new ProviderApiError("INVALID_PROVIDER_RESPONSE");
  return accountId;
}

export async function verifyStripeWebhook(input: {
  rawBody: Buffer;
  signatureHeader: string;
  signingSecret: string;
  restrictedApiKey: string;
  expectedAccountId: string;
  expectedLivemode: boolean;
  now?: Date;
  fetcher?: typeof fetch;
}): Promise<VerifiedStripeEvent> {
  if (
    !verifyStripeSignature({
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
      signingSecret: input.signingSecret,
      now: input.now,
    })
  )
    throw new ProviderApiError("INVALID_STRIPE_SIGNATURE");

  const received = parseStripePayload(input.rawBody);
  if (!eventTypeMap[received.type]) throw new ProviderApiError("UNSUPPORTED_STRIPE_EVENT");
  if (!/^acct_[A-Za-z0-9]+$/.test(input.expectedAccountId))
    throw new ProviderApiError("STRIPE_CONFIGURATION_MISSING");
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(
      `https://api.stripe.com/v1/events/${encodeURIComponent(received.id)}`,
      {
        headers: { authorization: `Bearer ${input.restrictedApiKey}`, accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new ProviderApiError("PROVIDER_UNAVAILABLE");
  }
  if (!response.ok) throw new ProviderApiError("STRIPE_EVENT_NOT_CONFIRMED");
  const providerPayload = parseStripePayload(Buffer.from(await response.text()));
  const receivedObjectId = meaningfulObjectId(received.data.object);
  const providerObjectId = meaningfulObjectId(providerPayload.data.object);
  if (
    providerPayload.id !== received.id ||
    providerPayload.type !== received.type ||
    providerPayload.created !== received.created ||
    providerObjectId === null ||
    providerObjectId !== receivedObjectId ||
    providerPayload.livemode !== received.livemode ||
    providerPayload.livemode !== input.expectedLivemode ||
    (providerPayload.account ?? null) !== (received.account ?? null) ||
    (providerPayload.account !== undefined && providerPayload.account !== input.expectedAccountId)
  )
    throw new ProviderApiError("STRIPE_EVENT_MISMATCH");
  const signedNormalized = normalizedStripeEvent(received);
  const providerNormalized = normalizedStripeEvent(providerPayload);
  if (
    signedNormalized.eventType !== providerNormalized.eventType ||
    signedNormalized.occurredAt !== providerNormalized.occurredAt ||
    signedNormalized.completionId !== providerNormalized.completionId ||
    signedNormalized.amountMinor !== providerNormalized.amountMinor ||
    signedNormalized.currency !== providerNormalized.currency ||
    signedNormalized.automaticVerificationEligible !==
      providerNormalized.automaticVerificationEligible
  )
    throw new ProviderApiError("STRIPE_EVENT_MISMATCH");
  return providerNormalized;
}
