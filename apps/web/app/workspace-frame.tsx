"use client";

import type { ReactNode } from "react";
import { WorkspaceHeader } from "./workspace-header";

export function WorkspaceFrame({
  active,
  eyebrow,
  title,
  description,
  children,
}: {
  active: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <WorkspaceHeader active={active} />
      <section className="dashboard-content">
        <div className="dashboard-intro">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </section>
      <footer className="auth-footer">Enough · Build with evidence.</footer>
    </main>
  );
}

export function displayWorkspaceDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function WorkspaceError({ message }: { message: string }) {
  return (
    <section className="account-card" role="alert">
      <h2>Workspace unavailable</h2>
      <p className="error">{message}</p>
      <a className="secondary-button link-button" href="/login">
        Sign in again
      </a>
    </section>
  );
}
