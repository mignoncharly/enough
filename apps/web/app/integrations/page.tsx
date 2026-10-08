"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  createIntegration,
  type IntegrationAccountSummary,
  type IntegrationCatalogItem,
  type IntegrationWorkspace,
  loadIntegrations,
  loadProducts,
  type ProductSummary,
  revokeIntegration,
} from "../workspace-data";
import { WorkspaceFrame } from "../workspace-frame";

const availableProviders = ["WEBHOOK", "PUBLIC_API"] as const;
type AvailableProvider = (typeof availableProviders)[number];

function providerName(provider: string): string {
  return provider === "PUBLIC_API"
    ? "Public Event API"
    : provider === "WEBHOOK"
      ? "Generic webhook"
      : provider;
}

function eventStatusLabel(status: string): string {
  return status === "AUTHENTICATED"
    ? "signature verified"
    : status.toLocaleLowerCase().replaceAll("_", " ");
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
    if (!productId) {
      setWorkspace(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void loadIntegrations(productId)
      .then((result) => {
        if (active) setWorkspace(result);
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
    if (productId) setWorkspace(await loadIntegrations(productId));
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
      await revokeIntegration(account.id);
      await refresh();
      setNotice(
        `${account.displayName} disconnected. Its API key and signing secret were revoked.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The integration could not be disconnected.",
      );
    } finally {
      setSaving(false);
    }
  }

  const availableCatalog = workspace?.catalog.filter((item) => item.available) ?? [];
  const plannedCatalog = workspace?.catalog.filter((item) => !item.available) ?? [];

  return (
    <WorkspaceFrame
      active="integrations"
      eyebrow="Integrations"
      title="Bring signed events into Enough"
      description="Connect a signed event source to record selected customer, revenue, calendar, and product analytics events. Linked task evidence enters the normal owner review queue."
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
            <p className="eyebrow">Connection architecture</p>
            <h2>Create a signed event source</h2>
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
                  {availableCatalog.map((item) => (
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
                        </span>
                      </div>
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
                    {account.recentEvents.length ? (
                      <ul className="integration-event-list">
                        {account.recentEvents.map((item) => (
                          <li key={item.id}>
                            <div>
                              <strong>{item.eventType}</strong>
                              <span>
                                {new Date(item.occurredAt).toLocaleString()} ·{" "}
                                {eventStatusLabel(item.verificationStatus)}
                              </span>
                            </div>
                            {item.completionId ? (
                              <a
                                className="quiet-link"
                                href={`/evidence?productId=${account.productId}&completionId=${item.completionId}`}
                              >
                                View linked evidence
                              </a>
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
              <h2>Planned connections</h2>
              <p className="muted-copy">
                The shared account, encrypted token, sync-run, error, event, and verification model
                is ready. These vendor OAuth/API adapters still need provider-specific scopes, sync
                logic, and signature validation.
              </p>
              <ul className="integration-planned-list">
                {plannedCatalog.map((item: IntegrationCatalogItem) => (
                  <li key={item.provider}>
                    <strong>{item.name}</strong>
                    <span>{item.mode.toLocaleLowerCase().replaceAll("_", " ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="dashboard-note">
            A valid signature authenticates the configured source; it does not prove that a vendor
            produced the event or that the event claim is true. The product owner controls this
            signing source. Vendor-backed verification requires provider-specific OAuth and
            signature adapters. Event payloads omit free-form metadata and hash external user
            references before storage.
          </p>
        </>
      ) : null}
    </WorkspaceFrame>
  );
}
