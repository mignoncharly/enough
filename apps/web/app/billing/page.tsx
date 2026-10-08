"use client";

import { useEffect, useState } from "react";
import {
  type BillingData,
  type BillingPlan,
  loadBilling,
  openBillingPortal,
  startBillingCheckout,
} from "../workspace-data";
import { displayWorkspaceDate, WorkspaceError, WorkspaceFrame } from "../workspace-frame";

function formatMoney(minor: number, currency: string): string {
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / 10 ** exponent);
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: "Active",
    trialing: "Trial",
    past_due: "Payment due",
    incomplete: "Payment setup incomplete",
    incomplete_expired: "Checkout expired",
    unpaid: "Unpaid",
    paused: "Paused",
    canceled: "Canceled",
    ACTIVE: "Active",
    GRACE: "Temporary access",
    INACTIVE: "No paid access",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function planPrice(plan: BillingPlan): string {
  if (
    plan.amountMinor === undefined ||
    plan.amountMinor === null ||
    !plan.currency ||
    !plan.interval
  )
    return "Price shown at checkout";
  const interval = plan.interval === "year" ? "year" : "month";
  return `${formatMoney(plan.amountMinor, plan.currency)} / ${interval}`;
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const checkoutResult = new URLSearchParams(window.location.search).get("checkout");
    if (checkoutResult === "success")
      setNotice(
        "Checkout returned successfully. Your subscription and access update after Stripe confirms it.",
      );
    if (checkoutResult === "cancelled")
      setNotice("Checkout was canceled. No subscription was started.");
    void loadBilling()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if ((cause as { status?: number })?.status === 401) window.location.replace("/login");
        else setError(cause instanceof Error ? cause.message : "Billing could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function refresh() {
    setBusy("refresh");
    setError("");
    try {
      setData(await loadBilling());
    } catch (cause) {
      if ((cause as { status?: number })?.status === 401) window.location.replace("/login");
      else setError(cause instanceof Error ? cause.message : "Billing could not be refreshed.");
    } finally {
      setBusy("");
    }
  }

  async function checkout(planKey: "monthly" | "annual") {
    setBusy(planKey);
    setError("");
    try {
      const result = await startBillingCheckout(planKey, crypto.randomUUID());
      window.location.assign(result.checkoutUrl);
    } catch (cause) {
      if ((cause as { status?: number })?.status === 401) window.location.replace("/login");
      else setError(cause instanceof Error ? cause.message : "Checkout could not be started.");
      setBusy("");
    }
  }

  async function manage() {
    setBusy("portal");
    setError("");
    try {
      const result = await openBillingPortal();
      window.location.assign(result.portalUrl);
    } catch (cause) {
      if ((cause as { status?: number })?.status === 401) window.location.replace("/login");
      else
        setError(
          cause instanceof Error ? cause.message : "The billing portal could not be opened.",
        );
      setBusy("");
    }
  }

  if (loading)
    return (
      <WorkspaceFrame
        active="billing"
        eyebrow="Billing"
        title="Your subscription"
        description="Manage your plan, payment details, and invoices."
      >
        <p className="notice" role="status">
          Loading billing information…
        </p>
      </WorkspaceFrame>
    );
  if (!data && error)
    return (
      <WorkspaceFrame
        active="billing"
        eyebrow="Billing"
        title="Your subscription"
        description="Manage your plan, payment details, and invoices."
      >
        <WorkspaceError message={error} />
      </WorkspaceFrame>
    );
  if (!data) return null;

  const subscription = data.subscription;
  const busyNow = Boolean(busy);
  const subscriptionNeedsPortal =
    subscription &&
    ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"].includes(
      subscription.status,
    );

  return (
    <WorkspaceFrame
      active="billing"
      eyebrow="Billing"
      title="Your subscription"
      description="Manage your plan, payment details, and invoices."
    >
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}

      <section className="account-card billing-current" aria-labelledby="billing-current-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Current access</p>
            <h2 id="billing-current-heading">
              {subscription ? statusLabel(subscription.status) : "Free"}
            </h2>
          </div>
          <span className={`billing-state billing-state-${data.entitlements.status.toLowerCase()}`}>
            {data.entitlements.hasPaidAccess
              ? "Paid entitlement active"
              : "Paid entitlement inactive"}
          </span>
        </div>
        {subscription ? (
          <dl className="billing-details">
            <div>
              <dt>Plan</dt>
              <dd>
                {subscription.planKey === "annual" ? "Annual subscription" : "Monthly subscription"}
              </dd>
            </div>
            <div>
              <dt>Subscription status</dt>
              <dd>{statusLabel(subscription.status)}</dd>
            </div>
            {subscription.trialEnd ? (
              <div>
                <dt>Trial ends</dt>
                <dd>{displayWorkspaceDate(subscription.trialEnd)}</dd>
              </div>
            ) : null}
            {subscription.currentPeriodEnd ? (
              <div>
                <dt>Current period ends</dt>
                <dd>{displayWorkspaceDate(subscription.currentPeriodEnd)}</dd>
              </div>
            ) : null}
            {subscription.cancelAtPeriodEnd ? (
              <div>
                <dt>Cancellation</dt>
                <dd>Scheduled at the end of this billing period</dd>
              </div>
            ) : null}
            {subscription.graceUntil && data.entitlements.status === "GRACE" ? (
              <div>
                <dt>Payment grace period</dt>
                <dd>
                  Access remains enabled until {displayWorkspaceDate(subscription.graceUntil)}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="muted-copy">You can use the free workspace. A subscription is optional.</p>
        )}
        <div className="button-row">
          {data.canManage ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void manage()}
              disabled={busyNow}
            >
              {busy === "portal" ? "Opening portal…" : "Manage billing"}
            </button>
          ) : null}
          <button
            className="quiet-button"
            type="button"
            onClick={() => void refresh()}
            disabled={busyNow}
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh status"}
          </button>
        </div>
      </section>

      {data.plans.length > 0 && !subscriptionNeedsPortal ? (
        <section className="account-card" aria-labelledby="billing-plans-heading">
          <p className="eyebrow">Subscription options</p>
          <h2 id="billing-plans-heading">Choose a billing interval</h2>
          <p className="muted-copy">
            {data.automaticTax
              ? "Taxes are calculated at checkout. "
              : "Tax is handled outside Stripe checkout. "}
            You can enter a coupon code there. The payment provider collects billing address and VAT
            ID details.
          </p>
          <div className="billing-plan-list">
            {data.plans.map((plan) => (
              <article className="billing-plan" key={plan.key}>
                <div>
                  <h3>{plan.label}</h3>
                  <p>{planPrice(plan)}</p>
                  {data.trialDays > 0 ? (
                    <small>
                      A trial may be available to eligible accounts. Checkout confirms eligibility
                      and terms.
                    </small>
                  ) : null}
                </div>
                <button
                  className="primary-button"
                  type="button"
                  disabled={busyNow}
                  onClick={() => void checkout(plan.key)}
                >
                  {busy === plan.key
                    ? "Opening checkout…"
                    : `Continue with ${plan.label.toLowerCase()}`}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {data.plans.length === 0 ? (
        <section className="account-card">
          <p className="eyebrow">Subscription options</p>
          <h2>Pricing is not configured</h2>
          <p className="muted-copy">
            Subscription checkout will appear after validated Stripe monthly or annual prices are
            configured. Your current workspace access is unchanged.
          </p>
        </section>
      ) : null}

      <section className="account-card" aria-labelledby="billing-invoices-heading">
        <p className="eyebrow">Payment history</p>
        <h2 id="billing-invoices-heading">Invoices</h2>
        {data.invoices.length === 0 ? (
          <p className="muted-copy">Invoices will appear here after Stripe sends billing events.</p>
        ) : (
          <ol className="billing-invoice-list">
            {data.invoices.map((invoice) => (
              <li key={invoice.id}>
                <div>
                  <strong>{invoice.number ?? `Invoice ${invoice.id.slice(-8)}`}</strong>
                  <span>
                    {statusLabel(invoice.status ?? "unknown")} ·{" "}
                    {displayWorkspaceDate(invoice.createdAt)}
                  </span>
                  {invoice.taxMinor > 0 ? (
                    <span>Tax: {formatMoney(invoice.taxMinor, invoice.currency)}</span>
                  ) : null}
                  {invoice.lastPaymentError ? (
                    <span className="error-copy">
                      Payment needs attention: {invoice.lastPaymentError}
                    </span>
                  ) : null}
                </div>
                <div className="billing-invoice-total">
                  <strong>
                    {formatMoney(
                      invoice.amountPaidMinor || invoice.amountDueMinor,
                      invoice.currency,
                    )}
                  </strong>
                  {invoice.hostedInvoiceUrl ? (
                    <a
                      className="quiet-link"
                      href={invoice.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open invoice
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="fine-print">
          Subscriptions, cancellations, coupon redemption, and invoice status are confirmed by
          signed Stripe webhooks. Checkout return links do not grant access.
        </p>
      </section>
    </WorkspaceFrame>
  );
}
