// src/store/useAppStore.ts
// ─────────────────────────────────────────────────────────
//  Zustand 전역 상태 - 유저 인증 + 큐레이션 상태 통합
// ─────────────────────────────────────────────────────────
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SpotifyBootstrapData,
  SpotifyTokens,
  SpotifyUser,
  Playlist,
  Track,
} from '../types';
import { MOCK_PLAYLISTS, MOCK_USER } from '../constants/mockData';

// ── User Store ────────────────────────────────────────────
interface UserSlice {
  spotifyTokens:   SpotifyTokens | null;
  spotifyUser:     SpotifyUser | null;
  spotifyBootstrap: SpotifyBootstrapData | null;
  playlists:       Playlist[];
  isAuthenticated: boolean;

  setTokens:       (tokens: SpotifyTokens) => void;
  setSpotifyUser:  (user: SpotifyUser) => void;
  setSpotifyBootstrap: (data: SpotifyBootstrapData) => void;
  addPlaylist:     (pl: Playlist) => void;
  removePlaylist:  (id: string) => void;
  toggleLike:      (id: string) => void;
  logout:          () => void;
}

// ── Curation Store ────────────────────────────────────────
interface CurationSlice {
  moodInput:        string;
  isGenerating:     boolean;
  generationStep:   number;   // 0=idle 1=분석 2=매칭 3=완성
  currentPlaylist:  Playlist | null;

  setMoodInput:       (text: string) => void;
  setGenerating:      (v: boolean) => void;
  setGenerationStep:  (step: number) => void;
  setCurrentPlaylist: (pl: Playlist | null) => void;
  resetCuration:      () => void;
}

type AppStore = UserSlice & CurationSlice;

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // ── User State ──────────────────────────────────────
      spotifyTokens:   null,
      spotifyUser:     null,
      spotifyBootstrap: null,
      // 개발 중 mock 데이터 사용; API 연동 후 [] 로 변경
      playlists:       MOCK_PLAYLISTS,
      isAuthenticated: false,

      setTokens: (tokens) => set({ spotifyTokens: tokens, isAuthenticated: true }),

      setSpotifyUser: (user) => set({ spotifyUser: user }),
      setSpotifyBootstrap: (data) => set({ spotifyBootstrap: data }),

      addPlaylist: (pl) =>
        set((s) => ({ playlists: [pl, ...s.playlists] })),

      removePlaylist: (id) =>
        set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),

      toggleLike: (id) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === id ? { ...p, liked: !p.liked } : p
          ),
        })),

      logout: () =>
        set({
          spotifyTokens:   null,
          spotifyUser:     null,
          spotifyBootstrap: null,
          isAuthenticated: false,
        }),

      // ── Curation State ──────────────────────────────────
      moodInput:       '',
      isGenerating:    false,
      generationStep:  0,
      currentPlaylist: null,

      setMoodInput:       (text)   => set({ moodInput: text }),
      setGenerating:      (v)      => set({ isGenerating: v }),
      setGenerationStep:  (step)   => set({ generationStep: step }),
      setCurrentPlaylist: (pl)     => set({ currentPlaylist: pl }),
      resetCuration: () =>
        set({ moodInput: '', isGenerating: false, generationStep: 0, currentPlaylist: null }),
    }),
    {
      name:    'moodtune-store',
      storage: createJSONStorage(() => AsyncStorage),
      // 민감 정보는 persist 제외 가능
      partialize: (state) => ({
        spotifyTokens:   state.spotifyTokens,
        spotifyUser:     state.spotifyUser,
        spotifyBootstrap: state.spotifyBootstrap,
        isAuthenticated: state.isAuthenticated,
        playlists:       state.playlists,
      }),
    }
  )
);

// ── Selector 헬퍼 (리렌더 최소화) ─────────────────────────
export const useUser         = () => useAppStore((s) => s.spotifyUser);
export const useIsAuth       = () => useAppStore((s) => s.isAuthenticated);
export const usePlaylists    = () => useAppStore((s) => s.playlists);
export const useMoodInput    = () => useAppStore((s) => s.moodInput);
export const useIsGenerating = () => useAppStore((s) => s.isGenerating);
export const useCurrentPl    = () => useAppStore((s) => s.currentPlaylist);
