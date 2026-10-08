"use client";

import { useEffect } from "react";

export default function ProductsPage() {
  useEffect(() => {
    const query = window.location.search;
    window.location.replace(`/dashboard${query}`);
  }, []);
  return (
    <main className="message-shell">
      <section className="auth-card">
        <p className="notice" role="status">
          Opening your product workspace…
        </p>
      </section>
    </main>
  );
}
