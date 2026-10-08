"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { displayWorkspaceDate, WorkspaceFrame } from "../workspace-frame";

type Section =
  | "overview"
  | "users"
  | "subscriptions"
  | "devices"
  | "integrations"
  | "jobs"
  | "growth"
  | "rules"
  | "flags"
  | "ai"
  | "audit";
type JsonObject = Record<string, unknown>;
type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  adminRole: "ADMIN" | "SUPPORT" | null;
  activeDevices: number;
  subscriptionStatus: string | null;
};
type AdminDevice = {
  id: string;
  userId: string;
  email: string;
  name: string;
  clientType: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};
type AdminSubscription = {
  id: string;
  userId: string;
  email: string;
  planKey: string;
  status: string;
  currency: string;
  billingInterval: string;
  unitAmountMinor: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
};
type AdminIntegration = {
  id: string;
  userId: string;
  email: string;
  provider: string;
  displayName: string;
  status: string;
  lastReceivedAt: string | null;
  errorCount: number;
  latestError: string | null;
};
type AdminJob = {
  id: string;
  name: string;
  attemptsMade: number;
  failedReason: string;
  timestamp: number;
  finishedOn: number | null;
};
type GrowthTemplate = {
  id: string;
  productStage: string;
  title: string;
  priority: number;
  signalStrength: number;
  estimatedMinutes: number;
  defaultRewardCredits: number;
  isActive: boolean;
};
type RuleTemplate = {
  id: string;
  name: string;
  description: string;
  action: string;
  priority: number;
  conditions: JsonObject;
  schedule: JsonObject | null;
  isActive: boolean;
};
type FeatureFlag = {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  configuration?: JsonObject;
  updatedAt: string;
};
type AiEvent = {
  id: string;
  userId: string | null;
  email: string | null;
  capability: string;
  model: string;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  createdAt: string;
};
type AuditEvent = {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: JsonObject;
  createdAt: string;
};
type UserDetail = {
  user: AdminUser;
  devices: AdminDevice[];
  subscriptions: AdminSubscription[];
  integrations: AdminIntegration[];
  aiUsage: AiEvent[];
};
type Payload = {
  counts?: Record<string, number>;
  health?: Record<string, string>;
  jobs?: Record<string, number>;
  configuration?: Record<string, boolean>;
  generatedAt?: string;
  users?: AdminUser[];
  userDetail?: UserDetail;
  subscriptions?: AdminSubscription[];
  devices?: AdminDevice[];
  integrations?: AdminIntegration[];
  failedJobs?: AdminJob[];
  growthTemplates?: GrowthTemplate[];
  ruleTemplates?: RuleTemplate[];
  flags?: FeatureFlag[];
  aiSummary?: { requests: number; failures: number; inputTokens: number; outputTokens: number };
  aiEvents?: AiEvent[];
  auditEvents?: AuditEvent[];
};

const sections: Array<{ key: Section; label: string }> = [
  { key: "overview", label: "System health" },
  { key: "users", label: "Users" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "devices", label: "Devices" },
  { key: "integrations", label: "Integrations" },
  { key: "jobs", label: "Failed jobs" },
  { key: "growth", label: "Growth templates" },
  { key: "rules", label: "Rule templates" },
  { key: "flags", label: "Feature flags" },
  { key: "ai", label: "AI usage" },
  { key: "audit", label: "Audit log" },
];

