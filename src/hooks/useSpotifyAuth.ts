// src/hooks/useSpotifyAuth.ts
// ─────────────────────────────────────────────────────────
//  Spotify 인증 훅 (현재: mock, API 연동 시 교체)
// ─────────────────────────────────────────────────────────
import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { loginWithSpotify, getSpotifyUser } from '../api/spotify.service';

export function useSpotifyAuth() {
  const { setTokens, setSpotifyUser, logout, isAuthenticated, spotifyUser } = useAppStore();

  const login = useCallback(async () => {
    try {
      // TODO: 실제 OAuth 구현 시 주석 해제
      // const tokens = await loginWithSpotify();
      // if (!tokens) throw new Error('Login cancelled');
      // setTokens(tokens);
      //
      // const user = await getSpotifyUser(tokens.accessToken);
      // if (user) setSpotifyUser(user);

      // 현재: mock 토큰으로 처리
      setTokens({
        accessToken:  'mock_access_token',
        refreshToken: 'mock_refresh_token',
        expiresAt:    Date.now() + 3600 * 1000,
      });
      return true;
    } catch (err) {
      console.error('[useSpotifyAuth] login error:', err);
      return false;
    }
  }, []);

  return {
    isAuthenticated,
    spotifyUser,
    login,
    logout,
  };
}
