"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  createIntegration,
  createProviderApiToken,
  createStripeIntegration,
  type IntegrationAccountSummary,
  type IntegrationCatalogItem,
  type IntegrationWorkspace,
  linkIntegrationEventEvidence,
  loadIntegrations,
  loadProducts,
  loadTaskEvidence,
  type ProductSummary,
  revokeIntegration,
  startProviderOAuth,
  syncIntegration,
  type TaskEvidenceCompletion,
} from "../workspace-data";
import { WorkspaceFrame } from "../workspace-frame";

type AvailableProvider = "WEBHOOK" | "PUBLIC_API";

function providerName(provider: string): string {
  const names: Record<string, string> = {
    PUBLIC_API: "Public Event API",
    WEBHOOK: "Generic webhook",
    GMAIL: "Gmail",
    GOOGLE_CALENDAR: "Google Calendar",
    OUTLOOK: "Outlook",
    MICROSOFT_CALENDAR: "Microsoft Calendar",
    STRIPE: "Stripe customer revenue",
    POSTHOG: "PostHog",
    PLAUSIBLE: "Plausible",
    GA4: "Google Analytics 4",
  };
  return names[provider] ?? provider;
}

const stripeWebhookEventTypes = [
  "checkout.session.completed",
  "payment_intent.succeeded",
  "customer.subscription.created",
  "invoice.paid",
  "customer.subscription.deleted",
  "charge.refunded",
];
const optionalStripeWebhookEventTypes = ["refund.created"];

function StripeEventRequirements() {
  return (
    <div className="stripe-event-requirements">
      <strong>Required Stripe webhook events</strong>
      <ul>
        {stripeWebhookEventTypes.map((eventType) => (
          <li key={eventType}>
            <code>{eventType}</code>
          </li>
        ))}
      </ul>
      <p>
        Also accepted: <code>{optionalStripeWebhookEventTypes.join(", ")}</code>
      </p>
    </div>
  );
}

function eventStatusLabel(status: string, providerOriginVerified: boolean): string {
  return status === "AUTHENTICATED"
    ? providerOriginVerified
      ? "provider authenticated"
      : "owner source signature verified"
    : status.toLocaleLowerCase().replaceAll("_", " ");
}

function parseEventMap(value: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(
      "Event mapping must be valid JSON with provider event names and Enough event types.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Event mapping must be a JSON object.");
  const entries = Object.entries(parsed);
  if (!entries.length || entries.some(([key, item]) => !key.trim() || typeof item !== "string"))
    throw new Error("Add at least one provider event mapped to a normalized event type.");
  return Object.fromEntries(entries) as Record<string, string>;
}