function readCsrfCookie(): string {
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("enough_csrf=") || part.startsWith("__Host-enough_csrf="));
  return match ? decodeURIComponent(match.slice(match.indexOf("=") + 1)) : "";
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const csrf = method === "GET" ? "" : readCsrfCookie();
  if (method !== "GET" && !csrf)
    throw new Error("Your secure session has expired. Sign in again and retry.");
  const response = await fetch(`/api/admin${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    const error = new Error(payload.error ?? "Admin Console request failed.") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return payload;
}

function date(value: string | null | undefined): string {
  return value ? displayWorkspaceDate(value) : "—";
}

function Panel({
  title,
  eyebrow,
  children,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`account-card admin-panel ${className}`}>
      <div className="section-heading">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatCards({ values }: { values: Array<[string, string | number]> }) {
  return (
    <div className="admin-stats">
      {values.map(([label, value]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="muted-copy admin-empty">{children}</p>;
}

export default function AdminPage() {
  const [section, setSection] = useState<Section>("overview");
  const [role, setRole] = useState<"ADMIN" | "SUPPORT">("SUPPORT");
  const [currentUserId, setCurrentUserId] = useState("");
  const [payload, setPayload] = useState<Payload>({});
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [growthTitle, setGrowthTitle] = useState("");
  const [growthStage, setGrowthStage] = useState("IDEA");
  const [ruleName, setRuleName] = useState("");
  const [flagKey, setFlagKey] = useState("");
  const [flagDescription, setFlagDescription] = useState("");

  const loadSection = useCallback(async (key: Section, query = "") => {
    setLoading(true);
    setError("");
    try {
      const queryString = key === "users" ? `?q=${encodeURIComponent(query)}` : "";
      const paths: Record<Section, string> = {
        overview: "/dashboard",
        users: `/users${queryString}`,
        subscriptions: "/subscriptions",
        devices: "/devices",
        integrations: "/integrations",
        jobs: "/jobs",
        growth: "/growth-templates",
        rules: "/rule-templates",
        flags: "/feature-flags",
        ai: "/ai-usage",
        audit: "/audit",
      };
      const result = await request<Record<string, unknown>>(paths[key]);
      const mapped: Partial<Record<Section, keyof Payload>> = {
        users: "users",
        subscriptions: "subscriptions",
        devices: "devices",
        integrations: "integrations",
        jobs: "failedJobs",
        growth: "growthTemplates",
        rules: "ruleTemplates",
        flags: "flags",
        audit: "auditEvents",
      };
      if (key === "overview")
        setPayload((previous) => ({
          ...previous,
          ...(result as Pick<
            Payload,
            "counts" | "health" | "jobs" | "configuration" | "generatedAt"
          >),
        }));
      else if (key === "ai")
        setPayload((previous) => ({
          ...previous,
          aiSummary: result.summary as Payload["aiSummary"],
          aiEvents: result.events as AiEvent[],
        }));
      else {
        const target = mapped[key];
        if (target)
          setPayload((previous) => ({
            ...previous,
            [target]: result[Object.keys(result)[0]] as never,
          }));
      }
    } catch (cause) {
      const status = (cause as { status?: number })?.status;
      if (status === 401) window.location.replace("/login");
      else if (status === 403) setAllowed(false);
      else
        setError(cause instanceof Error ? cause.message : "Admin information could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void request<{ role: "ADMIN" | "SUPPORT"; user: { id: string } }>("/me")
      .then((result) => {
        if (!active) return;
        setAllowed(true);
        setRole(result.role);
        setCurrentUserId(result.user.id);
        void loadSection("overview");
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active && status === 403) {
          setAllowed(false);
          setLoading(false);
        } else if (active) {
          setError(cause instanceof Error ? cause.message : "Admin access could not be checked.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [loadSection]);

  useEffect(() => {
    if (allowed && section !== "overview") void loadSection(section, search);
  }, [allowed, section, search, loadSection]);

  async function perform(
    name: string,
    path: string,
    method: string,
    body?: unknown,
    confirmText?: string,
  ): Promise<boolean> {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await request(path, method, body);
      setNotice("Saved. The action was recorded in the admin audit log.");
      await loadSection(section, search);
      if (userDetail) {
        const detail = await request<UserDetail>(`/users/${userDetail.user.id}`);
        setUserDetail(detail);
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not be completed.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function openUser(userId: string) {
    setBusy(`user:${userId}`);
    setError("");
    setUserDetail(null);
    try {
      setUserDetail(await request<UserDetail>(`/users/${userId}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "User details could not be loaded.");
    } finally {
      setBusy("");
    }
  }

  async function createGrowth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = growthTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70);
    if (
      await perform("growth-create", "/growth-templates", "POST", {
        id: id || `growth-${crypto.randomUUID().slice(0, 8)}`,
        productStage: growthStage,
        title: growthTitle,
        priority: 3,
        signalStrength: 4,
        estimatedMinutes: 30,
        defaultRewardCredits: 0,
        isActive: true,
      })
    )
      setGrowthTitle("");
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = ruleName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70);
    if (
      await perform("rule-create", "/rule-templates", "POST", {
        id: id || `rule-${crypto.randomUUID().slice(0, 8)}`,
        name: ruleName,
        description: "Admin-managed starting point. Review the conditions before applying.",
        action: "WARN",
        priority: 0,
        conditions: {},
        schedule: null,
        isActive: true,
      })
    )
      setRuleName("");
  }

  async function createFlag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      await perform("flag-create", "/feature-flags", "POST", {
        key: flagKey.toLowerCase(),
        description: flagDescription,
        enabled: false,
        rolloutPercent: 100,
        configuration: {},
      })
    ) {
      setFlagKey("");
      setFlagDescription("");
    }
  }

  async function editGrowthTemplate(item: GrowthTemplate) {
    const title = window.prompt("Task title", item.title);
    if (title === null) return;
    const priorityText = window.prompt("Priority (1–5)", String(item.priority));
    if (priorityText === null) return;
    const signalText = window.prompt("Signal strength (1–5)", String(item.signalStrength));
    if (signalText === null) return;
    const minutesText = window.prompt("Estimated minutes (5–600)", String(item.estimatedMinutes));
    if (minutesText === null) return;
    const rewardText = window.prompt(
      "Default reward credits (0–10000)",
      String(item.defaultRewardCredits),
    );
    if (rewardText === null) return;
    const priority = Number(priorityText);
    const signalStrength = Number(signalText);
    const estimatedMinutes = Number(minutesText);
    const defaultRewardCredits = Number(rewardText);
    await perform(
      `growth-edit:${item.id}`,
      `/growth-templates/${encodeURIComponent(item.id)}`,
      "PATCH",
      { title, priority, signalStrength, estimatedMinutes, defaultRewardCredits },
    );
  }

  async function editRuleTemplate(item: RuleTemplate) {
    const name = window.prompt("Template name", item.name);
    if (name === null) return;
    const description = window.prompt("Description", item.description);
    if (description === null) return;
    const action = window.prompt("Action: ALLOW, BLOCK, WARN, or REQUIRE_OVERRIDE", item.action);
    if (action === null) return;
    const priorityText = window.prompt("Priority (-10000 to 10000)", String(item.priority));
    if (priorityText === null) return;
    const priority = Number(priorityText);
    const conditionsText = window.prompt("Conditions JSON", JSON.stringify(item.conditions));
    if (conditionsText === null) return;
    const scheduleText = window.prompt(
      "Schedule JSON, or leave empty for no schedule",
      item.schedule ? JSON.stringify(item.schedule) : "",
    );
    if (scheduleText === null) return;
    try {
      const conditions = JSON.parse(conditionsText) as unknown;
      const schedule = scheduleText.trim() ? (JSON.parse(scheduleText) as unknown) : null;
      if (
        !conditions ||
        typeof conditions !== "object" ||
        Array.isArray(conditions) ||
        (schedule !== null && (typeof schedule !== "object" || Array.isArray(schedule)))
      )
        throw new Error("Conditions and schedule must be JSON objects.");
      await perform(
        `rule-edit:${item.id}`,
        `/rule-templates/${encodeURIComponent(item.id)}`,
        "PATCH",
        { name, description, action, priority, conditions, schedule },
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Enter valid JSON for the conditions and schedule.",
      );
    }
  }

  async function editFeatureFlag(item: FeatureFlag) {
    const description = window.prompt("Flag description", item.description);
    if (description === null) return;
    const rolloutText = window.prompt("Rollout percentage (0–100)", String(item.rolloutPercent));
    if (rolloutText === null) return;
    const rolloutPercent = Number(rolloutText);
    const configurationText = window.prompt(
      "Configuration JSON",
      JSON.stringify(item.configuration ?? {}),
    );
    if (configurationText === null) return;
    try {
      const configuration = JSON.parse(configurationText) as unknown;
      if (!configuration || typeof configuration !== "object" || Array.isArray(configuration))
        throw new Error("Configuration must be a JSON object.");
      await perform(
        `flag-edit:${item.key}`,
        `/feature-flags/${encodeURIComponent(item.key)}`,
        "PATCH",
        { description, rolloutPercent, configuration },
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Enter valid JSON for the flag configuration.",
      );
    }
  }

  if (allowed === false)
    return (
      <WorkspaceFrame
        active="admin"
        eyebrow="Operations"
        title="Admin access required"
        description="This account does not have access to operational support tools."
      >
        <Panel title="Access is restricted">
          <p className="muted-copy">
            Ask an administrator to grant support access, or configure this verified account in
            `ADMIN_EMAILS` for initial setup.
          </p>
          <a className="secondary-button link-button" href="/">
            Return to workspace
          </a>
        </Panel>
      </WorkspaceFrame>
    );

  const counts = payload.counts ?? {};
  return (
    <WorkspaceFrame
      active="admin"
      eyebrow="Operations"
      title="Admin Console"
      description="Review account health, investigate support issues, and manage shared product templates and flags."
    >
      <div className="admin-toolbar">
        <span className={`admin-role-pill ${role === "ADMIN" ? "admin-role-owner" : ""}`}>
          {role === "ADMIN" ? "Administrator" : "Support"}
        </span>
        <span className="muted-copy">
          Support actions are audited. Credentials and raw customer evidence are not shown.
        </span>
      </div>
      <nav className="admin-tabs" aria-label="Admin Console sections">
        {sections.map((item) => (
          <button
            type="button"
            key={item.key}
            aria-current={section === item.key ? "page" : undefined}
            onClick={() => {
              setUserDetail(null);
              setSection(item.key);
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
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
      {loading ? (
        <Panel title="Loading admin data">
          <p className="muted-copy">Fetching the latest account and service information…</p>
        </Panel>
      ) : null}

      {!loading && section === "overview" ? (
        <>
          <StatCards
            values={[
              ["Users", counts.users ?? 0],
              ["Subscriptions", counts.activeSubscriptions ?? 0],
              ["Active devices", counts.devices ?? 0],
              ["AI requests · 30d", counts.aiRequests30d ?? 0],
            ]}
          />
          <Panel title="System health" eyebrow="Live checks">
            <div className="admin-health-grid">
              {Object.entries(payload.health ?? {}).map(([name, state]) => (
                <div key={name}>
                  <span>{name}</span>
                  <strong className={`health-${state}`}>{state}</strong>
                </div>
              ))}
            </div>
            <p className="fine-print">
              Generated {date(payload.generatedAt)}. Database and Redis checks are live; queue
              counters reflect the current BullMQ queue.
            </p>
          </Panel>
          <Panel title="Queue and integrations" eyebrow="Current workload">
            <StatCards
              values={[
                ["Waiting", payload.jobs?.waiting ?? 0],
                ["Active", payload.jobs?.active ?? 0],
                ["Delayed", payload.jobs?.delayed ?? 0],
                ["Failed", payload.jobs?.failed ?? 0],
                ["Active integrations", counts.activeIntegrations ?? 0],
                ["Integration errors", counts.failedIntegrations ?? 0],
              ]}
            />
          </Panel>
          <Panel title="Configured services" eyebrow="Environment">
            <div className="admin-health-grid">
              {Object.entries(payload.configuration ?? {}).map(([name, configured]) => (
                <div key={name}>
                  <span>{name.replace("Configured", "")}</span>
                  <strong className={configured ? "health-ok" : "health-unavailable"}>
                    {configured ? "configured" : "not configured"}
                  </strong>
                </div>
              ))}
            </div>
          </Panel>
        </>
      ) : null}

      {!loading && section === "users" ? (
        <>
          <Panel title="Accounts" eyebrow="Support lookup">
            <form
              className="admin-search"
              onSubmit={(event) => {
                event.preventDefault();
                void loadSection("users", search);
              }}
            >
              <label>
                Search by name or email
                <input
                  value={search}
                  maxLength={120}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="name@example.com"
                />
              </label>
              <button className="secondary-button" type="submit">
                Search
              </button>
            </form>
            {payload.users?.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Created</th>
                      <th>Subscription</th>
                      <th>Devices</th>
                      <th>Access</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <strong>{user.displayName || user.email}</strong>
                          <small>
                            {user.email}
                            {user.emailVerifiedAt ? " · verified" : " · unverified"}
                          </small>
                        </td>
                        <td>{date(user.createdAt)}</td>
                        <td>{user.subscriptionStatus ?? "Free"}</td>
                        <td>{user.activeDevices}</td>
                        <td>{user.adminRole ?? "Member"}</td>
                        <td className="admin-action-cell">
                          <button
                            className="quiet-button"
                            type="button"
                            onClick={() => void openUser(user.id)}
                          >
                            {busy === `user:${user.id}` ? "Loading…" : "Details"}
                          </button>
                          <button
                            className="quiet-button"
                            type="button"
                            disabled={busy !== ""}
                            onClick={() =>
                              void perform(
                                `revoke-user:${user.id}`,
                                `/users/${user.id}/revoke-sessions`,
                                "POST",
                                {},
                                `Revoke every active session for ${user.email}?`,
                              )
                            }
                          >
                            Revoke sessions
                          </button>
                          {role === "ADMIN" && user.id !== currentUserId ? (
                            <details className="admin-role-menu">
                              <summary>Access</summary>
                              <button
                                type="button"
                                onClick={() =>
                                  void perform(
                                    `role:${user.id}`,
                                    `/users/${user.id}/role`,
                                    "PATCH",
                                    { role: "SUPPORT" },
                                  )
                                }
                              >
                                Grant support
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void perform(
                                    `role:${user.id}`,
                                    `/users/${user.id}/role`,
                                    "PATCH",
                                    { role: "ADMIN" },
                                  )
                                }
                              >
                                Grant admin
                              </button>
                              {user.adminRole ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void perform(
                                      `role:${user.id}`,
                                      `/users/${user.id}/role`,
                                      "PATCH",
                                      { role: null },
                                      `Remove ${user.adminRole?.toLowerCase()} access from ${user.email}?`,
                                    )
                                  }
                                >
                                  Remove role
                                </button>
                              ) : null}
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No matching accounts.</Empty>
            )}
          </Panel>
          {userDetail ? (
            <Panel
              title={userDetail.user.displayName || userDetail.user.email}
              eyebrow="Account detail"
            >
              <div className="admin-detail-grid">
                <div>
                  <strong>{userDetail.user.email}</strong>
                  <small>Joined {date(userDetail.user.createdAt)}</small>
                </div>
                <div>
                  <strong>{userDetail.devices.length} devices</strong>
                  <small>{userDetail.subscriptions.length} subscriptions</small>
                </div>
                <div>
                  <strong>{userDetail.integrations.length} integrations</strong>
                  <small>{userDetail.aiUsage.length} recent AI requests</small>
                </div>
              </div>
              <h3>Devices</h3>
              <ul className="admin-record-list">
                {userDetail.devices.map((device) => (
                  <li key={device.id}>
                    <span>
                      <strong>{device.name}</strong>
                      <small>
                        {device.clientType} · last seen {date(device.lastSeenAt)}
                      </small>
                    </span>
                    <span>
                      {device.revokedAt ? (
                        "Revoked"
                      ) : (
                        <button
                          className="quiet-button"
                          type="button"
                          onClick={() =>
                            void perform(
                              `detail-device:${device.id}`,
                              `/devices/${device.id}/revoke`,
                              "POST",
                              {},
                              `Revoke ${device.name}?`,
                            )
                          }
                        >
                          Revoke
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <h3>Integrations</h3>
              <ul className="admin-record-list">
                {userDetail.integrations.map((integration) => (
                  <li key={integration.id}>
                    <span>
                      <strong>{integration.displayName}</strong>
                      <small>
                        {integration.provider} · {integration.status} · {integration.errorCount}{" "}
                        errors
                      </small>
                    </span>
                    <span>
                      {integration.status === "REVOKED" ? (
                        "Revoked"
                      ) : (
                        <button
                          className="quiet-button"
                          type="button"
                          onClick={() =>
                            void perform(
                              `detail-integration:${integration.id}`,
                              `/integrations/${integration.id}/revoke`,
                              "POST",
                              {},
                              `Revoke ${integration.displayName}?`,
                            )
                          }
                        >
                          Revoke
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <button className="quiet-button" type="button" onClick={() => setUserDetail(null)}>
                Close details
              </button>
            </Panel>
          ) : null}
        </>
      ) : null}

      {!loading && section === "subscriptions" ? (
        <Panel title="Subscriptions" eyebrow="Billing support">
          {payload.subscriptions?.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Period end</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.subscriptions.map((item) => (
                    <tr key={item.id}>
                      <td>{item.email}</td>
                      <td>
                        {item.planKey} · {item.billingInterval}
                        {item.unitAmountMinor !== null
                          ? ` · ${(item.unitAmountMinor / 100).toFixed(2)} ${item.currency.toUpperCase()}`
                          : ""}
                      </td>
                      <td>
                        {item.status}
                        {item.cancelAtPeriodEnd ? " · canceling" : ""}
                      </td>
                      <td>{date(item.currentPeriodEnd)}</td>
                      <td>{date(item.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No subscription records yet.</Empty>
          )}
        </Panel>
      ) : null}

      {!loading && section === "devices" ? (
        <Panel title="Registered devices" eyebrow="Session support">
          {payload.devices?.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Last seen</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payload.devices.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.email}</td>
                      <td>{item.clientType}</td>
                      <td>{date(item.lastSeenAt)}</td>
                      <td>{item.revokedAt ? "Revoked" : "Active"}</td>
                      <td>
                        {item.revokedAt ? null : (
                          <button
                            className="quiet-button"
                            type="button"
                            onClick={() =>
                              void perform(
                                `device:${item.id}`,
                                `/devices/${item.id}/revoke`,
                                "POST",
                                {},
                                `Revoke this device and its active sessions for ${item.email}?`,
                              )
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No registered devices.</Empty>
          )}
        </Panel>
      ) : null}

      {!loading && section === "integrations" ? (
        <Panel title="Connected integrations" eyebrow="Connection support">
          {payload.integrations?.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Connection</th>
                    <th>Account</th>
                    <th>Status</th>
                    <th>Last event</th>
                    <th>Errors</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payload.integrations.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.displayName}
                        <small>{item.provider}</small>
                      </td>
                      <td>{item.email}</td>
                      <td>{item.status}</td>
                      <td>{date(item.lastReceivedAt)}</td>
                      <td>
                        {item.errorCount}
                        {item.latestError ? <small>{item.latestError}</small> : null}
                      </td>
                      <td>
                        {item.status === "REVOKED" ? null : (
                          <button
                            className="quiet-button"
                            type="button"
                            onClick={() =>
                              void perform(
                                `integration:${item.id}`,
                                `/integrations/${item.id}/revoke`,
                                "POST",
                                {},
                                `Revoke ${item.displayName} for ${item.email}?`,
                              )
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No integrations.</Empty>
          )}
        </Panel>
      ) : null}

      {!loading && section === "jobs" ? (
        <Panel title="Failed background jobs" eyebrow="BullMQ support">
          {payload.failedJobs?.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Failure</th>
                    <th>Attempts</th>
                    <th>Failed at</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payload.failedJobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <strong>{job.name}</strong>
                        <small>{job.id}</small>
                      </td>
                      <td>{job.failedReason}</td>
                      <td>{job.attemptsMade}</td>
                      <td>
                        {job.finishedOn
                          ? date(new Date(job.finishedOn).toISOString())
                          : date(new Date(job.timestamp).toISOString())}
                      </td>
                      <td>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy !== ""}
                          onClick={() =>
                            void perform(
                              `job:${job.id}`,
                              `/jobs/${encodeURIComponent(job.id)}/retry`,
                              "POST",
                              {},
                              `Retry failed job ${job.name} (${job.id})?`,
                            )
                          }
                        >
                          Retry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>The queue has no retained failed jobs.</Empty>
          )}
        </Panel>
      ) : null}

      {!loading && section === "growth" ? (
        <Panel title="Growth task templates" eyebrow="Shared catalog">
          {role === "ADMIN" ? (
            <form className="admin-inline-form" onSubmit={(event) => void createGrowth(event)}>
              <label>
                New task title
                <input
                  required
                  minLength={2}
                  maxLength={250}
                  value={growthTitle}
                  onChange={(event) => setGrowthTitle(event.target.value)}
                />
              </label>
              <label>
                Stage
                <select
                  value={growthStage}
                  onChange={(event) => setGrowthStage(event.target.value)}
                >
                  {[
                    "IDEA",
                    "PROBLEM_VALIDATION",
                    "SOLUTION_VALIDATION",
                    "PRE_LAUNCH",
                    "LAUNCHED_ZERO_USERS",
                    "EARLY_USERS",
                    "FIRST_REVENUE",
                    "PRODUCT_MARKET_SIGNAL",
                    "GROWTH",
                  ].map((stage) => (
                    <option key={stage}>{stage}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="primary-button" disabled={busy !== ""}>
                Add template
              </button>
            </form>
          ) : null}
          {payload.growthTemplates?.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Task</th>
                    <th>Priority</th>
                    <th>Signal</th>
                    <th>Minutes</th>
                    <th>Reward</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payload.growthTemplates.map((item) => (
                    <tr key={item.id}>
                      <td>{item.productStage}</td>
                      <td>
                        <strong>{item.title}</strong>
                        <small>{item.id}</small>
                      </td>
                      <td>{item.priority}</td>
                      <td>{item.signalStrength}</td>
                      <td>{item.estimatedMinutes}</td>
                      <td>{item.defaultRewardCredits}</td>
                      <td>{item.isActive ? "Active" : "Off"}</td>
                      <td>
                        {role === "ADMIN" ? (
                          <>
                            <button
                              className="quiet-button"
                              type="button"
                              onClick={() => void editGrowthTemplate(item)}
                            >
                              Edit
                            </button>
                            <button
                              className="quiet-button"
                              type="button"
                              onClick={() =>
                                void perform(
                                  `growth:${item.id}`,
                                  `/growth-templates/${encodeURIComponent(item.id)}`,
                                  "PATCH",
                                  { isActive: !item.isActive },
                                )
                              }
                            >
                              {item.isActive ? "Disable" : "Enable"}
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No task templates.</Empty>
          )}
        </Panel>
      ) : null}

      {!loading && section === "rules" ? (
        <Panel title="Policy rule templates" eyebrow="Shared catalog">
          {role === "ADMIN" ? (
            <form className="admin-inline-form" onSubmit={(event) => void createRule(event)}>
              <label>
                New template name
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={ruleName}
                  onChange={(event) => setRuleName(event.target.value)}
                />
              </label>
              <button type="submit" className="primary-button" disabled={busy !== ""}>
                Add starter template
              </button>
            </form>
          ) : null}
          {payload.ruleTemplates?.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Action</th>
                    <th>Priority</th>
                    <th>Conditions</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payload.ruleTemplates.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <small>{item.description}</small>
                      </td>
                      <td>{item.action}</td>
                      <td>{item.priority}</td>
                      <td>
                        <code>{JSON.stringify(item.conditions)}</code>
                      </td>
                      <td>{item.isActive ? "Active" : "Off"}</td>
                      <td>
                        {role === "ADMIN" ? (
                          <>
                            <button
                              className="quiet-button"
                              type="button"
                              onClick={() => void editRuleTemplate(item)}
                            >
                              Edit
                            </button>
                            <button
                              className="quiet-button"
                              type="button"
                              onClick={() =>
                                void perform(
                                  `rule:${item.id}`,
                                  `/rule-templates/${encodeURIComponent(item.id)}`,
                                  "PATCH",
                                  { isActive: !item.isActive },
                                )
                              }
                            >
                              {item.isActive ? "Disable" : "Enable"}
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No rule templates.</Empty>
          )}
          <p className="fine-print">
            Rule templates are a managed catalog. Review each rule's scope and schedule before
            applying it to an account.
          </p>
        </Panel>
      ) : null}

      {!loading && section === "flags" ? (
        <Panel title="Feature flags" eyebrow="Workspace configuration">
          {role === "ADMIN" ? (
            <form className="admin-inline-form" onSubmit={(event) => void createFlag(event)}>
              <label>
                Flag key
                <input
                  required
                  pattern="[a-z][a-z0-9_.-]{1,79}"
                  value={flagKey}
                  onChange={(event) => setFlagKey(event.target.value)}
                  placeholder="reports.new_summary"
                />
              </label>
              <label>
                Description
                <input
                  required
                  minLength={2}
                  maxLength={500}
                  value={flagDescription}
                  onChange={(event) => setFlagDescription(event.target.value)}
                />
              </label>
              <button type="submit" className="primary-button" disabled={busy !== ""}>
                Create disabled flag
              </button>
            </form>
          ) : null}
          {payload.flags?.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Flag</th>
                    <th>Status</th>
                    <th>Rollout</th>
                    <th>Description</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payload.flags.map((item) => (
                    <tr key={item.key}>
                      <td>
                        <code>{item.key}</code>
                      </td>
                      <td>{item.enabled ? "Enabled" : "Disabled"}</td>
                      <td>{item.rolloutPercent}%</td>
                      <td>{item.description}</td>
                      <td>{date(item.updatedAt)}</td>
                      <td>
                        {role === "ADMIN" ? (
                          <>
                            <button
                              className="quiet-button"
                              type="button"
                              onClick={() => void editFeatureFlag(item)}
                            >
                              Edit
                            </button>
                            <button
                              className="quiet-button"
                              type="button"
                              onClick={() =>
                                void perform(
                                  `flag:${item.key}`,
                                  `/feature-flags/${encodeURIComponent(item.key)}`,
                                  "PATCH",
                                  { enabled: !item.enabled },
                                )
                              }
                            >
                              {item.enabled ? "Disable" : "Enable"}
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No flags have been created.</Empty>
          )}
          <p className="fine-print">
            Flags are stored centrally. Existing feature behavior changes only where application
            code reads a flag.
          </p>
        </Panel>
      ) : null}

      {!loading && section === "ai" ? (
        <>
          <StatCards
            values={[
              ["Provider requests · 30d", payload.aiSummary?.requests ?? 0],
              ["Failures · 30d", payload.aiSummary?.failures ?? 0],
              ["Input tokens", payload.aiSummary?.inputTokens ?? 0],
              ["Output tokens", payload.aiSummary?.outputTokens ?? 0],
            ]}
          />
          <Panel title="Recent provider requests" eyebrow="AI usage">
            {payload.aiEvents?.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Capability</th>
                      <th>Model</th>
                      <th>Status</th>
                      <th>Tokens</th>
                      <th>Latency</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.aiEvents.map((item) => (
                      <tr key={item.id}>
                        <td>{item.email ?? "Deleted account"}</td>
                        <td>{item.capability}</td>
                        <td>{item.model}</td>
                        <td>{item.status}</td>
                        <td>
                          {item.inputTokens ?? "—"} / {item.outputTokens ?? "—"}
                        </td>
                        <td>{item.latencyMs} ms</td>
                        <td>{date(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No provider usage has been recorded.</Empty>
            )}
            <p className="fine-print">
              Usage records contain provider, model, token counts, capability, status, and latency.
              Prompt and response content are not stored.
            </p>
          </Panel>
        </>
      ) : null}

      {!loading && section === "audit" ? (
        <Panel title="Admin audit log" eyebrow="Recent support activity">
          {payload.auditEvents?.length ? (
            <ol className="admin-audit-list">
              {payload.auditEvents.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.action.replaceAll("admin.", "").replaceAll("_", " ")}</strong>
                    <small>
                      {item.actorEmail ?? "Deleted admin"} · {item.targetType}
                      {item.targetId ? ` ${item.targetId}` : ""}
                    </small>
                  </div>
                  <time>{date(item.createdAt)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>No admin actions have been recorded.</Empty>
          )}
        </Panel>
      ) : null}
    </WorkspaceFrame>
  );
}
