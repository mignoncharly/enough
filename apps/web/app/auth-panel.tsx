"use client";

import { useCallback, useEffect, useState } from "react";
import { ThemePreference, WorkspaceHeader } from "./workspace-header";

type User = {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  createdAt: string;
};

type ProviderConfig = { google: boolean; github: boolean };
type SessionItem = {
  id: string;
  deviceId: string;
  deviceName: string;
  clientType: "web" | "desktop" | "extension";
  authMethod: string;
  createdAt: string;
  lastSeenAt: string;
  revoked: boolean;
  current: boolean;
};
type DeviceItem = {
  id: string;
  name: string;
  clientType: "web" | "desktop" | "extension";
  lastSeenAt: string;
  revoked: boolean;
};

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`/api/auth${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
  if (response.status === 204) return null as T;
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? "The request could not be completed.");
  return payload;
}

function cookieValue(name: string): string {
  if (typeof document === "undefined") return "";
  const part = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function AuthPanel() {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [preCsrf, setPreCsrf] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [providers, setProviders] = useState<ProviderConfig>({ google: false, github: false });
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [deviceType, setDeviceType] = useState<"desktop" | "extension">("desktop");
  const [newAccessToken, setNewAccessToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const loadCsrf = useCallback(async () => {
    const result = await apiRequest<{ csrfToken: string }>("/csrf");
    setPreCsrf(result.csrfToken);
    return result.csrfToken;
  }, []);

  const loadAccountState = useCallback(async () => {
    const [sessionResult, deviceResult] = await Promise.all([
      apiRequest<{ sessions: SessionItem[] }>("/sessions"),
      apiRequest<{ devices: DeviceItem[] }>("/devices"),
    ]);
    setSessions(sessionResult.sessions);
    setDevices(deviceResult.devices);
  }, []);

  const csrfHeader = useCallback(
    (token?: string) => ({
      "x-csrf-token": user
        ? cookieValue("enough_csrf") || cookieValue("__Host-enough_csrf")
        : token || preCsrf,
    }),
    [preCsrf, user],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await loadCsrf();
        const configured = await apiRequest<ProviderConfig & { google: boolean; github: boolean }>(
          "/providers",
        );
        if (active) setProviders({ google: configured.google, github: configured.github });

        const magicToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
        if (magicToken) {
          const result = await apiRequest<{ user: User }>("/magic-link/consume", {
            method: "POST",
            headers: { "x-csrf-token": token },
            body: JSON.stringify({ token: magicToken, clientType: "web" }),
          });
          window.history.replaceState(null, "", window.location.pathname);
          if (active) {
            setUser(result.user);
            setMessage("You are signed in.");
            await loadAccountState();
          }
          return;
        }

        try {
          const result = await apiRequest<{ user: User }>("/me");
          if (active) {
            setUser(result.user);
            await loadAccountState();
          }
        } catch {
          // An anonymous visitor is expected to have no session.
        }
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "Authentication is unavailable.");
      }
    })();
    const oauthResult = new URLSearchParams(window.location.search).get("oauth");
    if (oauthResult === "cancelled") setMessage("Sign-in was cancelled.");
    if (oauthResult === "error")
      setError("Provider sign-in could not be completed. Try again or use email.");
    return () => {
      active = false;
    };
  }, [loadAccountState, loadCsrf]);

  async function submitEmailAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preCsrf) {
      setError("Preparing secure sign-in. Try again in a moment.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "signup") {
        await apiRequest("/signup", {
          method: "POST",
          headers: csrfHeader(),
          body: JSON.stringify({ email, password, displayName, clientType: "web" }),
        });
        setMessage("Check your email for a verification link. You can resend it below if needed.");
      } else if (mode === "login") {
        const result = await apiRequest<{ user: User }>("/login", {
          method: "POST",
          headers: csrfHeader(),
          body: JSON.stringify({ email, password, clientType: "web" }),
        });
        setUser(result.user);
        setPassword("");
        await loadAccountState();
        setMessage("You are signed in.");
      } else {
        await apiRequest("/password-reset/request", {
          method: "POST",
          headers: csrfHeader(),
          body: JSON.stringify({ email }),
        });
        setMessage("If the account can use password sign-in, a reset link will arrive shortly.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink() {
    if (!preCsrf) return setError("Preparing secure sign-in. Try again in a moment.");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest("/magic-link/request", {
        method: "POST",
        headers: csrfHeader(),
        body: JSON.stringify({ email }),
      });
      setMessage("If the account can sign in, a one-time link will arrive shortly.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (!preCsrf) return setError("Preparing secure sign-in. Try again in a moment.");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest("/email-verification/resend", {
        method: "POST",
        headers: csrfHeader(),
        body: JSON.stringify({ email }),
      });
      setMessage("If the account still needs verification, a link will arrive shortly.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function startOAuth(provider: "google" | "github") {
    if (!preCsrf) return setError("Preparing secure sign-in. Try again in a moment.");
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ authorizationUrl: string }>(`/oauth/${provider}/start`, {
        method: "POST",
        headers: csrfHeader(),
        body: JSON.stringify({}),
      });
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider sign-in could not be started.");
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    try {
      await apiRequest("/logout", { method: "POST", headers: csrfHeader() });
      setUser(null);
      setSessions([]);
      setDevices([]);
      setMessage("You are signed out.");
      await loadCsrf();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSession(sessionId: string) {
    setError("");
    try {
      await apiRequest(`/sessions/${sessionId}`, { method: "DELETE", headers: csrfHeader() });
      await loadAccountState();
      setMessage("Session revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke that session.");
    }
  }

  async function revokeDevice(deviceId: string) {
    setError("");
    try {
      await apiRequest(`/devices/${deviceId}`, { method: "DELETE", headers: csrfHeader() });
      await loadAccountState();
      setMessage("Device revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke that device.");
    }
  }

  async function registerDevice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNewAccessToken("");
    try {
      const result = await apiRequest<{ accessToken?: string }>("/sessions", {
        method: "POST",
        headers: csrfHeader(),
        body: JSON.stringify({ clientType: deviceType, deviceName }),
      });
      setNewAccessToken(result.accessToken ?? "");
      setDeviceName("");
      await loadAccountState();
      setMessage("Device session created. Copy its token now; it is only shown once.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not register that device.");
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await apiRequest("/password/change", {
        method: "POST",
        headers: csrfHeader(),
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setUser(null);
      setPassword("");
      setCurrentPassword("");
      setNewPassword("");
      await loadCsrf();
      setMessage("Password changed. Sign in again with the new password.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change your password.");
    }
  }

  async function deleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !window.confirm("Delete your Enough account and authentication data? This cannot be undone.")
    )
      return;
    setBusy(true);
    setError("");
    try {
      await apiRequest("/account", {
        method: "DELETE",
        headers: csrfHeader(),
        body: JSON.stringify({
          confirmationEmail: email || user?.email,
          password: currentPassword || undefined,
        }),
      });
      setUser(null);
      setSessions([]);
      setDevices([]);
      setCurrentPassword("");
      setShowDelete(false);
      await loadCsrf();
      setMessage("Your account has been deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete your account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      {user ? (
        <WorkspaceHeader active="home" onSignOut={() => void logout()} signOutDisabled={busy} />
      ) : (
        <header className="brand-row">
          <a className="brand-mark" href="/" aria-label="Enough home">
            E
          </a>
          <span>Enough</span>
          <ThemePreference />
        </header>
      )}

      <section className="auth-main">
        <div className="auth-intro">
          <p className="eyebrow">Founder focus</p>
          <h1>Earn your next coding session by getting market signal.</h1>
          <p>Enough helps technical founders balance building with customer learning.</p>
        </div>

        {!user ? (
          <div className="auth-card">
            <div className="auth-tabs" role="tablist" aria-label="Account access">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                onClick={() => {
                  setMode("login");
                  setMessage("");
                  setError("");
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                onClick={() => {
                  setMode("signup");
                  setMessage("");
                  setError("");
                }}
              >
                Create account
              </button>
            </div>

            <h2>
              {mode === "signup"
                ? "Create your account"
                : mode === "reset"
                  ? "Reset password"
                  : "Welcome back"}
            </h2>
            <form className="auth-form" onSubmit={submitEmailAction}>
              {mode === "signup" ? (
                <label>
                  Your name
                  <input
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={80}
                  />
                </label>
              ) : null}
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={320}
                />
              </label>
              {mode !== "reset" ? (
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={mode === "signup" ? 12 : 1}
                    maxLength={1024}
                  />
                  {mode === "signup" ? <small>Use at least 12 characters.</small> : null}
                </label>
              ) : null}
              <button className="primary-button" type="submit" disabled={busy || !preCsrf}>
                {busy
                  ? "Please wait…"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "reset"
                      ? "Send reset link"
                      : "Sign in"}
              </button>
            </form>

            {mode === "login" ? (
              <div className="auth-links">
                <button type="button" onClick={sendMagicLink} disabled={busy || !preCsrf || !email}>
                  Email me a sign-in link
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("reset");
                    setMessage("");
                    setError("");
                  }}
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  onClick={resendVerification}
                  disabled={busy || !preCsrf || !email}
                >
                  Resend verification email
                </button>
              </div>
            ) : null}
            {mode === "reset" ? (
              <div className="auth-links">
                <button type="button" onClick={() => setMode("login")}>
                  Back to sign in
                </button>
              </div>
            ) : null}

            <div className="divider">
              <span>or continue with</span>
            </div>
            <div className="provider-row">
              <button
                type="button"
                onClick={() => startOAuth("google")}
                disabled={busy || !preCsrf || !providers.google}
              >
                Google
              </button>
              <button
                type="button"
                onClick={() => startOAuth("github")}
                disabled={busy || !preCsrf || !providers.github}
              >
                GitHub
              </button>
            </div>
            {message ? (
              <p className="notice" role="status">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <p className="fine-print">
              By continuing, you agree to use Enough to build less blindly and learn from the
              market.
            </p>
          </div>
        ) : (
          <div className="account-column">
            <section className="account-card">
              <p className="eyebrow">Account</p>
              <h2>
                {user.displayName ? `Good to have you, ${user.displayName}.` : "You’re signed in."}
              </h2>
              <p>
                {user.email}{" "}
                <span className="verified-mark">
                  · {user.emailVerified ? "verified" : "unverified"}
                </span>
              </p>
              <div className="account-actions">
                <a className="primary-button link-button" href="/dashboard">
                  Open your workspace
                </a>
                <a className="primary-button link-button" href="/api/auth/account/export">
                  Export account data
                </a>
                <button type="button" className="quiet-button" onClick={logout} disabled={busy}>
                  Sign out
                </button>
              </div>
            </section>

            <section className="account-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Access</p>
                  <h3>Sessions and devices</h3>
                </div>
                <button type="button" className="quiet-button" onClick={loadAccountState}>
                  Refresh
                </button>
              </div>
              <ul className="session-list">
                {sessions.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>
                        {item.deviceName}
                        {item.current ? " · This session" : ""}
                      </strong>
                      <span>
                        {item.clientType} · {item.authMethod} · Last active{" "}
                        {formatDate(item.lastSeenAt)}
                      </span>
                    </div>
                    {!item.revoked ? (
                      <button
                        type="button"
                        onClick={() => (item.current ? logout() : revokeSession(item.id))}
                      >
                        {item.current ? "Sign out" : "Revoke"}
                      </button>
                    ) : (
                      <span className="revoked-label">Revoked</span>
                    )}
                  </li>
                ))}
              </ul>
              {devices.length ? (
                <ul className="device-list">
                  {devices.map((item) => (
                    <li key={item.id}>
                      <span>
                        {item.name}{" "}
                        <small>
                          {item.clientType} ·{" "}
                          {item.revoked ? "revoked" : `seen ${formatDate(item.lastSeenAt)}`}
                        </small>
                      </span>
                      {!item.revoked &&
                      item.id !== sessions.find((current) => current.current)?.deviceId ? (
                        <button type="button" onClick={() => revokeDevice(item.id)}>
                          Revoke device
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="account-card">
              <p className="eyebrow">Add a client</p>
              <h3>Register a desktop app or extension</h3>
              <p className="muted-copy">
                Create a separate bearer credential for a client. Copy it into that client’s secure
                credential store; the full value is shown once.
              </p>
              <form className="inline-form" onSubmit={registerDevice}>
                <label>
                  Client name
                  <input
                    required
                    value={deviceName}
                    onChange={(event) => setDeviceName(event.target.value)}
                    maxLength={80}
                    placeholder="My laptop"
                  />
                </label>
                <label>
                  Type
                  <select
                    value={deviceType}
                    onChange={(event) =>
                      setDeviceType(event.target.value as "desktop" | "extension")
                    }
                  >
                    <option value="desktop">Desktop</option>
                    <option value="extension">Browser extension</option>
                  </select>
                </label>
                <button className="secondary-button" type="submit">
                  Create token
                </button>
              </form>
              {newAccessToken ? (
                <div className="token-box">
                  <label htmlFor="device-token">Device token</label>
                  <textarea id="device-token" readOnly value={newAccessToken} rows={3} />
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(newAccessToken)}
                  >
                    Copy token
                  </button>
                </div>
              ) : null}
            </section>

            <section className="account-card">
              <p className="eyebrow">Password</p>
              <h3>Change password</h3>
              <form className="inline-form" onSubmit={changePassword}>
                <label>
                  Current password
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </label>
                <label>
                  New password
                  <input
                    type="password"
                    required
                    minLength={12}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                  <small>At least 12 characters.</small>
                </label>
                <button className="secondary-button" type="submit">
                  Change password
                </button>
              </form>
            </section>

            <section className="account-card danger-zone">
              <p className="eyebrow">Account lifecycle</p>
              <h3>Delete account</h3>
              <p className="muted-copy">
                Your account, sessions, devices, linked sign-ins, and authentication tokens will be
                removed.
              </p>
              {!showDelete ? (
                <button type="button" className="danger-button" onClick={() => setShowDelete(true)}>
                  Delete account…
                </button>
              ) : (
                <form className="inline-form" onSubmit={deleteAccount}>
                  <label>
                    Type your email to confirm
                    <input
                      type="email"
                      required
                      value={email || user.email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <label>
                    Password, if this account has one
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </label>
                  <div className="button-row">
                    <button className="danger-button" type="submit" disabled={busy}>
                      Delete account
                    </button>
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={() => setShowDelete(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </section>
            {message ? (
              <p className="notice" role="status">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </section>
      <footer className="auth-footer">Enough · Build with evidence.</footer>
    </main>
  );
}
