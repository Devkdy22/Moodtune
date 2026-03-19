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

const CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? "";
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
      `Spotify token exchange failed (${res.status}): ${JSON.stringify(json)}`,
    );
  }
  const accessToken = String(json?.access_token ?? "");
  const refreshToken = String(json?.refresh_token ?? "");
  const expiresIn = Number(json?.expires_in ?? 0);
  if (!accessToken || !refreshToken || !expiresIn) {
    throw new Error(
      `Spotify token response missing fields: ${JSON.stringify(json)}`,
    );
  }

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
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Spotify refresh failed (${res.status}): ${JSON.stringify(json)}`,
    );
  }
  const accessToken = String(json?.access_token ?? "");
  const expiresIn = Number(json?.expires_in ?? 0);
  if (!accessToken || !expiresIn) {
    throw new Error(
      `Spotify refresh response missing fields: ${JSON.stringify(json)}`,
    );
  }
  // Spotify may omit refresh_token on refresh responses; keep the existing one.
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
    console.error("[Spotify] getSpotifyUser failed:", res.status, json);
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
const lastMoodtunePlaylistIdByUser = new Map<string, string>();

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function spotifyFetch(
  endpoint: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const now = Date.now();
  if (spotifyGlobalCooldownUntil > now) {
    await wait(spotifyGlobalCooldownUntil - now);
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

async function spotifyGetJson<T>(accessToken: string, endpoint: string): Promise<T> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await spotifyFetch(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json: any = await res.json().catch(() => null);
    if (res.ok) {
      return json as T;
    }

    const isRateLimited = res.status === 429;
    if (isRateLimited && attempt < maxAttempts) {
      const retryAfterSec = Number(res.headers.get("retry-after") ?? "");
      const retryMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : attempt * 1200;
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
      `[Spotify] request failed (${res.status}) ${endpoint}${hint}: ${JSON.stringify(
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
      const retryAfterSec = Number(res.headers.get("retry-after") ?? "");
      const retryMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : attempt * 1200;
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
      `[Spotify] request failed (${res.status}) ${method} ${endpoint}${hint}: ${JSON.stringify(
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

async function createMoodtunePlaylistWithRetry(args: {
  accessToken: string;
  name: string;
  description: string;
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
        public: false,
        description: args.description,
      }),
    });
    const json: any = await res.json().catch(() => null);
    if (res.ok) return json;

    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfterSec = Number(res.headers.get("retry-after") ?? "");
      const retryMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : Math.min(60_000, 2_000 * 2 ** (attempt - 1));
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
      `[Spotify] request failed (${res.status}) POST /me/playlists: ${JSON.stringify(json)}`,
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
  console.warn(`[Spotify] bootstrap optional step failed (${label}):`, err?.message ?? err);
  return fallback;
}

async function getSpotifyTempoMap(
  accessToken: string,
  trackIds: string[],
): Promise<Record<string, number>> {
  if (!canUseAudioFeaturesApi) return {};
  const uniqueIds = Array.from(new Set(trackIds.filter(Boolean)));
  if (!uniqueIds.length) return {};
  const chunkSize = 100;
  const tempoMap: Record<string, number> = {};

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const ids = uniqueIds.slice(i, i + chunkSize).join(",");
    try {
      const json = await spotifyGetJson<{ audio_features: any[] }>(
        accessToken,
        `/audio-features?ids=${encodeURIComponent(ids)}`,
      );
      (json.audio_features ?? []).forEach((f: any) => {
        const id = String(f?.id ?? "");
        const tempo = Number(f?.tempo ?? 0);
        if (id && Number.isFinite(tempo) && tempo > 0) {
          tempoMap[id] = tempo;
        }
      });
    } catch (err) {
      // 계정/앱 권한 상태에 따라 오디오 피처가 제한될 수 있어 전체 흐름은 유지한다.
      const msg = String((err as Error)?.message ?? err);
      if (msg.includes("(403)")) {
        if (canUseAudioFeaturesApi) {
          console.warn("[Spotify] audio-features unavailable:", err);
        }
        canUseAudioFeaturesApi = false;
        break;
      }
      console.warn("[Spotify] audio-features unavailable:", err);
    }
  }

  return tempoMap;
}

async function getSpotifySavedMap(
  accessToken: string,
  trackIds: string[],
): Promise<Record<string, boolean>> {
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
        if (canUseSavedTrackContainsApi) {
          console.warn("[Spotify] saved-track state unavailable:", err);
        }
        canUseSavedTrackContainsApi = false;
        break;
      }
      console.warn("[Spotify] saved-track state unavailable:", err);
    }
  }

  return savedMap;
}

async function getSpotifyArtistGenresMap(
  accessToken: string,
  artistIds: string[],
): Promise<Record<string, string[]>> {
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
        if (canUseArtistApi) {
          console.warn("[Spotify] artist genres unavailable:", err);
        }
        canUseArtistApi = false;
        break;
      }
      console.warn("[Spotify] artist genres unavailable:", err);
    }
  }

  return map;
}

export async function getSpotifyTopTracks(
  accessToken: string,
  limit = 20,
): Promise<SpotifyTrackSummary[]> {
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
    useOwnerPath = false,
  ): Promise<any[]> {
    const rows: any[] = [];
    let offset = 0;
    while (offset < safeMax) {
      const rest = safeMax - offset;
      const fetchLimit = Math.min(pageSize, rest);
      const basePath =
        useOwnerPath && args.ownerId
          ? `/users/${encodeURIComponent(args.ownerId)}/playlists/${encodeURIComponent(args.playlistId)}`
          : `/playlists/${encodeURIComponent(args.playlistId)}`;
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
    () => fetchPaged("items", true),
    () => fetchPaged("tracks", true),
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
]);

function normalizeSearchText(raw: string): string {
  return String(raw ?? "")
    .replace(/추가\s*요청\s*[:：]/gi, " ")
    .replace(/[^0-9A-Za-z가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimQueryTokens(query: string, maxTokens = 6): string {
  const tokens = query.split(" ").filter(Boolean).slice(0, maxTokens);
  return tokens.join(" ").slice(0, 64).trim();
}

function buildSearchQueries(moodInput: string): string[] {
  const normalized = normalizeSearchText(moodInput);
  if (!normalized) return [];

  const clauses = normalized
    .split(/\n+|[.!?]| 그리고 |,|\/|\|/g)
    .map(v => trimQueryTokens(v.trim(), 6))
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
      [trimQueryTokens(normalized, 6), ...clauses, ...twoGrams]
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
  const normalized = normalizeSearchText(query);
  const tokens = normalized
    .split(" ")
    .map(v => v.trim())
    .filter(v => v.length >= 2 && !SEARCH_STOPWORDS.has(v));
  if (!tokens.length) return trimQueryTokens(normalized, 3);
  return trimQueryTokens(tokens.join(" "), 3);
}

function trackKey(summary: SpotifyTrackSummary): string {
  const id = String(summary?.id ?? "").trim();
  if (id) return `id:${id}`;
  const uri = String(summary?.uri ?? "").trim();
  if (uri) return `uri:${uri}`;
  const name = String(summary?.name ?? "").toLowerCase().trim();
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

export async function discoverSpotifyTracks(args: {
  accessToken: string;
  moodInput: string;
  bootstrap: SpotifyBootstrapData | null;
  limit?: number;
}): Promise<SpotifyTrackSummary[]> {
  const { accessToken, moodInput, bootstrap, limit = 80 } = args;
  const searchQueries = Array.from(
    new Set([
      ...buildSearchQueries(moodInput),
      ...buildUserAffinityQueries(bootstrap),
    ]),
  ).slice(0, 12);

  const collected: SpotifyTrackSummary[] = [];
  const searchLimitCandidates = [20, 10, 5];
  for (const rawQuery of searchQueries) {
    const queryCandidates = Array.from(
      new Set([rawQuery, compactQuery(rawQuery)].filter(Boolean)),
    );
    let success = false;
    for (const q of queryCandidates) {
      for (const rawLimit of searchLimitCandidates) {
        const safeLimit = clamp(rawLimit, 1, 50);
        const params = new URLSearchParams();
        params.set("type", "track");
        params.set("limit", String(safeLimit));
        params.set("market", "from_token");
        params.set("q", q);
        try {
          const json = await spotifyGetJson<{ tracks?: { items?: any[] } }>(
            accessToken,
            `/search?${params.toString()}`,
          );
          const items = json?.tracks?.items ?? [];
          collected.push(...items.map(mapTrackItemToSummary));
          success = items.length > 0;
          break;
        } catch (err) {
          const msg = String((err as Error)?.message ?? err);
          if (msg.includes("Invalid limit")) continue;
          if (msg.includes("(400)")) {
            // 잘못된 검색식은 축약된 후보로 계속 진행
            break;
          }
          console.warn("[Spotify] track search failed:", err);
          break;
        }
      }
      if (success) break;
    }
    if (!success) {
      const sample = compactQuery(rawQuery);
      if (sample) {
        console.warn(`[Spotify] track search skipped for query="${sample}"`);
      }
    }
  }

  try {
    const seedTracks = (bootstrap?.topTracks ?? [])
      .map(t => t.id)
      .filter(Boolean)
      .slice(0, 3);
    const seedArtists = (bootstrap?.topArtists ?? [])
      .map(a => a.id)
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
    if (msg.includes("(404)") || msg.includes("/recommendations?")) {
      console.warn("[Spotify] recommendations unavailable in current app mode.");
      canUseRecommendationsApi = false;
    } else {
      console.warn("[Spotify] recommendations failed:", err);
    }
  }

  const dedup = new Map<string, SpotifyTrackSummary>();
  shuffle(collected).forEach(t => {
    const key = trackKey(t);
    if (!key || key === "na:|") return;
    if (!dedup.has(key)) dedup.set(key, t);
  });
  const base = Array.from(dedup.values()).slice(0, Math.max(20, limit));

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
    await replacePlaylistItems(accessToken, trimmedExistingPlaylistId, uniqueUris);
    if (userCacheKey) {
      lastMoodtunePlaylistIdByUser.set(userCacheKey, trimmedExistingPlaylistId);
    }
    return { id: trimmedExistingPlaylistId };
  }
  if (cachedPlaylistId) {
    try {
      await replacePlaylistItems(accessToken, cachedPlaylistId, uniqueUris);
      return { id: cachedPlaylistId };
    } catch (err) {
      console.warn("[Spotify] cached playlist replace failed:", err);
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
    });
  } catch (err) {
    const status = (err as SpotifyApiError | undefined)?.status;
    if (status === 429) {
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
        console.warn("[Spotify] existing playlist reuse failed after 429:", reuseErr);
      }
    }
    throw err;
  }

  const playlistId = String(created?.id ?? "");
  const externalUrl = String(created?.external_urls?.spotify ?? "");
  const ownerId = String(created?.owner?.id ?? "");
  if (!playlistId) {
    throw new Error("[Spotify] playlist create succeeded but id missing");
  }
  if (userCacheKey) {
    lastMoodtunePlaylistIdByUser.set(userCacheKey, playlistId);
  }
  try {
    await replacePlaylistItems(accessToken, playlistId, uniqueUris);
  } catch (err) {
    throw new Error(
      `[Spotify] add tracks failed for playlist ${playlistId} (owner=${ownerId || "unknown"}, tokenUser=${effectiveUserId || "unknown"}). 토큰 재로그인 후 다시 시도해 주세요. ${String(
        (err as Error)?.message ?? err,
      )}`,
    );
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
}
