// ─────────────────────────────────────────────────────────
//  MoodTune · TypeScript Types
// ─────────────────────────────────────────────────────────

export interface Track {
  id: string;
  emoji: string;
  name: string;
  artist: string;
  duration: string;           // "5:32"
  gradientStart: string;      // hex
  gradientEnd: string;        // hex
  album: string;
  year: number;
  bpm: number;
  genre: string[];
  liked: boolean;
  spotifyUri?: string;
  previewUrl?: string;
}

export interface Playlist {
  id: string;
  name: string;
  coverEmoji: string;
  gradientStart: string;
  gradientEnd: string;
  trackCount: number;
  duration: string;           // "48분"
  liked: boolean;
  tracks: Track[];
  createdAt: Date;
  spotifyId?: string;
  moodInput?: string;         // 사용자가 입력한 무드 텍스트
}

export interface MoodPill {
  id: string;
  label: string;              // "☀️ 아침 루틴"
  text: string;               // 실제 프롬프트 텍스트
}

export interface GenreToggle {
  id: string;
  icon: string;
  label: string;
  active?: boolean;
}

// ── Spotify Auth ──────────────────────────────────────────
export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;          // timestamp ms
}

export interface SpotifyUser {
  id: string;
  display_name: string;
  email: string;
  images: Array<{ url: string }>;
  product: 'premium' | 'free';
}

export interface SpotifyArtistSummary {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
}

export interface SpotifyTrackSummary {
  id: string;
  name: string;
  uri: string;
  preview_url: string | null;
  artists: Array<{ id: string; name: string }>;
  album: { id: string; name: string; images: Array<{ url: string }> };
}

export interface SpotifyPlaylistSummary {
  id: string;
  name: string;
  uri: string;
  images: Array<{ url: string }>;
  tracks: { total: number };
}

export interface SpotifyBootstrapData {
  topTracks: SpotifyTrackSummary[];
  topArtists: SpotifyArtistSummary[];
  playlists: SpotifyPlaylistSummary[];
  recentlyPlayed: SpotifyTrackSummary[];
}

// ── Store ─────────────────────────────────────────────────
export interface UserState {
  spotifyTokens: SpotifyTokens | null;
  spotifyUser: SpotifyUser | null;
  spotifyBootstrap: SpotifyBootstrapData | null;
  playlists: Playlist[];
  isAuthenticated: boolean;
  setTokens: (tokens: SpotifyTokens) => void;
  setSpotifyUser: (user: SpotifyUser) => void;
  setSpotifyBootstrap: (data: SpotifyBootstrapData) => void;
  addPlaylist: (pl: Playlist) => void;
  logout: () => void;
}

// ── Curation ──────────────────────────────────────────────
export interface CurationState {
  moodInput: string;
  isGenerating: boolean;
  currentPlaylist: Playlist | null;
  generationStep: number;     // 0~3
  setMoodInput: (text: string) => void;
  setGenerating: (v: boolean) => void;
  setCurrentPlaylist: (pl: Playlist | null) => void;
  setGenerationStep: (step: number) => void;
}

// ── Navigation ────────────────────────────────────────────
export type RootStackParamList = {
  'auth/login': undefined;
  'auth/spotify': undefined;
  '(tabs)': undefined;
  'result/[id]': { id: string };
};
