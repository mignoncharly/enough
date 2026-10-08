"use client";

import { useEffect, useState } from "react";

export default function OAuthCompletePage() {
  const [message, setMessage] = useState("Completing sign-in…");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
        window.history.replaceState(null, "", window.location.pathname);
        if (!token) throw new Error("This sign-in link is missing or expired.");
        const preCsrfCookie = document.cookie
          .split(";")
          .map((value) => value.trim())
          .find(
            (value) =>
              value.startsWith("enough_pre_csrf=") || value.startsWith("__Host-enough_pre_csrf="),
          );
        const csrfToken = preCsrfCookie
          ? decodeURIComponent(preCsrfCookie.slice(preCsrfCookie.indexOf("=") + 1))
          : "";
        if (!csrfToken) throw new Error("Could not verify the sign-in request. Start again.");
        const response = await fetch("/api/auth/oauth/consume", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
          body: JSON.stringify({ token }),
        });
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(result.error ?? "Provider sign-in could not be completed.");
        }
        window.location.replace("/");
      } catch (cause) {
        if (active) {
          setError(true);
          setMessage(
            cause instanceof Error ? cause.message : "Provider sign-in could not be completed.",
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="message-shell">
      <section className="auth-card">
        <p className="eyebrow">Enough</p>
        <h1>{error ? "Sign-in did not finish" : "Signing you in"}</h1>
        <p className={error ? "error" : "notice"} role={error ? "alert" : "status"}>
          {message}
        </p>
        {error ? (
          <a className="primary-button link-button" href="/login">
            Return to sign in
          </a>
        ) : null}
      </section>
    </main>
  );
}
