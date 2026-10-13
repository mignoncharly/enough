import { env } from "@enough/config";

export type OAuthIntegrationProvider =
  | "GMAIL"
  | "GOOGLE_CALENDAR"
  | "OUTLOOK"
  | "MICROSOFT_CALENDAR"
  | "GA4";

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface IntegrationOAuthRuntime {
  google?: OAuthClientConfig;
  microsoft?: OAuthClientConfig;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresAt: Date;
  scopes: string[];
  providerAccountId: string | null;
}

export class OAuthProtocolError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("The provider authorization request failed.");
    this.name = "OAuthProtocolError";
    this.code = code;
  }
}

const GOOGLE_SCOPES: Record<
  Exclude<OAuthIntegrationProvider, "OUTLOOK" | "MICROSOFT_CALENDAR">,
  string[]
> = {
  GMAIL: ["openid", "https://www.googleapis.com/auth/gmail.metadata"],
  GOOGLE_CALENDAR: ["openid", "https://www.googleapis.com/auth/calendar.events.readonly"],
  GA4: ["openid", "https://www.googleapis.com/auth/analytics.readonly"],
};

const MICROSOFT_SCOPES: Record<"OUTLOOK" | "MICROSOFT_CALENDAR", string[]> = {
  OUTLOOK: ["openid", "offline_access", "User.Read", "Mail.ReadBasic"],
  MICROSOFT_CALENDAR: ["openid", "offline_access", "User.Read", "Calendars.ReadBasic"],
};

export function oauthFamily(provider: OAuthIntegrationProvider): "google" | "microsoft" {
  if (["GMAIL", "GOOGLE_CALENDAR", "GA4"].includes(provider)) return "google";
  return "microsoft";
}

export function requiredOAuthScopes(provider: OAuthIntegrationProvider): string[] {
  if (provider === "OUTLOOK" || provider === "MICROSOFT_CALENDAR")
    return [...MICROSOFT_SCOPES[provider]];
  return [...GOOGLE_SCOPES[provider]];
}

export function integrationOAuthRuntimeFromEnvironment(): IntegrationOAuthRuntime {
  return {
    google:
      env.GOOGLE_INTEGRATION_CLIENT_ID && env.GOOGLE_INTEGRATION_CLIENT_SECRET
        ? {
            clientId: env.GOOGLE_INTEGRATION_CLIENT_ID,
            clientSecret: env.GOOGLE_INTEGRATION_CLIENT_SECRET,
          }
        : undefined,
    microsoft:
      env.MICROSOFT_INTEGRATION_CLIENT_ID && env.MICROSOFT_INTEGRATION_CLIENT_SECRET
        ? {
            clientId: env.MICROSOFT_INTEGRATION_CLIENT_ID,
            clientSecret: env.MICROSOFT_INTEGRATION_CLIENT_SECRET,
          }
        : undefined,
  };
}

export function oauthClientConfig(
  provider: OAuthIntegrationProvider,
  runtime: IntegrationOAuthRuntime,
): OAuthClientConfig | null {
  const family = oauthFamily(provider);
  return runtime[family] ?? null;
}

