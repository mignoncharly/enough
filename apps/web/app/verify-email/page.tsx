"use client";

import { useEffect, useState } from "react";

export default function VerifyEmailPage() {
  const [message, setMessage] = useState("Checking your verification link…");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
        window.history.replaceState(null, "", window.location.pathname);
        if (!token) throw new Error("This verification link is missing or expired.");
        const response = await fetch("/api/auth/email-verification/consume", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const result = (await response.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error ?? "This verification link could not be used.");
        if (active) setMessage(result.message ?? "Email verified. You can now sign in.");
      } catch (cause) {
        if (active) {
          setError(true);
          setMessage(
            cause instanceof Error ? cause.message : "This verification link could not be used.",
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
        <h1>{error ? "Verification link unavailable" : "Email verification"}</h1>
        <p className={error ? "error" : "notice"} role={error ? "alert" : "status"}>
          {message}
        </p>
        <a className="primary-button link-button" href="/login">
          Continue to sign in
        </a>
      </section>
    </main>
  );
}
