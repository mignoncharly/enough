"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type AuthDeviceSummary,
  type AuthSessionSummary,
  loadAuthDevices,
  loadAuthSessions,
  revokeAuthDevice,
  revokeAuthSession,
} from "../workspace-data";
import { displayWorkspaceDate, WorkspaceFrame } from "../workspace-frame";

export default function DevicesPage() {
  const [devices, setDevices] = useState<AuthDeviceSummary[]>([]);
  const [sessions, setSessions] = useState<AuthSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [deviceItems, sessionItems] = await Promise.all([loadAuthDevices(), loadAuthSessions()]);
    setDevices(deviceItems);
    setSessions(sessionItems);
  }, []);

  useEffect(() => {
    let active = true;
    void refresh()
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "Devices could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  async function revoke(id: string, kind: "device" | "session") {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      if (kind === "device") await revokeAuthDevice(id);
      else await revokeAuthSession(id);
      await refresh();
      setNotice(
        kind === "device" ? "Device revoked. Its active sessions have ended." : "Session revoked.",
      );
    } catch (cause) {
      const status = (cause as { status?: number })?.status;
      if (status === 401) window.location.replace("/login");
      else setError(cause instanceof Error ? cause.message : "Access could not be revoked.");
    } finally {
      setBusyId("");
    }
  }

  const currentDeviceId = sessions.find((session) => session.current)?.deviceId;

  return (
    <WorkspaceFrame
      active="devices"
      eyebrow="Devices"
      title="Manage access"
      description="Review signed-in sessions and connected devices. Revoking a device also revokes its active sessions."
    >
      {loading ? (
        <p className="notice" role="status">
          Loading access…
        </p>
      ) : null}
      {error ? (
        <section className="account-card" role="alert">
          <h2>Access could not be loaded</h2>
          <p className="error">{error}</p>
          <a className="secondary-button link-button" href="/login">
            Sign in again
          </a>
        </section>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {!loading && !error && devices.length === 0 ? (
        <section className="account-card">
          <p className="eyebrow">No devices</p>
          <h2>This account has no registered devices</h2>
          <a className="primary-button link-button" href="/">
            Open account settings
          </a>
        </section>
      ) : null}
      {devices.length > 0 ? (
        <section className="account-card">
          <p className="eyebrow">Devices</p>
          <h2>Registered clients</h2>
          <ul className="device-list device-management-list">
            {devices.map((device) => (
              <li key={device.id}>
                <span>
                  <strong>{device.name}</strong>
                  <small>
                    {device.clientType} · created {displayWorkspaceDate(device.createdAt)} · last
                    active {displayWorkspaceDate(device.lastSeenAt)}
                    {device.id === currentDeviceId ? " · current device" : ""}
                  </small>
                </span>
                {device.revoked ? (
                  <span className="revoked-label">Revoked</span>
                ) : device.id === currentDeviceId ? (
                  <span className="revoked-label">Current</span>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === device.id}
                    onClick={() => void revoke(device.id, "device")}
                  >
                    {busyId === device.id ? "Revoking…" : "Revoke device"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sessions.length > 0 ? (
        <section className="account-card">
          <p className="eyebrow">Sessions</p>
          <h2>Browser and client sessions</h2>
          <ul className="session-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <div>
                  <strong>
                    {session.deviceName}
                    {session.current ? " · This session" : ""}
                  </strong>
                  <span>
                    {session.clientType} · {session.authMethod} · last active{" "}
                    {displayWorkspaceDate(session.lastSeenAt)} · expires{" "}
                    {displayWorkspaceDate(session.expiresAt)}
                  </span>
                </div>
                {session.revoked ? (
                  <span className="revoked-label">Revoked</span>
                ) : session.current ? (
                  <span className="revoked-label">Current</span>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === session.id}
                    onClick={() => void revoke(session.id, "session")}
                  >
                    {busyId === session.id ? "Revoking…" : "Revoke"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="account-card">
        <p className="eyebrow">New client</p>
        <h2>Register a desktop app or extension</h2>
        <p className="muted-copy">
          Create a bearer token from the account page. The full token is shown once when created.
        </p>
        <a className="secondary-button link-button" href="/">
          Open account settings
        </a>
      </section>
    </WorkspaceFrame>
  );
}
