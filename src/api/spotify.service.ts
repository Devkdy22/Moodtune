// src/api/spotify.service.ts
// ─────────────────────────────────────────────────────────
//  Spotify API 서비스 (현재: 스켈레톤)
//  OAuth PKCE flow + Web API 호출
// ─────────────────────────────────────────────────────────
import * as AuthSession from "expo-auth-session";
import {
  SpotifyArtistSummary,
  SpotifyBootstrapData,
  SpotifyPlaylistSummary,
  SpotifyTokens,
  SpotifyTrackSummary,
  SpotifyUser,
} from "../types";

const CLIENT_ID = (process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? "").trim();
const SPOTIFY_ENABLE_METADATA_ENRICH = String(
  process.env.EXPO_PUBLIC_SPOTIFY_ENABLE_METADATA_ENRICH ?? "false",
)
  .trim()
  .toLowerCase() === "true";
type SpotifyApiHealthSnapshot = {
  metadataEnrichEnabled: boolean;
  audioFeatures403Count: number;
  artist403Count: number;
  savedTrack403Count: number;
  lastFailureAt: number | null;
};
export type SpotifySearchBackoffSnapshot = {
  limited: boolean;
  cooldownMs: number;
  strike: number;
};
const spotifyApiHealth = {
  audioFeatures403Count: 0,
  artist403Count: 0,
  savedTrack403Count: 0,
  lastFailureAt: 0,
};

export function getSpotifyApiHealthSnapshot(): SpotifyApiHealthSnapshot {
  return {
    metadataEnrichEnabled: SPOTIFY_ENABLE_METADATA_ENRICH,
    audioFeatures403Count: spotifyApiHealth.audioFeatures403Count,
    artist403Count: spotifyApiHealth.artist403Count,
    savedTrack403Count: spotifyApiHealth.savedTrack403Count,
    lastFailureAt: spotifyApiHealth.lastFailureAt || null,
  };
}

export function getSpotifySearchBackoffSnapshot(): SpotifySearchBackoffSnapshot {
  const now = Date.now();
  const cooldownMs = Math.max(0, Math.max(spotifyGlobalCooldownUntil, spotifySearchRateLimitedUntil) - now);
  const recentLimited = now - spotifySearchRateLimitLastAt <= 90_000;
  return {
    limited: cooldownMs > 0 || (spotifySearchRateLimitStrike >= 2 && recentLimited),
    cooldownMs,
    strike: spotifySearchRateLimitStrike,
  };
}

function recordSpotify403Failure(kind: "audio" | "artist" | "saved"): void {
  if (kind === "audio") spotifyApiHealth.audioFeatures403Count += 1;
  if (kind === "artist") spotifyApiHealth.artist403Count += 1;
  if (kind === "saved") spotifyApiHealth.savedTrack403Count += 1;
  spotifyApiHealth.lastFailureAt = Date.now();
}
export const REDIRECT_URI = AuthSession.makeRedirectUri({
  scheme: "moodtune",
  path: "auth/spotify-login",
});

export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-read-private",
  "user-read-email",
  "user-library-read",
  "user-library-modify",
  "user-read-playback-state",
  "user-read-recently-played",
  "user-top-read",
];

export const SPOTIFY_DISCOVERY = {
  authorizationEndpoint: "https://accounts.spotify.com/authorize",
  tokenEndpoint: "https://accounts.spotify.com/api/token",
};
export const MOODTUNE_PLAYLIST_MARKER = "[moodtune_app]";

function redactSensitiveText(input: string): string {
  return String(input ?? "")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/(access_token|refresh_token|id_token)\s*[:=]\s*["'][^"']+["']/gi, "$1=[REDACTED]")
    .replace(/(code_verifier|code|client_secret)\s*[:=]\s*["'][^"']+["']/gi, "$1=[REDACTED]");
}

function summarizeSpotifyPayload(payload: any): string {
  if (!payload) return "empty_payload";
  const code = String(payload?.error?.status ?? payload?.status ?? "").trim();
  const msg = String(payload?.error?.message ?? payload?.message ?? "").trim();
  if (!code && !msg) return "upstream_error";
  const parts = [
    code ? `code=${code}` : "",
    msg ? `message=${redactSensitiveText(msg).slice(0, 180)}` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return redactSensitiveText(err.message || "error");
  }
  if (typeof err === "string") {
    return redactSensitiveText(err);
  }
  return "unknown_error";
}

const SPOTIFY_AUTH_COOLDOWN_MS = 90_000;
let spotifyAuthFailureCache: { tokenKey: string; until: number } | null = null;
let spotifyAuthFailureWarnAt = 0;

function spotifyTokenKey(accessToken: string): string {
  return String(accessToken ?? "").trim().slice(0, 18);
}

function isSpotifyAuthErrorMessage(input: unknown): boolean {
  const msg = String(
    input instanceof Error ? input.message : input ?? "",
  ).toLowerCase();
  return (
    msg.includes("(401)") ||
    msg.includes("invalid_token") ||
    msg.includes("access token expired") ||
    msg.includes("authentication unavailable") ||
    msg.includes("인증 만료")
  );
}

function shouldSkipSpotifyByAuthFailure(accessToken: string): boolean {
  if (!spotifyAuthFailureCache) return false;
  if (Date.now() >= spotifyAuthFailureCache.until) return false;
  const key = spotifyTokenKey(accessToken);
  if (!key) return false;
  return spotifyAuthFailureCache.tokenKey === key;
}

function markSpotifyAuthFailure(accessToken: string, reason?: string): void {
  spotifyAuthFailureCache = {
    tokenKey: spotifyTokenKey(accessToken),
    until: Date.now() + SPOTIFY_AUTH_COOLDOWN_MS,
  };
  if (Date.now() - spotifyAuthFailureWarnAt < 5000) return;
  spotifyAuthFailureWarnAt = Date.now();
  const suffix = reason ? ` (${reason})` : "";
  console.warn(`[Spotify] authentication expired. suppressing requests for 90s${suffix}`);
}

function isMoodtunePlaylistLike(args: {
  name?: string;
  description?: string;
}): boolean {
  const d = String(args.description ?? "").toLowerCase();
  const n = String(args.name ?? "").toLowerCase();
  return (
    d.includes(MOODTUNE_PLAYLIST_MARKER) ||
    d.includes("created by moodtune") ||
    d.includes("moodtune") ||
    n.includes("moodtune")
  );
}

// ── OAuth 로그인 ──────────────────────────────────────────
export async function loginWithSpotify(): Promise<SpotifyTokens | null> {
  throw new Error(
    "[Spotify] loginWithSpotify is UI-driven. Use AuthSession.useAuthRequest in a screen, then call exchangeSpotifyCodeForTokens().",
  );
}

