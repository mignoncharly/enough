"use client";

import { useEffect, useState } from "react";
import {
  type ActivityEventRecord,
  loadActivityEvents,
  loadProducts,
  type ProductSummary,
} from "../workspace-data";
import { displayWorkspaceDate, WorkspaceFrame } from "../workspace-frame";

export default function ActivityPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [events, setEvents] = useState<ActivityEventRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<{ before: string; beforeId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    let active = true;
    void loadProducts()
      .then((items) => {
        if (!active) return;
        setProducts(items);
        const requestedId = new URLSearchParams(window.location.search).get("productId");
        setProductId(
          requestedId && items.some((item) => item.id === requestedId) ? requestedId : "",
        );
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
    let active = true;
    setLoading(true);
    setError("");
    setEvents([]);
    setNextCursor(null);
    void loadActivityEvents({ productId: productId || undefined, limit: 100 })
      .then((page) => {
        if (active) {
          setEvents(page.events);
          setNextCursor(page.nextCursor);
        }
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "Activity could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  async function loadOlderEvents() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await loadActivityEvents({
        productId: productId || undefined,
        before: nextCursor.before,
        beforeId: nextCursor.beforeId,
        limit: 100,
      });
      setEvents((current) => [...current, ...page.events]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      const status = (cause as { status?: number })?.status;
      if (status === 401) window.location.replace("/login");
      else setError(cause instanceof Error ? cause.message : "Older activity could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  const visibleEvents = events.filter((event) => !typeFilter || event.eventType === typeFilter);
  const eventTypes = [...new Set(events.map((event) => event.eventType))].sort();

  return (
    <WorkspaceFrame
      active="activity"
      eyebrow="Activity"
      title="Your activity ledger"
      description="Review the event metadata Enough received. Event attributes may contain only the values your clients submitted."
    >
      <div className="product-toolbar activity-filters">
        <label className="product-select">
          Product
          <select value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">All products</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className="product-select">
          Event type
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">All event types</option>
            {eventTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <p className="notice" role="status">
          Loading activity…
        </p>
      ) : null}
      {error ? (
        <section className="account-card" role="alert">
          <h2>Activity could not be loaded</h2>
          <p className="error">{error}</p>
          <a className="secondary-button link-button" href="/login">
            Sign in again
          </a>
        </section>
      ) : null}
      {!loading && !error && visibleEvents.length === 0 ? (
        <section className="account-card">
          <p className="eyebrow">{events.length ? "Current page" : "No events yet"}</p>
          <h2>
            {events.length ? "No stored events match this filter" : "Activity will appear here"}
          </h2>
          <p className="muted-copy">
            {events.length
              ? "Try another event type, or keep loading older records to find earlier matches."
              : "When an authorized client records activity, you can review its timestamp, product, device, event type, and bounded attributes here."}
          </p>
          {!events.length && products.length === 0 ? (
            <a className="primary-button link-button" href="/onboarding">
              Set up a product
            </a>
          ) : null}
          {events.length && nextCursor ? (
            <button
              className="secondary-button"
              type="button"
              disabled={loadingMore}
              onClick={() => void loadOlderEvents()}
            >
              {loadingMore ? "Loading…" : "Load older events"}
            </button>
          ) : null}
        </section>
      ) : null}
      {visibleEvents.length > 0 ? (
        <section className="account-card">
          <p className="eyebrow">Stored event history</p>
          <h2>Recorded events</h2>
          <ol className="history-list activity-list">
            {visibleEvents.map((event) => (
              <li key={event.id}>
                <strong>
                  {event.eventType} <span className="activity-product">· {event.productName}</span>
                </strong>
                <span>
                  Effective {displayWorkspaceDate(event.effectiveAt)} · received{" "}
                  {displayWorkspaceDate(event.receivedAt)} · sequence {event.clientSequence}
                </span>
                {event.clockAdjusted ? (
                  <small>Client timestamp was adjusted for effective ordering.</small>
                ) : null}
                {Object.keys(event.attributes).length ? (
                  <pre className="activity-attributes">
                    {JSON.stringify(event.attributes, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
          {nextCursor ? (
            <button
              className="secondary-button"
              type="button"
              disabled={loadingMore}
              onClick={() => void loadOlderEvents()}
            >
              {loadingMore ? "Loading…" : "Load older events"}
            </button>
          ) : null}
        </section>
      ) : null}
    </WorkspaceFrame>
  );
}
