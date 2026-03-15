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
  const res = await fetch("https://api.spotify.com/v1/me", {
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

async function spotifyGetJson<T>(accessToken: string, endpoint: string): Promise<T> {
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(
      `[Spotify] request failed (${res.status}) ${endpoint}: ${JSON.stringify(json)}`,
    ) as SpotifyApiError;
    err.status = res.status;
    err.endpoint = endpoint;
    err.payload = json;
    throw err;
  }
  return json as T;
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

export async function getSpotifyTopTracks(
  accessToken: string,
  limit = 20,
): Promise<SpotifyTrackSummary[]> {
  const json = await spotifyGetJson<{ items: any[] }>(
    accessToken,
    `/me/top/tracks?time_range=medium_term&limit=${limit}`,
  );
  return (json.items ?? []).map(item => ({
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    uri: String(item?.uri ?? ""),
    preview_url: item?.preview_url ?? null,
    artists: Array.isArray(item?.artists)
      ? item.artists.map((a: any) => ({ id: String(a?.id ?? ""), name: String(a?.name ?? "") }))
      : [],
    album: {
      id: String(item?.album?.id ?? ""),
      name: String(item?.album?.name ?? ""),
      images: Array.isArray(item?.album?.images)
        ? item.album.images.map((img: any) => ({ url: String(img?.url ?? "") }))
        : [],
    },
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
  const json = await spotifyGetJson<{ items: any[] }>(
    accessToken,
    `/me/playlists?limit=${limit}`,
  );
  return (json.items ?? []).map(item => ({
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    uri: String(item?.uri ?? ""),
    images: Array.isArray(item?.images)
      ? item.images.map((img: any) => ({ url: String(img?.url ?? "") }))
      : [],
    tracks: { total: Number(item?.tracks?.total ?? 0) },
  }));
}

export async function getSpotifyRecentlyPlayed(
  accessToken: string,
  limit = 20,
): Promise<SpotifyTrackSummary[]> {
  const json = await spotifyGetJson<{ items: any[] }>(
    accessToken,
    `/me/player/recently-played?limit=${limit}`,
  );
  return (json.items ?? []).map(row => {
    const item = row?.track;
    return {
      id: String(item?.id ?? ""),
      name: String(item?.name ?? ""),
      uri: String(item?.uri ?? ""),
      preview_url: item?.preview_url ?? null,
      artists: Array.isArray(item?.artists)
        ? item.artists.map((a: any) => ({ id: String(a?.id ?? ""), name: String(a?.name ?? "") }))
        : [],
      album: {
        id: String(item?.album?.id ?? ""),
        name: String(item?.album?.name ?? ""),
        images: Array.isArray(item?.album?.images)
          ? item.album.images.map((img: any) => ({ url: String(img?.url ?? "") }))
          : [],
      },
    };
  });
}

export async function bootstrapSpotifyData(
  accessToken: string,
): Promise<SpotifyBootstrapData> {
  const settled = await Promise.allSettled([
    getSpotifyTopTracks(accessToken, 20),
    getSpotifyTopArtists(accessToken, 20),
    getSpotifyPlaylists(accessToken, 20),
    getSpotifyRecentlyPlayed(accessToken, 20),
  ]);
  const topTracks = toOptionalArrayResult(settled[0], "topTracks", []);
  const topArtists = toOptionalArrayResult(settled[1], "topArtists", []);
  const playlists = toOptionalArrayResult(settled[2], "playlists", []);
  const recentlyPlayed = toOptionalArrayResult(settled[3], "recentlyPlayed", []);
  return { topTracks, topArtists, playlists, recentlyPlayed };
}

// ── 플레이리스트 저장 ─────────────────────────────────────
export async function savePlaylistToSpotify(
  accessToken: string,
  userId: string,
  name: string,
  trackUris: string[],
): Promise<string | null> {
  // TODO: 실제 구현
  console.log("[Spotify] savePlaylistToSpotify called (mock)");
  return null;
}
