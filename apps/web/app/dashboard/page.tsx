"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  changeProductStage,
  createProduct,
  createProductGoal,
  loadOnboarding,
  loadProduct,
  loadProducts,
  type OnboardingResult,
  type ProductDetail,
  type ProductGoal,
  type ProductStage,
  type ProductSummary,
  productStageLabels,
  productStages,
  recordProductMetric,
  updateProductGoal,
} from "../workspace-data";
import { WorkspaceHeader } from "../workspace-header";

function revenueLabel(amount: string | null, currency: string): string {
  if (amount === null) return "Not provided";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export default function DashboardPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([loadProducts(), loadOnboarding()])
      .then(([items, profile]) => {
        if (!active) return;
        setOnboarding(profile);
        setProducts(items);
        if (items.length === 0) {
          setShowCreate(true);
          return;
        }
        const requestedId = new URLSearchParams(window.location.search).get("productId");
        setSelectedId(
          requestedId && items.some((item) => item.id === requestedId) ? requestedId : items[0].id,
        );
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) {
          window.location.replace("/login");
          return;
        }
        if (active)
          setError(cause instanceof Error ? cause.message : "Your workspace could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetail(null);
    setDetailLoading(true);
    setActionError("");
    void loadProduct(selectedId)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) {
          window.location.replace("/login");
          return;
        }
        if (active)
          setActionError(
            cause instanceof Error ? cause.message : "This product could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("productId", selectedId);
    window.history.replaceState({}, "", url);
  }, [selectedId]);

  async function refreshWorkspace(productId = selectedId) {
    const [items, loaded, profile] = await Promise.all([
      loadProducts(),
      productId ? loadProduct(productId) : Promise.resolve(null),
      loadOnboarding(),
    ]);
    setProducts(items);
    setOnboarding(profile);
    if (loaded) setDetail(loaded);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setActionError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await createProduct({
        name: String(form.get("name") ?? ""),
        targetCustomer: String(form.get("targetCustomer") ?? ""),
        problemStatement: String(form.get("problemStatement") ?? ""),
        productStage: String(form.get("productStage") ?? "IDEA") as ProductStage,
        initialGoal: String(form.get("initialGoal") ?? ""),
      });
      setProducts((items) => [
        result.product,
        ...items.filter((item) => item.id !== result.product.id),
      ]);
      setSelectedId(result.product.id);
      setShowCreate(false);
      setNotice("Product created. Its starting guidance is ready.");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The product could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function submitStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError("");
    setNotice("");
    try {
      const result = await changeProductStage(
        detail.product.id,
        String(form.get("productStage")) as ProductStage,
        String(form.get("reason") ?? ""),
        detail.product.productStage,
      );
      await refreshWorkspace();
      setNotice(
        result.changed
          ? "Stage updated. Your recommendations now match the selected stage."
          : "Stage unchanged. Your current recommendations are still available.",
      );
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "The product stage could not be changed.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get("title") ?? "");
    setSaving(true);
    setActionError("");
    try {
      await createProductGoal(detail.product.id, title, form.get("isPrimary") === "on");
      formElement.reset();
      await refreshWorkspace();
      setNotice("Goal added.");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The goal could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function setGoalStatus(goal: ProductGoal, status: ProductGoal["status"]) {
    if (!detail) return;
    setSaving(true);
    setActionError("");
    try {
      await updateProductGoal(detail.product.id, goal.id, status, goal.status);
      await refreshWorkspace();
      setNotice(status === "COMPLETED" ? "Goal marked complete." : "Goal cancelled.");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The goal could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function submitMetric(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setActionError("");
    try {
      await recordProductMetric(detail.product.id, {
        metricKey: String(form.get("metricKey") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        value: String(form.get("value") ?? ""),
        unit: String(form.get("unit") ?? ""),
        expectedValue:
          form.get("metricKey") === "total_users"
            ? String(detail.product.userCount)
            : form.get("metricKey") === "paying_users"
              ? String(detail.product.payingUserCount)
              : form.get("metricKey") === "current_revenue"
                ? detail.product.currentRevenue
                : undefined,
        expectedCurrency: detail.product.revenueCurrency,
      });
      formElement.reset();
      await refreshWorkspace();
      setNotice("Metric recorded.");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The metric could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <main className="message-shell">
        <section className="auth-card">
          <p className="notice">Loading your workspace…</p>
        </section>
      </main>
    );
  if (error)
    return (
      <main className="message-shell">
        <section className="auth-card">
          <p className="eyebrow">Enough</p>
          <h1>Workspace unavailable</h1>
          <p className="error" role="alert">
            {error}
          </p>
          <a className="primary-button link-button" href="/onboarding">
            Try again
          </a>
        </section>
      </main>
    );

  const product = detail?.product;
  const guidance = product?.guidance;

  return (
    <main className="auth-shell">
      <WorkspaceHeader active="products" />
      <section className="dashboard-content">
        <div className="dashboard-intro">
          <p className="eyebrow">Your workspace</p>
          <h1>
            {product?.name ?? (products.length ? "Product workspace" : "Set up your product")}
          </h1>
          <p>
            Product stages organize your current focus. Recommendations and build to market ratios
            are guidance you can revise as you learn.
          </p>
        </div>

        {products.length > 0 || showCreate ? (
          <div className="product-toolbar">
            {products.length > 1 ? (
              <label className="product-select">
                Product
                <select
                  value={selectedId}
                  disabled={saving}
                  onChange={(event) => setSelectedId(event.target.value)}
                >
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {products.length > 0 ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowCreate((value) => !value)}
              >
                {showCreate ? "Close" : "Add product"}
              </button>
            ) : null}
          </div>
        ) : null}

        {showCreate ? (
          <section className="account-card">
            <p className="eyebrow">New product</p>
            <h2>Add a product workspace</h2>
            <form className="product-form" onSubmit={submitCreate}>
              <label>
                Product name
                <input name="name" required minLength={3} maxLength={240} />
              </label>
              <label>
                Who is it for?
                <input name="targetCustomer" required minLength={2} maxLength={240} />
              </label>
              <label>
                Problem it solves
                <textarea name="problemStatement" required minLength={3} maxLength={500} rows={3} />
              </label>
              <label>
                Current stage
                <select name="productStage" defaultValue="IDEA">
                  {productStages.map((stage) => (
                    <option key={stage} value={stage}>
                      {productStageLabels[stage]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                First goal
                <input name="initialGoal" required minLength={2} maxLength={250} />
              </label>
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Create product"}
              </button>
            </form>
          </section>
        ) : null}

        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        {actionError ? (
          <p className="error" role="alert">
            {actionError}
          </p>
        ) : null}

        {detailLoading && !detail ? <p className="notice">Loading product details…</p> : null}
        {product && guidance ? (
          <>
            <div className="dashboard-intro product-context">
              <p>
                <strong>For:</strong> {product.targetCustomer}
              </p>
              <p>
                <strong>Problem:</strong> {product.problemStatement}
              </p>
            </div>
            <section className="recommendation-card">
              <div>
                <p className="eyebrow">{product.productStageLabel} · Recommended focus</p>
                <h2>{guidance.headline}</h2>
              </div>
              {onboarding?.productId === product.id && onboarding.recommendation ? (
                <section>
                  <h3>Recommended next action</h3>
                  <p>{onboarding.recommendation.firstAction}</p>
                  <a href="/onboarding">Edit onboarding answers</a>
                </section>
              ) : null}
              <div className="ratio-block">
                <div className="ratio-labels">
                  <span>
                    Build <strong>{guidance.buildPercent}%</strong>
                  </span>
                  <span>
                    Customer learning <strong>{guidance.marketPercent}%</strong>
                  </span>
                </div>
                <div
                  className="ratio-bar"
                  role="img"
                  aria-label={`Recommended time split: ${guidance.buildPercent}% building and ${guidance.marketPercent}% customer learning`}
                >
                  <i style={{ width: `${guidance.buildPercent}%` }} />
                  <i style={{ width: `${guidance.marketPercent}%` }} />
                </div>
                <p className="dashboard-note">
                  A suggested balance for this stage, not a required schedule.
                </p>
              </div>
              <div className="dashboard-columns">
                <section>
                  <h3>Priorities</h3>
                  <ul>
                    {guidance.priorities.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3>Signals to notice</h3>
                  <ul>
                    {guidance.signals.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              </div>
              <section className="guidance-tasks">
                <h3>Suggested tasks</h3>
                <ul>
                  {guidance.tasks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </section>

            <section className="dashboard-stats" aria-label="Product snapshot">
              <article>
                <span>Total users</span>
                <strong>{product.userCount.toLocaleString()}</strong>
              </article>
              <article>
                <span>Paying users</span>
                <strong>{product.payingUserCount.toLocaleString()}</strong>
              </article>
              <article>
                <span>Current revenue</span>
                <strong>{revenueLabel(product.currentRevenue, product.revenueCurrency)}</strong>
              </article>
              <article>
                <span>Launched</span>
                <strong>{product.hasLaunched ? "Yes" : "Not yet"}</strong>
              </article>
            </section>

            <div className="dashboard-columns">
              <section className="account-card">
                <p className="eyebrow">Stage history</p>
                <h2>How your focus changed</h2>
                {detail.stageHistory.length ? (
                  <ol className="history-list">
                    {detail.stageHistory.map((item) => (
                      <li key={item.id}>
                        <strong>{item.toStageLabel}</strong>
                        <span>
                          {item.fromStageLabel ? `From ${item.fromStageLabel}` : "Starting stage"} ·{" "}
                          {displayDate(item.changedAt)}
                        </span>
                        {item.reason ? <small>{item.reason}</small> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted-copy">Stage updates will appear here.</p>
                )}
              </section>
              <section className="account-card">
                <p className="eyebrow">Update stage</p>
                <h2>Choose your current stage</h2>
                <form
                  key={`${product.id}:${product.productStage}`}
                  className="product-form"
                  onSubmit={submitStage}
                >
                  <label>
                    Stage
                    <select name="productStage" defaultValue={product.productStage}>
                      {productStages.map((stage) => (
                        <option key={stage} value={stage}>
                          {productStageLabels[stage]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    What changed? (optional)
                    <input
                      name="reason"
                      maxLength={500}
                      placeholder="A new signal from customers"
                    />
                  </label>
                  <button className="secondary-button" type="submit" disabled={saving}>
                    Update stage
                  </button>
                </form>
              </section>
            </div>

            <section className="account-card">
              <p className="eyebrow">Goals</p>
              <h2>Keep the next step visible</h2>
              <form className="product-form goal-add-form" onSubmit={submitGoal}>
                <label>
                  Add a goal
                  <input
                    name="title"
                    required
                    minLength={2}
                    maxLength={250}
                    placeholder="Interview five likely customers"
                  />
                </label>
                <label className="check-row">
                  <input type="checkbox" name="isPrimary" />
                  Make this the primary goal
                </label>
                <button className="secondary-button" type="submit" disabled={saving}>
                  Add goal
                </button>
              </form>
              {detail.goals.length ? (
                <ul className="goal-list">
                  {detail.goals.map((goal) => (
                    <li key={goal.id}>
                      <div>
                        <strong>{goal.title}</strong>
                        <span>
                          {goal.status.toLowerCase()}
                          {goal.isPrimary ? " · primary" : ""}
                        </span>
                      </div>
                      {goal.status === "ACTIVE" ? (
                        <div className="goal-actions">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void setGoalStatus(goal, "COMPLETED")}
                          >
                            Complete
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void setGoalStatus(goal, "CANCELLED")}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">No goals yet.</p>
              )}
            </section>

            <div className="dashboard-columns">
              <section className="account-card">
                <p className="eyebrow">Metrics</p>
                <h2>Record a product signal</h2>
                <form className="product-form metric-form" onSubmit={submitMetric}>
                  <label>
                    Metric key
                    <input
                      name="metricKey"
                      required
                      pattern="[a-z][a-z0-9_]{0,49}"
                      defaultValue="total_users"
                    />
                  </label>
                  <label>
                    Display name
                    <input
                      name="displayName"
                      required
                      minLength={2}
                      maxLength={100}
                      defaultValue="Total users"
                    />
                  </label>
                  <label>
                    Value
                    <input name="value" required inputMode="decimal" defaultValue="0" />
                  </label>
                  <label>
                    Unit (or currency)
                    <input name="unit" required maxLength={32} defaultValue="users" />
                  </label>
                  <button className="secondary-button" type="submit" disabled={saving}>
                    Record metric
                  </button>
                </form>
              </section>
              <section className="account-card">
                <p className="eyebrow">Recent observations</p>
                <h2>Metric history</h2>
                {detail.metrics.length ? (
                  <ol className="history-list metric-history">
                    {detail.metrics.slice(0, 12).map((metric) => (
                      <li key={metric.id}>
                        <strong>
                          {metric.displayName}: {metric.value} {metric.unit}
                        </strong>
                        <span>{displayDate(metric.recordedAt)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted-copy">Recorded metrics will appear here.</p>
                )}
              </section>
            </div>
          </>
        ) : products.length > 0 && !detailLoading ? (
          <p className="muted-copy">Select a product to view its workspace.</p>
        ) : null}
        <p className="dashboard-note">
          Stage guidance and ratios are suggestions. Update the stage whenever new evidence changes
          how you see the product.
        </p>
      </section>
      <footer className="auth-footer">Enough · Build with evidence.</footer>
    </main>
  );
}
