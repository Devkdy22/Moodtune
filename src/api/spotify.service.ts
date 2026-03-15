// src/api/spotify.service.ts
// ─────────────────────────────────────────────────────────
//  Spotify API 서비스 (현재: 스켈레톤)
//  OAuth PKCE flow + Web API 호출
// ─────────────────────────────────────────────────────────
import * as AuthSession from "expo-auth-session";
import { SpotifyTokens, SpotifyUser } from "../types";

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
