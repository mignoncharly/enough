import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@enough/cache", "@enough/config", "@enough/db", "@enough/shared"],
  async rewrites() {
    const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
    return [
      { source: "/api/auth/:path*", destination: `${apiBaseUrl}/auth/:path*` },
      { source: "/api/onboarding/:path*", destination: `${apiBaseUrl}/onboarding/:path*` },
      { source: "/api/products/:path*", destination: `${apiBaseUrl}/products/:path*` },
      { source: "/api/activity/:path*", destination: `${apiBaseUrl}/activity/:path*` },
      { source: "/api/classification/:path*", destination: `${apiBaseUrl}/classification/:path*` },
      { source: "/api/rules/:path*", destination: `${apiBaseUrl}/rules/:path*` },
      { source: "/api/credits/:path*", destination: `${apiBaseUrl}/credits/:path*` },
      { source: "/api/tasks/:path*", destination: `${apiBaseUrl}/growth-tasks/:path*` },
      { source: "/api/evidence/:path*", destination: `${apiBaseUrl}/task-evidence/:path*` },
      { source: "/api/integrations/:path*", destination: `${apiBaseUrl}/integrations/:path*` },
      { source: "/api/ai/:path*", destination: `${apiBaseUrl}/ai/:path*` },
      { source: "/api/reports", destination: `${apiBaseUrl}/report-data` },
      { source: "/api/notifications", destination: `${apiBaseUrl}/notification-data` },
      {
        source: "/api/notifications/:path*",
        destination: `${apiBaseUrl}/notification-data/:path*`,
      },
      {
        source: "/api/notification-preferences",
        destination: `${apiBaseUrl}/notification-preferences`,
      },
      { source: "/api/billing/checkout", destination: `${apiBaseUrl}/billing-checkout` },
      { source: "/api/billing/portal", destination: `${apiBaseUrl}/billing-portal` },
      { source: "/api/billing", destination: `${apiBaseUrl}/billing-data` },
      { source: "/api/privacy", destination: `${apiBaseUrl}/privacy-data` },
      { source: "/api/privacy/consents", destination: `${apiBaseUrl}/privacy-consents` },
      { source: "/api/privacy/settings", destination: `${apiBaseUrl}/privacy-settings` },
      { source: "/api/privacy/activity", destination: `${apiBaseUrl}/privacy-activity` },
      {
        source: "/api/privacy/consents/:purpose",
        destination: `${apiBaseUrl}/privacy-consents/:purpose`,
      },
      { source: "/api/admin/:path*", destination: `${apiBaseUrl}/admin/:path*` },
    ];
  },
};

export default nextConfig;
