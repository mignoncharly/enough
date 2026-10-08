"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  loadNotificationPreferences,
  type NotificationPreferences,
  saveNotificationPreferences,
} from "../workspace-data";

export function NotificationPreferencesForm() {
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    webEnabled: true,
    desktopEnabled: true,
    emailEnabled: false,
    timezone: "UTC",
    quietHours: null,
  });
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void loadNotificationPreferences()
      .then((result) => {
        if (!active) return;
        setPreferences(result);
        setQuietEnabled(Boolean(result.quietHours));
        if (result.quietHours) {
          setQuietStart(result.quietHours.start);
          setQuietEnd(result.quietHours.end);
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if ((cause as { status?: number })?.status === 401) window.location.replace("/login");
        else setError(cause instanceof Error ? cause.message : "Preferences could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const payload: NotificationPreferences = {
      ...preferences,
      quietHours: quietEnabled ? { start: quietStart, end: quietEnd } : null,
    };
    try {
      const result = await saveNotificationPreferences(payload);
      setPreferences(result.preferences);
      setQuietEnabled(Boolean(result.preferences.quietHours));
      setNotice("Notification preferences saved.");
    } catch (cause) {
      const status = (cause as { status?: number })?.status;
      if (status === 401) window.location.replace("/login");
      else setError(cause instanceof Error ? cause.message : "Preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="notification-preferences-form" onSubmit={(event) => void save(event)}>
      <p className="muted-copy">
        Desktop and email alerts are rate limited. Quiet hours defer those alerts until your local
        quiet period ends. Your inbox remains available on the web.
      </p>
      {loading ? (
        <p className="notice" role="status">
          Loading notification preferences…
        </p>
      ) : null}
      <label className="preference-toggle">
        <input
          type="checkbox"
          checked={preferences.webEnabled}
          onChange={(event) => setPreferences({ ...preferences, webEnabled: event.target.checked })}
        />
        <span>Web inbox</span>
      </label>
      <label className="preference-toggle">
        <input
          type="checkbox"
          checked={preferences.desktopEnabled}
          onChange={(event) =>
            setPreferences({ ...preferences, desktopEnabled: event.target.checked })
          }
        />
        <span>Desktop alerts</span>
      </label>
      <label className="preference-toggle">
        <input
          type="checkbox"
          checked={preferences.emailEnabled}
          onChange={(event) =>
            setPreferences({ ...preferences, emailEnabled: event.target.checked })
          }
        />
        <span>Email notifications</span>
      </label>
      <label>
        Time zone
        <input
          required
          maxLength={100}
          value={preferences.timezone}
          onChange={(event) => setPreferences({ ...preferences, timezone: event.target.value })}
          placeholder="Europe/Berlin"
        />
        <small>Use an IANA name such as Europe/Berlin or America/New_York.</small>
      </label>
      <button
        className="secondary-button"
        type="button"
        onClick={() =>
          setPreferences({
            ...preferences,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          })
        }
      >
        Use this device’s time zone
      </button>
      <label className="preference-toggle">
        <input
          type="checkbox"
          checked={quietEnabled}
          onChange={(event) => setQuietEnabled(event.target.checked)}
        />
        <span>Set quiet hours</span>
      </label>
      {quietEnabled ? (
        <div className="quiet-hours-fields">
          <label>
            Start
            <input
              type="time"
              required
              value={quietStart}
              onChange={(event) => setQuietStart(event.target.value)}
            />
          </label>
          <label>
            End
            <input
              type="time"
              required
              value={quietEnd}
              onChange={(event) => setQuietEnd(event.target.value)}
            />
          </label>
        </div>
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
      <button className="primary-button" type="submit" disabled={loading || saving}>
        {saving ? "Saving…" : "Save notification preferences"}
      </button>
    </form>
  );
}
