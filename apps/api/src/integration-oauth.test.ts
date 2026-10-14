import { parseEnvironment } from "@enough/config";
import { describe, expect, it, vi } from "vitest";
import {
  buildProviderAuthorizationUrl,
  exchangeProviderAuthorizationCode,
  type IntegrationOAuthRuntime,
  integrationOAuthRuntimeFromEnvironment,
  OAuthProtocolError,
  oauthClientConfig,
  readProviderAccountId,
  refreshProviderAccessToken,
  requiredOAuthScopes,
  revokeProviderGrant,
} from "./integration-oauth.js";

const runtime: IntegrationOAuthRuntime = {
  google: { clientId: "google-test-client", clientSecret: "google-test-secret" },
  microsoft: { clientId: "microsoft-test-client", clientSecret: "microsoft-test-secret" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("provider OAuth protocol", () => {
  it("marks Gmail, Calendar, and GA4 catalog providers available only with a Google client pair", () => {
    const providers = ["GMAIL", "GOOGLE_CALENDAR", "GA4"] as const;
    const absent = integrationOAuthRuntimeFromEnvironment(
      parseEnvironment({ GOOGLE_INTEGRATION_CLIENT_ID: "", GOOGLE_INTEGRATION_CLIENT_SECRET: "" }),
    );
    const configured = integrationOAuthRuntimeFromEnvironment(
      parseEnvironment({
        GOOGLE_INTEGRATION_CLIENT_ID: "synthetic-google-client-id",
        GOOGLE_INTEGRATION_CLIENT_SECRET: "synthetic-google-client-secret",
      }),
    );

    for (const provider of providers) {
      expect(oauthClientConfig(provider, absent)).toBeNull();
      expect(oauthClientConfig(provider, configured)).toMatchObject({
        clientId: "synthetic-google-client-id",
        clientSecret: "synthetic-google-client-secret",
      });
    }
    expect(configured.microsoft).toBeUndefined();
  });

  it("requests only the provider-specific minimum read scopes with state and PKCE", () => {
    const cases = [
      ["GMAIL", ["openid", "https://www.googleapis.com/auth/gmail.metadata"]],
      ["GOOGLE_CALENDAR", ["openid", "https://www.googleapis.com/auth/calendar.events.readonly"]],
      ["OUTLOOK", ["openid", "offline_access", "User.Read", "Mail.ReadBasic"]],
      ["MICROSOFT_CALENDAR", ["openid", "offline_access", "User.Read", "Calendars.ReadBasic"]],
      ["GA4", ["openid", "https://www.googleapis.com/auth/analytics.readonly"]],
    ] as const;
    for (const [provider, scopes] of cases) {
      expect(requiredOAuthScopes(provider)).toEqual(scopes);
      const url = buildProviderAuthorizationUrl({
        provider,
        runtime,
        state: "one-time-state",
        redirectUri: "https://api.example.test/integrations/oauth/google/callback",
        codeChallenge: "pkce-challenge",
      });
      expect(url.searchParams.get("state")).toBe("one-time-state");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toBe("pkce-challenge");
      expect(url.searchParams.get("scope")?.split(" ")).toEqual(scopes);
      expect(url.searchParams.get("response_type")).toBe("code");
      if (["GMAIL", "GOOGLE_CALENDAR", "GA4"].includes(provider)) {
        expect(url.searchParams.get("access_type")).toBe("offline");
        expect(url.searchParams.get("prompt")).toBe("consent");
      }
    }
  });

  it("requires PKCE and a configured OAuth client", () => {
    expect(() =>
      buildProviderAuthorizationUrl({
        provider: "GMAIL",
        runtime,
        state: "s",
        redirectUri: "https://api.example.test/callback",
      }),
    ).toThrowError(new OAuthProtocolError("PKCE_REQUIRED"));
    expect(() =>
      buildProviderAuthorizationUrl({
        provider: "GMAIL",
        runtime: {},
        state: "s",
        redirectUri: "https://api.example.test/callback",
        codeChallenge: "challenge",
      }),
    ).toThrowError(new OAuthProtocolError("PROVIDER_NOT_CONFIGURED"));
  });

  it("exchanges the authorization code with the stored verifier and enforces granted scopes", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe("error");
      const params = new URLSearchParams(String(init?.body));
      expect(params.get("grant_type")).toBe("authorization_code");
      expect(params.get("code_verifier")).toBe("secret-verifier");
      expect(params.get("redirect_uri")).toBe("https://api.example.test/callback");
      return jsonResponse({
        access_token: "opaque-access-token",
        refresh_token: "opaque-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: requiredOAuthScopes("GMAIL").join(" "),
      });
    });
    const tokens = await exchangeProviderAuthorizationCode({
      provider: "GMAIL",
      runtime,
      code: "one-time-code",
      redirectUri: "https://api.example.test/callback",
      codeVerifier: "secret-verifier",
      scopes: requiredOAuthScopes("GMAIL"),
      fetcher,
    });
    expect(tokens).toMatchObject({
      accessToken: "opaque-access-token",
      refreshToken: "opaque-refresh-token",
      tokenType: "Bearer",
      scopes: requiredOAuthScopes("GMAIL"),
    });
    expect(tokens.expiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(fetcher).toHaveBeenCalledOnce();

    await expect(
      exchangeProviderAuthorizationCode({
        provider: "GMAIL",
        runtime,
        code: "one-time-code",
        redirectUri: "https://api.example.test/callback",
        codeVerifier: "secret-verifier",
        scopes: requiredOAuthScopes("GMAIL"),
        fetcher: async () =>
          jsonResponse({ access_token: "opaque-access-token", expires_in: 3600, scope: "openid" }),
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });
    await expect(
      exchangeProviderAuthorizationCode({
        provider: "GMAIL",
        runtime,
        code: "one-time-code",
        redirectUri: "https://api.example.test/callback",
        codeVerifier: "secret-verifier",
        scopes: requiredOAuthScopes("GMAIL"),
        fetcher: async () =>
          jsonResponse({
            access_token: "opaque-access-token",
            scope: requiredOAuthScopes("GMAIL").join(" "),
          }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN_RESPONSE" });
  });

  it("refreshes tokens, keeps provider rotation, and identifies the provider account without email", async () => {
    const requestedScopes = requiredOAuthScopes("OUTLOOK");
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("/token")) {
        const params = new URLSearchParams(String(init?.body));
        expect(params.get("grant_type")).toBe("refresh_token");
        expect(params.get("refresh_token")).toBe("old-refresh-token");
        expect(params.get("scope")).toBe(requestedScopes.join(" "));
        return jsonResponse({
          access_token: "rotated-access-token",
          refresh_token: "rotated-refresh-token",
          token_type: "Bearer",
          expires_in: 1800,
          scope: "User.Read Mail.ReadBasic",
        });
      }
      expect(String(url)).toContain("/me?$select=id");
      expect(init?.redirect).toBe("error");
      return jsonResponse({ id: "opaque-microsoft-object-id" });
    });
    const refreshed = await refreshProviderAccessToken({
      provider: "OUTLOOK",
      runtime,
      refreshToken: "old-refresh-token",
      scopes: requestedScopes,
      fetcher,
    });
    expect(refreshed.refreshToken).toBe("rotated-refresh-token");
    expect(refreshed.scopes).toEqual(requestedScopes);
    const accountId = await readProviderAccountId({
      provider: "OUTLOOK",
      accessToken: refreshed.accessToken,
      fetcher,
    });
    expect(accountId).toBe("opaque-microsoft-object-id");

    await expect(
      refreshProviderAccessToken({
        provider: "OUTLOOK",
        runtime,
        refreshToken: "old-refresh-token",
        scopes: requestedScopes,
        fetcher: async () =>
          jsonResponse({
            access_token: "missing-mail-scope",
            refresh_token: "rotated-refresh-token",
            expires_in: 1800,
            scope: "User.Read",
          }),
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });

    const noRotation = await refreshProviderAccessToken({
      provider: "OUTLOOK",
      runtime,
      refreshToken: "old-refresh-token",
      scopes: requestedScopes,
      fetcher: async () =>
        jsonResponse({
          access_token: "access-token-without-rotation",
          expires_in: 1800,
          scope: "User.Read Mail.ReadBasic",
        }),
    });
    expect(noRotation.refreshToken).toBeNull();
  });

  it("revokes Google grants and reports Microsoft's provider-side revocation gate", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://oauth2.googleapis.com/revoke");
      expect(new URLSearchParams(String(init?.body)).get("token")).toBe("refresh-token");
      return new Response(null, { status: 200 });
    });
    expect(
      await revokeProviderGrant({ provider: "GMAIL", token: "refresh-token", fetcher }),
    ).toEqual({ result: "REVOKED", httpStatus: 200 });
    expect(
      await revokeProviderGrant({ provider: "OUTLOOK", token: "refresh-token", fetcher }),
    ).toEqual({ result: "MANUAL_PROVIDER_REVOCATION_REQUIRED", httpStatus: null });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("reports only safe status metadata when Google revocation fails", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe("error");
      return new Response("sensitive provider response body", { status: 503 });
    });
    const result = await revokeProviderGrant({
      provider: "GOOGLE_CALENDAR",
      token: "private-token",
      fetcher,
    });
    expect(result).toEqual({ result: "FAILED", httpStatus: 503 });
    expect(JSON.stringify(result)).not.toContain("sensitive provider response body");
  });
});
