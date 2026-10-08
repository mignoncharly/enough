"use client";

import { useEffect, useState } from "react";
import {
  type ActivityEventRecord,
  loadActivityEvents,
  loadProduct,
  loadProducts,
  type ProductDetail,
  type ProductSummary,
} from "../workspace-data";
import { displayWorkspaceDate, WorkspaceFrame } from "../workspace-frame";

export default function GrowthPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [events, setEvents] = useState<ActivityEventRecord[]>([]);
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
        setLoading(false);
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "Products could not be loaded.");
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
    const since = new Date();
    since.setDate(since.getDate() - 7);
    void Promise.all([
      loadProduct(productId),
      loadActivityEvents({ productId, since: since.toISOString(), limit: 100 }),
    ])
      .then(([product, activity]) => {
        if (!active) return;
        setDetail(product);
        setEvents(activity.events);
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "Growth guidance could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  const signalEvents = events.filter((event) =>
    /customer|interview|feedback|market|sales|signup|revenue/i.test(event.eventType),
  );

  return (
    <WorkspaceFrame
      active="growth"
      eyebrow="Growth"
      title="Get closer to the market"
      description="Use stage guidance to choose customer learning that can inform what you build next."
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
          Loading growth guidance…
        </p>
      ) : null}
      {error ? (
        <section className="account-card" role="alert">
          <h2>Growth guidance could not be loaded</h2>
          <p className="error">{error}</p>
          <a className="secondary-button link-button" href="/login">
            Sign in again
          </a>
        </section>
      ) : null}
      {!loading && !error && products.length === 0 ? (
        <section className="account-card">
          <p className="eyebrow">No product yet</p>
          <h2>Growth guidance follows your product stage</h2>
          <p className="muted-copy">
            Create a product workspace to see recommendations for customer learning.
          </p>
          <a className="primary-button link-button" href="/onboarding">
            Start onboarding
          </a>
        </section>
      ) : null}
      {detail ? (
        <>
          <section className="recommendation-card">
            <div>
              <p className="eyebrow">{detail.product.productStageLabel}</p>
              <h2>{detail.product.guidance.headline}</h2>
            </div>
            <div className="ratio-block">
              <div className="ratio-labels">
                <span>
                  Build <strong>{detail.product.guidance.buildPercent}%</strong>
                </span>
                <span>
                  Customer learning <strong>{detail.product.guidance.marketPercent}%</strong>
                </span>
              </div>
              <div
                className="ratio-bar"
                role="img"
                aria-label={`Suggested split: ${detail.product.guidance.buildPercent}% building and ${detail.product.guidance.marketPercent}% customer learning`}
              >
                <i style={{ width: `${detail.product.guidance.buildPercent}%` }} />
                <i style={{ width: `${detail.product.guidance.marketPercent}%` }} />
              </div>
            </div>
            <div className="dashboard-columns">
              <section>
                <h3>Signals to notice</h3>
                <ul>
                  {detail.product.guidance.signals.map((signal) => (
                    <li key={signal}>{signal}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>Suggested market actions</h3>
                <ul>
                  {detail.product.guidance.tasks.slice(0, 4).map((task) => (
                    <li key={task}>{task}</li>
                  ))}
                </ul>
                <a className="quiet-link" href={`/tasks?productId=${detail.product.id}`}>
                  Turn an action into a task
                </a>
              </section>
            </div>
          </section>
          <section className="dashboard-stats" aria-label="Recent market signals">
            <article>
              <span>Events last 7 days</span>
              <strong>{events.length}</strong>
            </article>
            <article>
              <span>Customer or market events</span>
              <strong>{signalEvents.length}</strong>
            </article>
            <article>
              <span>Active goals</span>
              <strong>{detail.goals.filter((goal) => goal.status === "ACTIVE").length}</strong>
            </article>
            <article>
              <span>Product stage</span>
              <strong>{detail.product.productStageLabel}</strong>
            </article>
          </section>
          <section className="account-card">
            <p className="eyebrow">Signal activity · 7 days</p>
            <h2>Recent customer learning events</h2>
            {signalEvents.length ? (
              <ol className="history-list">
                {signalEvents.slice(0, 10).map((event) => (
                  <li key={event.id}>
                    <strong>{event.eventType}</strong>
                    <span>
                      {displayWorkspaceDate(event.effectiveAt)} · {event.productName}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted-copy">
                No customer or market event types were recorded this week. Activity names are
                supplied by your authorized clients; Enough does not inspect content.
              </p>
            )}
          </section>
        </>
      ) : null}
      <p className="dashboard-note">
        These recommendations are advisory. Add a suggested action as a task to set its priority,
        estimated time, reward, and recurrence.
      </p>
    </WorkspaceFrame>
  );
}
