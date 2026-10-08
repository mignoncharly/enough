import { WorkspaceFrame } from "../workspace-frame";
import { ThemePreference } from "../workspace-header";
import { NotificationPreferencesForm } from "./notification-preferences";

export default function SettingsPage() {
  return (
    <WorkspaceFrame
      active="settings"
      eyebrow="Settings"
      title="Your workspace preferences"
      description="Choose how Enough appears and find your account and access controls."
    >
      <section className="account-card">
        <p className="eyebrow">Appearance</p>
        <h2>Color theme</h2>
        <p className="muted-copy">
          This preference is stored in this browser. System follows your device appearance setting.
        </p>
        <ThemePreference />
      </section>
      <section className="account-card">
        <p className="eyebrow">Notifications</p>
        <h2>Choose when Enough reaches out</h2>
        <NotificationPreferencesForm />
      </section>
      <div className="dashboard-columns">
        <section className="account-card">
          <p className="eyebrow">Account</p>
          <h2>Profile and security</h2>
          <p className="muted-copy">
            Change your password, register a client, export your account, or delete your account
            from the account page.
          </p>
          <a className="secondary-button link-button" href="/">
            Open account settings
          </a>
        </section>
        <section className="account-card">
          <p className="eyebrow">Access</p>
          <h2>Sessions and devices</h2>
          <p className="muted-copy">
            Review connected clients and revoke sessions you no longer use.
          </p>
          <a className="secondary-button link-button" href="/devices">
            Manage devices
          </a>
        </section>
      </div>
      <section className="account-card">
        <p className="eyebrow">Privacy</p>
        <h2>Inspect your data and controls</h2>
        <p className="muted-copy">
          Review collected activity, export account data, manage optional consent, choose retention
          periods, disconnect sign-in methods, and delete records.
        </p>
        <a className="secondary-button link-button" href="/privacy">
          Open privacy settings
        </a>
      </section>
    </WorkspaceFrame>
  );
}
