"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  deleteActivityHistory,
  deleteCurrentAccount,
  disconnectOAuthIdentity,
  loadPrivacyDashboard,
  type PrivacyConsent,
  type PrivacyDashboardData,
  revokeAuthDevice,
  savePrivacyPreferences,
  setPrivacyConsent,
} from "../workspace-data";
import { WorkspaceFrame } from "../workspace-frame";

function friendlyAuditName(value: string): string {
  return value.replaceAll(".", " · ").replaceAll("_", " ");
}

function retentionLabel(days: number): string {
  if (days < 365) return `${days} days`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${years} ${years === 1 ? "year" : "years"}`;
}

export default function PrivacyPage() {
  const [data, setData] = useState<PrivacyDashboardData | null>(null);
  const [activityRetentionDays, setActivityRetentionDays] = useState(365);
  const [notificationRetentionDays, setNotificationRetentionDays] = useState(365);
  const [auditRetentionDays, setAuditRetentionDays] = useState(730);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const result = await loadPrivacyDashboard();
    setData(result);
    setActivityRetentionDays(result.preferences.activity_retention_days);
    setNotificationRetentionDays(result.preferences.notification_retention_days);
    setAuditRetentionDays(result.preferences.audit_retention_days);
  }

  useEffect(() => {
    let active = true;
    void loadPrivacyDashboard()
      .then((result) => {
        if (!active) return;
        setData(result);
        setActivityRetentionDays(result.preferences.activity_retention_days);
        setNotificationRetentionDays(result.preferences.notification_retention_days);
        setAuditRetentionDays(result.preferences.audit_retention_days);
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(
            cause instanceof Error ? cause.message : "Privacy information could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await savePrivacyPreferences({
        activityRetentionDays,
        notificationRetentionDays,
        auditRetentionDays,
      });
      setNotice(
        "Retention settings saved. The running worker targets a six-hour cleanup cycle; cleanup pauses while that worker is offline.",
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Retention settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function changeConsent(purpose: PrivacyConsent["purpose"], enabled: boolean) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await setPrivacyConsent(purpose, enabled);
      setData((current) =>
        current
          ? {
              ...current,
              consents: current.consents.map((consent) =>
                consent.purpose === purpose ? result.consent : consent,
              ),
            }
          : current,
      );
      setNotice(
        purpose === "ACTIVITY_COLLECTION"
          ? enabled
            ? "Activity consent granted. Sync each client, then enable its local capture toggle if you want activity recorded."
            : "Activity consent revoked. The API rejects new events immediately; connected clients stop local capture and clear unsent events at their next sync (about five minutes). Re-granting consent still requires enabling the local toggle again. Existing server records remain until you delete them or retention expires."
          : enabled
            ? "AI provider consent granted and recorded."
            : "AI provider consent revoked. New provider requests are blocked immediately; an already-started request may finish.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Consent could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function clearActivity() {
    if (
      window.prompt("Type DELETE to erase all stored activity events and aggregates.") !== "DELETE"
    )
      return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await deleteActivityHistory();
      setNotice(
        `${result.deleted} stored activity events and their aggregate history were deleted.`,
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Activity history could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect(provider: string) {
    if (!window.confirm(`Disconnect ${provider} as a sign-in method?`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await disconnectOAuthIdentity(provider);
      setNotice(`${provider} sign-in was disconnected.`);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The sign-in method could not be disconnected.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function revokeDevice(deviceId: string) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await revokeAuthDevice(deviceId);
      setNotice("Device access revoked. Its active sessions were revoked too.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Device access could not be revoked.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !window.confirm(
        "Permanently delete your Enough account, workspace, records, and access? This cannot be undone.",
      )
    )
      return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await deleteCurrentAccount({
        confirmationEmail,
        ...(data?.account.hasPassword ? { password } : {}),
      });
      window.location.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The account could not be deleted.");
      setSaving(false);
    }
  }

  const consentRecord = (purpose: PrivacyConsent["purpose"]) =>
    data?.consents.find((consent) => consent.purpose === purpose);
  const consentEnabled = (purpose: PrivacyConsent["purpose"]) =>
    Boolean(consentRecord(purpose)?.enabled);

  return (
    <WorkspaceFrame
      active="privacy"
      eyebrow="Privacy"
      title="Your data, in one place"
      description="Inspect the activity Enough has collected, control optional processing, set retention periods, disconnect sign-in methods, and erase your records."
    >
      {loading ? (
        <p className="notice" role="status">
          Loading privacy controls…
        </p>
      ) : null}
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
      {data ? (
        <>
          <section className="account-card">
            <p className="eyebrow">Account record</p>
            <h2>{data.account.email}</h2>
            <p className="muted-copy">
              Created {new Date(data.account.createdAt).toLocaleDateString()} · Email{" "}
              {data.account.emailVerified ? "verified" : "not verified"}. Your complete export
              includes workspace, activity, evidence, notifications, integrations, billing, device,
              consent, and audit records.
            </p>
            <div className="goal-actions">
              <a className="secondary-button link-button" href="/api/auth/account/export">
                Download account export
              </a>
              <a className="secondary-button link-button" href="/privacy-policy.md">
                Privacy and processing record
              </a>
            </div>
          </section>

          <section className="account-card">
            <p className="eyebrow">Optional data use</p>
            <h2>Consent controls</h2>
            <div className="privacy-consent-list">
              <label className="privacy-consent">
                <span>
                  <strong>Activity collection</strong>
                  <small>
                    Allow the signed-in clients to submit supported activity event metadata to this
                    account. Enough does not capture source code, keystrokes, clipboard contents,
                    screen recordings, documents, email bodies, passwords, or terminal commands. A
                    separate local capture toggle in each client must also be on.
                  </small>
                  <small>
                    {consentRecord("ACTIVITY_COLLECTION")?.enabled
                      ? `Granted ${new Date(consentRecord("ACTIVITY_COLLECTION")?.granted_at ?? "").toLocaleString()}`
                      : consentRecord("ACTIVITY_COLLECTION")?.revoked_at
                        ? `Revoked ${new Date(consentRecord("ACTIVITY_COLLECTION")?.revoked_at ?? "").toLocaleString()}`
                        : "Not granted"}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={consentEnabled("ACTIVITY_COLLECTION")}
                  disabled={saving}
                  onChange={(event) =>
                    void changeConsent("ACTIVITY_COLLECTION", event.target.checked)
                  }
                />
              </label>
              <label className="privacy-consent">
                <span>
                  <strong>Optional AI provider processing</strong>
                  <small>
                    Allow the Coach to send the selected product, task, goal, numeric traction, and
                    (only for evidence classification) selected evidence title and note to OpenAI
                    when you click Get advice. It does not send event details, evidence files, URLs,
                    or integration references.
                  </small>
                  <small>
                    {consentRecord("AI_PROVIDER_PROCESSING")?.enabled
                      ? `Granted ${new Date(consentRecord("AI_PROVIDER_PROCESSING")?.granted_at ?? "").toLocaleString()}`
                      : consentRecord("AI_PROVIDER_PROCESSING")?.revoked_at
                        ? `Revoked ${new Date(consentRecord("AI_PROVIDER_PROCESSING")?.revoked_at ?? "").toLocaleString()}`
                        : "Not granted"}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={consentEnabled("AI_PROVIDER_PROCESSING")}
                  disabled={saving}
                  onChange={(event) =>
                    void changeConsent("AI_PROVIDER_PROCESSING", event.target.checked)
                  }
                />
              </label>
            </div>
            <p className="muted-copy">
              Revoking consent stops future collection or provider requests; it does not erase
              records already stored. Use the controls below to delete activity, evidence, or the
              full account.
            </p>
          </section>

          <section className="account-card">
            <p className="eyebrow">Retention</p>
            <h2>Choose how long records stay here</h2>
            <form
              className="privacy-retention-form"
              onSubmit={(event) => void saveRetention(event)}
            >
              <label>
                Activity events
                <select
                  value={activityRetentionDays}
                  onChange={(event) => setActivityRetentionDays(Number(event.target.value))}
                >
                  {data.retentionOptions.map((days) => (
                    <option key={days} value={days}>
                      {retentionLabel(days)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Notifications
                <select
                  value={notificationRetentionDays}
                  onChange={(event) => setNotificationRetentionDays(Number(event.target.value))}
                >
                  {data.retentionOptions.map((days) => (
                    <option key={days} value={days}>
                      {retentionLabel(days)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Audit history
                <select
                  value={auditRetentionDays}
                  onChange={(event) => setAuditRetentionDays(Number(event.target.value))}
                >
                  {data.retentionOptions.map((days) => (
                    <option key={days} value={days}>
                      {retentionLabel(days)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" type="submit" disabled={saving}>
                Save retention
              </button>
            </form>
            <p className="muted-copy">
              Available periods are 30 days to 10 years. The worker targets a six-hour cleanup
              cycle; cleanup is delayed while it is offline. Task rewards, evidence review state,
              billing records, and account security records are not removed by these activity and
              inbox timers.
            </p>
            <div className="privacy-delete-row">
              <span>
                <strong>Delete all activity now</strong>
                <small>
                  Removes event details and hourly aggregates for every product. This does not
                  delete products, tasks, or evidence.
                </small>
              </span>
              <button
                className="danger-button"
                type="button"
                disabled={saving}
                onClick={() => void clearActivity()}
              >
                Delete activity
              </button>
            </div>
          </section>

          <section className="account-card">
            <p className="eyebrow">Collected activity</p>
            <h2>
              Recent records ({data.collectedActivity.length}
              {data.collectedActivity.length === 50 ? "+" : ""})
            </h2>
            <p className="muted-copy">
              Each row shows the stored event type, time, product, device, and exact attributes.{" "}
              <a href="/activity">Open full activity history</a>.
            </p>
            {data.collectedActivity.length ? (
              <ul className="privacy-record-list">
                {data.collectedActivity.map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>{event.event_type}</strong>
                      <span>
                        {event.product_name} · {new Date(event.effective_at).toLocaleString()} ·{" "}
                        {event.device_name ?? "Unknown device"}
                      </span>
                    </div>
                    <details>
                      <summary>Stored attributes</summary>
                      <pre>{JSON.stringify(event.attributes, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">No activity events are stored.</p>
            )}
          </section>

          <div className="dashboard-columns">
            <section className="account-card">
              <p className="eyebrow">Evidence</p>
              <h2>
                {data.evidence.liveCount} active records ·{" "}
                {(data.evidence.fileBytes / 1024 / 1024).toFixed(1)} MiB of files
              </h2>
              <p className="muted-copy">
                Delete evidence details and uploaded files individually. Task review state and
                reward history remain so the ledger can still be explained.
              </p>
              <a className="secondary-button link-button" href="/evidence">
                Inspect and delete evidence
              </a>
            </section>
            <section className="account-card">
              <p className="eyebrow">Sign-in and devices</p>
              <h2>Connected access</h2>
              <h3>OAuth sign-in</h3>
              {data.identities.length ? (
                <ul className="privacy-access-list">
                  {data.identities.map((identity) => (
                    <li key={identity.provider}>
                      <span>
                        <strong>{identity.provider}</strong>
                        <small>Linked {new Date(identity.created_at).toLocaleDateString()}</small>
                      </span>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={saving}
                        onClick={() => void disconnect(identity.provider)}
                      >
                        Disconnect
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">No OAuth identities are linked.</p>
              )}
              {!data.account.hasPassword && data.identities.length <= 1 ? (
                <p className="notice">
                  Add another sign-in method before disconnecting your only login.
                </p>
              ) : null}
              <p className="muted-copy">
                Disconnecting removes the Enough login link. Existing Enough sessions stay active
                until revoked below or in Devices. Enough does not store Google or GitHub access
                tokens, so their separate provider sessions are not revoked here.
              </p>
              <h3>Devices</h3>
              {data.devices.length ? (
                <ul className="privacy-access-list">
                  {data.devices.map((device) => (
                    <li key={device.id}>
                      <span>
                        <strong>{device.name}</strong>
                        <small>
                          {device.client_type} · Last seen{" "}
                          {new Date(device.last_seen_at).toLocaleString()}
                          {device.revoked_at ? " · Revoked" : ""}
                        </small>
                      </span>
                      {!device.revoked_at ? (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={saving}
                          onClick={() => void revokeDevice(device.id)}
                        >
                          Revoke
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">No devices are registered.</p>
              )}
              <a className="quiet-link" href="/devices">
                Review sessions
              </a>
            </section>
          </div>

          <section className="account-card">
            <p className="eyebrow">Audit history</p>
            <h2>Recent account changes</h2>
            {data.auditHistory.length ? (
              <ul className="privacy-record-list">
                {data.auditHistory.map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>{friendlyAuditName(event.event_type)}</strong>
                      <span>{new Date(event.created_at).toLocaleString()}</span>
                    </div>
                    {event.metadata ? (
                      <details>
                        <summary>Recorded details</summary>
                        <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">No account audit events are stored.</p>
            )}
          </section>

          <section className="account-card privacy-danger-zone">
            <p className="eyebrow">Permanent action</p>
            <h2>Delete your Enough account</h2>
            <p className="muted-copy">
              This removes your workspace, products, evidence files, activity, notifications,
              integrations, sign-in identities, sessions, and local billing records. If Stripe
              billing is linked, Enough requests Stripe to delete its customer record, which
              immediately cancels active subscriptions; Stripe may retain payment history required
              for accounting and fraud prevention.
            </p>
            <form className="privacy-delete-form" onSubmit={(event) => void deleteAccount(event)}>
              <label>
                Type your account email
                <input
                  type="email"
                  value={confirmationEmail}
                  onChange={(event) => setConfirmationEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
              {data.account.hasPassword ? (
                <label>
                  Enter your password
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </label>
              ) : (
                <p className="muted-copy">
                  This passwordless account must have signed in within the last five minutes before
                  deletion.
                </p>
              )}
              <button className="danger-button" type="submit" disabled={saving}>
                Delete account permanently
              </button>
            </form>
          </section>
        </>
      ) : null}
    </WorkspaceFrame>
  );
}
