"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  type AuthDeviceSummary,
  archivePolicyRule,
  createPolicyOverride,
  evaluatePolicy,
  loadAuthDevices,
  loadPolicyRules,
  loadPolicyRuleVersions,
  loadProducts,
  type PolicyDecision,
  type PolicyOverrideAction,
  type PolicyOverrideRecord,
  type PolicyRuleAction,
  type PolicyRuleConfig,
  type PolicyRuleRecord,
  type PolicyRuleVersion,
  type ProductSummary,
  policyOverrideActions,
  policyRuleActions,
  revokePolicyOverride,
  savePolicyRule,
  type ToolClassification,
  type ToolKind,
  toolClassifications,
  toolKinds,
} from "../workspace-data";
import { WorkspaceHeader } from "../workspace-header";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface RuleFormState {
  name: string;
  enabled: boolean;
  priority: string;
  action: PolicyRuleAction;
  productId: string;
  deviceId: string;
  classifications: ToolClassification[];
  toolKind: "" | ToolKind;
  toolKeys: string;
  contextKey: string;
  contextValue: string;
  useSchedule: boolean;
  timezone: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  startsAt: string;
  endsAt: string;
}

const defaultRuleForm: RuleFormState = {
  name: "",
  enabled: true,
  priority: "0",
  action: "BLOCK",
  productId: "",
  deviceId: "",
  classifications: [],
  toolKind: "",
  toolKeys: "",
  contextKey: "",
  contextValue: "",
  useSchedule: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "17:00",
  startsAt: "",
  endsAt: "",
};

function localDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function isoDateTime(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function ruleConfig(form: RuleFormState): PolicyRuleConfig {
  const toolKeys = form.toolKeys
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    priority: Number(form.priority),
    action: form.action,
    productId: form.productId || null,
    deviceId: form.deviceId || null,
    conditions: {
      ...(form.classifications.length ? { classifications: form.classifications } : {}),
      ...(form.toolKind ? { toolKind: form.toolKind } : {}),
      ...(toolKeys.length ? { toolKeys } : {}),
      ...(form.contextKey.trim() ? { contextKey: form.contextKey.trim() } : {}),
      ...(form.contextValue.trim() ? { contextValue: form.contextValue.trim() } : {}),
    },
    schedule: form.useSchedule
      ? {
          timezone: form.timezone.trim(),
          daysOfWeek: form.daysOfWeek,
          startTime: form.startTime,
          endTime: form.endTime,
          startsAt: isoDateTime(form.startsAt) ?? null,
          endsAt: isoDateTime(form.endsAt) ?? null,
        }
      : null,
  };
}

