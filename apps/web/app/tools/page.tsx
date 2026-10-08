"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  deleteToolMapping,
  loadProducts,
  loadToolCatalog,
  loadToolMappings,
  type ProductSummary,
  resolveTool,
  saveToolMapping,
  type ToolClassification,
  type ToolClassificationResolution,
  type ToolKind,
  type ToolMapping,
  toolClassifications,
  toolKinds,
} from "../workspace-data";
import { WorkspaceHeader } from "../workspace-header";

const emptyForm = {
  toolKind: "APPLICATION" as ToolKind,
  toolKey: "",
  displayName: "",
  classification: "BUILD" as ToolClassification,
  contextKey: "",
  contextValue: "",
};

export default function ToolsPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadToolCatalog>>>([]);
  const [mappings, setMappings] = useState<ToolMapping[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [resolution, setResolution] = useState<ToolClassificationResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([loadProducts(), loadToolCatalog(), loadToolMappings()])
      .then(([loadedProducts, loadedCatalog, loadedMappings]) => {
        if (!active) return;
        setProducts(loadedProducts);
        setCatalog(loadedCatalog);
        setMappings(loadedMappings);
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) {
          window.location.replace("/login");
          return;
        }
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Tool classifications could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleCatalog = useMemo(
    () =>
      catalog.filter((entry) => {
        const query = search.trim().toLocaleLowerCase();
        return (
          (!kindFilter || entry.toolKind === kindFilter) &&
          (!query ||
            entry.displayName.toLocaleLowerCase().includes(query) ||
            entry.toolKey.toLocaleLowerCase().includes(query))
        );
      }),
    [catalog, kindFilter, search],
  );

  function resetForm() {
    setForm(emptyForm);
    setEditingId("");
  }

  function customizeCatalogEntry(entry: (typeof catalog)[number]) {
    setForm({
      toolKind: entry.toolKind,
      toolKey: entry.toolKey,
      displayName: entry.displayName,
      classification: entry.classification,
      contextKey: "",
      contextValue: "",
    });
    setNotice("Catalog entry copied into the mapping form. Save an override to customize it.");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editMapping(mapping: ToolMapping) {
    setEditingId(mapping.id);
    setSelectedProduct(mapping.productId ?? "");
    setForm({
      toolKind: mapping.toolKind,
      toolKey: mapping.toolKey,
      displayName: mapping.displayName,
      classification: mapping.classification,
      contextKey: mapping.contextKey,
      contextValue: mapping.contextValue,
    });
    setError("");
    setNotice("Mapping loaded for editing.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await saveToolMapping(
        {
          ...form,
          toolKey: form.toolKey.trim(),
          displayName: form.displayName.trim() || form.toolKey.trim(),
          productId: selectedProduct || null,
          contextKey: form.contextKey.trim(),
          contextValue: form.contextValue.trim(),
        },
        editingId || undefined,
      );
      setMappings((items) => [
        result.mapping,
        ...items.filter((item) => item.id !== result.mapping.id),
      ]);
      resetForm();
      setNotice("Tool mapping saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tool mapping could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMapping(mapping: ToolMapping) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await deleteToolMapping(mapping.id);
      setMappings((items) => items.filter((item) => item.id !== mapping.id));
      if (editingId === mapping.id) resetForm();
      setNotice("Tool mapping removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The mapping could not be removed.");
    } finally {
      setSaving(false);
    }
  }

  async function previewResolution() {
    setSaving(true);
    setError("");
    setNotice("");
    setResolution(null);
    try {
      const result = await resolveTool({
        toolKind: form.toolKind,
        toolKey: form.toolKey.trim(),
        productId: selectedProduct || null,
        contextKey: form.contextKey.trim(),
        contextValue: form.contextValue.trim(),
      });
      setResolution(result.resolution);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The classification could not be previewed.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <main className="message-shell">
        <section className="auth-card">
          <p className="notice">Loading tool classifications…</p>
        </section>
      </main>
    );

  return (
    <main className="auth-shell">
      <WorkspaceHeader active="tools" />
      <section className="dashboard-content">
        <div className="dashboard-intro">
          <p className="eyebrow">Tool classification</p>
          <h1>Make tool labels fit your work</h1>
          <p>
            Classify applications and domains for your account or a specific product. Context
            mappings apply only when the same context is supplied during resolution.
          </p>
        </div>

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

        <section className="account-card">
          <p className="eyebrow">Create or edit</p>
          <h2>{editingId ? "Edit a mapping" : "Add an application or domain"}</h2>
          <form className="product-form classification-form" onSubmit={submitMapping}>
            <label>
              Tool type
              <select
                value={form.toolKind}
                onChange={(event) => setForm({ ...form, toolKind: event.target.value as ToolKind })}
              >
                {toolKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === "APPLICATION" ? "Application" : "Domain"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Identifier
              <input
                value={form.toolKey}
                onChange={(event) => setForm({ ...form, toolKey: event.target.value })}
                required
                maxLength={500}
                placeholder={
                  form.toolKind === "DOMAIN"
                    ? "example.com or *.example.com"
                    : "com.example.app or executable name"
                }
              />
            </label>
            <label>
              Display name
              <input
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                maxLength={120}
                placeholder="Defaults to the identifier"
              />
            </label>
            <label>
              Classification
              <select
                value={form.classification}
                onChange={(event) =>
                  setForm({ ...form, classification: event.target.value as ToolClassification })
                }
              >
                {toolClassifications.map((classification) => (
                  <option key={classification} value={classification}>
                    {classification}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Product scope
              <select
                value={selectedProduct}
                onChange={(event) => setSelectedProduct(event.target.value)}
              >
                <option value="">All products</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Context name (optional)
              <input
                value={form.contextKey}
                onChange={(event) => setForm({ ...form, contextKey: event.target.value })}
                maxLength={80}
                placeholder="purpose"
              />
            </label>
            <label>
              Context value
              <input
                value={form.contextValue}
                onChange={(event) => setForm({ ...form, contextValue: event.target.value })}
                maxLength={160}
                placeholder="tutorial"
              />
            </label>
            <div className="button-row classification-actions">
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Save mapping"}
              </button>
              {editingId ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={resetForm}
                >
                  Cancel edit
                </button>
              ) : null}
              <button
                className="secondary-button"
                type="button"
                disabled={saving || !form.toolKey.trim()}
                onClick={() => void previewResolution()}
              >
                Preview result
              </button>
            </div>
          </form>
          {resolution ? (
            <div className="classification-result" role="status">
              <strong>
                {resolution.displayName}: {resolution.classification}
              </strong>
              <span>
                {resolution.source.replace(/_/g, " ")}
                {resolution.matchedKey
                  ? ` · matched ${resolution.matchedKey}`
                  : " · no mapping matched"}
                {resolution.contextMatched ? " · context matched" : ""}
              </span>
            </div>
          ) : null}
          <p className="dashboard-note">
            BLOCKED and ALLOWED are classification labels in this phase. They do not block or permit
            app access.
          </p>
        </section>

        <section className="account-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your mappings</p>
              <h2>Custom and product-specific rules</h2>
            </div>
            <span className="mapping-count">{mappings.length}</span>
          </div>
          {mappings.length ? (
            <ul className="classification-list">
              {mappings.map((mapping) => (
                <li key={mapping.id}>
                  <div>
                    <strong>{mapping.displayName}</strong>
                    <span>
                      {mapping.toolKind.toLowerCase()} · {mapping.toolKey} ·{" "}
                      {mapping.classification}
                    </span>
                    <small>
                      {mapping.productName ?? "All products"}
                      {mapping.contextKey
                        ? ` · ${mapping.contextKey}=${mapping.contextValue}`
                        : " · any context"}
                    </small>
                  </div>
                  <div className="goal-actions">
                    <button type="button" disabled={saving} onClick={() => editMapping(mapping)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void removeMapping(mapping)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-copy">
              No custom mappings yet. Catalog defaults are used until you add an override.
            </p>
          )}
        </section>

        <section className="account-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Default catalog</p>
              <h2>Browse {catalog.length} common tools</h2>
            </div>
          </div>
          <div className="catalog-toolbar">
            <label>
              Search
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or identifier"
              />
            </label>
            <label>
              Type
              <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
                <option value="">All types</option>
                {toolKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === "APPLICATION" ? "Applications" : "Domains"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {visibleCatalog.length ? (
            <ul className="classification-list catalog-list">
              {visibleCatalog.map((entry) => (
                <li key={`${entry.toolKind}:${entry.toolKey}`}>
                  <div>
                    <strong>{entry.displayName}</strong>
                    <span>
                      {entry.toolKind.toLowerCase()} · {entry.toolKey} · {entry.classification}
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => customizeCatalogEntry(entry)}
                  >
                    Customize
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-copy">No catalog entries match this search.</p>
          )}
        </section>
        <p className="dashboard-note">
          Resolution order: product mapping, matching context, most-specific domain, then catalog
          default. Unmapped tools resolve to NEUTRAL.
        </p>
      </section>
      <footer className="auth-footer">
        Enough · Classifications describe focus; enforcement is a later phase.
      </footer>
    </main>
  );
}