export function buildProviderAuthorizationUrl(input: {
  provider: OAuthIntegrationProvider;
  runtime: IntegrationOAuthRuntime;
  state: string;
  redirectUri: string;
  codeChallenge?: string;
}): URL {
  const config = oauthClientConfig(input.provider, input.runtime);
  if (!config) throw new OAuthProtocolError("PROVIDER_NOT_CONFIGURED");
  const family = oauthFamily(input.provider);
  const endpoint =
    family === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
  const url = new URL(endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", requiredOAuthScopes(input.provider).join(" "));
  if (family === "google") {
    if (!input.codeChallenge) throw new OAuthProtocolError("PKCE_REQUIRED");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  } else {
    if (!input.codeChallenge) throw new OAuthProtocolError("PKCE_REQUIRED");
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url;
}

function parseTokenResponse(
  provider: OAuthIntegrationProvider,
  value: unknown,
  fallbackScopes: string[],
): OAuthTokenSet {
  if (!value || typeof value !== "object") throw new OAuthProtocolError("INVALID_TOKEN_RESPONSE");
  const response = value as Record<string, unknown>;
  if (typeof response.access_token !== "string" || response.access_token.length < 8)
    throw new OAuthProtocolError("INVALID_TOKEN_RESPONSE");
  const encodedScope = typeof response.scope === "string" ? response.scope.trim() : "";
  let rawScope = encodedScope;
  if (encodedScope && oauthFamily(provider) === "microsoft") {
    try {
      rawScope = decodeURIComponent(encodedScope);
    } catch {
      throw new OAuthProtocolError("INVALID_TOKEN_RESPONSE");
    }
  }
  const scopes = rawScope ? rawScope.split(/\s+/).filter(Boolean) : fallbackScopes;
  const expiresIn = Number(response.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0)
    throw new OAuthProtocolError("INVALID_TOKEN_RESPONSE");
  const expiresAt = new Date(Date.now() + Math.min(expiresIn, 60 * 60 * 24 * 365) * 1000);
  return {
    accessToken: response.access_token,
    refreshToken: typeof response.refresh_token === "string" ? response.refresh_token : null,
    tokenType: typeof response.token_type === "string" ? response.token_type : "Bearer",
    expiresAt,
    scopes,
    providerAccountId: null,
  };
}

function retainGrantedScopes(tokenSet: OAuthTokenSet, requestedScopes: string[]): OAuthTokenSet {
  // OIDC scopes identify the user or request refresh capability; they are not API scopes.
  // Microsoft omits offline_access from its access-token scope list, so retain the full grant.
  const requiredAccessScopes = requestedScopes.filter(
    (scope) => scope !== "offline_access" && scope !== "openid",
  );
  const normalizeScope = (scope: string) =>
    scope.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLocaleLowerCase("en-US");
  if (
    requiredAccessScopes.some(
      (scope) =>
        !tokenSet.scopes.some((granted) => normalizeScope(granted) === normalizeScope(scope)),
    )
  )
    throw new OAuthProtocolError("INSUFFICIENT_SCOPE");
  return { ...tokenSet, scopes: requestedScopes };
}

async function postForm(
  fetcher: typeof fetch,
  endpoint: string,
  form: URLSearchParams,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OAuthProtocolError("PROVIDER_UNAVAILABLE");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OAuthProtocolError("INVALID_PROVIDER_RESPONSE");
  }
  if (!response.ok || !body || typeof body !== "object")
    throw new OAuthProtocolError("PROVIDER_REJECTED_AUTHORIZATION");
  return body as Record<string, unknown>;
}

export async function exchangeProviderAuthorizationCode(input: {
  provider: OAuthIntegrationProvider;
  runtime: IntegrationOAuthRuntime;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  scopes: string[];
  fetcher?: typeof fetch;
}): Promise<OAuthTokenSet> {
  const config = oauthClientConfig(input.provider, input.runtime);
  if (!config) throw new OAuthProtocolError("PROVIDER_NOT_CONFIGURED");
  const family = oauthFamily(input.provider);
  const endpoint =
    family === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });
  if (!input.codeVerifier) throw new OAuthProtocolError("PKCE_REQUIRED");
  form.set("code_verifier", input.codeVerifier);
  const response = await postForm(input.fetcher ?? fetch, endpoint, form);
  const parsed = parseTokenResponse(input.provider, response, input.scopes);
  return retainGrantedScopes(parsed, input.scopes);
}

export async function refreshProviderAccessToken(input: {
  provider: OAuthIntegrationProvider;
  runtime: IntegrationOAuthRuntime;
  refreshToken: string;
  scopes: string[];
  fetcher?: typeof fetch;
}): Promise<OAuthTokenSet> {
  const config = oauthClientConfig(input.provider, input.runtime);
  if (!config) throw new OAuthProtocolError("PROVIDER_NOT_CONFIGURED");
  const family = oauthFamily(input.provider);
  const endpoint =
    family === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const response = await postForm(
    input.fetcher ?? fetch,
    endpoint,
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      ...(family === "microsoft" ? { scope: input.scopes.join(" ") } : {}),
    }),
  );
  const parsed = parseTokenResponse(input.provider, response, input.scopes);
  return retainGrantedScopes(parsed, input.scopes);
}

export async function readProviderAccountId(input: {
  provider: OAuthIntegrationProvider;
  accessToken: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  const endpoint =
    oauthFamily(input.provider) === "google"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=id";
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      headers: { authorization: `Bearer ${input.accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OAuthProtocolError("PROVIDER_UNAVAILABLE");
  }
  if (!response.ok) throw new OAuthProtocolError("PROVIDER_IDENTITY_UNAVAILABLE");
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const id = body?.sub ?? body?.id;
  if (typeof id !== "string" || id.length < 1 || id.length > 512)
    throw new OAuthProtocolError("INVALID_PROVIDER_ACCOUNT");
  return id;
}

export async function revokeProviderGrant(input: {
  provider: OAuthIntegrationProvider;
  token: string;
  fetcher?: typeof fetch;
}): Promise<"REVOKED" | "MANUAL_PROVIDER_REVOCATION_REQUIRED"> {
  const family = oauthFamily(input.provider);
  if (family === "microsoft") return "MANUAL_PROVIDER_REVOCATION_REQUIRED";
  const endpoint = "https://oauth2.googleapis.com/revoke";
  const form = new URLSearchParams({ token: input.token });
  const response = await (input.fetcher ?? fetch)(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) throw new OAuthProtocolError("PROVIDER_REVOCATION_FAILED");
  return "REVOKED";
}
