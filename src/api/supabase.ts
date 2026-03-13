// src/api/supabase.ts
// ─────────────────────────────────────────────────────────
//  Supabase 클라이언트 초기화
//  현재: 스켈레톤 (API 연동 시 활성화)
// ─────────────────────────────────────────────────────────
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ── 타입 헬퍼 ─────────────────────────────────────────────
export type DbPlaylist = {
  id: string;
  user_id: string;
  name: string;
  cover_emoji: string;
  mood_input: string;
  spotify_id: string | null;
  track_count: number;
  duration_min: number;
  created_at: string;
};

export type DbTrack = {
  id: string;
  playlist_id: string;
  name: string;
  artist: string;
  album: string;
  year: number;
  bpm: number;
  duration: string;
  spotify_uri: string;
  genre: string[];
  liked: boolean;
};