export default function IntegrationsPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [workspace, setWorkspace] = useState<IntegrationWorkspace | null>(null);
  const [provider, setProvider] = useState<AvailableProvider>("PUBLIC_API");
  const [displayName, setDisplayName] = useState("");
  const [credentials, setCredentials] = useState<{
    apiKey: string;
    signingSecret: string;
    contentType: string;
    signatureFormat: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [completions, setCompletions] = useState<TaskEvidenceCompletion[]>([]);
  const [vendorProvider, setVendorProvider] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [oauthPropertyId, setOauthPropertyId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [analyticsProjectId, setAnalyticsProjectId] = useState("");
  const [analyticsRegion, setAnalyticsRegion] = useState<"us" | "eu">("us");
  const [plausibleSiteId, setPlausibleSiteId] = useState("");
  const [eventMapText, setEventMapText] = useState('{"signup":"analytics.user_signup"}');
  const [stripeRestrictedKey, setStripeRestrictedKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [selectedCompletions, setSelectedCompletions] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void loadProducts()
      .then((items) => {
        if (!active) return;
        setProducts(items);
        setProductId(items[0]?.id ?? "");
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "Products could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const connection = query.get("connection");
    const providerNameFromReturn = query.get("provider")?.replaceAll("_", " ") ?? "Provider";
    if (connection === "connected") setNotice(`${providerNameFromReturn} connected successfully.`);
    if (connection === "failed")
      setError(
        `${providerNameFromReturn} could not connect. Check the consent and OAuth configuration, then try again.`,
      );
  }, []);

  useEffect(() => {
    if (!productId) {
      setWorkspace(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([loadIntegrations(productId), loadTaskEvidence(productId)])
      .then(([result, evidence]) => {
        if (!active) return;
        setWorkspace(result);
        setCompletions(evidence.completions);
        const firstVendor = result.catalog.find(
          (item) => item.provider !== "WEBHOOK" && item.provider !== "PUBLIC_API" && item.available,
        );
        setVendorProvider(firstVendor?.provider ?? "");
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "Integrations could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  async function refresh() {
    if (!productId) return;
    const [integrations, evidence] = await Promise.all([
      loadIntegrations(productId),
      loadTaskEvidence(productId),
    ]);
    setWorkspace(integrations);
    setCompletions(evidence.completions);
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await createIntegration({
        productId,
        provider,
        displayName: displayName.trim(),
      });
      setCredentials(result.credentials);
      setDisplayName("");
      await refresh();
      setNotice("Integration created. Copy both credentials now; they will not be shown again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The integration could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect(account: IntegrationAccountSummary) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await revokeIntegration(account.id);
      await refresh();
      setNotice(
        result.providerRevocation === "MANUAL_REQUIRED"
          ? `${account.displayName} disconnected in Enough. Revoke its provider credential or consent in the ${providerName(account.provider)} account settings as well.`
          : result.providerRevocation === "REVOKED"
            ? `${account.displayName} disconnected and its provider grant was revoked.`
            : `${account.displayName} disconnected in Enough.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The integration could not be disconnected.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function connectVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = workspace?.catalog.find((item) => item.provider === vendorProvider);
    if (!selected?.available || !productId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (selected.mode === "OAUTH") {
        const body: Parameters<typeof startProviderOAuth>[0] = {
          productId,
          provider: selected.provider,
          displayName: vendorName.trim(),
        };
        if (selected.provider === "GA4") {
          body.propertyId = oauthPropertyId.trim();
          body.eventMap = parseEventMap(eventMapText);
        }
        const result = await startProviderOAuth(body);
        window.location.assign(result.authorizationUrl);
        return;
      }
      if (selected.provider === "STRIPE") {
        const result = await createStripeIntegration({
          productId,
          displayName: vendorName.trim(),
          restrictedApiKey: stripeRestrictedKey.trim(),
          webhookSigningSecret: stripeWebhookSecret.trim(),
        });
        setStripeRestrictedKey("");
        setStripeWebhookSecret("");
        setNotice(
          `Stripe connected. Add ${result.webhookUrl} as a webhook endpoint and subscribe to payment_intent.succeeded, checkout.session.completed, customer.subscription.created, invoice.paid, customer.subscription.deleted, charge.refunded, and refund.created. Automatic task credit verification applies only to confirmed payment_intent.succeeded events with a matching task completion ID.`,
        );
      } else {
        const eventMap = parseEventMap(eventMapText);
        await createProviderApiToken({
          productId,
          provider: selected.provider as "POSTHOG" | "PLAUSIBLE",
          displayName: vendorName.trim(),
          apiToken: apiToken.trim(),
          ...(selected.provider === "POSTHOG"
            ? { projectId: analyticsProjectId.trim(), region: analyticsRegion }
            : { siteId: plausibleSiteId.trim() }),
          eventMap,
        });
        setApiToken("");
        setNotice(`${selected.name} connected. The provider credential was stored encrypted.`);
      }
      setVendorName("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The provider could not be connected.");
    } finally {
      setSaving(false);
    }
  }

  async function sync(account: IntegrationAccountSummary) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await syncIntegration(account.id);
      await refresh();
      setNotice(`Sync complete: ${result.eventsReceived} new events recorded.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider sync failed.");
    } finally {
      setSaving(false);
    }
  }

  async function attachEvent(account: IntegrationAccountSummary, eventId: string) {
    const completionId = selectedCompletions[eventId];
    if (!completionId) return;
    setSaving(true);
    setError("");
    try {
      await linkIntegrationEventEvidence(account.id, eventId, completionId);
      setSelectedCompletions((current) => ({ ...current, [eventId]: "" }));
      await refresh();
      setNotice(
        "Provider event attached as pending evidence. Review it on the Evidence page to grant credits.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The event could not be attached.");
    } finally {
      setSaving(false);
    }
  }

  const availableCatalog = workspace?.catalog.filter((item) => item.available) ?? [];
  const availableSignedCatalog = availableCatalog.filter(
    (item) => item.provider === "WEBHOOK" || item.provider === "PUBLIC_API",
  );
  const vendorCatalog =
    workspace?.catalog.filter(
      (item) => item.provider !== "WEBHOOK" && item.provider !== "PUBLIC_API",
    ) ?? [];
  const selectedVendor = vendorCatalog.find((item) => item.provider === vendorProvider);
  const plannedCatalog = workspace?.catalog.filter((item) => !item.available) ?? [];

  return (
    <WorkspaceFrame
      active="integrations"
      eyebrow="Integrations"
      title="Connect event sources"
      description="Connect vendor accounts, analytics tokens, Stripe revenue, or a signed event source. Provider events can be linked to completed tasks for owner review."
    >
      {products.length > 1 ? (
        <div className="product-toolbar">
          <label className="product-select">
            Product
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {loading ? (
        <p className="notice" role="status">
          Loading integrations…
        </p>
      ) : null}
      {error ? (
        <section className="account-card" role="alert">
          <h2>Integration action could not be completed</h2>
          <p className="error">{error}</p>
        </section>
      ) : null}
      {!loading && !error && products.length === 0 ? (
        <section className="account-card">
          <p className="eyebrow">No product yet</p>
          <h2>Integrations need a product workspace</h2>
          <a className="primary-button link-button" href="/onboarding">
            Start onboarding
          </a>
        </section>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {credentials ? (
        <section className="account-card integration-credentials" aria-live="polite">
          <p className="eyebrow">Copy these credentials now</p>
          <h2>Integration signing credentials</h2>
          <p>
            The API key identifies this integration. The signing secret authenticates exact event
            request bytes. Store both in your server's secret manager; Enough only retains a hash of
            the API key and an encrypted signing secret. A signed request confirms control of this
            source, so linked task evidence still needs owner review.
          </p>
          <label>
            API key
            <input
              readOnly
              value={credentials.apiKey}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <label>
            Signing secret
            <input
              readOnly
              value={credentials.signingSecret}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <p className="evidence-help">
            Content type: <code>{credentials.contentType}</code>
          </p>
          <a className="quiet-link" href="/INTEGRATIONS.md" target="_blank" rel="noreferrer">
            Open the signed event API guide
          </a>
          <button className="secondary-button" type="button" onClick={() => setCredentials(null)}>
            I saved both values
          </button>
        </section>
      ) : null}

      {workspace ? (
        <>
          <section className="account-card">
            <p className="eyebrow">Provider catalog</p>
            <h2>Supported event sources</h2>
            <ul className="integration-planned-list">
              {workspace.catalog.map((item) => (
                <li key={item.provider}>
                  <strong>{item.name}</strong>
                  <span>{item.available ? "Setup available" : "Server setup needed"}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="account-card">
            <p className="eyebrow">Connection architecture</p>
            <h2>Create an owner-controlled signed event source</h2>
            <p className="muted-copy">
              Each source gets a separate API key and HMAC secret. Sign the raw request body with a
              fresh timestamp. Duplicate event IDs cannot create duplicate records, and linked task
              evidence waits for owner review.
            </p>
            <form
              className="product-form integration-form"
              onSubmit={(event) => void connect(event)}
            >
              <label>
                Connection type
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as AvailableProvider)}
                >
                  {availableSignedCatalog.map((item) => (
                    <option key={item.provider} value={item.provider}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Display name
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder={
                    provider === "WEBHOOK" ? "Customer event webhook" : "Production event API"
                  }
                />
              </label>
              <button className="primary-button" type="submit" disabled={saving}>
                Create signed connection
              </button>
            </form>
          </section>

          {vendorCatalog.length ? (
            <section className="account-card">
              <p className="eyebrow">Provider adapters</p>
              <h2>Connect a vendor event source</h2>
              <p className="muted-copy">
                OAuth sync uses the narrow provider scopes shown by the provider. Analytics sources
                are aggregated; email bodies and raw analytics identifiers are not stored. Calendar
                events stay pending until you link and review evidence.
              </p>
              <form
                className={`product-form integration-form ${
                  vendorProvider === "STRIPE" ? "integration-stripe-form" : ""
                }`}
                onSubmit={(event) => void connectVendor(event)}
              >
                <label>
                  Provider
                  <select
                    value={vendorProvider}
                    onChange={(event) => setVendorProvider(event.target.value)}
                  >
                    {vendorCatalog.map((item) => (
                      <option key={item.provider} value={item.provider}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Display name
                  <input
                    value={vendorName}
                    onChange={(event) => setVendorName(event.target.value)}
                    required
                    minLength={2}
                    maxLength={100}
                  />
                </label>
                {vendorProvider === "GA4" ? (
                  <label>
                    GA4 property ID
                    <input
                      value={oauthPropertyId}
                      onChange={(event) => setOauthPropertyId(event.target.value)}
                      required
                      inputMode="numeric"
                      pattern="[0-9]{1,20}"
                    />
                  </label>
                ) : null}
                {vendorProvider === "POSTHOG" ? (
                  <>
                    <label>
                      PostHog project ID
                      <input
                        value={analyticsProjectId}
                        onChange={(event) => setAnalyticsProjectId(event.target.value)}
                        required
                        inputMode="numeric"
                        pattern="[0-9]{1,12}"
                      />
                    </label>
                    <label>
                      PostHog region
                      <select
                        value={analyticsRegion}
                        onChange={(event) => setAnalyticsRegion(event.target.value as "us" | "eu")}
                      >
                        <option value="us">US</option>
                        <option value="eu">EU</option>
                      </select>
                    </label>
                  </>
                ) : null}
                {vendorProvider === "PLAUSIBLE" ? (
                  <label>
                    Plausible site ID
                    <input
                      value={plausibleSiteId}
                      onChange={(event) => setPlausibleSiteId(event.target.value)}
                      required
                      maxLength={255}
                    />
                  </label>
                ) : null}
                {vendorProvider === "POSTHOG" || vendorProvider === "PLAUSIBLE" ? (
                  <label>
                    Read-only provider API key
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={apiToken}
                      onChange={(event) => setApiToken(event.target.value)}
                      required
                      minLength={12}
                      maxLength={4096}
                    />
                  </label>
                ) : null}
                {vendorProvider === "STRIPE" ? (
                  <>
                    <label>
                      Stripe restricted API key (Account: Read and Events: Read)
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={stripeRestrictedKey}
                        onChange={(event) => setStripeRestrictedKey(event.target.value)}
                        required
                        minLength={12}
                        maxLength={255}
                        placeholder="rk_test_…"
                      />
                    </label>
                    <label>
                      Stripe webhook signing secret
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={stripeWebhookSecret}
                        onChange={(event) => setStripeWebhookSecret(event.target.value)}
                        required
                        minLength={16}
                        maxLength={255}
                        placeholder="whsec_…"
                      />
                    </label>
                    <p className="evidence-help">
                      Use Stripe test mode during acceptance. This connection is separate from
                      Enough subscription billing.
                    </p>
                    <StripeEventRequirements />
                  </>
                ) : null}
                {vendorProvider === "GA4" ||
                vendorProvider === "POSTHOG" ||
                vendorProvider === "PLAUSIBLE" ? (
                  <label>
                    Provider event mapping (JSON)
                    <textarea
                      value={eventMapText}
                      onChange={(event) => setEventMapText(event.target.value)}
                      rows={4}
                      spellCheck={false}
                    />
                  </label>
                ) : null}
                <button
                  className="primary-button"
                  type="submit"
                  disabled={saving || !selectedVendor?.available}
                  title={
                    selectedVendor && !selectedVendor.available
                      ? "Configure this provider's server OAuth client before connecting."
                      : undefined
                  }
                >
                  {saving
                    ? "Connecting…"
                    : vendorProvider === "GMAIL" ||
                        vendorProvider === "GOOGLE_CALENDAR" ||
                        vendorProvider === "OUTLOOK" ||
                        vendorProvider === "MICROSOFT_CALENDAR" ||
                        vendorProvider === "GA4"
                      ? "Continue to provider"
                      : "Connect provider"}
                </button>
              </form>
              {selectedVendor?.mode === "OAUTH" ? (
                <p className="evidence-help">
                  Requested least-privilege scopes: {selectedVendor.requiredScopes.join(", ")}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="account-card">
            <p className="eyebrow">Connected sources</p>
            <h2>{workspace.accounts.length} configured</h2>
            {workspace.accounts.length ? (
              <ul className="integration-list">
                {workspace.accounts.map((account) => (
                  <li key={account.id}>
                    <div className="integration-account-heading">
                      <div>
                        <strong>{account.displayName}</strong>
                        <span>
                          {providerName(account.provider)} · {account.health.toLocaleLowerCase()} ·{" "}
                          {account.lastReceivedAt
                            ? `Last event ${new Date(account.lastReceivedAt).toLocaleString()}`
                            : "No events received"}
                          {account.lastSyncAt
                            ? ` · Last sync ${new Date(account.lastSyncAt).toLocaleString()}`
                            : ""}
                        </span>
                      </div>
                      <div className="integration-actions">
                        {[
                          "GMAIL",
                          "GOOGLE_CALENDAR",
                          "OUTLOOK",
                          "MICROSOFT_CALENDAR",
                          "POSTHOG",
                          "PLAUSIBLE",
                          "GA4",
                        ].includes(account.provider) && account.status !== "REVOKED" ? (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={saving}
                            onClick={() => void sync(account)}
                          >
                            Sync now
                          </button>
                        ) : null}
                        {account.status !== "REVOKED" ? (
                          <button
                            className="danger-button"
                            type="button"
                            disabled={saving}
                            onClick={() => void disconnect(account)}
                          >
                            Disconnect
                          </button>
                        ) : (
                          <span className="integration-revoked">Disconnected</span>
                        )}
                      </div>
                    </div>
                    {account.provider === "STRIPE" ? (
                      <div className="integration-provider-setup">
                        <strong>Stripe customer revenue webhook</strong>
                        {account.webhookUrl ? (
                          <code className="integration-webhook-url">{account.webhookUrl}</code>
                        ) : null}
                        <StripeEventRequirements />
                        <span>
                          This revenue connection is separate from Enough subscription billing.
                        </span>
                      </div>
                    ) : null}
                    {account.recentEvents.length ? (
                      <ul className="integration-event-list">
                        {account.recentEvents.map((item) => (
                          <li key={item.id}>
                            <div>
                              <strong>{item.eventType}</strong>
                              <span>
                                {new Date(item.occurredAt).toLocaleString()} ·{" "}
                                {eventStatusLabel(
                                  item.verificationStatus,
                                  item.providerOriginVerified,
                                )}
                              </span>
                            </div>
                            {item.completionId ? (
                              <a
                                className="quiet-link"
                                href={`/evidence?productId=${account.productId}&completionId=${item.completionId}`}
                              >
                                View linked evidence
                              </a>
                            ) : item.providerOriginVerified &&
                              !item.evidenceId &&
                              account.status !== "REVOKED" ? (
                              <div className="integration-evidence-link">
                                <select
                                  aria-label={`Choose task completion for ${item.eventType}`}
                                  value={selectedCompletions[item.eventId] ?? ""}
                                  onChange={(event) =>
                                    setSelectedCompletions((current) => ({
                                      ...current,
                                      [item.eventId]: event.target.value,
                                    }))
                                  }
                                >
                                  <option value="">Choose completed task…</option>
                                  {completions
                                    .filter(
                                      (completion) =>
                                        completion.taskStatus === "COMPLETED" &&
                                        ["AWAITING_EVIDENCE", "AWAITING_REVIEW"].includes(
                                          completion.verificationStatus,
                                        ) &&
                                        !completion.creditTransactionId,
                                    )
                                    .map((completion) => (
                                      <option key={completion.id} value={completion.id}>
                                        {completion.taskTitle}
                                      </option>
                                    ))}
                                </select>
                                <button
                                  className="quiet-link"
                                  type="button"
                                  disabled={saving || !selectedCompletions[item.eventId]}
                                  onClick={() => void attachEvent(account, item.eventId)}
                                >
                                  Attach for owner review
                                </button>
                              </div>
                            ) : (
                              <span className="muted-copy">Event recorded</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">No event sources configured for this product.</p>
            )}
          </section>

          {plannedCatalog.length ? (
            <section className="account-card">
              <p className="eyebrow">Provider adapters</p>
              <h2>OAuth client setup needed</h2>
              <p className="muted-copy">
                These adapters are implemented, but the server does not have the required OAuth
                client configuration. Set the matching integration client ID and secret before
                connecting these providers.
              </p>
              <ul className="integration-planned-list">
                {plannedCatalog.map((item: IntegrationCatalogItem) => (
                  <li key={item.provider}>
                    <div className="integration-planned-provider">
                      <strong>{item.name}</strong>
                      <span>
                        OAuth setup needed · requested scopes: {item.requiredScopes.join(", ")}
                      </span>
                    </div>
                    <button className="secondary-button" type="button" disabled>
                      Connect {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="dashboard-note">
            Owner-controlled HMAC sources authenticate only the configured source and can never
            become vendor-verified. OAuth sync events are linked as pending evidence for owner
            review. Only Stripe payment events confirmed through Stripe's API can automatically
            verify a matching task, and the normal Phase 13 reward transaction remains exactly-once.
            Provider event payloads omit email bodies and raw analytics identifiers.
          </p>
        </>
      ) : null}
    </WorkspaceFrame>
  );
}
