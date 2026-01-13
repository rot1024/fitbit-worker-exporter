import type { FitbitOAuthConfig, TokenResponse, StoredTokens } from "./types.js";

const FITBIT_AUTH_URL = "https://www.fitbit.com/oauth2/authorize";
const FITBIT_TOKEN_URL = "https://api.fitbit.com/oauth2/token";

const DEFAULT_SCOPES = [
  "activity",
  "sleep",
  "profile",
  "weight",
];

export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createAuthUrl(
  config: FitbitOAuthConfig,
  state: string,
  scopes: string[] = DEFAULT_SCOPES
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: scopes.join(" "),
    state,
  });
  return `${FITBIT_AUTH_URL}?${params.toString()}`;
}

function encodeCredentials(clientId: string, clientSecret: string): string {
  return btoa(`${clientId}:${clientSecret}`);
}

export async function exchangeCode(
  config: FitbitOAuthConfig,
  code: string
): Promise<StoredTokens> {
  const response = await fetch(FITBIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodeCredentials(config.clientId, config.clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = (await response.json()) as TokenResponse;
  return tokenResponseToStored(data);
}

export async function refreshToken(
  config: FitbitOAuthConfig,
  refreshTokenValue: string
): Promise<StoredTokens> {
  const response = await fetch(FITBIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodeCredentials(config.clientId, config.clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshTokenValue,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = (await response.json()) as TokenResponse;
  return tokenResponseToStored(data);
}

function tokenResponseToStored(response: TokenResponse): StoredTokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
    userId: response.user_id,
  };
}

export function isTokenExpired(tokens: StoredTokens): boolean {
  // Consider expired 5 minutes before actual expiry
  return Date.now() > tokens.expiresAt - 5 * 60 * 1000;
}