function formFromRule(rule: PolicyRuleRecord): RuleFormState {
  return {
    ...defaultRuleForm,
    name: rule.name,
    enabled: rule.enabled,
    priority: String(rule.priority),
    action: rule.action,
    productId: rule.productId ?? "",
    deviceId: rule.deviceId ?? "",
    classifications: rule.conditions.classifications ?? [],
    toolKind: rule.conditions.toolKind ?? "",
    toolKeys: rule.conditions.toolKeys?.join(", ") ?? "",
    contextKey: rule.conditions.contextKey ?? "",
    contextValue: rule.conditions.contextValue ?? "",
    useSchedule: Boolean(rule.schedule),
    timezone: rule.schedule?.timezone ?? defaultRuleForm.timezone,
    daysOfWeek: rule.schedule?.daysOfWeek ?? defaultRuleForm.daysOfWeek,
    startTime: rule.schedule?.startTime ?? defaultRuleForm.startTime,
    endTime: rule.schedule?.endTime ?? defaultRuleForm.endTime,
    startsAt: localDateTime(rule.schedule?.startsAt),
    endsAt: localDateTime(rule.schedule?.endsAt),
  };
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export default function RulesPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [devices, setDevices] = useState<AuthDeviceSummary[]>([]);
  const [rules, setRules] = useState<PolicyRuleRecord[]>([]);
  const [overrides, setOverrides] = useState<PolicyOverrideRecord[]>([]);
  const [form, setForm] = useState(defaultRuleForm);
  const [editingRule, setEditingRule] = useState<PolicyRuleRecord | null>(null);
  const [versions, setVersions] = useState<PolicyRuleVersion[]>([]);
  const [historyRuleName, setHistoryRuleName] = useState("");
  const [toolKey, setToolKey] = useState("");
  const [toolKind, setToolKind] = useState<ToolKind>("APPLICATION");
  const [evalProductId, setEvalProductId] = useState("");
  const [evalDeviceId, setEvalDeviceId] = useState("");
  const [evalContextKey, setEvalContextKey] = useState("");
  const [evalContextValue, setEvalContextValue] = useState("");
  const [decision, setDecision] = useState<PolicyDecision | null>(null);
  const [overrideKey, setOverrideKey] = useState("");
  const [overrideKind, setOverrideKind] = useState<ToolKind>("APPLICATION");
  const [overrideAction, setOverrideAction] = useState<PolicyOverrideAction>("ALLOW");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideExpiry, setOverrideExpiry] = useState(() => {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [overrideProductId, setOverrideProductId] = useState("");
  const [overrideDeviceId, setOverrideDeviceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const [loadedProducts, loadedDevices, workspace] = await Promise.all([
      loadProducts(),
      loadAuthDevices(),
      loadPolicyRules(),
    ]);
    setProducts(loadedProducts);
    setDevices(loadedDevices);
    setRules(workspace.rules);
    setOverrides(workspace.overrides);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([loadProducts(), loadAuthDevices(), loadPolicyRules()])
      .then(([loadedProducts, loadedDevices, workspace]) => {
        if (!active) return;
        setProducts(loadedProducts);
        setDevices(loadedDevices);
        setRules(workspace.rules);
        setOverrides(workspace.overrides);
      })
      .catch((cause: unknown) => {
        if ((cause as { status?: number })?.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (active)
          setError(cause instanceof Error ? cause.message : "Rule workspace could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeDevices = devices.filter((device) => !device.revoked);

  function toggleClassification(classification: ToolClassification) {
    setForm((current) => ({
      ...current,
      classifications: current.classifications.includes(classification)
        ? current.classifications.filter((item) => item !== classification)
        : [...current.classifications, classification],
    }));
  }

  function toggleWeekday(day: number) {
    setForm((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((item) => item !== day)
        : [...current.daysOfWeek, day].sort((a, b) => a - b),
    }));
  }

  function startEdit(rule: PolicyRuleRecord) {
    setEditingRule(rule);
    setForm(formFromRule(rule));
    setError("");
    setNotice(`Editing version ${rule.version}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setForm(defaultRuleForm);
    setEditingRule(null);
  }

  async function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await savePolicyRule(ruleConfig(form), editingRule?.id, editingRule?.version);
      await refresh();
      resetForm();
      setNotice("Rule saved as a new version.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The rule could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveRule(rule: PolicyRuleRecord) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await archivePolicyRule(rule.id, rule.version);
      await refresh();
      if (editingRule?.id === rule.id) resetForm();
      setNotice(`${rule.name} was archived.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The rule could not be archived.");
    } finally {
      setSaving(false);
    }
  }

  async function showVersions(rule: PolicyRuleRecord) {
    setHistoryRuleName(rule.name);
    setError("");
    try {
      setVersions(await loadPolicyRuleVersions(rule.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rule history could not be loaded.");
    }
  }

  async function previewDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setDecision(null);
    try {
      const result = await evaluatePolicy({
        productId: evalProductId || null,
        deviceId: evalDeviceId || null,
        toolKind,
        toolKey: toolKey.trim(),
        contextKey: evalContextKey.trim(),
        contextValue: evalContextValue.trim(),
      });
      setDecision(result.decision);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The policy decision could not be evaluated.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await createPolicyOverride({
        productId: overrideProductId || null,
        deviceId: overrideDeviceId || null,
        toolKind: overrideKind,
        toolKey: overrideKey.trim(),
        action: overrideAction,
        reason: overrideReason.trim(),
        expiresAt: new Date(overrideExpiry).toISOString(),
      });
      setOverrides((current) => [result.override, ...current]);
      setOverrideReason("");
      setNotice("Temporary override created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The override could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeOverride(override: PolicyOverrideRecord) {
    setSaving(true);
    setError("");
    try {
      await revokePolicyOverride(override.id);
      setOverrides((items) => items.filter((item) => item.id !== override.id));
      setNotice("Override revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The override could not be revoked.");
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <main className="message-shell">
        <section className="auth-card">
          <p className="notice">Loading rules…</p>
        </section>
      </main>
    );

  return (
    <main className="auth-shell">
      <WorkspaceHeader active="rules" />
      <section className="dashboard-content">
        <div className="dashboard-intro">
          <p className="eyebrow">Rule engine</p>
          <h1>Choose how tools are handled</h1>
          <p>
            Rules combine product and device scope, conditions, schedules, and priority. A preview
            uses server time and the saved tool classification.
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
          <p className="eyebrow">
            {editingRule ? `Edit version ${editingRule.version}` : "New policy"}
          </p>
          <h2>{editingRule ? editingRule.name : "Create a rule"}</h2>
          <form className="product-form rule-form" onSubmit={submitRule}>
            <label>
              Rule name
              <input
                required
                minLength={2}
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Focus time for build tools"
              />
            </label>
            <label>
              Action
              <select
                value={form.action}
                onChange={(event) =>
                  setForm({ ...form, action: event.target.value as PolicyRuleAction })
                }
              >
                {policyRuleActions.map((action) => (
                  <option key={action} value={action}>
                    {action.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority (higher wins)
              <input
                type="number"
                min={-10000}
                max={10000}
                step={1}
                value={form.priority}
                onChange={(event) => setForm({ ...form, priority: event.target.value })}
              />
            </label>
            <label className="rule-check-label">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />{" "}
              Enabled
            </label>
            <label>
              Product scope
              <select
                value={form.productId}
                onChange={(event) => setForm({ ...form, productId: event.target.value })}
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
              Device scope
              <select
                value={form.deviceId}
                onChange={(event) => setForm({ ...form, deviceId: event.target.value })}
              >
                <option value="">All devices</option>
                {activeDevices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name} · {device.clientType}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="rule-classifications">
              <legend>Classifications (any selected)</legend>
              {toolClassifications.map((classification) => (
                <label key={classification}>
                  <input
                    type="checkbox"
                    checked={form.classifications.includes(classification)}
                    onChange={() => toggleClassification(classification)}
                  />
                  {classification}
                </label>
              ))}
            </fieldset>
            <label>
              Tool type (optional)
              <select
                value={form.toolKind}
                onChange={(event) =>
                  setForm({ ...form, toolKind: event.target.value as "" | ToolKind })
                }
              >
                <option value="">Any tool type</option>
                {toolKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tool identifiers (optional, comma separated)
              <input
                value={form.toolKeys}
                onChange={(event) => setForm({ ...form, toolKeys: event.target.value })}
                placeholder="github.com, *.example.com"
              />
            </label>
            <label>
              Context name (optional)
              <input
                value={form.contextKey}
                onChange={(event) => setForm({ ...form, contextKey: event.target.value })}
                placeholder="purpose"
              />
            </label>
            <label>
              Context value
              <input
                value={form.contextValue}
                onChange={(event) => setForm({ ...form, contextValue: event.target.value })}
                placeholder="tutorial"
              />
            </label>
            <label className="rule-check-label rule-schedule-toggle">
              <input
                type="checkbox"
                checked={form.useSchedule}
                onChange={(event) => setForm({ ...form, useSchedule: event.target.checked })}
              />{" "}
              Limit to a schedule
            </label>
            {form.useSchedule ? (
              <>
                <label>
                  Time zone
                  <input
                    required
                    value={form.timezone}
                    onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                    placeholder="Europe/Berlin"
                  />
                </label>
                <fieldset className="rule-weekdays">
                  <legend>Active days</legend>
                  {weekdays.map((day, index) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        checked={form.daysOfWeek.includes(index)}
                        onChange={() => toggleWeekday(index)}
                      />
                      {day}
                    </label>
                  ))}
                </fieldset>
                <label>
                  Starts at local time
                  <input
                    required
                    type="time"
                    value={form.startTime}
                    onChange={(event) => setForm({ ...form, startTime: event.target.value })}
                  />
                </label>
                <label>
                  Ends at local time
                  <input
                    required
                    type="time"
                    value={form.endTime}
                    onChange={(event) => setForm({ ...form, endTime: event.target.value })}
                  />
                </label>
                <label>
                  Schedule begins (optional)
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
                  />
                </label>
                <label>
                  Schedule ends (optional)
                  <input
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
                  />
                </label>
              </>
            ) : null}
            <div className="button-row rule-actions">
              <button className="primary-button" disabled={saving} type="submit">
                {saving ? "Saving…" : editingRule ? "Save new version" : "Create rule"}
              </button>
              {editingRule ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={resetForm}
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>
          <p className="dashboard-note">
            All supplied condition fields must match; multiple selected classifications or tool
            identifiers use OR. Schedule intervals include the start and exclude the end. Equal
            start/end times mean the full selected day.
          </p>
        </section>

        <section className="account-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Policy set</p>
              <h2>Rules and versions</h2>
            </div>
            <span className="mapping-count">{rules.filter((rule) => !rule.archivedAt).length}</span>
          </div>
          {rules.length ? (
            <ul className="rule-list">
              {rules.map((rule) => (
                <li key={rule.id} className={rule.archivedAt ? "archived-rule" : ""}>
                  <div>
                    <strong>{rule.name}</strong>
                    <span>
                      v{rule.version} · priority {rule.priority} · {rule.action.replace(/_/g, " ")}
                      {!rule.enabled ? " · disabled" : ""}
                      {rule.archivedAt ? " · archived" : ""}
                    </span>
                    <small>
                      {rule.productName ?? (rule.productId ? "Product scope" : "All products")} ·{" "}
                      {rule.deviceName ?? (rule.deviceId ? "Device scope" : "All devices")}
                      {rule.schedule
                        ? ` · ${rule.schedule.timezone} ${rule.schedule.startTime}–${rule.schedule.endTime}`
                        : " · any time"}
                    </small>
                  </div>
                  <div className="goal-actions">
                    <button
                      type="button"
                      disabled={saving || Boolean(rule.archivedAt)}
                      onClick={() => startEdit(rule)}
                    >
                      Edit
                    </button>
                    <button type="button" onClick={() => void showVersions(rule)}>
                      Versions
                    </button>
                    {!rule.archivedAt ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void archiveRule(rule)}
                      >
                        Archive
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-copy">
              No rules yet. With no matching rule or override, the engine returns ALLOW.
            </p>
          )}
          {historyRuleName ? (
            <div className="rule-history">
              <div className="section-heading">
                <h3>{historyRuleName} history</h3>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => {
                    setHistoryRuleName("");
                    setVersions([]);
                  }}
                >
                  Close
                </button>
              </div>
              <ol className="history-list">
                {versions.map((version) => (
                  <li key={version.version}>
                    <strong>Version {version.version}</strong>
                    <span>{formatTime(version.createdAt)}</span>
                    <pre>{JSON.stringify(version.snapshot, null, 2)}</pre>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>

        <section className="account-card">
          <p className="eyebrow">Decision preview</p>
          <h2>Evaluate a tool now</h2>
          <p className="muted-copy">
            This API returns the policy decision. Desktop and extension clients that apply decisions
            are not implemented yet.
          </p>
          <form className="product-form rule-form" onSubmit={previewDecision}>
            <label>
              Tool type
              <select
                value={toolKind}
                onChange={(event) => setToolKind(event.target.value as ToolKind)}
              >
                {toolKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tool identifier
              <input
                required
                value={toolKey}
                onChange={(event) => setToolKey(event.target.value)}
                placeholder="com.example.app or example.com"
              />
            </label>
            <label>
              Product scope
              <select
                value={evalProductId}
                onChange={(event) => setEvalProductId(event.target.value)}
              >
                <option value="">No product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Device scope
              <select
                value={evalDeviceId}
                onChange={(event) => setEvalDeviceId(event.target.value)}
              >
                <option value="">No device</option>
                {activeDevices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Context name (optional)
              <input
                value={evalContextKey}
                onChange={(event) => setEvalContextKey(event.target.value)}
              />
            </label>
            <label>
              Context value
              <input
                value={evalContextValue}
                onChange={(event) => setEvalContextValue(event.target.value)}
              />
            </label>
            <button className="secondary-button" disabled={saving} type="submit">
              Evaluate current policy
            </button>
          </form>
          {decision ? (
            <div
              className={`classification-result ${decision.allowed ? "decision-allow" : "decision-block"}`}
              role="status"
            >
              <strong>
                {decision.action.replace(/_/g, " ")} ·{" "}
                {decision.allowed ? "Allowed" : "Not allowed"}
              </strong>
              <span>
                {decision.reason} · {decision.source}
                {decision.matchedRuleVersion ? ` · rule v${decision.matchedRuleVersion}` : ""} ·
                evaluated {formatTime(decision.evaluatedAt)}
              </span>
            </div>
          ) : null}
        </section>

        <section className="account-card">
          <p className="eyebrow">Temporary override</p>
          <h2>Allow or block a tool until expiry</h2>
          <form className="product-form rule-form" onSubmit={submitOverride}>
            <label>
              Tool type
              <select
                value={overrideKind}
                onChange={(event) => setOverrideKind(event.target.value as ToolKind)}
              >
                {toolKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tool identifier
              <input
                required
                value={overrideKey}
                onChange={(event) => setOverrideKey(event.target.value)}
                placeholder="app ID or domain; *.example.com for subdomains"
              />
            </label>
            <label>
              Override action
              <select
                value={overrideAction}
                onChange={(event) => setOverrideAction(event.target.value as PolicyOverrideAction)}
              >
                {policyOverrideActions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Expires at
              <input
                required
                type="datetime-local"
                value={overrideExpiry}
                onChange={(event) => setOverrideExpiry(event.target.value)}
              />
            </label>
            <label>
              Product scope
              <select
                value={overrideProductId}
                onChange={(event) => setOverrideProductId(event.target.value)}
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
              Device scope
              <select
                value={overrideDeviceId}
                onChange={(event) => setOverrideDeviceId(event.target.value)}
              >
                <option value="">All devices</option>
                {activeDevices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="rule-reason">
              Reason
              <input
                required
                minLength={2}
                maxLength={300}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Customer call requires access"
              />
            </label>
            <button className="secondary-button" disabled={saving} type="submit">
              Create override (max 30 days)
            </button>
          </form>
          {overrides.length ? (
            <ul className="rule-list">
              {overrides.map((override) => {
                const expired = Date.parse(override.expiresAt) <= Date.now();
                return (
                  <li key={override.id} className={expired ? "archived-rule" : ""}>
                    <div>
                      <strong>
                        {override.action} · {override.toolKey}
                      </strong>
                      <span>
                        {override.reason} ·{" "}
                        {expired ? "expired" : `expires ${formatTime(override.expiresAt)}`}
                      </span>
                      <small>
                        {override.productName ??
                          (override.productId ? "Product scope" : "All products")}{" "}
                        ·{" "}
                        {override.deviceName ??
                          (override.deviceId ? "Device scope" : "All devices")}
                      </small>
                    </div>
                    {!expired ? (
                      <div className="goal-actions">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void revokeOverride(override)}
                        >
                          Revoke
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted-copy">No temporary overrides.</p>
          )}
        </section>
      </section>
      <footer className="auth-footer">
        Enough · Rule decisions are deterministic for a fixed input, policy version, and evaluation
        timestamp.
      </footer>
    </main>
  );
}
