"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type CreditReservation,
  type CreditTransaction,
  type CreditWorkspace,
  createCreditIdempotencyKey,
  loadCredits,
  loadProducts,
  type ProductSummary,
  postCreditAction,
} from "../workspace-data";
import { WorkspaceHeader } from "../workspace-header";

function dateLabel(value: string | null): string {
  if (!value) return "No expiry";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function localIso(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default function CreditsPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [workspace, setWorkspace] = useState<CreditWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingKeys = useRef(new Map<string, string>());

  const refresh = useCallback(
    async (scope = productId) => {
      setError("");
      const result = await loadCredits(scope || undefined);
      setWorkspace(result);
    },
    [productId],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([loadProducts(), loadCredits()])
      .then(([items, credits]) => {
        if (!active) return;
        setProducts(items);
        setWorkspace(credits);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Credits could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function runAction<T>(
    path: string,
    body: Record<string, unknown>,
    successMessage: string,
  ): Promise<T | null> {
    setSaving(true);
    setError("");
    setNotice("");
    const operationKey = JSON.stringify([path, productId || null, body]) ?? "";
    const idempotencyKey = pendingKeys.current.get(operationKey) ?? createCreditIdempotencyKey();
    pendingKeys.current.set(operationKey, idempotencyKey);
    try {
      const result = await postCreditAction<T>(path, {
        productId: productId || null,
        idempotencyKey,
        ...body,
      });
      pendingKeys.current.delete(operationKey);
      setNotice(successMessage);
      try {
        await refresh();
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `The operation succeeded, but the wallet could not refresh: ${cause.message}`
            : "The operation succeeded, but the wallet could not refresh.",
        );
      }
      return result;
    } catch (cause) {
      const status = (cause as { status?: number })?.status;
      if (status === 401) window.location.replace("/login");
      else
        setError(
          cause instanceof Error ? cause.message : "The credit operation could not be completed.",
        );
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submitForm(
    event: FormEvent<HTMLFormElement>,
    path: string,
    successMessage: string,
    includeExpiry = false,
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body: Record<string, unknown> = {
      amount: Number(form.get("amount")),
      ...(String(form.get("reason") ?? "").trim()
        ? { reason: String(form.get("reason")).trim() }
        : {}),
    };
    const direction = path === "/api/credits/adjust" ? String(form.get("direction")) : "";
    if (includeExpiry && (path !== "/api/credits/adjust" || direction === "CREDIT")) {
      const expiresAt = localIso(form.get("expiresAt"));
      if (expiresAt) body.expiresAt = expiresAt;
    }
    if (direction) body.direction = direction;
    const result = await runAction(path, body, successMessage);
    if (result) formElement.reset();
  }

  async function expireNow() {
    await runAction("/api/credits/expire", {}, "Expired credits have been reconciled.");
  }

  async function reservationAction(reservation: CreditReservation, action: "release" | "spend") {
    await runAction(
      `/api/credits/reservations/${reservation.id}/${action}`,
      {},
      action === "release" ? "Reserved credits released." : "Reserved credits spent.",
    );
  }

  async function submitRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await runAction(
      "/api/credits/refund",
      {
        transactionId: String(form.get("transactionId")),
        amount: Number(form.get("amount")),
        ...(String(form.get("reason") ?? "").trim()
          ? { reason: String(form.get("reason")).trim() }
          : {}),
      },
      "Refund recorded.",
    );
    if (result) formElement.reset();
  }

  async function changeScope(nextProductId: string) {
    setProductId(nextProductId);
    setLoading(true);
    try {
      await refresh(nextProductId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Credits could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  if (loading)
    return (
      <main className="message-shell">
        <section className="auth-card">
          <p className="notice">Loading credits…</p>
        </section>
      </main>
    );

  const wallet = workspace?.account;
  const refundableTransactions = (workspace?.transactions ?? []).filter(
    (item) => item.action === "SPEND" && item.amount > item.refundedAmount,
  );

  return (
    <main className="auth-shell">
      <WorkspaceHeader active="credits" />
      <section className="dashboard-content">
        <div className="dashboard-intro">
          <p className="eyebrow">Build Credits</p>
          <h1>Credit wallet</h1>
          <p>
            Task rewards enter the product wallet after evidence is manually verified. These
            owner-managed earn and adjustment controls are prototype tools, not billing or proof of
            completed work.
          </p>
        </div>

        {products.length > 0 ? (
          <div className="product-toolbar">
            <label className="product-select">
              Wallet scope
              <select value={productId} onChange={(event) => void changeScope(event.target.value)}>
                <option value="">Account-wide</option>
                {products.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() => void expireNow()}
            >
              Reconcile expirations
            </button>
          </div>
        ) : (
          <div className="product-toolbar">
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() => void expireNow()}
            >
              Reconcile expirations
            </button>
          </div>
        )}

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

        <section className="dashboard-stats" aria-label="Credit balance">
          <article>
            <span>Available</span>
            <strong>{wallet?.availableBalance.toLocaleString() ?? 0}</strong>
          </article>
          <article>
            <span>Reserved</span>
            <strong>{wallet?.reservedBalance.toLocaleString() ?? 0}</strong>
          </article>
          <article>
            <span>Lifetime earned</span>
            <strong>{wallet?.lifetimeEarned.toLocaleString() ?? 0}</strong>
          </article>
          <article>
            <span>Lifetime spent</span>
            <strong>{wallet?.lifetimeSpent.toLocaleString() ?? 0}</strong>
          </article>
        </section>

        <div className="dashboard-columns">
          <section className="account-card">
            <p className="eyebrow">Earn</p>
            <h2>Grant credits</h2>
            <form
              className="product-form"
              onSubmit={(event) =>
                void submitForm(event, "/api/credits/earn", "Credit grant recorded.", true)
              }
            >
              <label>
                Amount
                <input name="amount" type="number" min="1" max="1000000000" step="1" required />
              </label>
              <label>
                Expires at (optional)
                <input name="expiresAt" type="datetime-local" />
              </label>
              <label>
                Reason (optional)
                <input name="reason" maxLength={300} />
              </label>
              <button className="primary-button" type="submit" disabled={saving}>
                Earn credits
              </button>
            </form>
          </section>
          <section className="account-card">
            <p className="eyebrow">Spend</p>
            <h2>Spend available credits</h2>
            <form
              className="product-form"
              onSubmit={(event) => void submitForm(event, "/api/credits/spend", "Credits spent.")}
            >
              <label>
                Amount
                <input name="amount" type="number" min="1" max="1000000000" step="1" required />
              </label>
              <label>
                Reason (optional)
                <input name="reason" maxLength={300} />
              </label>
              <button className="secondary-button" type="submit" disabled={saving}>
                Spend credits
              </button>
            </form>
          </section>
        </div>

        <div className="dashboard-columns">
          <section className="account-card">
            <p className="eyebrow">Reserve</p>
            <h2>Hold credits for later</h2>
            <form
              className="product-form"
              onSubmit={(event) =>
                void submitForm(event, "/api/credits/reserve", "Credits reserved.", true)
              }
            >
              <label>
                Amount
                <input name="amount" type="number" min="1" max="1000000000" step="1" required />
              </label>
              <label>
                Reservation expires at (optional)
                <input name="expiresAt" type="datetime-local" />
              </label>
              <label>
                Reason (optional)
                <input name="reason" maxLength={300} />
              </label>
              <button className="secondary-button" type="submit" disabled={saving}>
                Reserve credits
              </button>
            </form>
          </section>
          <section className="account-card">
            <p className="eyebrow">Adjust</p>
            <h2>Correct a balance</h2>
            <form
              className="product-form"
              onSubmit={(event) =>
                void submitForm(event, "/api/credits/adjust", "Credit adjustment recorded.", true)
              }
            >
              <label>
                Adjustment
                <select name="direction" defaultValue="CREDIT">
                  <option value="CREDIT">Add credits</option>
                  <option value="DEBIT">Remove available credits</option>
                </select>
              </label>
              <label>
                Amount
                <input name="amount" type="number" min="1" max="1000000000" step="1" required />
              </label>
              <label>
                Expires at (optional, added credits only)
                <input name="expiresAt" type="datetime-local" />
              </label>
              <label>
                Reason
                <input name="reason" minLength={2} maxLength={300} required />
              </label>
              <button className="secondary-button" type="submit" disabled={saving}>
                Apply adjustment
              </button>
            </form>
          </section>
        </div>

        <div className="dashboard-columns">
          <section className="account-card">
            <p className="eyebrow">Refund</p>
            <h2>Refund a spend</h2>
            {refundableTransactions.length ? (
              <form className="product-form" onSubmit={(event) => void submitRefund(event)}>
                <label>
                  Spent transaction
                  <select name="transactionId" required>
                    {refundableTransactions.map((transaction) => (
                      <option key={transaction.id} value={transaction.id}>
                        {transaction.amount} credits · {dateLabel(transaction.createdAt)} ·{" "}
                        {transaction.amount - transaction.refundedAmount} refundable
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Refund amount
                  <input name="amount" type="number" min="1" step="1" required />
                </label>
                <label>
                  Reason (optional)
                  <input name="reason" maxLength={300} />
                </label>
                <button className="secondary-button" type="submit" disabled={saving}>
                  Refund credits
                </button>
              </form>
            ) : (
              <p className="muted-copy">Spent credits that can be refunded will appear here.</p>
            )}
          </section>
          <section className="account-card">
            <p className="eyebrow">Reservations</p>
            <h2>Held credits</h2>
            {workspace?.reservations.length ? (
              <ul className="goal-list">
                {workspace.reservations
                  .filter((item) => item.status === "ACTIVE")
                  .map((reservation) => (
                    <li key={reservation.id}>
                      <div>
                        <strong>{reservation.remainingAmount} credits active</strong>
                        <span>Expires {dateLabel(reservation.expiresAt)}</span>
                      </div>
                      <div className="goal-actions">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void reservationAction(reservation, "release")}
                        >
                          Release
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void reservationAction(reservation, "spend")}
                        >
                          Spend
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="muted-copy">There are no active reservations.</p>
            )}
          </section>
        </div>

        <section className="account-card">
          <p className="eyebrow">Ledger</p>
          <h2>Recent credit activity</h2>
          {workspace?.transactions.length ? (
            <ol className="history-list">
              {workspace.transactions.map((transaction: CreditTransaction) => (
                <li key={transaction.id}>
                  <strong>
                    {transaction.action} · {transaction.amount.toLocaleString()} credits
                  </strong>
                  <span>
                    Available {transaction.availableDelta >= 0 ? "+" : ""}
                    {transaction.availableDelta.toLocaleString()} · Reserved{" "}
                    {transaction.reservedDelta >= 0 ? "+" : ""}
                    {transaction.reservedDelta.toLocaleString()} ·{" "}
                    {dateLabel(transaction.createdAt)}
                  </span>
                  {transaction.relatedTransactionId ? (
                    <small>Related transaction {transaction.relatedTransactionId}</small>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted-copy">Credit transactions will appear here.</p>
          )}
        </section>
        <p className="dashboard-note">
          This phase provides the ledger and wallet controls. Reward verification and production
          credit grants are added with the task and evidence phases.
        </p>
      </section>
      <footer className="auth-footer">Enough · Build with evidence.</footer>
    </main>
  );
}
