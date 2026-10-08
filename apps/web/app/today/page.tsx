"use client";

import { useEffect, useState } from "react";
import {
  type ActivityEventRecord,
  type CreditWorkspace,
  loadActivityEvents,
  loadCredits,
  loadProduct,
  loadProducts,
  type ProductDetail,
  type ProductSummary,
} from "../workspace-data";
import { displayWorkspaceDate, WorkspaceFrame } from "../workspace-frame";

export default function TodayPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [events, setEvents] = useState<ActivityEventRecord[]>([]);
  const [credits, setCredits] = useState<CreditWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void loadProducts()
      .then((items) => {
        if (!active) return;
        setProducts(items);
        const requested = new URLSearchParams(window.location.search).get("productId");
        setProductId(items.find((item) => item.id === requested)?.id ?? items[0]?.id ?? "");
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
    if (!productId) return;
    let active = true;
    setLoading(true);
    setError("");
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    void Promise.all([
      loadProduct(productId),
      loadActivityEvents({ productId, since: startOfDay.toISOString(), limit: 100 }),
      loadCredits(productId),
    ])
      .then(([product, activity, wallet]) => {
        if (!active) return;
        setDetail(product);
        setEvents(activity.events);
        setCredits(wallet);
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "Today could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  return (
    <WorkspaceFrame
      active="today"
      eyebrow="Today"
      title={detail?.product.name ?? "Your day"}
      description="A clear next step, based on your current product stage and recent activity."
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
          Loading today’s workspace…
        </p>
      ) : null}
      {error ? (
        <section className="account-card" role="alert">
          <h2>Today could not be loaded</h2>
          <p className="error">{error}</p>
          <a className="secondary-button link-button" href="/dashboard">
            Return to workspace
          </a>
        </section>
      ) : null}
      {!loading && !error && products.length === 0 ? (
        <section className="account-card">
          <p className="eyebrow">Set up a product</p>
          <h2>Your daily view starts with a product workspace</h2>
          <p className="muted-copy">
            Add the product you are building to get stage guidance, goals, and a place for activity.
          </p>
          <a className="primary-button link-button" href="/onboarding">
            Start onboarding
          </a>
        </section>
      ) : null}
      {!loading && !error && detail ? (
        <>
          <section className="recommendation-card">
            <div>
              <p className="eyebrow">{detail.product.productStageLabel} · Focus</p>
              <h2>{detail.product.guidance.headline}</h2>
            </div>
            <p className="review-prompt">
              Today’s recommended balance: {detail.product.guidance.buildPercent}% building and{" "}
              {detail.product.guidance.marketPercent}% customer learning.
            </p>
            <div className="dashboard-columns">
              <section>
                <h3>Next actions</h3>
                <ul>
                  {detail.product.guidance.tasks.slice(0, 3).map((task) => (
                    <li key={task}>{task}</li>
                  ))}
                </ul>
                <a className="quiet-link" href={`/tasks?productId=${detail.product.id}`}>
                  Open tasks
                </a>
              </section>
              <section>
                <h3>Active goals</h3>
                {detail.goals.filter((goal) => goal.status === "ACTIVE").length ? (
                  <ul>
                    {detail.goals
                      .filter((goal) => goal.status === "ACTIVE")
                      .slice(0, 4)
                      .map((goal) => (
                        <li key={goal.id}>{goal.title}</li>
                      ))}
                  </ul>
                ) : (
                  <p className="muted-copy">No active goals yet.</p>
                )}
                <a className="quiet-link" href={`/products?productId=${detail.product.id}`}>
                  Open product
                </a>
              </section>
            </div>
          </section>
          <section className="dashboard-stats" aria-label="Today’s summary">
            <article>
              <span>Activity events today</span>
              <strong>{events.length}</strong>
            </article>
            <article>
              <span>Available credits</span>
              <strong>{credits?.account.availableBalance.toLocaleString() ?? 0}</strong>
            </article>
            <article>
              <span>Goals completed</span>
              <strong>{detail.goals.filter((goal) => goal.status === "COMPLETED").length}</strong>
            </article>
            <article>
              <span>Current stage</span>
              <strong>{detail.product.productStageLabel}</strong>
            </article>
          </section>
          <section className="account-card">
            <p className="eyebrow">Recent activity</p>
            <h2>What happened today</h2>
            {events.length ? (
              <ol className="history-list">
                {events.slice(0, 8).map((event) => (
                  <li key={event.id}>
                    <strong>{event.eventType.replaceAll("_", " ")}</strong>
                    <span>
                      {displayWorkspaceDate(event.effectiveAt)}
                      {event.clockAdjusted ? " · client clock adjusted" : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted-copy">
                No activity has been recorded today. Activity appears after an authorized client
                sends events.
              </p>
            )}
            <a className="quiet-link" href={`/activity?productId=${detail.product.id}`}>
              View activity
            </a>
          </section>
        </>
      ) : null}
    </WorkspaceFrame>
  );
}
