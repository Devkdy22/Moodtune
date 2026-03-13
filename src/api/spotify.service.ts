// src/api/spotify.service.ts
// ─────────────────────────────────────────────────────────
//  Spotify API 서비스 (현재: 스켈레톤)
//  OAuth PKCE flow + Web API 호출
// ─────────────────────────────────────────────────────────
import * as AuthSession from "expo-auth-session";
import { SpotifyTokens, SpotifyUser } from "../types";

const CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? "";
const REDIRECT_URI = AuthSession.makeRedirectUri({ scheme: "moodtune" });

const SCOPES = [
  "playlist-read-private",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-read-private",
  "user-read-email",
  "user-library-read",
  "user-library-modify",
  "user-read-playback-state",
].join(" ");

const DISCOVERY = {
  authorizationEndpoint: "https://accounts.spotify.com/authorize",
  tokenEndpoint: "https://accounts.spotify.com/api/token",
};

// ── OAuth 로그인 ──────────────────────────────────────────
export async function loginWithSpotify(): Promise<SpotifyTokens | null> {
  // TODO: 실제 구현
  // const request = new AuthSession.AuthRequest({
  //   clientId:            CLIENT_ID,
  //   scopes:              SCOPES.split(' '),
  //   redirectUri:         REDIRECT_URI,
  //   usePKCE:             true,
  //   responseType:        AuthSession.ResponseType.Code,
  // });
  // const result = await request.promptAsync(DISCOVERY);
  // ...
  console.log("[Spotify] loginWithSpotify called (mock)");
  return null;
}

// ── 유저 프로필 ───────────────────────────────────────────
export async function getSpotifyUser(
  accessToken: string,
): Promise<SpotifyUser | null> {
  // TODO: 실제 구현
  // const res = await fetch('https://api.spotify.com/v1/me', {
  //   headers: { Authorization: `Bearer ${accessToken}` },
  // });
  // return res.json();
  console.log("[Spotify] getSpotifyUser called (mock)");
  return null;
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
