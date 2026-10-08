"use client";

import { useEffect, useState } from "react";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    setToken(value);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/password-reset/consume", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "This reset link could not be used.");
      setMessage(result.message ?? "Password updated.");
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="message-shell">
      <section className="auth-card">
        <p className="eyebrow">Enough</p>
        <h1>Choose a new password</h1>
        {token ? (
          <form className="auth-form" onSubmit={submit}>
            <label>
              New password
              <input
                type="password"
                required
                minLength={12}
                maxLength={1024}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <small>Use at least 12 characters.</small>
            </label>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        ) : (
          <p className="error" role="alert">
            This reset link is missing or expired. Request another from the sign-in page.
          </p>
        )}
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
        <a className="quiet-link" href="/login">
          Back to sign in
        </a>
      </section>
    </main>
  );
}
