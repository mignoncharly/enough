"use client";

import { useEffect, useState } from "react";
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type WorkspaceNotification,
} from "../workspace-data";
import { displayWorkspaceDate, WorkspaceFrame } from "../workspace-frame";

export default function NotificationsPage() {
  const [items, setItems] = useState<WorkspaceNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void loadNotifications()
      .then((result) => {
        if (active) setItems(result);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if ((cause as { status?: number })?.status === 401) window.location.replace("/login");
        else
          setError(cause instanceof Error ? cause.message : "Notifications could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function markRead(item: WorkspaceNotification) {
    if (item.readAt || saving) return;
    setSaving(true);
    setError("");
    try {
      await markNotificationRead(item.id);
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry,
        ),
      );
    } catch (cause) {
      if ((cause as { status?: number })?.status === 401) window.location.replace("/login");
      else
        setError(
          cause instanceof Error ? cause.message : "This notification could not be updated.",
        );
    } finally {
      setSaving(false);
    }
  }

  async function markAllRead() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await markAllNotificationsRead();
      const now = new Date().toISOString();
      setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt: now })));
      setNotice("All notifications marked as read.");
    } catch (cause) {
      if ((cause as { status?: number })?.status === 401) window.location.replace("/login");
      else setError(cause instanceof Error ? cause.message : "Notifications could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  const unreadCount = items.filter((item) => !item.readAt).length;
  return (
    <WorkspaceFrame
      active="notifications"
      eyebrow="Notifications"
      title="A quiet record of important changes"
      description="Review verified task rewards, product stage changes, and selected market signals."
    >
      <div className="notification-toolbar">
        <p className="muted-copy">{unreadCount} unread · newest 50</p>
        <button
          className="secondary-button"
          type="button"
          disabled={saving || unreadCount === 0}
          onClick={() => void markAllRead()}
        >
          Mark all read
        </button>
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
      {loading ? (
        <p className="notice" role="status">
          Loading notifications…
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <section className="account-card">
          <h2>No notifications yet</h2>
          <p className="muted-copy">
            Enough will record a notification when a selected milestone or verified reward occurs.
          </p>
          <a className="secondary-button link-button" href="/settings">
            Set notification preferences
          </a>
        </section>
      ) : null}
      {!loading && items.length > 0 ? (
        <ol className="notification-list">
          {items.map((item) => (
            <li
              className={
                item.readAt ? "notification-item" : "notification-item notification-unread"
              }
              key={item.id}
            >
              <div className="notification-copy">
                <div className="notification-title-row">
                  <h2>{item.title}</h2>
                  {!item.readAt ? <span className="notification-unread-label">Unread</span> : null}
                </div>
                <p>{item.body}</p>
                <time dateTime={item.createdAt}>{displayWorkspaceDate(item.createdAt)}</time>
              </div>
              <div className="notification-actions">
                <a className="quiet-link" href={item.href}>
                  Open
                </a>
                {!item.readAt ? (
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={saving}
                    onClick={() => void markRead(item)}
                  >
                    Mark read
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="muted-copy">
        Email is opt-in. Desktop alerts follow your quiet hours and a delivery cap. Web push is not
        enabled.
      </p>
    </WorkspaceFrame>
  );
}
