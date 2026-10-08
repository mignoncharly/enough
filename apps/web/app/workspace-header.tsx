"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

const workspaceLinks = [
  ["Home", "/", "home"],
  ["Products", "/products", "products"],
  ["Today", "/today", "today"],
  ["Activity", "/activity", "activity"],
  ["Growth", "/growth", "growth"],
  ["Tasks", "/tasks", "tasks"],
  ["Evidence", "/evidence", "evidence"],
  ["Tools", "/tools", "tools"],
  ["Rules", "/rules", "rules"],
  ["Credits", "/credits", "credits"],
  ["Integrations", "/integrations", "integrations"],
  ["AI Coach", "/coach", "coach"],
  ["Reports", "/reports", "reports"],
  ["Notifications", "/notifications", "notifications"],
  ["Devices", "/devices", "devices"],
  ["Billing", "/billing", "billing"],
  ["Privacy", "/privacy", "privacy"],
  ["Admin Console", "/admin", "admin"],
  ["Settings", "/settings", "settings"],
] as const;

export function ThemePreference() {
  const [theme, setTheme] = useState<Theme>("system");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("enough-theme");
      if (saved === "system" || saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      // Keep the system appearance if browser storage is unavailable.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("enough-theme", theme);
    } catch {
      // The selected appearance still applies until this page is closed.
    }
  }, [loaded, theme]);

  return (
    <label className="theme-preference">
      Appearance
      <select
        aria-label="Color theme"
        value={theme}
        onChange={(event) => setTheme(event.target.value as Theme)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

export function WorkspaceHeader({
  active,
  onSignOut,
  signOutDisabled = false,
}: {
  active?: string;
  onSignOut?: () => void;
  signOutDisabled?: boolean;
}) {
  const [adminEnabled, setAdminEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/me", { credentials: "include", cache: "no-store" })
      .then((response) => {
        if (active && response.ok) setAdminEnabled(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <header className="brand-row workspace-brand-row">
      <a className="brand-mark" href="/" aria-label="Enough home">
        E
      </a>
      <span>Enough</span>
      <details className="workspace-menu">
        <summary>Workspace menu</summary>
        <nav aria-label="Workspace sections">
          <ul>
            {workspaceLinks
              .filter(([, , key]) => key !== "admin" || adminEnabled)
              .map(([label, href, key]) => (
                <li key={key}>
                  <a href={href} aria-current={active === key ? "page" : undefined}>
                    {label}
                  </a>
                </li>
              ))}
          </ul>
          <ThemePreference />
        </nav>
      </details>
      {onSignOut ? (
        <button
          className="quiet-button"
          type="button"
          onClick={onSignOut}
          disabled={signOutDisabled}
        >
          Sign out
        </button>
      ) : null}
    </header>
  );
}