export async function exchangeSpotifyCodeForTokens(args: {
  code: string;
  codeVerifier: string;
  redirectUri?: string;
}): Promise<SpotifyTokens> {
  if (!CLIENT_ID) {
    throw new Error(
      "Missing EXPO_PUBLIC_SPOTIFY_CLIENT_ID. Set it in your env and restart Expo.",
    );
  }
  const redirectUri = args.redirectUri ?? REDIRECT_URI;

  const body = new URLSearchParams();
  body.set("client_id", CLIENT_ID);
  body.set("grant_type", "authorization_code");
  body.set("code", args.code);
  body.set("redirect_uri", redirectUri);
  body.set("code_verifier", args.codeVerifier);
  const res = await fetch(SPOTIFY_DISCOVERY.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Spotify token exchange failed (${res.status}): ${summarizeSpotifyPayload(json)}`,
    );
  }
  const accessToken = String(json?.access_token ?? "");
  const refreshToken = String(json?.refresh_token ?? "");
  const expiresIn = Number(json?.expires_in ?? 0);
  if (!accessToken || !refreshToken || !expiresIn) {
    throw new Error(
      `Spotify token response missing fields: ${summarizeSpotifyPayload(json)}`,
    );
  }

  spotifyAuthFailureCache = null;
  spotifyUserTokenProbeCache = new Map();
  spotifyUserTokenProbeInFlight = new Map();
  spotifyUserTokenProbeRateLimitedUntil = new Map();
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function refreshSpotifyAccessToken(args: {
  refreshToken: string;
}): Promise<SpotifyTokens> {
  if (!CLIENT_ID) {
    throw new Error(
      "Missing EXPO_PUBLIC_SPOTIFY_CLIENT_ID. Set it in your env and restart Expo.",
    );
  }
  const body = new URLSearchParams();
  body.set("client_id", CLIENT_ID);
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", args.refreshToken);
  const res = await fetch(SPOTIFY_DISCOVERY.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const raw = await res.text();
  let json: any = null;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const detail = summarizeSpotifyPayload(json);
    const rawHint = raw
      ? redactSensitiveText(raw).slice(0, 220)
      : "empty_response_body";
    console.error(`[Spotify] refresh error body (${res.status}): ${rawHint}`);
    throw new Error(
      `Spotify refresh failed (${res.status}): ${detail}; raw=${rawHint}`,
    );
  }
  const accessToken = String(json?.access_token ?? "");
  const expiresIn = Number(json?.expires_in ?? 0);
  const scopeRaw = String(json?.scope ?? "").trim();
  if (!accessToken || !expiresIn) {
    throw new Error(
      `Spotify refresh response missing fields: ${summarizeSpotifyPayload(json)}`,
    );
  }
  if (scopeRaw) {
    const granted = new Set(scopeRaw.split(/\s+/).filter(Boolean));
    const required = ["user-top-read", "user-library-read", "user-read-recently-played"];
    const missing = required.filter(s => !granted.has(s));
    if (missing.length) {
      console.warn(
        `[Spotify] refresh scope check missing=${missing.join(",")}`,
      );
    } else {
      console.warn("[Spotify] refresh scope check ok");
    }
  } else {
    console.warn("[Spotify] refresh scope not returned by Spotify; reusing prior consent scopes");
  }
  // Spotify may omit refresh_token on refresh responses; keep the existing one.
  spotifyAuthFailureCache = null;
  spotifyUserTokenProbeCache = new Map();
  spotifyUserTokenProbeInFlight = new Map();
  spotifyUserTokenProbeRateLimitedUntil = new Map();
  return {
    accessToken,
    refreshToken: args.refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

// ── 유저 프로필 ───────────────────────────────────────────
export async function getSpotifyUser(
  accessToken: string,
): Promise<SpotifyUser | null> {
  const res = await spotifyFetch("/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    console.warn(
      `[Spotify] getSpotifyUser failed (${res.status}): ${summarizeSpotifyPayload(json)}`,
    );
    return null;
  }
  return json as SpotifyUser;
}

type SpotifyApiError = Error & {
  status?: number;
  endpoint?: string;
  payload?: unknown;
};

type SavedPlaylistResult = {
  id: string;
  externalUrl?: string;
};

export type SpotifyRecommendationArgs = {
  accessToken: string;
  seedArtists?: string[];
  seedTracks?: string[];
  seedGenres?: string[];
  targetEnergy?: number;
  targetValence?: number;
  targetAcousticness?: number;
  targetTempo?: number;
  minTempo?: number;
  maxTempo?: number;
  limit?: number;
};

let canUseAudioFeaturesApi = true;
let canUseArtistApi = true;
let canUseSavedTrackContainsApi = true;
let canUseRecommendationsApi = true;
let moodtunePlaylistsCache:
  | { data: SpotifyPlaylistSummary[]; fetchedAt: number }
  | null = null;
let moodtunePlaylistsInFlight: Promise<SpotifyPlaylistSummary[]> | null = null;
let moodtunePlaylistsCooldownUntil = 0;
let moodtunePlaylistsCacheTokenKey: string | null = null;
let playlistTracksCache = new Map<string, { data: SpotifyTrackSummary[]; fetchedAt: number }>();
let playlistTracksInFlight = new Map<string, Promise<SpotifyTrackSummary[]>>();
let playlistTracksCooldownUntil = new Map<string, number>();
let spotifyGlobalCooldownUntil = 0;
let playlistCreateCooldownUntil = 0;
const MAX_SPOTIFY_GLOBAL_COOLDOWN_MS = 120_000;
const MAX_SPOTIFY_RETRY_AFTER_MS = 30_000;
let spotifySearchRateLimitStrike = 0;
let spotifySearchRateLimitedUntil = 0;
const MAX_SPOTIFY_SEARCH_RATE_LIMIT_MS = 120_000;
let spotifySearchRateLimitLastAt = 0;
const lastMoodtunePlaylistIdByUser = new Map<string, string>();
let spotifyUserTokenProbeCache = new Map<
  string,
  { isUserToken: boolean; checkedAt: number }
>();
let spotifyUserTokenProbeInFlight = new Map<string, Promise<void>>();
let spotifyUserTokenProbeRateLimitedUntil = new Map<string, number>();

export function invalidateMoodtunePlaylistCache(): void {
  moodtunePlaylistsCache = null;
  moodtunePlaylistsInFlight = null;
  moodtunePlaylistsCooldownUntil = 0;
}

async function ensureSpotifyUserAccessToken(
  accessToken: string,
  context: string,
): Promise<void> {
  const token = String(accessToken ?? "").trim();
  if (!token) {
    throw new Error(`[Spotify] User token is required (${context}): empty token`);
  }
  const tokenPrefix = token.slice(0, 10);
  const probeRateLimitedUntil = spotifyUserTokenProbeRateLimitedUntil.get(tokenPrefix) ?? 0;
  if (probeRateLimitedUntil > Date.now()) {
    return;
  }
  const cached = spotifyUserTokenProbeCache.get(tokenPrefix);
  if (cached && Date.now() - cached.checkedAt < 10 * 60_000) {
    if (cached.isUserToken) return;
    throw new Error(`[Spotify] User token is required (${context})`);
  }
  const existingProbe = spotifyUserTokenProbeInFlight.get(tokenPrefix);
  if (existingProbe) {
    await existingProbe;
    const nextCached = spotifyUserTokenProbeCache.get(tokenPrefix);
    if (
      nextCached &&
      Date.now() - nextCached.checkedAt < 10 * 60_000 &&
      !nextCached.isUserToken
    ) {
      throw new Error(`[Spotify] User token is required (${context})`);
    }
    return;
  }

  const probePromise = (async () => {
    console.warn(`[Spotify] /me probe start context=${context}`);
    const res = await spotifyFetch(
      "/me",
      { headers: { Authorization: `Bearer ${token}` } },
      5_000,
    );
    const json: any = await res.json().catch(() => null);
    if (res.ok) {
      console.warn(`[Spotify] /me probe ok context=${context}`);
      spotifyUserTokenProbeCache.set(tokenPrefix, {
        isUserToken: true,
        checkedAt: Date.now(),
      });
      return;
    }
    console.warn(
      `[Spotify] /me probe failed context=${context} status=${res.status}`,
    );
    if (res.status === 429) {
      const retryMs = clampRetryAfterMs(
        res.headers.get("retry-after"),
        2_000,
        20_000,
      );
      spotifyGlobalCooldownUntil = Math.max(
        spotifyGlobalCooldownUntil,
        Date.now() + retryMs,
      );
      spotifyUserTokenProbeRateLimitedUntil.set(
        tokenPrefix,
        Date.now() + retryMs,
      );
      return;
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      spotifyUserTokenProbeCache.set(tokenPrefix, {
        isUserToken: false,
        checkedAt: Date.now(),
      });
      throw new Error(
        `[Spotify] User token is required (${context}). /me failed (${res.status}): ${summarizeSpotifyPayload(
          json,
        )}`,
      );
    }
  })();

  spotifyUserTokenProbeInFlight.set(tokenPrefix, probePromise);
  try {
    await probePromise;
  } finally {
    spotifyUserTokenProbeInFlight.delete(tokenPrefix);
  }
}

export async function validateSpotifyUserToken(
  accessToken: string,
  context = "spotify_api",
): Promise<void> {
  await ensureSpotifyUserAccessToken(accessToken, context);
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clampRetryAfterMs(
  retryAfterSecRaw: string | null,
  fallbackMs: number,
  maxMs = MAX_SPOTIFY_RETRY_AFTER_MS,
): number {
  const sec = Number(retryAfterSecRaw ?? "");
  if (Number.isFinite(sec) && sec > 0) {
    return Math.max(500, Math.min(sec * 1000, maxMs));
  }
  return Math.max(500, Math.min(fallbackMs, maxMs));
}

function registerSpotifySearchRateLimit(retryMs: number): void {
  spotifySearchRateLimitLastAt = Date.now();
  spotifySearchRateLimitStrike = Math.min(8, spotifySearchRateLimitStrike + 1);
  const strikeBackoffMs = Math.min(
    MAX_SPOTIFY_SEARCH_RATE_LIMIT_MS,
    Math.max(6_000, 4_000 * spotifySearchRateLimitStrike),
  );
  const holdMs = Math.max(retryMs, strikeBackoffMs);
  spotifySearchRateLimitedUntil = Math.max(
    spotifySearchRateLimitedUntil,
    Date.now() + holdMs,
  );
}

function registerSpotifySearchSuccess(): void {
  spotifySearchRateLimitStrike = Math.max(0, spotifySearchRateLimitStrike - 1);
  if (spotifySearchRateLimitStrike <= 1) {
    spotifySearchRateLimitLastAt = 0;
  }
  if (spotifySearchRateLimitStrike === 0) {
    spotifySearchRateLimitedUntil = 0;
  }
}

function getSearchCooldownMs(): number {
  const now = Date.now();
  const globalRemain = Math.max(0, spotifyGlobalCooldownUntil - now);
  const searchRemain = Math.max(0, spotifySearchRateLimitedUntil - now);
  return Math.max(globalRemain, searchRemain);
}

function isForbiddenWriteError(err: unknown): boolean {
  const status = (err as SpotifyApiError | undefined)?.status;
  if (status === 403) return true;
  const msg = String((err as Error | undefined)?.message ?? err ?? "");
  return msg.includes("(403)") || msg.toLowerCase().includes("forbidden");
}

async function spotifyFetch(
  endpoint: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const now = Date.now();
  if (spotifyGlobalCooldownUntil > now) {
    const rawWaitMs = spotifyGlobalCooldownUntil - now;
    if (rawWaitMs > MAX_SPOTIFY_GLOBAL_COOLDOWN_MS) {
      console.warn(
        `[SpotifyDiag] reset abnormal global cooldown raw=${rawWaitMs}ms endpoint=${endpoint.slice(0, 80)}`,
      );
      spotifyGlobalCooldownUntil = 0;
    }
  }
  if (spotifyGlobalCooldownUntil > Date.now()) {
    const rawWaitMs = spotifyGlobalCooldownUntil - Date.now();
    const isSearchEndpoint = endpoint.startsWith("/search?");
    const cappedWaitMs = isSearchEndpoint
      ? Math.max(0, Math.min(rawWaitMs, Math.max(1200, timeoutMs - 1500), 3500))
      : rawWaitMs;
    if (isSearchEndpoint) {
      console.warn(
        `[SpotifyDiag] search cooldown wait raw=${rawWaitMs}ms capped=${cappedWaitMs}ms timeout=${timeoutMs} endpoint=${endpoint.slice(0, 80)}`,
      );
    }
    if (cappedWaitMs > 0) {
      await wait(cappedWaitMs);
    }
  }
  if (endpoint.startsWith("/search?") && spotifySearchRateLimitedUntil > Date.now()) {
    const remain = spotifySearchRateLimitedUntil - Date.now();
    const shortWaitMs = Math.min(remain, Math.max(400, timeoutMs - 1000), 1500);
    if (shortWaitMs > 0) {
      console.warn(
        `[SpotifyDiag] search circuit wait remain=${remain}ms shortWait=${shortWaitMs}ms endpoint=${endpoint.slice(0, 80)}`,
      );
      await wait(shortWaitMs);
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`https://api.spotify.com/v1${endpoint}`, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as any)?.name === "AbortError") {
      throw new Error(`[Spotify] request timeout ${endpoint} (${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function spotifyGetJson<T>(
  accessToken: string,
  endpoint: string,
  timeoutMs?: number,
): Promise<T> {
  if (shouldSkipSpotifyByAuthFailure(accessToken)) {
    throw new Error("[Spotify] authentication unavailable (cached): 인증 만료: Spotify 재로그인 필요");
  }
  const isSearchEndpoint = endpoint.startsWith("/search?");
  const maxAttempts = isSearchEndpoint ? 2 : 4;
  const baseTimeoutMs = Math.max(6500, Math.min(24000, Number(timeoutMs ?? 15000)));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const res = await Promise.race<Response>([
      spotifyFetch(
        endpoint,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        baseTimeoutMs,
      ),
      new Promise<Response>((_, reject) => {
        setTimeout(() => {
          const elapsed = Date.now() - startedAt;
          reject(
            new Error(
              `[Spotify] hard timeout ${endpoint} (${baseTimeoutMs + 3000}ms, elapsed=${elapsed}ms, attempt=${attempt})`,
            ),
          );
        }, baseTimeoutMs + 3000);
      }),
    ]);
    const json: any = await res.json().catch(() => null);
    if (res.ok) {
      if (isSearchEndpoint) {
        registerSpotifySearchSuccess();
      }
      return json as T;
    }

    const isRateLimited = res.status === 429;
    if (isRateLimited && attempt < maxAttempts) {
      const retryMs = clampRetryAfterMs(
        res.headers.get("retry-after"),
        attempt * 1200,
      );
      spotifyGlobalCooldownUntil = Math.max(
        spotifyGlobalCooldownUntil,
        Date.now() + retryMs,
      );
      if (isSearchEndpoint) {
        registerSpotifySearchRateLimit(retryMs);
      }
      await wait(retryMs);
      continue;
    }
    if (isRateLimited && isSearchEndpoint) {
      const retryMs = clampRetryAfterMs(
        res.headers.get("retry-after"),
        attempt * 1200,
      );
      registerSpotifySearchRateLimit(retryMs);
      console.warn(
        `[SpotifyDiag] search rate-limited give-up endpoint=${endpoint.slice(0, 120)} attempts=${attempt}`,
      );
    }

    const wwwAuthenticate = String(
      res.headers.get("www-authenticate") ?? "",
    );
    const rawMessage = String(json?.error?.message ?? "");
    const isScopeProblem =
      /insufficient_scope/i.test(wwwAuthenticate) ||
      rawMessage.toLowerCase().includes("insufficient") ||
      rawMessage.toLowerCase().includes("scope");
    const isAuthProblem =
      res.status === 401 || /invalid_token/i.test(wwwAuthenticate);
    if (isAuthProblem) {
      markSpotifyAuthFailure(accessToken, `status=${res.status}`);
    }
    const hint =
      isAuthProblem
        ? " (인증 만료: Spotify 재로그인 필요)"
        : res.status === 429
        ? " (요청 한도 초과: 잠시 후 다시 시도)"
        : res.status === 403
        ? isScopeProblem
          ? " (권한(scope) 부족: Spotify 재로그인 필요)"
          : " (권한/앱 설정 문제: Spotify Dashboard User Management 및 앱 권한 확인)"
        : "";
    const authHeaderHint = wwwAuthenticate
      ? ` [www-authenticate: ${wwwAuthenticate}]`
      : "";
    const err = new Error(
      `[Spotify] request failed (${res.status}) ${endpoint}${hint}: ${summarizeSpotifyPayload(
        json,
      )}${authHeaderHint}`,
    ) as SpotifyApiError;
    err.status = res.status;
    err.endpoint = endpoint;
    err.payload = json;
    throw err;
  }
  throw new Error("[Spotify] unexpected request flow");
}

async function spotifyWriteJson<T>(
  accessToken: string,
  endpoint: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  if (shouldSkipSpotifyByAuthFailure(accessToken)) {
    throw new Error("[Spotify] authentication unavailable (cached): 인증 만료: Spotify 재로그인 필요");
  }
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await spotifyFetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json().catch(() => null);
    if (res.ok) {
      return json as T;
    }

    if (res.status === 429 && attempt < maxAttempts) {
      const retryMs = clampRetryAfterMs(
        res.headers.get("retry-after"),
        attempt * 1200,
      );
      spotifyGlobalCooldownUntil = Math.max(
        spotifyGlobalCooldownUntil,
        Date.now() + retryMs,
      );
      await wait(retryMs);
      continue;
    }

    const wwwAuthenticate = String(
      res.headers.get("www-authenticate") ?? "",
    );
    const rawMessage = String(json?.error?.message ?? "");
    const isScopeProblem =
      /insufficient_scope/i.test(wwwAuthenticate) ||
      rawMessage.toLowerCase().includes("insufficient") ||
      rawMessage.toLowerCase().includes("scope");
    const isAuthProblem =
      res.status === 401 || /invalid_token/i.test(wwwAuthenticate);
    if (isAuthProblem) {
      markSpotifyAuthFailure(accessToken, `status=${res.status}`);
    }
    const hint =
      isAuthProblem
        ? " (인증 만료: Spotify 재로그인 필요)"
        : res.status === 429
        ? " (요청 한도 초과: 잠시 후 다시 시도)"
        : res.status === 403
        ? isScopeProblem
          ? " (권한(scope) 부족: Spotify 재로그인 필요)"
          : " (권한/앱 설정 문제: Spotify 앱 권한 또는 Dashboard User Management 사용자 등록 확인)"
        : "";
    const authHeaderHint = wwwAuthenticate
      ? ` [www-authenticate: ${wwwAuthenticate}]`
      : "";
    const err = new Error(
      `[Spotify] request failed (${res.status}) ${method} ${endpoint}${hint}: ${summarizeSpotifyPayload(
        json,
      )}${authHeaderHint}`,
    ) as SpotifyApiError;
    err.status = res.status;
    err.endpoint = endpoint;
    err.payload = json;
    throw err;
  }
  throw new Error("[Spotify] unexpected write request flow");
}

async function addItemsToPlaylist(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  const pid = encodeURIComponent(playlistId);
  const attempts: Array<{ endpoint: string; body: unknown }> = [
    // 신규 스펙 우선
    { endpoint: `/playlists/${pid}/items`, body: { uris } },
    // 일부 계정/앱 조합 호환
    {
      endpoint: `/playlists/${pid}/items`,
      body: { items: uris.map(uri => ({ uri })) },
    },
    // 구 스펙 폴백
    { endpoint: `/playlists/${pid}/tracks`, body: { uris } },
  ];

  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      await spotifyWriteJson(accessToken, attempt.endpoint, "POST", attempt.body);
      return;
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error)?.message ?? err);
      // 페이로드/엔드포인트 호환 이슈일 때 다음 전략으로 재시도
      if (
        msg.includes("(400)") ||
        msg.includes("(403)") ||
        msg.includes("(404)")
      ) {
        continue;
      }
      break;
    }
  }
  throw lastErr ?? new Error("[Spotify] addItemsToPlaylist failed");
}

async function replacePlaylistItems(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  const pid = encodeURIComponent(playlistId);
  const first = uris.slice(0, 100);
  const rest = uris.slice(100);

  await spotifyWriteJson(accessToken, `/playlists/${pid}/tracks`, "PUT", {
    uris: first,
  });
  for (let i = 0; i < rest.length; i += 100) {
    await addItemsToPlaylist(accessToken, playlistId, rest.slice(i, i + 100));
  }
}

async function appendPlaylistItemsInChunks(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) {
    await addItemsToPlaylist(accessToken, playlistId, uris.slice(i, i + 100));
  }
}

async function createMoodtunePlaylistWithRetry(args: {
  accessToken: string;
  name: string;
  description: string;
  isPublic?: boolean;
}): Promise<any> {
  const now = Date.now();
  if (playlistCreateCooldownUntil > now) {
    await wait(playlistCreateCooldownUntil - now);
  }
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await spotifyFetch("/me/playlists", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: args.name,
        public: Boolean(args.isPublic),
        description: args.description,
      }),
    });
    const json: any = await res.json().catch(() => null);
    if (res.ok) return json;

    if (res.status === 429 && attempt < maxAttempts) {
      const retryMs = clampRetryAfterMs(
        res.headers.get("retry-after"),
        Math.min(60_000, 2_000 * 2 ** (attempt - 1)),
        60_000,
      );
      playlistCreateCooldownUntil = Math.max(
        playlistCreateCooldownUntil,
        Date.now() + retryMs,
      );
      spotifyGlobalCooldownUntil = Math.max(
        spotifyGlobalCooldownUntil,
        Date.now() + retryMs,
      );
      await wait(retryMs);
      continue;
    }

    const err = new Error(
      `[Spotify] request failed (${res.status}) POST /me/playlists: ${summarizeSpotifyPayload(
        json,
      )}`,
    ) as SpotifyApiError;
    err.status = res.status;
    err.endpoint = "/me/playlists";
    err.payload = json;
    throw err;
  }

  throw new Error("[Spotify] playlist creation retries exhausted");
}

function toOptionalArrayResult<T>(
  result: PromiseSettledResult<T>,
  label: string,
  fallback: T,
): T {
  if (result.status === "fulfilled") return result.value;
  const err = result.reason as SpotifyApiError | undefined;
  if (err?.status === 401) throw err;
  console.warn(
    `[Spotify] bootstrap optional step failed (${label}): ${errorMessage(err)}`,
  );
  return fallback;
}

async function getSpotifyTempoMap(
  accessToken: string,
  trackIds: string[],
): Promise<Record<string, number>> {
  const featuresMap = await getSpotifyAudioFeaturesMap(accessToken, trackIds);
  const tempoMap: Record<string, number> = {};
  Object.entries(featuresMap).forEach(([id, features]) => {
    const tempo = Number(features?.tempo ?? 0);
    if (id && Number.isFinite(tempo) && tempo > 0) tempoMap[id] = tempo;
  });
  return tempoMap;
}

export type SpotifyAudioFeaturesSummary = {
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  tempo: number;
};

export async function getSpotifyAudioFeaturesMap(
  accessToken: string,
  trackIds: string[],
): Promise<Record<string, SpotifyAudioFeaturesSummary>> {
  if (!SPOTIFY_ENABLE_METADATA_ENRICH) return {};
  if (!canUseAudioFeaturesApi) return {};
  const uniqueIds = Array.from(
    new Set(trackIds.map(v => String(v ?? "").trim()).filter(Boolean)),
  );
  if (!uniqueIds.length) return {};
  const chunkSize = 100;
  const out: Record<string, SpotifyAudioFeaturesSummary> = {};

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const ids = uniqueIds.slice(i, i + chunkSize).join(",");
    try {
      const json = await spotifyGetJson<{ audio_features: any[] }>(
        accessToken,
        `/audio-features?ids=${encodeURIComponent(ids)}`,
      );
      (json.audio_features ?? []).forEach((f: any) => {
        const id = String(f?.id ?? "").trim();
        if (!id) return;
        out[id] = {
          energy: Number(f?.energy ?? 0) || 0,
          valence: Number(f?.valence ?? 0) || 0,
          danceability: Number(f?.danceability ?? 0) || 0,
          acousticness: Number(f?.acousticness ?? 0) || 0,
          tempo: Number(f?.tempo ?? 0) || 0,
        };
      });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (msg.includes("(403)")) {
        recordSpotify403Failure("audio");
        if (canUseAudioFeaturesApi) {
          console.warn(`[Spotify] audio-features unavailable: ${errorMessage(err)}`);
        }
        canUseAudioFeaturesApi = false;
        break;
      }
      console.warn(`[Spotify] audio-features unavailable: ${errorMessage(err)}`);
    }
  }

  return out;
}

async function getSpotifySavedMap(
  accessToken: string,
  trackIds: string[],
): Promise<Record<string, boolean>> {
  if (!SPOTIFY_ENABLE_METADATA_ENRICH) return {};
  if (!canUseSavedTrackContainsApi) return {};
  const uniqueIds = Array.from(new Set(trackIds.filter(Boolean)));
  if (!uniqueIds.length) return {};
  const chunkSize = 50;
  const savedMap: Record<string, boolean> = {};

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const idsChunk = uniqueIds.slice(i, i + chunkSize);
    const ids = idsChunk.join(",");
    try {
      const json = await spotifyGetJson<boolean[]>(
        accessToken,
        `/me/tracks/contains?ids=${encodeURIComponent(ids)}`,
      );
      idsChunk.forEach((id, idx) => {
        savedMap[id] = Boolean(json?.[idx]);
      });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (msg.includes("(403)")) {
        recordSpotify403Failure("saved");
        if (canUseSavedTrackContainsApi) {
          console.warn(
            `[Spotify] saved-track state unavailable: ${errorMessage(err)}`,
          );
        }
        canUseSavedTrackContainsApi = false;
        break;
      }
      console.warn(`[Spotify] saved-track state unavailable: ${errorMessage(err)}`);
    }
  }

  return savedMap;
}

async function getSpotifyArtistGenresMap(
  accessToken: string,
  artistIds: string[],
): Promise<Record<string, string[]>> {
  if (!SPOTIFY_ENABLE_METADATA_ENRICH) return {};
  if (!canUseArtistApi) return {};
  const uniqueIds = Array.from(new Set(artistIds.filter(Boolean)));
  if (!uniqueIds.length) return {};
  const chunkSize = 50;
  const map: Record<string, string[]> = {};

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const ids = uniqueIds.slice(i, i + chunkSize).join(",");
    try {
      const json = await spotifyGetJson<{ artists: any[] }>(
        accessToken,
        `/artists?ids=${encodeURIComponent(ids)}`,
      );
      (json.artists ?? []).forEach((artist: any) => {
        const id = String(artist?.id ?? "");
        if (!id) return;
        const genres = Array.isArray(artist?.genres)
          ? artist.genres
              .map((g: any) => String(g).trim())
              .filter(Boolean)
              .slice(0, 3)
          : [];
        map[id] = genres;
      });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (msg.includes("(403)")) {
        recordSpotify403Failure("artist");
        if (canUseArtistApi) {
          console.warn(
            `[Spotify] artist genres unavailable: ${errorMessage(err)}`,
          );
        }
        canUseArtistApi = false;
        break;
      }
      console.warn(`[Spotify] artist genres unavailable: ${errorMessage(err)}`);
    }
  }

  return map;
}

export async function getSpotifyTopTracks(
  accessToken: string,
  limit = 20,
): Promise<SpotifyTrackSummary[]> {
  await ensureSpotifyUserAccessToken(accessToken, "top_tracks");
  const json = await spotifyGetJson<{ items: any[] }>(
    accessToken,
    `/me/top/tracks?time_range=medium_term&limit=${limit}`,
  );
  const tracks: SpotifyTrackSummary[] = (json.items ?? []).map(item => ({
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    uri: String(item?.uri ?? ""),
    preview_url: item?.preview_url ?? null,
    duration_ms: Number(item?.duration_ms ?? 0),
    artists: Array.isArray(item?.artists)
      ? item.artists.map((a: any) => ({ id: String(a?.id ?? ""), name: String(a?.name ?? "") }))
      : [],
    album: {
      id: String(item?.album?.id ?? ""),
      name: String(item?.album?.name ?? ""),
      release_date: String(item?.album?.release_date ?? ""),
      images: Array.isArray(item?.album?.images)
        ? item.album.images.map((img: any) => ({ url: String(img?.url ?? "") }))
        : [],
    },
  }));
  if (!SPOTIFY_ENABLE_METADATA_ENRICH) {
    return tracks.map(track => ({
      ...track,
      tempo: 0,
      is_saved: false,
      genres: [],
    }));
  }
  const [tempoMap, savedMap, artistGenreMap] = await Promise.all([
    getSpotifyTempoMap(
      accessToken,
      tracks.map(t => t.id),
    ),
    getSpotifySavedMap(
      accessToken,
      tracks.map(t => t.id),
    ),
    getSpotifyArtistGenresMap(
      accessToken,
      tracks.flatMap(t => t.artists.map((a: { id: string }) => a.id)),
    ),
  ]);
  return tracks.map(track => ({
    ...track,
    tempo: tempoMap[track.id] ?? 0,
    is_saved: savedMap[track.id] ?? false,
    genres: Array.from(
      new Set(
        track.artists.flatMap((a: { id: string }) =>
          (artistGenreMap[a.id] ?? []).map(g => String(g)),
        ),
      ),
    ).slice(0, 3),
  }));
}

export async function getSpotifyTopArtists(
  accessToken: string,
  limit = 20,
): Promise<SpotifyArtistSummary[]> {
  await ensureSpotifyUserAccessToken(accessToken, "top_artists");
  const json = await spotifyGetJson<{ items: any[] }>(
    accessToken,
    `/me/top/artists?time_range=medium_term&limit=${limit}`,
  );
  return (json.items ?? []).map(item => ({
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    genres: Array.isArray(item?.genres) ? item.genres.map((g: any) => String(g)) : [],
    popularity: Number(item?.popularity ?? 0),
  }));
}

export async function getSpotifyRecommendations(
  args: SpotifyRecommendationArgs,
): Promise<SpotifyTrackSummary[]> {
  try {
    await ensureSpotifyUserAccessToken(args.accessToken, "recommendations");
  } catch (err) {
    console.warn(`[Spotify] recommendations skipped: ${errorMessage(err)}`);
    return [];
  }
  const cleanIds = (values?: string[]): string[] =>
    Array.from(
      new Set(
        (values ?? [])
          .map(v => String(v ?? "").trim())
          .filter(Boolean),
      ),
    );
  const cleanGenres = (values?: string[]): string[] =>
    Array.from(
      new Set(
        (values ?? [])
          .map(v =>
            String(v ?? "")
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, ""),
          )
          .filter(Boolean),
      ),
    );
  const clampFloat = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));
  const cleaned = {
    artists: cleanIds(args.seedArtists).slice(0, 5),
    tracks: cleanIds(args.seedTracks).slice(0, 5),
    genres: cleanGenres(args.seedGenres).slice(0, 5),
  };
  while (cleaned.artists.length + cleaned.tracks.length + cleaned.genres.length > 5) {
    if (cleaned.genres.length > 0) {
      cleaned.genres.pop();
      continue;
    }
    if (cleaned.tracks.length > 0) {
      cleaned.tracks.pop();
      continue;
    }
    cleaned.artists.pop();
  }
  if (!cleaned.artists.length && !cleaned.tracks.length && !cleaned.genres.length) {
    return [];
  }

  const params = new URLSearchParams();
  params.set("limit", String(Math.max(1, Math.min(100, Math.floor(args.limit ?? 40)))));
  params.set("market", "KR");
  if (cleaned.artists.length) params.set("seed_artists", cleaned.artists.join(","));
  if (cleaned.tracks.length) params.set("seed_tracks", cleaned.tracks.join(","));
  if (cleaned.genres.length) params.set("seed_genres", cleaned.genres.join(","));
  if (Number.isFinite(args.targetEnergy)) {
    params.set("target_energy", String(clampFloat(Number(args.targetEnergy), 0, 1)));
  }
  if (Number.isFinite(args.targetValence)) {
    params.set("target_valence", String(clampFloat(Number(args.targetValence), 0, 1)));
  }
  if (Number.isFinite(args.targetAcousticness)) {
    params.set(
      "target_acousticness",
      String(clampFloat(Number(args.targetAcousticness), 0, 1)),
    );
  }
  if (Number.isFinite(args.targetTempo) && Number(args.targetTempo) > 0) {
    params.set("target_tempo", String(Math.round(Number(args.targetTempo))));
  }
  if (Number.isFinite(args.minTempo) && Number(args.minTempo) > 0) {
    params.set("min_tempo", String(Math.round(Number(args.minTempo))));
  }
  if (Number.isFinite(args.maxTempo) && Number(args.maxTempo) > 0) {
    params.set("max_tempo", String(Math.round(Number(args.maxTempo))));
  }

  try {
    const json = await spotifyGetJson<{ tracks?: any[] }>(
      args.accessToken,
      `/recommendations?${params.toString()}`,
      7_500,
    );
    return (json.tracks ?? []).map(mapTrackItemToSummary);
  } catch (err) {
    const status = (err as SpotifyApiError | undefined)?.status;
    const msg = String((err as Error)?.message ?? err);
    if (status === 404 || msg.includes("(404)")) {
      console.warn("[Spotify] recommendations unavailable in current app mode.");
      return [];
    }
    console.warn(`[Spotify] recommendations request failed: ${errorMessage(err)}`);
    return [];
  }
}

export async function getSpotifyPlaylists(
  accessToken: string,
  limit = 20,
): Promise<SpotifyPlaylistSummary[]> {
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const json = await spotifyGetJson<{ items: any[] }>(
    accessToken,
    `/me/playlists?limit=${safeLimit}`,
  );
  return (json.items ?? []).map(item => ({
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    uri: String(item?.uri ?? ""),
    description: String(item?.description ?? ""),
    external_url: String(item?.external_urls?.spotify ?? ""),
    owner_id: String(item?.owner?.id ?? ""),
    images: Array.isArray(item?.images)
      ? item.images.map((img: any) => ({ url: String(img?.url ?? "") }))
      : [],
    tracks: { total: Number(item?.tracks?.total ?? 0) },
  }));
}

export async function getMoodtuneCreatedPlaylists(
  accessToken: string,
): Promise<SpotifyPlaylistSummary[]> {
  const tokenKey = accessToken.slice(0, 24);
  const now = Date.now();
  if (moodtunePlaylistsCacheTokenKey !== tokenKey) {
    moodtunePlaylistsCache = null;
    moodtunePlaylistsInFlight = null;
    moodtunePlaylistsCooldownUntil = 0;
    moodtunePlaylistsCacheTokenKey = tokenKey;
  }
  if (now < moodtunePlaylistsCooldownUntil && moodtunePlaylistsCache) {
    return moodtunePlaylistsCache.data;
  }
  if (
    moodtunePlaylistsCache &&
    now - moodtunePlaylistsCache.fetchedAt < 5 * 60_000
  ) {
    return moodtunePlaylistsCache.data;
  }
  if (moodtunePlaylistsInFlight) {
    return moodtunePlaylistsInFlight;
  }

  moodtunePlaylistsInFlight = (async () => {
  const pageSize = 50;
  const maxPages = 6; // 최대 300개 (호출량 제어)
  const all: SpotifyPlaylistSummary[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * pageSize;
    const json = await spotifyGetJson<{ items: any[] }>(
      accessToken,
      `/me/playlists?limit=${pageSize}&offset=${offset}`,
    );
    const items = json.items ?? [];
    const mapped: SpotifyPlaylistSummary[] = items.map(item => ({
      id: String(item?.id ?? ""),
      name: String(item?.name ?? ""),
      uri: String(item?.uri ?? ""),
      description: String(item?.description ?? ""),
      external_url: String(item?.external_urls?.spotify ?? ""),
      owner_id: String(item?.owner?.id ?? ""),
      images: Array.isArray(item?.images)
        ? item.images.map((img: any) => ({ url: String(img?.url ?? "") }))
        : [],
      tracks: { total: Number(item?.tracks?.total ?? 0) },
    }));
    all.push(...mapped);
    if (items.length < pageSize) break;
  }

  const me = await getSpotifyUser(accessToken).catch(() => null);
  const owned = me?.id ? all.filter(p => p.owner_id === me.id) : all;
  const moodtuneLike = owned.filter(p =>
    isMoodtunePlaylistLike({
      name: p.name,
      description: p.description,
    }),
  );
  if (me?.id) {
    // 레거시(예전 버전) 데이터는 marker가 없을 수 있어, marker 결과가 0일 때만 owner 기반 폴백.
    const finalList = moodtuneLike.length > 0 ? moodtuneLike : owned;
    moodtunePlaylistsCache = { data: finalList, fetchedAt: Date.now() };
    return finalList;
  }
  moodtunePlaylistsCache = { data: moodtuneLike, fetchedAt: Date.now() };
  return moodtuneLike;
  })();

  try {
    return await moodtunePlaylistsInFlight;
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("(429)")) {
      moodtunePlaylistsCooldownUntil = Date.now() + 30_000;
    }
    if (moodtunePlaylistsCache) return moodtunePlaylistsCache.data;
    throw err;
  } finally {
    moodtunePlaylistsInFlight = null;
  }
}

export async function getSpotifyPlaylistTracks(args: {
  accessToken: string;
  playlistId: string;
  ownerId?: string;
  limit?: number;
}): Promise<SpotifyTrackSummary[]> {
  const tokenKey = args.accessToken.slice(0, 24);
  const key = `${tokenKey}:${args.playlistId}`;
  const now = Date.now();
  const cached = playlistTracksCache.get(key);
  const cooldownUntil = playlistTracksCooldownUntil.get(key) ?? 0;
  if (cached && now - cached.fetchedAt < 2 * 60_000) {
    return cached.data;
  }
  if (cooldownUntil > now) {
    if (cached) return cached.data;
    throw new Error(
      `[Spotify] playlist tracks request cooling down (${Math.ceil((cooldownUntil - now) / 1000)}s): ${args.playlistId}`,
    );
  }
  const inFlight = playlistTracksInFlight.get(key);
  if (inFlight) return inFlight;

  const loader = (async () => {
  const requestedLimit = Math.max(1, Math.floor(args.limit ?? 1000));
  const safeMax = Math.min(5000, requestedLimit);
  const pageSize = 100;
  async function fetchPaged(
    endpointKind: "items" | "tracks",
  ): Promise<any[]> {
    const rows: any[] = [];
    let offset = 0;
    while (offset < safeMax) {
      const rest = safeMax - offset;
      const fetchLimit = Math.min(pageSize, rest);
      const basePath = `/playlists/${encodeURIComponent(args.playlistId)}`;
      let json: { items: any[]; next?: string | null };
      try {
        json = await spotifyGetJson<{ items: any[]; next?: string | null }>(
          args.accessToken,
          `${basePath}/${endpointKind}?limit=${fetchLimit}&offset=${offset}`,
        );
      } catch (err) {
        // 중간 페이지에서 레이트리밋이 걸리면 지금까지 가져온 트랙이라도 반환한다.
        if (rows.length > 0) return rows;
        throw err;
      }
      const pageItems = json.items ?? [];
      rows.push(...pageItems);
      if (pageItems.length < fetchLimit || !json.next) break;
      offset += fetchLimit;
    }
    return rows;
  }

  const attempts: Array<() => Promise<any[]>> = [
    () => fetchPaged("items"),
    () => fetchPaged("tracks"),
    async () => {
      const oneShot = await spotifyGetJson<{ tracks?: { items?: any[] } }>(
        args.accessToken,
        `/playlists/${encodeURIComponent(args.playlistId)}?fields=tracks.items(track(id,name,uri,preview_url,duration_ms,artists(id,name),album(id,name,release_date,images(url))))`,
      );
      return (oneShot.tracks?.items ?? []).slice(0, safeMax);
    },
  ];

  let lastErr: unknown = null;
  for (const run of attempts) {
    try {
      const allItems = await run();
      const items = allItems.map((row: any) => row?.track).filter(Boolean);
      const mapped = items.map(mapTrackItemToSummary).filter(v => Boolean(v.id));
      if (mapped.length) {
        playlistTracksCache.set(key, { data: mapped, fetchedAt: Date.now() });
        return mapped;
      }
    } catch (err) {
      const e = err as SpotifyApiError;
      if (e?.status === 429) {
        playlistTracksCooldownUntil.set(key, Date.now() + 30_000);
        if (cached?.data?.length) return cached.data;
        throw err;
      }
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return [];
  })();

  playlistTracksInFlight.set(key, loader);
  try {
    return await loader;
  } finally {
    playlistTracksInFlight.delete(key);
  }
}

export async function getSpotifyRecentlyPlayed(
  accessToken: string,
  limit = 20,
): Promise<SpotifyTrackSummary[]> {
  await ensureSpotifyUserAccessToken(accessToken, "recently_played");
  const json = await spotifyGetJson<{ items: any[] }>(
    accessToken,
    `/me/player/recently-played?limit=${limit}`,
  );
  const tracks: SpotifyTrackSummary[] = (json.items ?? []).map(row => {
    const item = row?.track;
    return {
      id: String(item?.id ?? ""),
      name: String(item?.name ?? ""),
      uri: String(item?.uri ?? ""),
      preview_url: item?.preview_url ?? null,
      duration_ms: Number(item?.duration_ms ?? 0),
      artists: Array.isArray(item?.artists)
        ? item.artists.map((a: any) => ({ id: String(a?.id ?? ""), name: String(a?.name ?? "") }))
        : [],
      album: {
        id: String(item?.album?.id ?? ""),
        name: String(item?.album?.name ?? ""),
        release_date: String(item?.album?.release_date ?? ""),
        images: Array.isArray(item?.album?.images)
          ? item.album.images.map((img: any) => ({ url: String(img?.url ?? "") }))
          : [],
      },
    };
  });
  if (!SPOTIFY_ENABLE_METADATA_ENRICH) {
    return tracks.map(track => ({
      ...track,
      tempo: 0,
      is_saved: false,
      genres: [],
    }));
  }
  const [tempoMap, savedMap, artistGenreMap] = await Promise.all([
    getSpotifyTempoMap(
      accessToken,
      tracks.map(t => t.id),
    ),
    getSpotifySavedMap(
      accessToken,
      tracks.map(t => t.id),
    ),
    getSpotifyArtistGenresMap(
      accessToken,
      tracks.flatMap(t => t.artists.map((a: { id: string }) => a.id)),
    ),
  ]);
  return tracks.map(track => ({
    ...track,
    tempo: tempoMap[track.id] ?? 0,
    is_saved: savedMap[track.id] ?? false,
    genres: Array.from(
      new Set(
        track.artists.flatMap((a: { id: string }) =>
          (artistGenreMap[a.id] ?? []).map(g => String(g)),
        ),
      ),
    ).slice(0, 3),
  }));
}

export async function bootstrapSpotifyData(
  accessToken: string,
): Promise<SpotifyBootstrapData> {
  const settled = await Promise.allSettled([
    getSpotifyTopTracks(accessToken, 20),
    getSpotifyTopArtists(accessToken, 20),
    Promise.resolve([] as SpotifyPlaylistSummary[]),
    getSpotifyRecentlyPlayed(accessToken, 20),
  ]);
  const topTracks = toOptionalArrayResult(settled[0], "topTracks", []);
  const topArtists = toOptionalArrayResult(settled[1], "topArtists", []);
  const playlists = toOptionalArrayResult(settled[2], "playlists", []);
  const recentlyPlayed = toOptionalArrayResult(settled[3], "recentlyPlayed", []);
  return { topTracks, topArtists, playlists, recentlyPlayed };
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const SEARCH_STOPWORDS = new Set([
  "플레이리스트",
  "플리",
  "노래",
  "음악",
  "추천",
  "원해",
  "원합니다",
  "해주세요",
  "해줘",
  "해줘요",
  "부탁해",
  "추가",
  "요청",
  "전체",
  "분위기",
  "구성",
  "그리고",
  "또는",
  "위주",
  "중심",
  "으로",
  "있는",
  "하게",
  "좋은",
  "신나는",
  "잔잔한",
  "차분한",
  "집중",
  "공부",
  "작업",
  "업무",
  "운동",
  "드라이브",
  "카페",
  "무드",
  "상황",
  "핵심",
  "제외",
  "시간",
  "이상",
  "이내",
  "내외",
]);

function normalizeSearchText(raw: string): string {
  return String(raw ?? "")
    .replace(/추가\s*요청\s*[:：]/gi, " ")
    .replace(/[^0-9A-Za-z가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasStructuredSearchTag(query: string): boolean {
  return /\b(genre|artist|track)\s*:/.test(String(query ?? "").toLowerCase());
}

function normalizeTagQuery(query: string): string {
  return String(query ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

function queryEquivalenceKey(query: string): string {
  const q = String(query ?? "").trim();
  if (!q) return "";
  if (hasStructuredSearchTag(q)) return `tag:${normalizeTagQuery(q).toLowerCase()}`;
  const compacted = compactQuery(q);
  return `plain:${normalizeSearchText(compacted).toLowerCase()}`;
}

function buildQueryCandidates(rawQuery: string, fastMode: boolean): string[] {
  const raw = String(rawQuery ?? "").trim();
  if (!raw) return [];
  const compacted = compactQuery(raw);
  const shortPair = trimQueryTokens(compacted, 2);
  const base = fastMode
    ? [raw, compacted, shortPair]
    : [raw, compacted, trimQueryTokens(raw, 6), shortPair];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of base) {
    const c = String(candidate ?? "").trim();
    if (!c) continue;
    const key = queryEquivalenceKey(c);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function trimQueryTokens(query: string, maxTokens = 6): string {
  const tokens = query.split(" ").filter(Boolean).slice(0, maxTokens);
  return tokens.join(" ").slice(0, 64).trim();
}

function extractQueryHintKeywords(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return Array.from(
    new Set(
      normalized
        .split(" ")
        .map(v => v.trim())
        .filter(v => v.length >= 2 && !SEARCH_STOPWORDS.has(v)),
    ),
  ).slice(0, 4);
}

function buildSearchQueries(moodInput: string): string[] {
  if (hasStructuredSearchTag(moodInput)) {
    const raw = normalizeTagQuery(moodInput);
    const tagFree = extractTagFreeSearchQuery(raw);
    return Array.from(new Set([raw, tagFree].filter(v => String(v ?? "").length >= 2))).slice(0, 8);
  }
  const normalized = normalizeSearchText(moodInput);
  if (!normalized) return [];

  const clauses = normalized
    .split(/\n+|[.!?]| 그리고 |,|\/|\|/g)
    .map(v => compactQuery(v.trim()))
    .filter(v => v.length >= 2);

  const tokens = normalized
    .split(" ")
    .map(v => v.trim())
    .filter(v => v.length >= 2 && !SEARCH_STOPWORDS.has(v));

  const twoGrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    twoGrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }

  return Array.from(
    new Set(
      [...clauses, ...twoGrams, trimQueryTokens(tokens.join(" "), 5)]
        .map(v => trimQueryTokens(v, 6))
        .filter(v => v.length >= 2),
    ),
  ).slice(0, 8);
}

function buildUserAffinityQueries(
  bootstrap: SpotifyBootstrapData | null,
): string[] {
  if (!bootstrap) return [];
  const artistNames = (bootstrap.topArtists ?? [])
    .map(a => String(a?.name ?? "").trim())
    .filter(v => v.length >= 2)
    .slice(0, 4);
  const genreNames = Array.from(
    new Set(
      (bootstrap.topArtists ?? [])
        .flatMap(a => a.genres ?? [])
        .map(v => String(v ?? "").trim())
        .filter(v => v.length >= 2),
    ),
  ).slice(0, 4);
  const topTrackArtistNames = Array.from(
    new Set(
      (bootstrap.topTracks ?? [])
        .flatMap(t => t.artists ?? [])
        .map(a => String(a?.name ?? "").trim())
        .filter(v => v.length >= 2),
    ),
  ).slice(0, 3);

  return Array.from(
    new Set([
      ...artistNames,
      ...topTrackArtistNames,
      ...genreNames.map(g => `${g} mood`),
    ]),
  )
    .map(v => trimQueryTokens(normalizeSearchText(v), 4))
    .filter(Boolean)
    .slice(0, 6);
}

function compactQuery(query: string): string {
  if (hasStructuredSearchTag(query)) return normalizeTagQuery(query);
  const normalized = normalizeSearchText(query);
  const tokens = normalized
    .split(" ")
    .map(v => v.trim())
    .filter(v => v.length >= 2 && !SEARCH_STOPWORDS.has(v));
  if (!tokens.length) return trimQueryTokens(normalized, 3);
  return trimQueryTokens(tokens.join(" "), 5);
}

function extractTagFreeSearchQuery(query: string): string {
  const q = String(query ?? "").trim();
  if (!q) return "";
  const withoutTag = q
    .replace(/\b(genre|artist|track)\s*:\s*"[^\"]*"/gi, " ")
    .replace(/\b(genre|artist|track)\s*:\s*[^\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const retry = buildRetrySearchQuery(withoutTag || q);
  if (retry) return retry;
  return trimQueryTokens(normalizeSearchText(withoutTag || q), 4);
}

function buildRetrySearchQuery(rawQuery: string): string {
  const aliasMap: Array<[RegExp, string]> = [
    [/\bk[\s-]?pop\b|케이팝|케이 팝|k pop/i, "kpop"],
    [/멜로디\s*힙합|melodic\s*hip[\s-]?hop/i, "melodic hip hop"],
    [/\bhip[\s-]?hop\b|힙합|랩/i, "hip hop"],
    [/발라드|ballad/i, "korean ballad"],
    [/\br[\s&-]?n[\s&-]?b\b|알앤비/i, "korean rnb"],
    [/인디|indie/i, "korean indie"],
    [/\bedm\b|일렉|electronic/i, "edm"],
    [/신나|업템포|에너지|파티/i, "upbeat"],
    [/차분|잔잔|편안|힐링/i, "chill"],
  ];
  const normalized = normalizeSearchText(rawQuery);
  const aliases = aliasMap
    .filter(([re]) => re.test(normalized))
    .map(([, value]) => value);
  const tokenFallback = normalized
    .split(" ")
    .map(v => v.trim())
    .filter(v => v.length >= 2 && !SEARCH_STOPWORDS.has(v))
    .filter(v => !/^(추가|요청|준비|준비하면서|기분|좋게|약속|듣기|재생)$/.test(v))
    .slice(0, 2);
  const merged = Array.from(new Set([...aliases, ...tokenFallback]));
  return trimQueryTokens(merged.join(" "), 4);
}

function sanitizeSearchQueryForSpotify(rawQuery: string): string {
  const normalized = normalizeSearchText(rawQuery);
  if (!normalized) return "";
  const aliases = buildRetrySearchQuery(normalized);
  if (aliases) return aliases;
  const fallback = normalized
    .split(" ")
    .map(v => v.trim())
    .filter(v => v.length >= 2 && !SEARCH_STOPWORDS.has(v))
    .slice(0, 3)
    .join(" ");
  return trimQueryTokens(fallback, 3);
}

function trackKey(summary: SpotifyTrackSummary): string {
  const id = String(summary?.id ?? "").trim();
  if (id) return `id:${id}`;
  const uri = String(summary?.uri ?? "").trim();
  if (uri) return `uri:${uri}`;
  const name = String(summary?.name ?? "")
    .toLowerCase()
    .replace(/\b(remaster(ed)?|live|version|edit|mono|stereo)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const artists = (summary?.artists ?? [])
    .map(a => String(a?.name ?? "").toLowerCase().trim())
    .filter(Boolean)
    .join(",");
  return `na:${name}|${artists}`;
}

function mapTrackItemToSummary(item: any): SpotifyTrackSummary {
  return {
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    uri: String(item?.uri ?? ""),
    preview_url: item?.preview_url ?? null,
    duration_ms: Number(item?.duration_ms ?? 0),
    artists: Array.isArray(item?.artists)
      ? item.artists.map((a: any) => ({
          id: String(a?.id ?? ""),
          name: String(a?.name ?? ""),
        }))
      : [],
    album: {
      id: String(item?.album?.id ?? ""),
      name: String(item?.album?.name ?? ""),
      release_date: String(item?.album?.release_date ?? ""),
      images: Array.isArray(item?.album?.images)
        ? item.album.images.map((img: any) => ({ url: String(img?.url ?? "") }))
        : [],
    },
  };
}

async function searchPlaylistTracksByQuery(args: {
  accessToken: string;
  query: string;
  deadlineAt: number;
  targetCount?: number;
}): Promise<SpotifyTrackSummary[]> {
  const q = String(args.query ?? "").trim();
  if (!q) return [];
  const remainingMs = Math.max(0, args.deadlineAt - Date.now());
  if (remainingMs <= 1400) return [];
  const timeoutMs = Math.max(2200, Math.min(6500, remainingMs - 120));
  const targetCount = clamp(args.targetCount ?? 18, 6, 30);
  try {
    const searchParams = new URLSearchParams();
    searchParams.set("type", "playlist");
    searchParams.set("limit", "3");
    searchParams.set("market", "from_token");
    searchParams.set("q", q);
    const playlistJson = await spotifyGetJson<{ playlists?: { items?: any[] } }>(
      args.accessToken,
      `/search?${searchParams.toString()}`,
      timeoutMs,
    );
    const playlists = (playlistJson?.playlists?.items ?? [])
      .map(p => String(p?.id ?? "").trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!playlists.length) return [];
    const out: SpotifyTrackSummary[] = [];
    for (const playlistId of playlists) {
      if (Date.now() >= args.deadlineAt) break;
      const remain = Math.max(0, args.deadlineAt - Date.now());
      if (remain <= 1300) break;
      const trackTimeout = Math.max(2000, Math.min(5000, remain - 120));
      const trackParams = new URLSearchParams();
      trackParams.set("limit", "18");
      trackParams.set("market", "from_token");
      const tracksJson = await spotifyGetJson<{ items?: any[] }>(
        args.accessToken,
        `/playlists/${encodeURIComponent(playlistId)}/tracks?${trackParams.toString()}`,
        trackTimeout,
      );
      const items = tracksJson?.items ?? [];
      for (const row of items) {
        const track = row?.track;
        if (!track?.id) continue;
        out.push(mapTrackItemToSummary(track));
        if (out.length >= targetCount) break;
      }
      if (out.length >= targetCount) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function discoverSpotifyTracks(args: {
  accessToken: string;
  moodInput: string;
  bootstrap: SpotifyBootstrapData | null;
  limit?: number;
  seedTrackIds?: string[];
  seedArtistIds?: string[];
  enrichMetadata?: boolean;
  fastMode?: boolean;
  maxSearchQueries?: number;
  includeAffinityQueries?: boolean;
  maxDurationMs?: number;
}): Promise<SpotifyTrackSummary[]> {
  const {
    accessToken,
    moodInput,
    bootstrap,
    limit = 80,
    seedTrackIds = [],
    seedArtistIds = [],
    enrichMetadata = false,
    fastMode = true,
    maxSearchQueries = 4,
    includeAffinityQueries = true,
    maxDurationMs,
  } = args;
  const startedAt = Date.now();
  const deadlineAt =
    Number.isFinite(maxDurationMs) && Number(maxDurationMs) > 0
      ? startedAt + Math.max(2500, Number(maxDurationMs))
      : Number.POSITIVE_INFINITY;
  const isDeadlineReached = () => Date.now() >= deadlineAt;
  const moodQueries = buildSearchQueries(moodInput);
  const affinityQueries = includeAffinityQueries
    ? buildUserAffinityQueries(bootstrap)
    : [];
  const affinityCap =
    moodQueries.length >= 5 ? 2 : moodQueries.length >= 3 ? 3 : 5;
  const requestedFastMax = Math.max(1, Math.min(2, Math.floor(maxSearchQueries)));
  const effectiveFastMax =
    moodQueries.length >= 2 ? Math.max(2, requestedFastMax) : requestedFastMax;
  const searchQueries = Array.from(
    new Set([...moodQueries, ...affinityQueries.slice(0, affinityCap)]),
  ).slice(
    0,
    fastMode
      ? effectiveFastMax
      : Math.max(2, Math.min(12, Math.floor(maxSearchQueries))),
  );

  const collected: SpotifyTrackSummary[] = [];
  const searchLimitCandidates = fastMode ? [18] : [20, 10];
  const searchRequestTimeoutMs = fastMode ? 7000 : 12000;
  const internalDeadlineAt = fastMode
    ? Date.now() + Math.max(4500, Math.min(8500, Math.max(1, maxSearchQueries) * 3200))
    : Number.POSITIVE_INFINITY;
  let compactedSkipCount = 0;
  let compactedSkipLogged = 0;
  let attemptedTrackSearchCalls = 0;
  let playlistFallbackCalls = 0;
  let authFailureDetected = false;
  for (const rawQuery of searchQueries) {
    if (authFailureDetected) break;
    if (Date.now() >= internalDeadlineAt || isDeadlineReached()) break;
    const queryHintKeywords = extractQueryHintKeywords(rawQuery);
    const queryCandidates = buildQueryCandidates(rawQuery, fastMode);
    let rawQueryCollected = 0;
    for (const q of queryCandidates) {
      if (authFailureDetected) break;
      if (Date.now() >= internalDeadlineAt || isDeadlineReached()) break;
      for (const rawLimit of searchLimitCandidates) {
        if (authFailureDetected) break;
        if (Date.now() >= internalDeadlineAt || isDeadlineReached()) break;
        const safeLimit = clamp(rawLimit, 1, 50);
        const params = new URLSearchParams();
        params.set("type", "track");
        params.set("limit", String(safeLimit));
        params.set("market", "from_token");
        params.set("q", q);
        try {
          attemptedTrackSearchCalls += 1;
          const remainingMs = Math.max(0, deadlineAt - Date.now());
          if (remainingMs <= 1200) break;
          const requestTimeoutMs = Math.max(
            2500,
            Math.min(searchRequestTimeoutMs, remainingMs - 120),
          );
          const json = await spotifyGetJson<{ tracks?: { items?: any[] } }>(
            accessToken,
            `/search?${params.toString()}`,
            requestTimeoutMs,
          );
          const items = json?.tracks?.items ?? [];
          collected.push(
            ...items.map(item => {
              const mapped = mapTrackItemToSummary(item);
              if (!queryHintKeywords.length) return mapped;
              return {
                ...mapped,
                genres: Array.from(
                  new Set([
                    ...(Array.isArray(mapped.genres) ? mapped.genres : []),
                    ...queryHintKeywords,
                  ]),
                ).slice(0, 5),
              };
            }),
          );
          rawQueryCollected += items.length;
          if (rawQueryCollected >= (fastMode ? 10 : 22)) break;
        } catch (err) {
          const msg = String((err as Error)?.message ?? err);
          if (isSpotifyAuthErrorMessage(msg)) {
            authFailureDetected = true;
            markSpotifyAuthFailure(accessToken, "discover-search");
            break;
          }
          if (msg.includes("Invalid limit")) continue;
          if (msg.includes("(400)")) {
            const safeQ = sanitizeSearchQueryForSpotify(q);
            if (safeQ && safeQ !== q) {
              try {
                const retryParams = new URLSearchParams();
                retryParams.set("type", "track");
                retryParams.set("limit", String(safeLimit));
                retryParams.set("market", "from_token");
                retryParams.set("q", safeQ);
                const remainingMs = Math.max(0, deadlineAt - Date.now());
                if (remainingMs > 1200) {
                  const retryTimeoutMs = Math.max(
                    2500,
                    Math.min(searchRequestTimeoutMs, remainingMs - 120),
                  );
                  const retryJson = await spotifyGetJson<{ tracks?: { items?: any[] } }>(
                    accessToken,
                    `/search?${retryParams.toString()}`,
                    retryTimeoutMs,
                  );
                  const retryItems = retryJson?.tracks?.items ?? [];
                  collected.push(...retryItems.map(mapTrackItemToSummary));
                  rawQueryCollected += retryItems.length;
                  if (retryItems.length) continue;
                }
              } catch (retryErr) {
                if (isSpotifyAuthErrorMessage(retryErr)) {
                  authFailureDetected = true;
                  markSpotifyAuthFailure(accessToken, "discover-search-retry");
                }
              }
            }
            console.warn(`[Spotify] track search 400. raw="${q}" sanitized="${safeQ || "-"}"`);
            break;
          }
          console.warn(`[Spotify] track search failed: ${errorMessage(err)}`);
          break;
        }
      }
      if (rawQueryCollected >= (fastMode ? 10 : 22)) break;
    }
    if (rawQueryCollected === 0) {
      const retryQuery = buildRetrySearchQuery(rawQuery);
      if (retryQuery) {
        try {
          const params = new URLSearchParams();
          params.set("type", "track");
          params.set("limit", "12");
          params.set("market", "from_token");
          params.set("q", retryQuery);
          const remainingMs = Math.max(0, deadlineAt - Date.now());
          if (remainingMs > 1400) {
            const requestTimeoutMs = Math.max(
              2500,
              Math.min(searchRequestTimeoutMs, remainingMs - 120),
            );
            const json = await spotifyGetJson<{ tracks?: { items?: any[] } }>(
              accessToken,
              `/search?${params.toString()}`,
              requestTimeoutMs,
            );
            const items = json?.tracks?.items ?? [];
            if (items.length) {
              collected.push(...items.map(mapTrackItemToSummary));
              rawQueryCollected += items.length;
            }
          }
        } catch {
          // noop
        }
      }
      if (rawQueryCollected === 0) {
        const tagFree = extractTagFreeSearchQuery(rawQuery);
        if (tagFree && tagFree !== retryQuery) {
          try {
            const params = new URLSearchParams();
            params.set("type", "track");
            params.set("limit", "12");
            params.set("market", "from_token");
            params.set("q", tagFree);
            const remainingMs = Math.max(0, deadlineAt - Date.now());
            if (remainingMs > 1400) {
              const requestTimeoutMs = Math.max(
                2500,
                Math.min(searchRequestTimeoutMs, remainingMs - 120),
              );
              const json = await spotifyGetJson<{ tracks?: { items?: any[] } }>(
                accessToken,
                `/search?${params.toString()}`,
                requestTimeoutMs,
              );
              const items = json?.tracks?.items ?? [];
              if (items.length) {
                collected.push(...items.map(mapTrackItemToSummary));
                rawQueryCollected += items.length;
              }
            }
          } catch {
            // noop
          }
        }
      }
      if (rawQueryCollected === 0) {
        const playlistFallback = await searchPlaylistTracksByQuery({
          accessToken,
          query: rawQuery,
          deadlineAt,
          targetCount: fastMode ? 12 : 18,
        });
        if (playlistFallback.length) {
          playlistFallbackCalls += 1;
          console.warn(`[Spotify] playlist fallback used size=${playlistFallback.length}`);
          collected.push(...playlistFallback);
          rawQueryCollected += playlistFallback.length;
        }
      }
      if (rawQueryCollected === 0) {
        const sample = compactQuery(rawQuery);
        if (sample && !hasStructuredSearchTag(rawQuery)) {
          compactedSkipCount += 1;
          if (compactedSkipLogged < 2) {
            compactedSkipLogged += 1;
            console.warn("[Spotify] no results after compacted query attempts.");
          }
        }
      }
    }
  }
  if (compactedSkipCount > 2) {
    console.warn(`[Spotify] no results after compacted query attempts x${compactedSkipCount}`);
  }
  if (fastMode) {
    console.warn(
      `[Spotify] fast search stats queries=${searchQueries.length} attempts=${attemptedTrackSearchCalls} compactedNoResult=${compactedSkipCount} playlistFallback=${playlistFallbackCalls} collected=${collected.length}`,
    );
  }

  try {
    if (fastMode) {
      // fastMode에서는 search 결과 우선으로 빠르게 반환한다.
      throw new Error("skip_recommendations_in_fast_mode");
    }
    const seedTracks = (
      seedTrackIds.length
        ? seedTrackIds
        : (bootstrap?.topTracks ?? []).map(t => t.id)
    )
      .filter(Boolean)
      .slice(0, 3);
    const seedArtists = (
      seedArtistIds.length
        ? seedArtistIds
        : (bootstrap?.topArtists ?? []).map(a => a.id)
    )
      .filter(Boolean)
      .slice(0, 2);
    const params = new URLSearchParams();
    params.set("limit", "20");
    if (seedTracks.length) params.set("seed_tracks", seedTracks.join(","));
    if (seedArtists.length) params.set("seed_artists", seedArtists.join(","));
    // 일부 앱/계정 환경에서 recommendations 엔드포인트가 404를 반환할 수 있어
    // 전체 생성 흐름은 유지하고 선택적으로만 사용한다.
    if (canUseRecommendationsApi && (seedTracks.length || seedArtists.length)) {
      const endpoint = `/recommendations?${params.toString()}`;
      const json = await spotifyGetJson<{ tracks?: any[] }>(accessToken, endpoint);
      collected.push(...(json.tracks ?? []).map(mapTrackItemToSummary));
    }
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("skip_recommendations_in_fast_mode")) {
      // noop
    } else
    if (msg.includes("(404)") || msg.includes("/recommendations?")) {
      console.warn("[Spotify] recommendations unavailable in current app mode.");
      canUseRecommendationsApi = false;
    } else {
      console.warn(`[Spotify] recommendations failed: ${errorMessage(err)}`);
    }
  }

  const dedup = new Map<string, SpotifyTrackSummary>();
  shuffle(collected).forEach(t => {
    const key = trackKey(t);
    if (!key || key === "na:|") return;
    if (!dedup.has(key)) dedup.set(key, t);
  });
  const base = Array.from(dedup.values()).slice(0, Math.max(20, limit));

  if (!enrichMetadata) {
    return shuffle(
      base.map(track => ({
        ...track,
        tempo: Number(track.tempo ?? 0) || 0,
        is_saved: Boolean(track.is_saved),
        genres: Array.isArray(track.genres) ? track.genres.slice(0, 3) : [],
      })),
    ).slice(0, limit);
  }

  const [tempoMap, savedMap, artistGenreMap] = await Promise.all([
    getSpotifyTempoMap(
      accessToken,
      base.map(t => t.id),
    ),
    getSpotifySavedMap(
      accessToken,
      base.map(t => t.id),
    ),
    getSpotifyArtistGenresMap(
      accessToken,
      base.flatMap(t => t.artists.map((a: { id: string }) => a.id)),
    ),
  ]);

  return shuffle(
    base.map(track => ({
      ...track,
      tempo: tempoMap[track.id] ?? 0,
      is_saved: savedMap[track.id] ?? false,
      genres: Array.from(
        new Set(
          track.artists.flatMap((a: { id: string }) =>
            (artistGenreMap[a.id] ?? []).map(g => String(g)),
          ),
        ),
      ).slice(0, 3),
    })),
  ).slice(0, limit);
}

export async function searchSpotifyTracksByQueries(args: {
  accessToken: string;
  queries: string[];
  perQueryLimit?: number;
  maxDurationMs?: number;
  concurrency?: number;
  randomSeed?: number;
  requestId?: string;
  abortSignal?: AbortSignal;
  onQueryDone?: (event: {
    requestId?: string;
    query: string;
    done: number;
    total: number;
    queryIndex: number;
    added: number;
    totalCollected: number;
  }) => void;
  onTracks?: (event: {
    requestId?: string;
    query: string;
    queryIndex: number;
    queryTotal: number;
    tracks: SpotifyTrackSummary[];
    totalCollected: number;
  }) => void;
  shouldStop?: (event: {
    requestId?: string;
    done: number;
    total: number;
    totalCollected: number;
    lastQuery: string;
  }) => boolean;
}): Promise<SpotifyTrackSummary[]> {
  const isAborted = () => Boolean(args.abortSignal?.aborted);
  if (isAborted()) return [];
  await ensureSpotifyUserAccessToken(args.accessToken, "search_tracks");
  const normalizeDirectSearchText = (raw: string): string =>
    String(raw ?? "")
      .replace(/[^0-9A-Za-z가-힣\s:"'&-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const startedAt = Date.now();
  const deadlineAt =
    Number.isFinite(args.maxDurationMs) && Number(args.maxDurationMs) > 0
      ? startedAt + Math.max(2000, Number(args.maxDurationMs))
      : Number.POSITIVE_INFINITY;
  const perQueryLimit = clamp(args.perQueryLimit ?? 30, 5, 50);
  const searchCooldownMs = getSearchCooldownMs();
  const isSearchLimitedMode = searchCooldownMs > 0;
  const effectivePerQueryLimit = isSearchLimitedMode
    ? clamp(Math.min(perQueryLimit, 12), 5, 12)
    : perQueryLimit;
  const dedup = new Map<string, SpotifyTrackSummary>();
  let authFailureDetected = shouldSkipSpotifyByAuthFailure(args.accessToken);
  const normalizedQueries = Array.from(
    new Set(
      (args.queries ?? [])
        .map(q => normalizeDirectSearchText(String(q ?? "").toLowerCase().trim()))
        .map(q => String(q ?? "").slice(0, 64).trim())
        .filter(q => q.length >= 2),
    ),
  );
  const runnableQueries = normalizedQueries.slice(0, Math.max(4, normalizedQueries.length));
  const runnableLimited = runnableQueries.slice(0, Math.max(4, runnableQueries.length));
  console.warn("[SpotifySearchInternal] inputQueries=", args.queries ?? []);
  console.warn("[SpotifySearchInternal] normalizedQueries=", normalizedQueries);
  console.warn("[SpotifySearchInternal] runnableQueries=", runnableLimited);
  console.warn("[SpotifySearchInternal] finalBatchCount=", runnableLimited.length);
  if (isSearchLimitedMode) {
    console.warn(
      `[SpotifyDiag] search limited mode cooldownMs=${searchCooldownMs} strike=${spotifySearchRateLimitStrike}`,
    );
  }
  const budgetMs = Number.isFinite(args.maxDurationMs) && Number(args.maxDurationMs) > 0
    ? Number(args.maxDurationMs)
    : 9000;
  const requestedConcurrency = clamp(args.concurrency ?? 6, 2, 6);
  const dynamicConcurrencyBase = Math.max(
    2,
    Math.min(
      requestedConcurrency,
      runnableLimited.length >= 6 ? 4 : requestedConcurrency,
      budgetMs <= 4500 ? 4 : requestedConcurrency,
      budgetMs <= 3200 ? 3 : requestedConcurrency,
    ),
  );
  const dynamicConcurrency = isSearchLimitedMode ? 1 : dynamicConcurrencyBase;
  const maxQueryCount = runnableLimited.length;
  const dynamicQueryCount = isSearchLimitedMode
    ? Math.max(1, Math.min(2, maxQueryCount))
    : Math.max(
        4,
        Math.min(
          maxQueryCount,
          runnableLimited.length,
        ),
      );
  const parallelQueries = runnableLimited.slice(0, dynamicQueryCount);
  let completedQueryCount = 0;
  let totalCollected = 0;
  let rateLimitedFailures = 0;
  const totalQueryCount = parallelQueries.length;
  const mergeTracks = (tracks: SpotifyTrackSummary[]): SpotifyTrackSummary[] => {
    const added: SpotifyTrackSummary[] = [];
    for (const mapped of tracks) {
      const key = trackKey(mapped);
      if (!key || dedup.has(key)) continue;
      dedup.set(key, mapped);
      added.push(mapped);
    }
    return added;
  };
  const notifyQueryDone = (query: string, queryIndex: number, addedCount: number) => {
    completedQueryCount += 1;
    totalCollected = dedup.size;
    args.onQueryDone?.({
      requestId: args.requestId,
      query,
      done: completedQueryCount,
      total: totalQueryCount,
      queryIndex,
      added: addedCount,
      totalCollected,
    });
  };

  const runSingleQuery = async (q: string, queryIdx: number): Promise<number> => {
    const out: SpotifyTrackSummary[] = [];
    let queryAdded = 0;
    const emitFoundNow = (tracks: SpotifyTrackSummary[]) => {
      if (!tracks.length) return;
      const added = mergeTracks(tracks);
      if (added.length) {
        queryAdded += added.length;
      }
      console.warn("[SEARCH onTracks emit]", {
        requestId: args.requestId,
        query: q,
        count: tracks.length,
      });
      args.onTracks?.({
        requestId: args.requestId,
        query: q,
        queryIndex: queryIdx,
        queryTotal: totalQueryCount,
        tracks,
        totalCollected: dedup.size + tracks.length,
      });
    };
    const offset = 0;
    try {
      if (isAborted()) return queryAdded;
      if (authFailureDetected) return queryAdded;
      if (Date.now() >= deadlineAt) return queryAdded;
      const params = new URLSearchParams();
      params.set("type", "track");
      params.set("limit", String(effectivePerQueryLimit));
      params.set("market", "from_token");
      params.set("q", q);
      params.set("offset", String(offset));
      const remainingMs = Math.max(0, deadlineAt - Date.now());
      if (remainingMs <= 800) return queryAdded;
      const timeoutMs = Math.max(2200, Math.min(9000, remainingMs - 120));
      const json = await spotifyGetJson<{ tracks?: { items?: any[] } }>(
        args.accessToken,
        `/search?${params.toString()}`,
        timeoutMs,
      );
      if (isAborted()) return queryAdded;
      const items = json?.tracks?.items ?? [];
      const mappedItems = items.map(mapTrackItemToSummary);
      out.push(...mappedItems);
      emitFoundNow(mappedItems);
      console.warn("[SpotifySearchInternal] queryDone=", q, "found=", mappedItems.length);
      if (!items.length) {
        const fallbackQuery = extractTagFreeSearchQuery(q);
        if (fallbackQuery && fallbackQuery !== q && Date.now() < deadlineAt) {
          try {
            const retry = new URLSearchParams();
            retry.set("type", "track");
            retry.set("limit", String(effectivePerQueryLimit));
            retry.set("market", "from_token");
            retry.set("q", fallbackQuery);
            retry.set("offset", String(Math.max(0, offset - perQueryLimit)));
            const remain = Math.max(0, deadlineAt - Date.now());
            if (remain > 800) {
              const fallbackTimeoutMs = Math.max(2200, Math.min(8500, remain - 120));
              const retryJson = await spotifyGetJson<{ tracks?: { items?: any[] } }>(
                args.accessToken,
                `/search?${retry.toString()}`,
                fallbackTimeoutMs,
              );
              if (isAborted()) return queryAdded;
              const retryItems = retryJson?.tracks?.items ?? [];
              const mappedRetryItems = retryItems.map(mapTrackItemToSummary);
              out.push(...mappedRetryItems);
              emitFoundNow(mappedRetryItems);
              console.warn("[SpotifySearchInternal] queryDone(tagFree)=", fallbackQuery, "found=", mappedRetryItems.length);
            }
          } catch (retryErr) {
            if (isSpotifyAuthErrorMessage(retryErr)) {
              authFailureDetected = true;
              markSpotifyAuthFailure(args.accessToken, "direct-query-tag-free-retry");
            }
          }
        }
        if (!out.length && Date.now() < deadlineAt) {
          const broadFallbackQuery = String(q).replace(/\bkorean\s+/i, "").trim();
          if (broadFallbackQuery && broadFallbackQuery !== q) {
            try {
              const broad = new URLSearchParams();
              broad.set("type", "track");
              broad.set("limit", String(effectivePerQueryLimit));
              broad.set("market", "from_token");
              broad.set("q", broadFallbackQuery);
              broad.set("offset", "0");
              const remain = Math.max(0, deadlineAt - Date.now());
              if (remain > 800) {
                const broadTimeoutMs = Math.max(2200, Math.min(8000, remain - 120));
                const broadJson = await spotifyGetJson<{ tracks?: { items?: any[] } }>(
                  args.accessToken,
                  `/search?${broad.toString()}`,
                  broadTimeoutMs,
                );
                if (isAborted()) return queryAdded;
                const broadItems = broadJson?.tracks?.items ?? [];
                const mappedBroadItems = broadItems.map(mapTrackItemToSummary);
                out.push(...mappedBroadItems);
                emitFoundNow(mappedBroadItems);
                console.warn("[SpotifySearchInternal] queryDone(broadFallback)=", broadFallbackQuery, "found=", mappedBroadItems.length);
              }
            } catch (broadErr) {
              if (isSpotifyAuthErrorMessage(broadErr)) {
                authFailureDetected = true;
                markSpotifyAuthFailure(args.accessToken, "direct-query-broad-fallback");
              }
            }
          }
        }
        if (!out.length && Date.now() < deadlineAt) {
          const playlistFallback = await searchPlaylistTracksByQuery({
            accessToken: args.accessToken,
            query: q,
            deadlineAt,
            targetCount: effectivePerQueryLimit,
          });
          if (isAborted()) return queryAdded;
          if (playlistFallback.length) {
            console.warn(
              `[Spotify] direct playlist fallback used size=${playlistFallback.length}`,
            );
          }
          out.push(...playlistFallback);
          emitFoundNow(playlistFallback);
          console.warn("[SpotifySearchInternal] queryDone(playlistFallback)=", q, "found=", playlistFallback.length);
        }
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (isSpotifyAuthErrorMessage(msg)) {
        authFailureDetected = true;
        markSpotifyAuthFailure(args.accessToken, "direct-query");
        return queryAdded;
      }
      if (msg.includes("(400)")) {
        const safeQ = sanitizeSearchQueryForSpotify(q);
        if (safeQ && safeQ !== q) {
          try {
            const retry = new URLSearchParams();
            retry.set("type", "track");
            retry.set("limit", String(effectivePerQueryLimit));
            retry.set("market", "from_token");
            retry.set("q", safeQ);
            retry.set("offset", String(offset));
            const remainingMs = Math.max(0, deadlineAt - Date.now());
            if (remainingMs > 800) {
              const timeoutMs = Math.max(2200, Math.min(8500, remainingMs - 120));
              const retryJson = await spotifyGetJson<{ tracks?: { items?: any[] } }>(
                args.accessToken,
                `/search?${retry.toString()}`,
                timeoutMs,
              );
              if (isAborted()) return queryAdded;
              const retryItems = retryJson?.tracks?.items ?? [];
              const mappedRetryItems = retryItems.map(mapTrackItemToSummary);
              out.push(...mappedRetryItems);
              emitFoundNow(mappedRetryItems);
              console.warn("[SpotifySearchInternal] queryDone(sanitized)=", safeQ, "found=", mappedRetryItems.length);
            }
          } catch (retryErr) {
            if (isSpotifyAuthErrorMessage(retryErr)) {
              authFailureDetected = true;
              markSpotifyAuthFailure(args.accessToken, "direct-query-retry");
            }
          }
        }
      } else if (msg.includes("(429)")) {
        rateLimitedFailures += 1;
      } else if (!authFailureDetected) {
        console.warn(`[Spotify] direct query search failed q=${q}: ${errorMessage(err)}`);
      }
    } finally {
      console.warn("[SpotifySearchInternal] queryDone(final)=", q, "added=", queryAdded);
    }
    return queryAdded;
  };

  if (authFailureDetected) {
    markSpotifyAuthFailure(args.accessToken, "direct-query-skip");
    return [];
  }
  console.warn(
    `[Spotify] direct query parallel requestId=${args.requestId || "-"} count=${parallelQueries.length} concurrency=${dynamicConcurrency} budgetMs=${budgetMs}`,
  );
  let cursor = 0;
  let shouldHalt = false;
  const workerCount = Math.max(1, Math.min(dynamicConcurrency, parallelQueries.length || 1));
  const worker = async (): Promise<void> => {
    while (!shouldHalt) {
      if (isAborted()) return;
      if (Date.now() >= deadlineAt) {
        shouldHalt = true;
        return;
      }
      const queryIndex = cursor;
      cursor += 1;
      if (queryIndex >= parallelQueries.length) return;
      const query = parallelQueries[queryIndex] ?? "";
      try {
        const addedCount = await runSingleQuery(query, queryIndex);
        if (isAborted()) return;
        notifyQueryDone(query, queryIndex, addedCount);
      } catch {
        notifyQueryDone(query, queryIndex, 0);
      }
      if (rateLimitedFailures >= Math.max(2, Math.ceil(totalQueryCount * 0.4))) {
        console.warn(
          `[SpotifyDiag] stop on repeated 429 requestId=${args.requestId || "-"} rateLimitedFailures=${rateLimitedFailures} total=${totalQueryCount}`,
        );
        shouldHalt = true;
        return;
      }
      if (
        args.shouldStop?.({
          requestId: args.requestId,
          done: completedQueryCount,
          total: totalQueryCount,
          totalCollected: dedup.size,
          lastQuery: query,
        })
      ) {
        console.warn(
          `[Spotify] direct query early-stop requestId=${args.requestId || "-"} done=${completedQueryCount}/${totalQueryCount} collected=${dedup.size}`,
        );
        shouldHalt = true;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return Array.from(dedup.values());
}

// ── 플레이리스트 저장 ─────────────────────────────────────
export async function savePlaylistToSpotify(
  accessToken: string,
  userId: string,
  name: string,
  trackUris: string[],
  existingPlaylistId?: string | null,
): Promise<SavedPlaylistResult | null> {
  const effectiveUserId = String(userId ?? "").trim();

  const uniqueUris = Array.from(
    new Set(
      trackUris
        .map(v => String(v ?? "").trim())
        .filter(Boolean)
        // Spotify playlist에는 track URI만 추가한다.
        .filter(v => /^spotify:track:[A-Za-z0-9]+$/.test(v)),
    ),
  );
  if (!uniqueUris.length) return null;

  const trimmedExistingPlaylistId = String(existingPlaylistId ?? "").trim();
  const userCacheKey = String(effectiveUserId || userId || "").trim();
  const cachedPlaylistId = userCacheKey
    ? String(lastMoodtunePlaylistIdByUser.get(userCacheKey) ?? "").trim()
    : "";
  if (trimmedExistingPlaylistId) {
    try {
      await replacePlaylistItems(accessToken, trimmedExistingPlaylistId, uniqueUris);
      if (userCacheKey) {
        lastMoodtunePlaylistIdByUser.set(userCacheKey, trimmedExistingPlaylistId);
      }
      return { id: trimmedExistingPlaylistId };
    } catch (err) {
      // 기존 ID가 더 이상 수정 불가(권한/소유 변경 등)하면 신규 생성으로 안전 폴백.
      if (!isForbiddenWriteError(err)) throw err;
      console.warn(
        `[Spotify] existing playlist replace forbidden. fallback to create: ${errorMessage(err)}`,
      );
      if (userCacheKey) {
        lastMoodtunePlaylistIdByUser.delete(userCacheKey);
      }
    }
  }
  if (cachedPlaylistId) {
    try {
      await replacePlaylistItems(accessToken, cachedPlaylistId, uniqueUris);
      return { id: cachedPlaylistId };
    } catch (err) {
      if (isForbiddenWriteError(err) && userCacheKey) {
        // 금지된 playlistId를 캐시에 유지하면 매 저장마다 같은 403이 반복된다.
        lastMoodtunePlaylistIdByUser.delete(userCacheKey);
      }
      console.warn(
        `[Spotify] cached playlist replace failed: ${errorMessage(err)}`,
      );
    }
  }

  const createPayload = {
    name: name.trim() || "Moodtune Playlist",
    public: false,
    description: `Created by Moodtune ${MOODTUNE_PLAYLIST_MARKER}`,
  };
  let created: any;
  try {
    created = await createMoodtunePlaylistWithRetry({
      accessToken,
      name: createPayload.name,
      description: createPayload.description,
      isPublic: createPayload.public,
    });
  } catch (err) {
    const status = (err as SpotifyApiError | undefined)?.status;
    if (status === 403 && createPayload.public === false) {
      try {
        // 일부 토큰/앱 권한 조합에서 private 수정 권한이 누락될 수 있어 public으로 1회 폴백.
        created = await createMoodtunePlaylistWithRetry({
          accessToken,
          name: createPayload.name,
          description: createPayload.description,
          isPublic: true,
        });
      } catch (publicErr) {
        throw new Error(
          `[Spotify] playlist create failed (private/public). ${errorMessage(publicErr)}`,
        );
      }
    } else if (status === 429) {
      try {
        // 생성이 막힐 때만 기존 Moodtune 플레이리스트 재사용을 시도한다.
        const existing = await getMoodtuneCreatedPlaylists(accessToken);
        const latest = existing[0];
        if (latest?.id) {
          await replacePlaylistItems(accessToken, latest.id, uniqueUris);
          if (userCacheKey) {
            lastMoodtunePlaylistIdByUser.set(userCacheKey, latest.id);
          }
          return {
            id: latest.id,
            externalUrl: latest.external_url || undefined,
          };
        }
      } catch (reuseErr) {
        console.warn(
          `[Spotify] existing playlist reuse failed after 429: ${errorMessage(reuseErr)}`,
        );
      }
      throw err;
    } else {
      throw err;
    }
  }

  const playlistId = String(created?.id ?? "");
  const externalUrl = String(created?.external_urls?.spotify ?? "");
  if (!playlistId) {
    throw new Error("[Spotify] playlist create succeeded but id missing");
  }
  if (userCacheKey) {
    lastMoodtunePlaylistIdByUser.set(userCacheKey, playlistId);
  }
  try {
    await replacePlaylistItems(accessToken, playlistId, uniqueUris);
  } catch (err) {
    if (isForbiddenWriteError(err)) {
      try {
        // 새로 생성된 빈 플레이리스트에서는 replace 실패 시 append 전략으로 재시도 가능.
        await appendPlaylistItemsInChunks(accessToken, playlistId, uniqueUris);
      } catch (appendErr) {
        throw new Error(
          `[Spotify] add tracks failed for created playlist (replace+append). 토큰 재로그인 후 다시 시도해 주세요. replace=${errorMessage(
            err,
          )}, append=${errorMessage(appendErr)}`,
        );
      }
    } else {
      throw new Error(
        `[Spotify] add tracks failed for created playlist. 토큰 재로그인 후 다시 시도해 주세요. ${errorMessage(
          err,
        )}`,
      );
    }
  }

  return {
    id: playlistId,
    externalUrl: externalUrl || undefined,
  };
}

export async function removeSpotifyPlaylist(
  accessToken: string,
  playlistId: string,
): Promise<void> {
  await spotifyWriteJson(
    accessToken,
    `/playlists/${encodeURIComponent(playlistId)}/followers`,
    "DELETE",
  );
  invalidateMoodtunePlaylistCache();
}
