// app/(tabs)/index.tsx
// ─────────────────────────────────────────────────────────
//  메인 홈 화면 (s2 Syncing → s3 Input → s4 Loading → s5 Preview)
//  실제 앱에서는 각 화면이 별도 스택으로 분리되나
//  현재는 animated 전환으로 구현 (API 연동 전 UI 우선)
// ─────────────────────────────────────────────────────────
import { router, useLocalSearchParams } from "expo-router";
import {
  Bike,
  BookOpenText,
  ChevronLeft,
  Clock3,
  Coffee,
  Disc3,
  Dumbbell,
  Flame,
  Hand,
  HeartPulse,
  Leaf,
  LucideIcon,
  MoonStar,
  Music2,
  Rabbit,
  RefreshCw,
  ShipWheel,
  SlidersHorizontal,
  Sparkles,
  Sunrise,
  Timer,
  Waves,
} from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AnalysisProgressEvent } from "../../src/api/gemini.service";
import {
  analyzeMoodAndRecommend,
  analyzeMoodAndRecommendFast,
  consumeFastWorkingRecommendation,
  resetFastWorkingRecommendationCache,
} from "../../src/api/gemini.service";
import {
  refreshSpotifyAccessToken,
  savePlaylistToSpotify,
} from "../../src/api/spotify.service";
import Waveform from "../../src/components/ai/waveform";
import { PrimaryButton } from "../../src/components/common/Button";
import GlassCard from "../../src/components/common/GlassCard";
import LogoIcon from "../../src/components/common/LogoIcon";
import ScreenBackground from "../../src/components/common/ScreenBackground";
import ToastOverlay, {
  ToastItem,
} from "../../src/components/common/ToastOverlay";
import TrackDetailModal from "../../src/components/music/TrackDetailModal";
import TrackItem from "../../src/components/music/TrackItem";
import { Colors } from "../../src/constants/colors";
import { FontSize, Radius } from "../../src/constants/layout";
import { MOCK_TRACKS, MOOD_PILLS } from "../../src/constants/mockData";
import { useAppStore } from "../../src/store/useAppStore";
import {
  SpotifyBootstrapData,
  SpotifyTrackSummary,
  Track,
} from "../../src/types";

const { width: W, height: H } = Dimensions.get("window");
const USE_NATIVE_DRIVER = Platform.OS !== "web";
const HOME_SCROLL_BOTTOM_SPACER = Platform.OS === "ios" ? 188 : 198;
const HOME_CTA_BOTTOM_OFFSET = Platform.OS === "ios" ? 92 : 98;
const PREVIEW_BAR_BOTTOM_OFFSET = Platform.OS === "ios" ? 94 : 86;
const PLAYLIST_GENERATION_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(
    String(process.env.EXPO_PUBLIC_PLAYLIST_GENERATION_TIMEOUT_MS ?? "").trim(),
    10,
  );
  if (!Number.isFinite(raw)) return 35_000;
  return Math.max(12_000, Math.min(90_000, raw));
})();
const FAST_ANALYSIS_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(
    String(process.env.EXPO_PUBLIC_FAST_ANALYSIS_TIMEOUT_MS ?? "").trim(),
    10,
  );
  if (!Number.isFinite(raw)) return 18_000;
  return Math.max(8_000, Math.min(35_000, raw));
})();
const ENABLE_FULL_ANALYSIS_AFTER_FAST =
  String(process.env.EXPO_PUBLIC_ENABLE_FULL_ANALYSIS_AFTER_FAST ?? "true")
    .trim()
    .toLowerCase() === "true";

function isHardRefreshTokenInvalid(message: string): boolean {
  const msg = String(message ?? "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("invalid_grant") ||
    msg.includes("invalid refresh token") ||
    msg.includes("refresh token revoked") ||
    msg.includes("refresh token expired")
  );
}

const GENRE_TOGGLES = [
  {
    id: "genre",
    Icon: Disc3,
    label: "장르 선택",
    desc: "좋아하는 음악 스타일",
  },
  { id: "length", Icon: Clock3, label: "길이", desc: "플레이리스트 재생 시간" },
  {
    id: "mood",
    Icon: SlidersHorizontal,
    label: "분위기",
    desc: "감정/템포 무드 방향",
  },
  { id: "era", Icon: Timer, label: "시대", desc: "최신곡/연도대 선택" },
  { id: "pop", Icon: Sparkles, label: "인기도", desc: "대중성 또는 숨은 곡" },
] as const;

type SettingId = (typeof GENRE_TOGGLES)[number]["id"];
type SettingOption = { label: string; prompt: string };
type SettingSelection = {
  genre: SettingOption[];
  length: SettingOption | null;
  mood: SettingOption | null;
  era: SettingOption | null;
  pop: SettingOption | null;
};

const SETTING_OPTIONS: Record<SettingId, SettingOption[]> = {
  genre: [
    { label: "K-POP", prompt: "장르는 K-POP 중심으로 구성해줘." },
    { label: "트로트", prompt: "장르는 트로트 중심으로 구성해줘." },
    { label: "멜로디 힙합", prompt: "장르는 멜로디 힙합 중심으로 구성해줘." },
    { label: "힙합", prompt: "장르는 힙합 중심으로 구성해줘." },
    { label: "R&B/소울", prompt: "장르는 R&B와 소울 중심으로 구성해줘." },
    { label: "인디/포크", prompt: "장르는 인디와 포크 중심으로 구성해줘." },
    { label: "록/메탈", prompt: "장르는 록과 메탈 중심으로 구성해줘." },
    { label: "EDM/일렉", prompt: "장르는 EDM과 일렉트로닉 중심으로 구성해줘." },
    { label: "재즈/블루스", prompt: "장르는 재즈와 블루스 중심으로 구성해줘." },
    { label: "발라드", prompt: "장르는 발라드 중심으로 구성해줘." },
    {
      label: "OST/영화음악",
      prompt: "장르는 OST와 영화음악 중심으로 구성해줘.",
    },
    {
      label: "로파이/앰비언트",
      prompt: "장르는 로파이와 앰비언트 중심으로 구성해줘.",
    },
  ],
  length: [
    { label: "1시간 이내", prompt: "총 길이는 1시간 이내로 구성해줘." },
    { label: "1시간 30분 내외", prompt: "총 길이는 1시간 30분 내외로 맞춰줘." },
    { label: "2시간 이상", prompt: "총 길이는 2시간 이상으로 구성해줘." },
  ],
  mood: [
    {
      label: "차분하고 잔잔하게",
      prompt: "전체 분위기는 차분하고 잔잔하게 유지해줘.",
    },
    {
      label: "밝고 에너지 있게",
      prompt: "전체 분위기는 밝고 에너지 있게 구성해줘.",
    },
    {
      label: "몽환적이고 감성적으로",
      prompt: "전체 분위기는 몽환적이고 감성적으로 구성해줘.",
    },
  ],
  era: [
    {
      label: "최신곡 위주",
      prompt: "최신곡(최근 1~2년 발매) 위주로 추천해줘.",
    },
    { label: "2020년대", prompt: "2020년대 발매곡 중심으로 구성해줘." },
    { label: "2010년대", prompt: "2010년대 발매곡 중심으로 구성해줘." },
    { label: "2000년대", prompt: "2000년대 발매곡 중심으로 구성해줘." },
    {
      label: "90년대~00년대",
      prompt: "90년대~2000년대 초반 발매곡 중심으로 구성해줘.",
    },
    {
      label: "시대 혼합",
      prompt: "시대를 한쪽으로 치우치지 말고 고르게 섞어줘.",
    },
  ],
  pop: [
    {
      label: "유명한 곡 위주",
      prompt: "인지도 높은 유명한 곡 위주로 추천해줘.",
    },
    {
      label: "숨은 명곡 위주",
      prompt: "숨은 명곡과 발견형 트랙 위주로 추천해줘.",
    },
    { label: "균형 있게", prompt: "유명곡과 숨은 곡을 균형 있게 섞어줘." },
  ],
};

const LOADING_STEPS = [
  "무드 컨텍스트 해석",
  "취향 기반 트랙 매칭",
  "플레이리스트 조합 완료",
];
const LOADING_PHASE_LABELS = [
  "프롬프트 의미를 추출하고 있어요",
  "분위기와 취향에 맞는 곡을 탐색 중이에요",
  "흐름이 자연스러운 플레이리스트를 구성 중이에요",
];
const LP_STAGE_META = [
  { key: "mood", label: "MOOD", desc: "무드 분석" },
  { key: "genre", label: "GENRE", desc: "장르 탐색" },
  { key: "taste", label: "TASTE", desc: "취향 반영" },
  { key: "discovery", label: "DISCOVERY", desc: "신곡 탐색" },
  { key: "flow", label: "FLOW", desc: "흐름 정리" },
] as const;
const LOADING_HEADLINES = [
  "AI가 당신의 무드를 듣고 있어요",
  "지금 듣기 좋은 플레이리스트를 만들고 있어요",
  "분위기와 취향을 조합하는 중이에요",
  "너무 뻔하지 않은 곡을 다듬고 있어요",
  "재생 흐름을 자연스럽게 정리하고 있어요",
] as const;
const PREVIEW_CARD_MESSAGES = [
  "밝고 가벼운 흐름으로 정리 중",
  "익숙한 취향에 새로운 곡을 섞는 중",
  "너무 뻔하지 않게 다듬는 중",
  "초반부터 끝까지 자연스럽게 이어지게 정리 중",
  "지금 기분에 맞는 결을 맞추는 중",
  "트랙 간 에너지 밸런스를 조정하는 중",
  "지금 듣기 좋은 템포로 순서를 다듬는 중",
] as const;
const MAX_LOADING_DISCS = 5;
const MAX_VISIBLE_LOADING_DISCS = 3;
const LP_STACK_DEPTH_CAP = 4;
const LP_DISC_SIZE = 184;
const LP_DISC_RADIUS = LP_DISC_SIZE / 2;
const LP_STAGE_HEIGHT = LP_DISC_SIZE + 54;
const LP_SLEEVE_WIDTH = Math.round(LP_DISC_SIZE * 0.88);
const LP_SLEEVE_HEIGHT = LP_SLEEVE_WIDTH;
const LP_SLEEVE_LEFT = Math.round((W - 48 - LP_SLEEVE_WIDTH) / 2);
const LP_SLEEVE_TOP = Math.round(LP_DISC_SIZE * 0.2);
const MOOD_SUGGESTION_COUNT = 5;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const MOOD_ICON_POOL: LucideIcon[] = [
  Sunrise,
  MoonStar,
  Dumbbell,
  BookOpenText,
  HeartPulse,
  Sparkles,
  Coffee,
  Waves,
  Leaf,
  Flame,
  Rabbit,
  Bike,
  ShipWheel,
];

const EXTRA_MOOD_SUGGESTIONS = [
  {
    id: "x1",
    label: "퇴근 후 리프레시",
    text: "부드럽고 리듬감 있는 팝/인디로 하루를 정리하는 40분",
  },
  {
    id: "x2",
    label: "집중 코딩 모드",
    text: "가사 적은 일렉트로닉과 로파이로 몰입도를 높이는 90분",
  },
  {
    id: "x3",
    label: "감성 산책",
    text: "잔잔한 어쿠스틱과 시티팝으로 걷기 좋은 50분",
  },
  {
    id: "x4",
    label: "카페 브런치",
    text: "재즈 보컬과 소울 기반의 따뜻한 플레이리스트 60분",
  },
];

type MoodSuggestionSeed = {
  id: string;
  label: string;
  text: string;
};

type MoodSuggestionItem = MoodSuggestionSeed & {
  Icon: LucideIcon;
};

const normalizeMoodLabel = (label: string) =>
  label.replace(/^[^\p{L}\p{N}]+/u, "").trim();

const DYNAMIC_CONTEXT = [
  "출근길",
  "퇴근길",
  "밤산책",
  "주말 아침",
  "카페 작업",
  "운동 전",
  "운동 후",
  "샤워 후",
  "집중 타임",
  "감성 충전",
];
const DYNAMIC_MOODS = [
  "산뜻한 팝",
  "몽환 신스",
  "따뜻한 어쿠스틱",
  "저음 힙합",
  "재즈 칠",
  "드림 인디",
  "부스터 EDM",
];
const DYNAMIC_DURATIONS = ["30분", "40분", "50분", "60분", "75분"];

const GENERATED_MOOD_SUGGESTIONS: MoodSuggestionSeed[] =
  DYNAMIC_CONTEXT.flatMap((context, ci) =>
    DYNAMIC_MOODS.slice(0, 5).map((mood, mi) => {
      const duration = DYNAMIC_DURATIONS[(ci + mi) % DYNAMIC_DURATIONS.length];
      return {
        id: `g-${ci}-${mi}`,
        label: `${context} ${mood}`,
        text: `${context}에 어울리는 ${mood} 중심의 플레이리스트 ${duration}`,
      };
    }),
  );

const MOOD_SUGGESTION_POOL: MoodSuggestionSeed[] = [
  ...MOOD_PILLS,
  ...EXTRA_MOOD_SUGGESTIONS,
  ...GENERATED_MOOD_SUGGESTIONS,
].map((pill, i) => ({
  ...pill,
  label: normalizeMoodLabel(pill.label),
}));

function pickMoodSuggestions(
  count: number,
  excludeIds: string[] = [],
): MoodSuggestionItem[] {
  const candidates = MOOD_SUGGESTION_POOL.filter(
    item => !excludeIds.includes(item.id),
  );
  const source = candidates.length >= count ? candidates : MOOD_SUGGESTION_POOL;
  const shuffled = [...source].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);
  const iconBag = [...MOOD_ICON_POOL].sort(() => Math.random() - 0.5);
  return selected.map((item, idx) => ({
    ...item,
    Icon: iconBag[idx],
  }));
}

type Phase = "syncing" | "home" | "loading" | "preview";

function composePrompt(baseText: string, selections: SettingSelection): string {
  const base = baseText.trim().replace(/\s+/g, " ");
  const genrePrompt = buildMergedGenrePrompt(selections.genre);
  const selectedPrompts = [
    ...(genrePrompt ? [genrePrompt] : []),
    ...[selections.length, selections.mood, selections.era, selections.pop]
      .filter((v): v is SettingOption => Boolean(v))
      .map(v => v.prompt.trim().replace(/[.!?]$/, "")),
  ];
  const deduped = Array.from(new Set(selectedPrompts.filter(Boolean)));

  if (!deduped.length) return base;

  return `${base}\n\n추가 요청: ${deduped.join(" 그리고 ")}.`;
}

function buildMergedGenrePrompt(genres: SettingOption[]): string {
  if (!genres.length) return "";
  if (genres.length === 1) {
    return genres[0].prompt.trim().replace(/[.!?]$/, "");
  }

  const parts = Array.from(
    new Set(
      genres
        .map(v => v.label.split(" 중심")[0].trim())
        .filter(Boolean)
        .flatMap(v =>
          v
            .split("/")
            .map(x => x.trim())
            .filter(Boolean),
        ),
    ),
  );
  if (!parts.length) return "";
  const joined =
    parts.length === 2
      ? `${parts[0]}와 ${parts[1]}`
      : `${parts.slice(0, -1).join(", ")}, ${parts[parts.length - 1]}`;
  return `장르는 ${joined} 계열을 자연스럽게 섞어 구성해줘`;
}

function isSettingActive(selections: SettingSelection, id: SettingId): boolean {
  if (id === "genre") return selections.genre.length > 0;
  return Boolean(selections[id]);
}

function selectionLabel(
  selections: SettingSelection,
  id: SettingId,
  fallback: string,
): string {
  if (id === "genre") {
    if (!selections.genre.length) return fallback;
    if (selections.genre.length === 1) return selections.genre[0].label;
    return `${selections.genre[0].label} 외 ${selections.genre.length - 1}개`;
  }
  return selections[id]?.label ?? fallback;
}

function formatDurationMs(durationMs: number): string {
  if (!durationMs || durationMs < 0) return "0:00";
  const totalSec = Math.floor(durationMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function parseReleaseYear(releaseDate?: string): number {
  if (!releaseDate) return 0;
  const m = releaseDate.match(/^(\d{4})/);
  return m ? Number(m[1]) : 0;
}

const TRACK_EMOJIS = ["♬", "♫", "♪", "♩", "♭"] as const;
const TRACK_GRADIENT_START = [
  "#1a2535",
  "#22323f",
  "#2a2138",
  "#163026",
  "#2f2420",
] as const;
const TRACK_GRADIENT_END = [
  "#0e1822",
  "#162730",
  "#171728",
  "#0b1d17",
  "#1f1612",
] as const;

function mapSpotifySummaryToTrack(t: SpotifyTrackSummary, i: number): Track {
  return {
    id: t.id,
    emoji: TRACK_EMOJIS[i % TRACK_EMOJIS.length],
    name: t.name,
    artist:
      t.artists
        .map(a => a.name)
        .filter(Boolean)
        .join(", ") || "Unknown Artist",
    duration: formatDurationMs(Number(t.duration_ms ?? 0)),
    albumImageUrl: t.album?.images?.[0]?.url || undefined,
    gradientStart: TRACK_GRADIENT_START[i % TRACK_GRADIENT_START.length],
    gradientEnd: TRACK_GRADIENT_END[i % TRACK_GRADIENT_END.length],
    album: t.album?.name || "Spotify",
    year: parseReleaseYear(t.album?.release_date),
    bpm: Math.round(Number(t.tempo ?? 0)),
    genre: t.genres ?? [],
    liked: Boolean(t.is_saved),
    spotifyUri: t.uri,
    previewUrl: t.preview_url ?? undefined,
  };
}

function buildBootstrapSeedTracks(
  bootstrap: SpotifyBootstrapData | null,
  limit = 120,
): Track[] {
  const merged = [
    ...(bootstrap?.topTracks ?? []),
    ...(bootstrap?.recentlyPlayed ?? []),
  ];
  const seen = new Set<string>();
  const unique = merged.filter(t => {
    const id = String(t?.id ?? "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return unique.slice(0, limit).map(mapSpotifySummaryToTrack);
}

function estimateTargetMinutes(selection: SettingOption | null): number | null {
  const source =
    `${selection?.label ?? ""} ${selection?.prompt ?? ""}`.toLowerCase();
  if (!source) return null;
  if (source.includes("2시간") || source.includes("120분")) return 120;
  if (source.includes("1시간 30분") || source.includes("90분")) return 90;
  if (source.includes("1시간")) return 60;
  return null;
}

function durationMinutes(track: Track): number {
  const [m, s] = String(track.duration ?? "0:00")
    .split(":")
    .map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(s)) return 0;
  return Math.max(0, m) + Math.max(0, s) / 60;
}

function buildDurationAwareFallbackTracks(
  seedTracks: Track[],
  targetMinutes: number | null,
): Track[] {
  const source = seedTracks.length ? seedTracks : MOCK_TRACKS;
  if (!targetMinutes || targetMinutes <= 0) {
    return source.slice(0, Math.max(12, Math.min(36, source.length)));
  }

  const dedup = new Set<string>();
  const picked: Track[] = [];
  let minutesAcc = 0;
  const pools = [source, MOCK_TRACKS];
  const hardCap = 90;

  for (const pool of pools) {
    for (const t of pool) {
      const id = String(t?.id ?? "").trim();
      if (!id || dedup.has(id)) continue;
      dedup.add(id);
      picked.push(t);
      minutesAcc += durationMinutes(t);
      if (minutesAcc >= targetMinutes * 0.95 || picked.length >= hardCap) {
        return picked;
      }
    }
  }

  return picked.length ? picked : source.slice(0, 20);
}

function promptHashSeed(input: string): number {
  let h = 2166136261;
  const normalized = String(input ?? "")
    .toLowerCase()
    .trim();
  for (let i = 0; i < normalized.length; i += 1) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= Date.now() & 0xffff;
  return h >>> 0 || 1;
}

function seededRandomFactory(seedInput: number): () => number {
  let seed = seedInput >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function inferPromptGenres(prompt: string): string[] {
  const source = String(prompt ?? "").toLowerCase();
  const tokens: string[] = [];
  if (/\bk[\s-]?pop\b|케이팝|케이 팝|k pop/.test(source)) tokens.push("k-pop");
  if (/멜로디\s*힙합|melodic/.test(source)) tokens.push("멜로디 힙합");
  if (/\bhip[\s-]?hop\b|힙합|랩/.test(source)) tokens.push("힙합");
  if (/발라드|ballad/.test(source)) tokens.push("발라드");
  if (/\br[\s&-]?n[\s&-]?b\b|알앤비|r&b/.test(source)) tokens.push("rnb");
  if (/인디|indie/.test(source)) tokens.push("인디");
  return Array.from(new Set(tokens));
}

function inferPromptEnergy(prompt: string): "low" | "mid" | "high" {
  const source = String(prompt ?? "").toLowerCase();
  if (/잔잔|편안|따뜻|밤산책|calm|chill|relax/.test(source)) return "low";
  if (/에너지|운동|달리기|high|boost/.test(source)) return "high";
  return "mid";
}

function trackEnergyBand(track: Track): "low" | "mid" | "high" {
  const bpm = Number(track.bpm ?? 0);
  if (!Number.isFinite(bpm) || bpm <= 0) return "mid";
  if (bpm < 95) return "low";
  if (bpm > 125) return "high";
  return "mid";
}

function buildPromptAwareFallbackTracks(args: {
  seedTracks: Track[];
  prompt: string;
  targetMinutes: number | null;
  avoidTrackIds?: Set<string>;
}): Track[] {
  const source = args.seedTracks.length ? args.seedTracks : MOCK_TRACKS;
  const preferredGenres = inferPromptGenres(args.prompt);
  const preferredEnergy = inferPromptEnergy(args.prompt);
  const random = seededRandomFactory(promptHashSeed(args.prompt));
  const avoidTrackIds = args.avoidTrackIds ?? new Set<string>();

  const scored = source.map(track => {
    const id = String(track.id ?? "").trim();
    const normalizedGenre = (track.genre ?? []).join(" ").toLowerCase();
    const normalizedMeta =
      `${track.name} ${track.artist} ${track.album}`.toLowerCase();
    let score = random() * 0.35;

    if (id && avoidTrackIds.has(id)) score -= 3.5;

    for (const g of preferredGenres) {
      const token = g.toLowerCase();
      if (normalizedGenre.includes(token)) score += 2.2;
      if (normalizedMeta.includes(token.replace("-", ""))) score += 0.8;
    }

    const band = trackEnergyBand(track);
    if (band === preferredEnergy) score += 1.25;
    else if (
      (preferredEnergy === "low" && band === "mid") ||
      (preferredEnergy === "mid" && band !== "high")
    ) {
      score += 0.45;
    }

    if (
      /밤|night/.test(args.prompt.toLowerCase()) &&
      Number(track.year ?? 0) >= 2015
    ) {
      score += 0.25;
    }

    return { track, score };
  });

  const ordered = scored
    .sort((a, b) => b.score - a.score)
    .map(item => item.track);

  return buildDurationAwareFallbackTracks(ordered, args.targetMinutes);
}

type RecommendationOutput = Awaited<ReturnType<typeof analyzeMoodAndRecommend>>;
type GenerationRequestState =
  | "idle"
  | "loading"
  | "partial"
  | "complete"
  | "failed";

function promptRequestKey(prompt: string): string {
  return String(prompt ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractRequestedMinutesFromPrompt(prompt: string): number | null {
  const text = String(prompt ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const hourMin = text.match(/(\d{1,2})\s*시간\s*(\d{1,3})\s*분/);
  if (hourMin) {
    const hour = Number(hourMin[1]);
    const minute = Number(hourMin[2]);
    const total = hour * 60 + minute;
    if (!Number.isFinite(total) || total <= 0) return null;
    return Math.max(10, Math.min(180, total));
  }
  const hourOnly = text.match(/(\d{1,2})\s*시간/);
  if (hourOnly) {
    const total = Number(hourOnly[1]) * 60;
    if (!Number.isFinite(total) || total <= 0) return null;
    return Math.max(10, Math.min(180, total));
  }
  const minuteOnly = text.match(/(\d{1,3})\s*(분|min|minutes?)/i);
  if (!minuteOnly) return null;
  const v = Number(minuteOnly[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.max(10, Math.min(180, v));
}

function createRecommendationRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function applyNoveltyPolicy(args: {
  tracks: Track[];
  prompt: string;
  targetMinutes: number | null;
  seedTracks: Track[];
  previousTrackIds: Set<string>;
  minNewRatio?: number;
  maxOldRatio?: number;
}): Track[] {
  const minNewRatio = Math.max(0, Math.min(1, Number(args.minNewRatio ?? 0.6)));
  const maxOldRatio = Math.max(0, Math.min(1, Number(args.maxOldRatio ?? 0.2)));
  const seen = new Set<string>();
  const dedup = args.tracks.filter(track => {
    const id = String(track.id ?? "").trim();
    const key =
      id ||
      `${String(track.name ?? "").toLowerCase()}|${String(track.artist ?? "").toLowerCase()}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!args.previousTrackIds.size) return dedup;

  const isOld = (track: Track) =>
    args.previousTrackIds.has(String(track.id ?? "").trim());
  let fresh = dedup.filter(track => !isOld(track));
  const old = dedup.filter(isOld);
  const targetCount = Math.max(12, dedup.length || 0);
  const maxOldCount = Math.max(0, Math.floor(targetCount * maxOldRatio));
  const minNewCount = Math.max(1, Math.ceil(targetCount * minNewRatio));

  if (fresh.length < minNewCount) {
    const refill = buildPromptAwareFallbackTracks({
      seedTracks: args.seedTracks,
      prompt: args.prompt,
      targetMinutes: args.targetMinutes,
      avoidTrackIds: args.previousTrackIds,
    }).filter(track => {
      const id = String(track.id ?? "").trim();
      return Boolean(id) && !seen.has(id);
    });
    for (const track of refill) {
      if (fresh.length >= minNewCount) break;
      const id = String(track.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      fresh.push(track);
    }
  }

  const selected: Track[] = [...fresh];
  for (const track of old) {
    if (selected.length >= targetCount) break;
    const oldCount = selected.filter(isOld).length;
    if (oldCount >= maxOldCount) break;
    selected.push(track);
  }
  if (selected.length < targetCount) {
    const refill = buildPromptAwareFallbackTracks({
      seedTracks: args.seedTracks,
      prompt: args.prompt,
      targetMinutes: args.targetMinutes,
      avoidTrackIds: args.previousTrackIds,
    });
    for (const track of refill) {
      if (selected.length >= targetCount) break;
      const id = String(track.id ?? "").trim();
      if (!id || selected.some(t => String(t.id ?? "").trim() === id)) continue;
      selected.push(track);
    }
  }
  return buildDurationAwareFallbackTracks(selected, args.targetMinutes);
}

function mergeRecommendationOutputs(args: {
  fast: RecommendationOutput | null;
  full: RecommendationOutput | null;
  prompt: string;
  targetMinutes: number | null;
  previousTrackIds?: Set<string>;
  seedTracks?: Track[];
}): RecommendationOutput | null {
  const fastTracks = args.fast?.tracks ?? [];
  const fullTracks = args.full?.tracks ?? [];
  if (!fastTracks.length && !fullTracks.length) return null;
  if (!fastTracks.length) return args.full;
  if (!fullTracks.length) return args.fast;

  const mergedSeed = [...fastTracks, ...fullTracks];
  const seen = new Set<string>();
  const dedupMerged = mergedSeed.filter(track => {
    const id = String(track.id ?? "").trim();
    const key =
      id ||
      `${String(track.name ?? "").toLowerCase()}|${String(track.artist ?? "").toLowerCase()}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // fast/full 공통 기준으로 다시 정렬해 덮어쓰기 없이 보강한다.
  const reranked = buildPromptAwareFallbackTracks({
    seedTracks: dedupMerged,
    prompt: args.prompt,
    targetMinutes: args.targetMinutes,
    avoidTrackIds: new Set(),
  });
  const tracks = applyNoveltyPolicy({
    tracks: reranked.length ? reranked : dedupMerged,
    prompt: args.prompt,
    targetMinutes: args.targetMinutes,
    seedTracks: args.seedTracks ?? dedupMerged,
    previousTrackIds: args.previousTrackIds ?? new Set<string>(),
    minNewRatio: 0.6,
    maxOldRatio: 0.2,
  });

  return {
    status:
      args.full?.status === "success" || args.fast?.status === "success"
        ? "success"
        : args.full?.status === "partial" || args.fast?.status === "partial"
          ? "partial"
          : "failed",
    tracks,
    playlistName:
      args.fast?.playlistName ||
      args.full?.playlistName ||
      "AI 추천 플레이리스트",
    reasoning:
      args.fast?.reasoning ||
      args.full?.reasoning ||
      "빠른 분석 결과를 유지하고 부족한 곡은 보강했어요.",
    fallbackReason: args.fast?.fallbackReason ?? args.full?.fallbackReason,
    meta: args.fast?.meta ?? args.full?.meta,
  };
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const spotifyUser = useAppStore(s => s.spotifyUser);
  const spotifyTokens = useAppStore(s => s.spotifyTokens);
  const spotifyBootstrap = useAppStore(s => s.spotifyBootstrap);
  const setMoodInput = useAppStore(s => s.setMoodInput);
  const addPlaylist = useAppStore(s => s.addPlaylist);
  const setCurrentPlaylist = useAppStore(s => s.setCurrentPlaylist);
  const setTokens = useAppStore(s => s.setTokens);
  const logout = useAppStore(s => s.logout);
  const params = useLocalSearchParams<{ skipSync?: string }>();
  const skipSync = params.skipSync === "1" || params.skipSync === "true";
  const [phase, setPhase] = useState<Phase>(skipSync ? "home" : "syncing");
  const [moodText, setMoodText] = useState("");
  const [moodSuggestions, setMoodSuggestions] = useState<MoodSuggestionItem[]>(
    () => pickMoodSuggestions(MOOD_SUGGESTION_COUNT),
  );
  const [selections, setSelections] = useState<SettingSelection>({
    genre: [],
    length: null,
    mood: null,
    era: null,
    pop: null,
  });
  const [settingPickerTarget, setSettingPickerTarget] =
    useState<SettingId | null>(null);
  const [tracks, setTracks] = useState<Track[]>(MOCK_TRACKS);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState<{
    progress: number;
    step: 0 | 1 | 2;
    label: string;
    analysisStatus?: string;
    queryDone?: number;
    queryTotal?: number;
  }>({
    progress: 0.1,
    step: 0,
    label: LOADING_PHASE_LABELS[0],
  });
  const [saving, setSaving] = useState(false);
  const [toastQueue, setToastQueue] = useState<ToastItem[]>([]);
  const [requestState, setRequestState] =
    useState<GenerationRequestState>("idle");
  const toastDedupRef = useRef<Record<string, number>>({});
  const lastGeneratedTrackIdsRef = useRef<Set<string>>(new Set());
  const lastPromptKeyRef = useRef<string>("");
  const activeRequestIdRef = useRef<string>("");
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const loadingPhaseEpochRef = useRef(0);
  const loadingRunEpochRef = useRef<number | null>(null);
  const isStartingRecommendationRef = useRef(false);
  const isRunningRecommendationRef = useRef(false);
  const pendingRecommendationStartRef = useRef(false);
  const recommendationTriggerSourceRef = useRef<"button" | "retry" | "auto">(
    "button",
  );
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const userFirstName =
    spotifyUser?.display_name?.trim().split(/\s+/)[0] ||
    spotifyUser?.id ||
    "사용자";

  useEffect(() => {
    const mapped = buildBootstrapSeedTracks(spotifyBootstrap, 80);
    if (mapped.length) setTracks(mapped);
  }, [spotifyBootstrap]);

  useEffect(() => {
    if (phase === "loading") {
      loadingPhaseEpochRef.current += 1;
      loadingRunEpochRef.current = null;
      isStartingRecommendationRef.current = false;
      return;
    }
    isStartingRecommendationRef.current = false;
    loadingRunEpochRef.current = null;
    pendingRecommendationStartRef.current = false;
  }, [phase]);

  // s2 Syncing → s3 Home 자동 전환
  useEffect(() => {
    if (phase !== "syncing") return;
    const t = setTimeout(() => goTo("home"), 3500);
    return () => clearTimeout(t);
  }, [phase]);

  function enqueueToast(
    message: string,
    dedupeKey: string,
    tone: ToastItem["tone"] = "info",
  ) {
    const now = Date.now();
    const lastAt = toastDedupRef.current[dedupeKey] ?? 0;
    if (now - lastAt < 5000) return;
    toastDedupRef.current[dedupeKey] = now;
    setToastQueue(prev => [
      ...prev,
      {
        id: `${dedupeKey}_${now}`,
        message,
        tone,
      },
    ]);
  }

  function shiftToast(id: string) {
    setToastQueue(prev => prev.filter(t => t.id !== id));
  }

  // 로딩 단계 시뮬레이션
  useEffect(() => {
    if (phase !== "loading") return;
    if (!pendingRecommendationStartRef.current) {
      console.warn(
        "[Home] recommendation trigger source=effect skipped reason=no_pending_start",
      );
      return;
    }
    pendingRecommendationStartRef.current = false;
    const loadingEpoch = loadingPhaseEpochRef.current;
    if (loadingRunEpochRef.current === loadingEpoch) {
      console.warn(
        `[Home] recommendation trigger source=effect skipped reason=duplicate_loading_epoch epoch=${loadingEpoch}`,
      );
      return;
    }
    loadingRunEpochRef.current = loadingEpoch;
    const triggerSource = recommendationTriggerSourceRef.current;
    console.warn(
      `[Home] recommendation trigger source=${triggerSource} phase=loading epoch=${loadingEpoch}`,
    );
    setLoadingStep(0);
    console.warn("[Home] setLoading(true)");
    setRequestState("loading");
    setAnalysisProgress({
      progress: 0.1,
      step: 0,
      label: LOADING_PHASE_LABELS[0],
      queryDone: 0,
      queryTotal: 0,
      analysisStatus: "idle",
    });
    setTracks([]);
    setCurrentPlaylist(null);
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const run = async () => {
      if (isRunningRecommendationRef.current) {
        console.warn("[Home] recommendation trigger source=effect skipped reason=already_running");
        return;
      }
      isRunningRecommendationRef.current = true;
      const requestId = createRecommendationRequestId();
      if (activeAbortControllerRef.current) {
        console.warn(
          `[Playlist] request cancel requestId=${activeRequestIdRef.current || "-"} reason=new_request_start`,
        );
        activeAbortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;
      activeRequestIdRef.current = requestId;
      console.warn(`[Home] reset recommendation state requestId=${requestId}`);
      console.warn(`[Playlist] activeRequestId set requestId=${requestId}`);
      const isStale = () =>
        cancelled ||
        abortController.signal.aborted ||
        activeRequestIdRef.current !== requestId;
      const dropIfStale = (context: string) => {
        if (!isStale()) return false;
        console.warn(
          `[Playlist] stale response dropped requestId=${requestId} activeRequestId=${activeRequestIdRef.current || "-"} context=${context}`,
        );
        return true;
      };
      let requestPrompt = "";
      let requestPreviousTrackIds = new Set<string>();
      let accessToken: string | null = spotifyTokens?.accessToken ?? null;
      try {
        timers.push(setTimeout(() => !cancelled && setLoadingStep(1), 700));
        timers.push(setTimeout(() => !cancelled && setLoadingStep(2), 1500));

        const finalPrompt = composePrompt(moodText, selections);
        const currentPromptKey = promptRequestKey(finalPrompt);
        const requestedMinutes =
          estimateTargetMinutes(selections.length) ??
          extractRequestedMinutesFromPrompt(finalPrompt);
        console.warn(
          `[Home] duration requested requestId=${requestId} minutes=${requestedMinutes ?? "-"} promptKey=${currentPromptKey || "-"}`,
        );
        requestPrompt = finalPrompt;
        const previousTrackIds =
          lastPromptKeyRef.current === currentPromptKey
            ? new Set(lastGeneratedTrackIdsRef.current)
            : new Set<string>();
        requestPreviousTrackIds = new Set(previousTrackIds);
        if (lastPromptKeyRef.current !== currentPromptKey) {
          lastGeneratedTrackIdsRef.current = new Set();
        }
        lastPromptKeyRef.current = currentPromptKey;
        resetFastWorkingRecommendationCache(finalPrompt, requestId);
        if (
          spotifyTokens?.refreshToken &&
          spotifyTokens?.expiresAt &&
          Date.now() > spotifyTokens.expiresAt - 45_000
        ) {
          try {
            const refreshed = await refreshSpotifyAccessToken({
              refreshToken: spotifyTokens.refreshToken,
            });
            if (dropIfStale("spotify_refresh")) return;
            setTokens(refreshed);
            accessToken = refreshed.accessToken;
          } catch (refreshErr) {
            const refreshMsg = String(
              (refreshErr as Error)?.message ?? refreshErr,
            );
            console.warn(`[home] spotify refresh failed: ${refreshMsg}`);
            const isRefreshInvalid = isHardRefreshTokenInvalid(refreshMsg);
            if (isRefreshInvalid) {
              logout();
              enqueueToast(
                "Spotify 세션이 만료되어 다시 로그인해 주세요.",
                "spotify_refresh_invalid_generation",
                "warning",
              );
              router.replace("/auth/spotify-login" as any);
              return;
            }
            const isAccessTokenLikelyExpired =
              !spotifyTokens?.expiresAt ||
              Date.now() > spotifyTokens.expiresAt - 5_000;
            if (isAccessTokenLikelyExpired) {
              // 만료 토큰 재사용 시 401 병렬 요청이 폭증하므로 Spotify 경로를 비활성화한다.
              accessToken = null;
              console.warn(
                "[home] spotify token unavailable after refresh failure; using non-spotify fallback.",
              );
            }
          }
        }
        let result: RecommendationOutput | null = null;
        let fastResult: RecommendationOutput | null = null;
        let fastFailedByTimeout = false;
        const buildImmediateTimeoutResult = () => {
          const partial = consumeFastWorkingRecommendation({
            moodInput: finalPrompt,
            spotifyBootstrap,
            maxAgeMs: 180_000,
            requestId,
          });
          if (partial?.tracks?.length) return partial;
          const targetMinutes = estimateTargetMinutes(selections.length);
          const seedTracks = buildBootstrapSeedTracks(spotifyBootstrap, 140);
          const avoidTrackIds = new Set(previousTrackIds);
          const timeoutTracks = buildPromptAwareFallbackTracks({
            seedTracks,
            prompt: finalPrompt,
            targetMinutes,
            avoidTrackIds,
          });
          return {
            tracks: timeoutTracks.length ? timeoutTracks : MOCK_TRACKS,
            playlistName: "빠른 추천 플레이리스트",
          };
        };
        const waitAndConsumeFastWorking = async (
          waitMs = 4200,
          stepMs = 220,
        ) => {
          const deadline = Date.now() + waitMs;
          while (Date.now() < deadline) {
            const partial = consumeFastWorkingRecommendation({
              moodInput: finalPrompt,
              spotifyBootstrap,
              maxAgeMs: 180_000,
              requestId,
            });
            if (partial?.tracks?.length) return partial;
            await new Promise(resolve => setTimeout(resolve, stepMs));
          }
          return null;
        };
        const fastBudgetMs = Math.min(
          FAST_ANALYSIS_TIMEOUT_MS,
          Math.max(10_000, PLAYLIST_GENERATION_TIMEOUT_MS - 8_000),
        );
        const handleAnalysisProgress = (event: AnalysisProgressEvent) => {
          if (
            event.requestId &&
            event.requestId !== activeRequestIdRef.current
          ) {
            console.warn(
              `[Playlist] stale response dropped requestId=${event.requestId} activeRequestId=${activeRequestIdRef.current || "-"} context=progress`,
            );
            return;
          }
          if (dropIfStale("progress")) return;
          const safeStep = Math.max(0, Math.min(2, Number(event.step ?? 0))) as
            | 0
            | 1
            | 2;
          const safeProgress = Math.max(
            0.08,
            Math.min(0.99, Number(event.progress ?? 0.1)),
          );
          const queryInfo =
            (event.queryTotal ?? 0) > 0
              ? ` (${Math.min(event.queryDone ?? 0, event.queryTotal ?? 0)}/${event.queryTotal})`
              : "";
          const label =
            event.label ??
            (safeStep === 0
              ? LOADING_PHASE_LABELS[0]
              : safeStep === 1
                ? LOADING_PHASE_LABELS[1]
                : LOADING_PHASE_LABELS[2]);
          setAnalysisProgress(prev => ({
            progress: Math.max(prev.progress, safeProgress),
            step: safeStep,
            label: `${label}${queryInfo}`,
            analysisStatus: event.analysisStatus ?? prev.analysisStatus,
            queryDone: event.queryDone ?? prev.queryDone,
            queryTotal: event.queryTotal ?? prev.queryTotal,
          }));
        };
        const fastMaxDurationMs = Math.max(15_000, fastBudgetMs);
        console.warn("[Home] analyze start", { requestId });

        try {
          result = await analyzeMoodAndRecommendFast(
            {
              moodInput: finalPrompt,
              spotifyUser,
              spotifyBootstrap,
              spotifyAccessToken: accessToken,
              requestId,
              abortSignal: abortController.signal,
            },
            {
              maxDurationMs: fastMaxDurationMs,
              onProgress: handleAnalysisProgress,
              requestId,
              abortSignal: abortController.signal,
            },
          );
          if (dropIfStale("fast_result")) return;
          fastResult = result;
          if (activeRequestIdRef.current !== requestId) {
            console.warn("[Home] stale result ignored", requestId);
            return;
          }
          enqueueToast(
            "프롬프트 핵심 기반 빠른 분석으로 추천했어요.",
            "prompt_first_fast_primary",
            "info",
          );
        } catch (fastErr) {
          const fastMsg = String((fastErr as Error)?.message ?? fastErr);
          if (
            fastMsg.includes("CancelledRecommendationError") ||
            fastMsg.includes("[Playlist] pipeline aborted")
          ) {
            console.warn(`[home] fast pipeline aborted requestId=${requestId}`);
            return;
          }
          fastFailedByTimeout =
            fastMsg.includes("fast analysis timeout") ||
            fastMsg.toLowerCase().includes("timed out") ||
            fastMsg.toLowerCase().includes("timeout");
          if (fastFailedByTimeout) {
            console.warn(
              `[home] fast analysis timeout treated as partial-finalize: ${fastMsg}`,
            );
          } else {
            console.warn(`[home] fast analysis failed: ${fastMsg}`);
          }
          if (fastFailedByTimeout) {
            const waitedPartial = await waitAndConsumeFastWorking();
            result = (waitedPartial ??
              buildImmediateTimeoutResult()) as RecommendationOutput;
            if (dropIfStale("fast_timeout_partial")) return;
            fastResult = result;
            setRequestState("partial");
            enqueueToast(
              "분석 지연으로 현재 데이터로 먼저 추천했어요.",
              "fast_partial_return_workingset",
              "info",
            );
          }
        }

        if (!result && !ENABLE_FULL_ANALYSIS_AFTER_FAST) {
          throw new Error("fast analysis timeout");
        }
        const shouldRunFullMerge =
          ENABLE_FULL_ANALYSIS_AFTER_FAST &&
          (!result || result.status === "failed");
        if (shouldRunFullMerge) {
          const fullResult = await analyzeMoodAndRecommend({
            moodInput: finalPrompt,
            spotifyUser,
            spotifyBootstrap,
            spotifyAccessToken: accessToken,
            requestId,
            abortSignal: abortController.signal,
          });
          if (dropIfStale("full_result")) return;
          if (activeRequestIdRef.current !== requestId) {
            console.warn("[Home] stale result ignored", requestId);
            return;
          }
          result = mergeRecommendationOutputs({
            fast: fastResult ?? result,
            full: fullResult,
            prompt: finalPrompt,
            targetMinutes: estimateTargetMinutes(selections.length),
            previousTrackIds,
            seedTracks: buildBootstrapSeedTracks(spotifyBootstrap, 180),
          });
        }
        if (!result) throw new Error("playlist generation timeout");
        const {
          tracks: generatedTracks,
          playlistName,
          fallbackReason,
          status: resultStatusRaw,
        } = result;
        const resultStatus =
          resultStatusRaw ??
          (generatedTracks.length ? "success" : "failed");
        console.warn("[Home] analyze resolved", {
          requestId,
          status: resultStatus,
          trackCount: generatedTracks.length,
        });

        if (dropIfStale("before_finalize")) return;
        if (fallbackReason === "gemini_quota_exceeded") {
          enqueueToast(
            "Gemini 쿼터가 초과되어 Spotify 기반 추천으로 생성했어요.",
            "gemini_quota_exceeded",
            "warning",
          );
        }

        if (resultStatus === "failed") {
          setTracks(() => []);
          setCurrentPlaylist(null);
          console.warn("[Home] setPlaylist count", 0);
          console.warn("[Home] setGenerationState", {
            requestId,
            state: "failed",
          });
          setRequestState("failed");
          enqueueToast(
            "플레이리스트 생성에 실패했습니다.",
            "playlist_generation_failed",
            "warning",
          );
          return;
        }
        const nextTracks = Array.isArray(generatedTracks) ? generatedTracks : [];
        lastGeneratedTrackIdsRef.current = new Set(
          nextTracks.map(t => String(t.id ?? "").trim()).filter(Boolean),
        );
        const totalMins = nextTracks.reduce((sum: number, t: Track) => {
          const [m, s] = t.duration.split(":").map(Number);
          return sum + m + s / 60;
        }, 0);
        setCurrentPlaylist({
          id: "gen_1",
          name: playlistName || "AI 추천 플레이리스트",
          coverEmoji: "♬",
          gradientStart: "#1a2535",
          gradientEnd: "#0e1822",
          trackCount: nextTracks.length,
          duration: `${Math.max(1, Math.round(totalMins))}분`,
          liked: false,
          tracks: nextTracks,
          createdAt: new Date(),
          moodInput: finalPrompt,
        });
        setTracks(() => nextTracks);
        console.warn("[Home] setPlaylist count", nextTracks.length);
        console.warn("[Home] setPlaylist replace", {
          requestId,
          nextCount: nextTracks.length,
        });
        if (resultStatus === "partial") {
          console.warn("[Home] setGenerationState", {
            requestId,
            state: "partial-completed",
          });
          setRequestState("partial");
        } else {
          console.warn("[Home] setGenerationState", {
            requestId,
            state: "completed",
          });
          setRequestState("complete");
        }
        timers.push(setTimeout(() => !cancelled && goTo("preview"), 2450));
      } catch (error) {
        console.warn(
          `[home] playlist generation failed: ${String((error as Error)?.message ?? error)}`,
        );
        const errMsg = String((error as Error)?.message ?? error);
        if (
          errMsg.includes("CancelledRecommendationError") ||
          errMsg.includes("[Playlist] pipeline aborted")
        ) {
          console.warn(
            `[home] playlist pipeline aborted requestId=${requestId}`,
          );
          return;
        }
        if (dropIfStale("error_fallback")) return;
        setRequestState("failed");
        const msg = String((error as Error)?.message ?? error);
        if (msg.includes("(429)") || msg.toLowerCase().includes("quota")) {
          enqueueToast(
            "Gemini 쿼터가 초과되어 Spotify 기반 추천으로 생성했어요.",
            "gemini_quota_exceeded_error",
            "warning",
          );
        }
        const fallbackPrompt =
          requestPrompt || composePrompt(moodText, selections);
        // 새 요청 실패 시 이전 추천 재사용 금지: 현재 요청 프롬프트 기준 fallback만 생성한다.
        const avoidTrackIds = new Set(requestPreviousTrackIds);
        const fallbackTracks = buildPromptAwareFallbackTracks({
          seedTracks: buildBootstrapSeedTracks(spotifyBootstrap, 140),
          prompt: fallbackPrompt,
          targetMinutes: estimateTargetMinutes(selections.length),
          avoidTrackIds,
        });
        const finalFallbackTracks = applyNoveltyPolicy({
          tracks: fallbackTracks.length ? fallbackTracks : MOCK_TRACKS,
          prompt: fallbackPrompt,
          targetMinutes: estimateTargetMinutes(selections.length),
          seedTracks: buildBootstrapSeedTracks(spotifyBootstrap, 140),
          previousTrackIds: requestPreviousTrackIds,
          minNewRatio: 0.6,
          maxOldRatio: 0.2,
        });
        lastGeneratedTrackIdsRef.current = new Set(
          finalFallbackTracks
            .map(t => String(t.id ?? "").trim())
            .filter(Boolean),
        );
        const fallbackTotalMins = finalFallbackTracks.reduce(
          (sum: number, t: Track) => {
            const [m, s] = t.duration.split(":").map(Number);
            return sum + m + s / 60;
          },
          0,
        );
        setCurrentPlaylist({
          id: "gen_1",
          name: "AI 추천 플레이리스트",
          coverEmoji: "♬",
          gradientStart: "#1a2535",
          gradientEnd: "#0e1822",
          trackCount: finalFallbackTracks.length,
          duration: `${Math.max(1, Math.round(fallbackTotalMins || 65))}분`,
          liked: false,
          tracks: finalFallbackTracks,
          createdAt: new Date(),
          moodInput: fallbackPrompt,
        });
        setTracks(finalFallbackTracks);
        timers.push(setTimeout(() => !cancelled && goTo("preview"), 2300));
      } finally {
        console.warn("[Home] setLoading(false)", { requestId });
        isRunningRecommendationRef.current = false;
        console.warn("[Home] recommendation finalized", { requestId });
      }
    };

    run();
    return () => {
      cancelled = true;
      isRunningRecommendationRef.current = false;
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
      }
      activeRequestIdRef.current = "";
      timers.forEach(clearTimeout);
    };
  }, [phase]);

  function goTo(next: Phase) {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start(() => {
      setPhase(next);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 280,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start();
    });
  }

  function startGeneration(sourceInput?: unknown) {
    if (!moodText.trim()) return;
    if (requestState === "loading") {
      console.warn("[Home] recommendation trigger skipped reason=loading");
      return;
    }
    if (isRunningRecommendationRef.current) {
      console.warn("[Home] recommendation trigger skipped reason=already_running");
      return;
    }
    const source: "button" | "retry" =
      sourceInput === "retry" ? "retry" : "button";
    if (isStartingRecommendationRef.current) {
      console.warn(
        `[Home] recommendation trigger source=${source} skipped reason=start_in_progress`,
      );
      return;
    }
    isStartingRecommendationRef.current = true;
    recommendationTriggerSourceRef.current = source;
    pendingRecommendationStartRef.current = true;
    console.warn(`[Home] recommendation trigger source=${source}`);
    const finalPrompt = composePrompt(moodText, selections);
    setMoodInput(finalPrompt);
    goTo("loading");
  }

  function refreshMoodSuggestions() {
    setMoodSuggestions(prev =>
      pickMoodSuggestions(
        MOOD_SUGGESTION_COUNT,
        prev.map(v => v.id),
      ),
    );
  }

  function resetMoodText() {
    setMoodText("");
  }

  function resetAllSettings() {
    setSelections({
      genre: [],
      length: null,
      mood: null,
      era: null,
      pop: null,
    });
  }

  function openSettingPicker(id: SettingId) {
    setSettingPickerTarget(id);
  }

  function selectSettingOption(id: SettingId, option: SettingOption) {
    setSelections(prev => {
      if (id === "genre") {
        const exists = prev.genre.some(v => v.label === option.label);
        return {
          ...prev,
          genre: exists
            ? prev.genre.filter(v => v.label !== option.label)
            : [...prev.genre, option],
        };
      }
      return { ...prev, [id]: option };
    });
    if (id !== "genre") {
      setSettingPickerTarget(null);
    }
  }

  function clearSettingOption(id: SettingId) {
    setSelections(prev => {
      if (id === "genre") return { ...prev, genre: [] };
      return { ...prev, [id]: null };
    });
    setSettingPickerTarget(null);
  }

  function deleteTrack(id: string) {
    setTracks(prev => prev.filter(t => t.id !== id));
  }

  function toggleLike(id: string) {
    let nextLiked: boolean | null = null;
    setTracks(prev =>
      prev.map(t => {
        if (t.id !== id) return t;
        const updated = { ...t, liked: !t.liked };
        nextLiked = updated.liked;
        return updated;
      }),
    );
    setSelectedTrack(prev =>
      prev && prev.id === id && nextLiked !== null
        ? { ...prev, liked: nextLiked }
        : prev,
    );
  }

  function openTrack(track: Track) {
    setSelectedTrack(track);
    setShowModal(true);
  }

  useEffect(() => {
    if (!selectedTrack) return;
    const latest = tracks.find(t => t.id === selectedTrack.id);
    if (latest) setSelectedTrack(latest);
  }, [selectedTrack?.id, tracks]);

  async function saveToSpotify() {
    if (saving) return;
    setSaving(true);

    const basePlaylist = useAppStore.getState().currentPlaylist;
    if (!basePlaylist) {
      router.push("/result/gen_1" as any);
      setSaving(false);
      return;
    }

    if (!spotifyTokens?.accessToken || !spotifyUser?.id) {
      router.push("/result/gen_1" as any);
      setSaving(false);
      return;
    }

    const uris = tracks
      .map(t => t.spotifyUri)
      .filter((v): v is string => Boolean(v));
    if (!uris.length) {
      router.push("/result/gen_1" as any);
      setSaving(false);
      return;
    }

    try {
      let accessToken = spotifyTokens.accessToken;
      if (
        spotifyTokens.refreshToken &&
        spotifyTokens.expiresAt &&
        Date.now() > spotifyTokens.expiresAt - 30_000
      ) {
        try {
          const refreshed = await refreshSpotifyAccessToken({
            refreshToken: spotifyTokens.refreshToken,
          });
          setTokens(refreshed);
          accessToken = refreshed.accessToken;
        } catch (refreshErr) {
          const refreshMsg = String(
            (refreshErr as Error)?.message ?? refreshErr,
          );
          console.warn(
            `[home] spotify refresh failed while saving: ${refreshMsg}`,
          );
          const isRefreshInvalid = isHardRefreshTokenInvalid(refreshMsg);
          if (isRefreshInvalid) {
            logout();
            enqueueToast(
              "Spotify 세션이 만료되어 다시 로그인해 주세요.",
              "spotify_refresh_invalid_save",
              "warning",
            );
            router.replace("/auth/spotify-login" as any);
            setSaving(false);
            return;
          }
          const isAccessTokenLikelyExpired =
            !spotifyTokens.expiresAt ||
            Date.now() > spotifyTokens.expiresAt - 5_000;
          if (isAccessTokenLikelyExpired) {
            Alert.alert(
              "Spotify 저장 실패",
              "Spotify 세션 갱신에 실패했어요. 다시 로그인한 뒤 저장해 주세요.",
            );
            setSaving(false);
            return;
          }
        }
      }

      let saved = await savePlaylistToSpotify(
        accessToken,
        spotifyUser.id,
        basePlaylist.name,
        uris,
        basePlaylist.spotifyId,
      );
      if (!saved && spotifyTokens.refreshToken) {
        try {
          const refreshed = await refreshSpotifyAccessToken({
            refreshToken: spotifyTokens.refreshToken,
          });
          setTokens(refreshed);
          saved = await savePlaylistToSpotify(
            refreshed.accessToken,
            spotifyUser.id,
            basePlaylist.name,
            uris,
            basePlaylist.spotifyId,
          );
        } catch (retryErr) {
          console.warn(
            `[home] spotify save retry failed: ${String((retryErr as Error)?.message ?? retryErr)}`,
          );
        }
      }
      if (!saved) {
        throw new Error("spotify save failed: empty result");
      }
      const updated = {
        ...basePlaylist,
        tracks,
        trackCount: tracks.length,
        spotifyId: saved?.id,
        spotifyUrl: saved?.externalUrl,
      };
      setCurrentPlaylist(updated);
      addPlaylist(updated);
      router.push({
        pathname: "/result/[id]",
        params: { id: updated.id || "gen_1" },
      } as any);
    } catch (err) {
      console.warn(
        `[home] save playlist failed: ${String((err as Error)?.message ?? err)}`,
      );
      const msg = String((err as Error)?.message ?? err);
      const needsRelogin =
        msg.includes("권한(scope) 부족") ||
        msg.includes("인증 만료") ||
        msg.toLowerCase().includes("insufficient_scope") ||
        msg.toLowerCase().includes("invalid_token");
      const isTimeout = msg.toLowerCase().includes("timeout");
      const isRateLimit =
        msg.includes("(429)") ||
        msg.includes("요청 한도 초과") ||
        msg.toLowerCase().includes("too many requests");
      Alert.alert(
        "Spotify 저장 실패",
        isTimeout
          ? "Spotify 응답이 지연되어 저장을 완료하지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해 주세요."
          : isRateLimit
            ? "Spotify 요청 한도(429)에 걸렸어요. 30~90초 후 다시 저장해 주세요."
            : needsRelogin
              ? "Spotify 권한 또는 인증이 만료되어 저장하지 못했어요. Spotify를 다시 로그인한 뒤 다시 시도해 주세요."
              : "Spotify 앱 설정 또는 계정 권한 문제로 저장에 실패했어요. Spotify Developer Dashboard에서 User Management(사용자 등록)와 앱 권한을 확인해 주세요.",
      );
    } finally {
      setSaving(false);
    }
  }
  const canGenerate = moodText.trim().length > 0;
  const canResetInput = moodText.trim().length > 0;
  const canResetSettings =
    selections.genre.length > 0 ||
    Boolean(selections.length) ||
    Boolean(selections.mood) ||
    Boolean(selections.era) ||
    Boolean(selections.pop);
  const finalPrompt = composePrompt(moodText, selections);

  return (
    <ScreenBackground intensity="strong">
      <StatusBar barStyle="light-content" />
      <Animated.View style={[{ flex: 1 }, { opacity: fadeAnim }]}>
        <ToastOverlay
          queue={toastQueue}
          topInset={insets.top + 10}
          onShift={shiftToast}
        />
        {phase === "syncing" && (
          <SyncingView insets={insets} userFirstName={userFirstName} />
        )}
        {phase === "home" && (
          <HomeInputView
            insets={insets}
            userFirstName={userFirstName}
            moodText={moodText}
            setMoodText={setMoodText}
            moodSuggestions={moodSuggestions}
            onRefreshMoods={refreshMoodSuggestions}
            onResetInput={resetMoodText}
            canResetInput={canResetInput}
            canGenerate={canGenerate}
            finalPrompt={finalPrompt}
            selections={selections}
            onOpenSetting={openSettingPicker}
            onResetSettings={resetAllSettings}
            canResetSettings={canResetSettings}
            onGenerate={startGeneration}
          />
        )}
        {phase === "loading" && (
          <LoadingView
            insets={insets}
            step={loadingStep}
            requestState={requestState}
            tracks={tracks}
            analysisProgress={analysisProgress}
          />
        )}
        {phase === "preview" && (
          <PreviewView
            insets={insets}
            tracks={tracks}
            onBack={() => goTo("home")}
            onTrackPress={openTrack}
            onDelete={deleteTrack}
            onLike={toggleLike}
            onSave={saveToSpotify}
            saving={saving}
          />
        )}
      </Animated.View>

      <TrackDetailModal
        track={selectedTrack}
        visible={showModal}
        onClose={() => setShowModal(false)}
        onLike={toggleLike}
      />
      <SettingPickerModal
        target={settingPickerTarget}
        visible={Boolean(settingPickerTarget)}
        current={settingPickerTarget ? selections[settingPickerTarget] : null}
        selections={selections}
        onClose={() => setSettingPickerTarget(null)}
        onSelect={selectSettingOption}
        onClear={clearSettingOption}
      />
    </ScreenBackground>
  );
}

// ════════════════════════════════════════════════════════
//  S2 — SYNCING VIEW
// ════════════════════════════════════════════════════════
const SYNC_STEPS = [
  "계정 연결 상태 확인",
  "취향 데이터 동기화",
  "맞춤 추천 환경 준비",
];

function SettingPickerModal({
  visible,
  target,
  current,
  selections,
  onClose,
  onSelect,
  onClear,
}: {
  visible: boolean;
  target: SettingId | null;
  current: SettingOption | SettingOption[] | null;
  selections: SettingSelection;
  onClose: () => void;
  onSelect: (id: SettingId, option: SettingOption) => void;
  onClear: (id: SettingId) => void;
}) {
  if (!target) return null;
  const meta = GENRE_TOGGLES.find(v => v.id === target);
  const options = SETTING_OPTIONS[target];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.settingModalBackdrop} onPress={onClose} />
      <View style={styles.settingModalSheet}>
        <Text style={styles.settingModalTitle}>
          {meta?.label ?? "설정 선택"}
        </Text>
        <Text style={styles.settingModalSub}>{meta?.desc}</Text>

        <View style={styles.settingOptionList}>
          {options.map(option => {
            const selected =
              target === "genre"
                ? selections.genre.some(v => v.label === option.label)
                : (current as SettingOption | null)?.label === option.label;
            return (
              <TouchableOpacity
                key={option.label}
                style={[
                  styles.settingOptionItem,
                  selected && styles.settingOptionItemSelected,
                ]}
                onPress={() => onSelect(target, option)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.settingOptionLabel,
                    selected && styles.settingOptionLabelSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.settingModalActions}>
          <TouchableOpacity
            style={styles.settingActionGhost}
            onPress={() => onClear(target)}
            activeOpacity={0.8}
          >
            <Text style={styles.settingActionGhostText}>선택 해제</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingActionPrimary}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text style={styles.settingActionPrimaryText}>
              {target === "genre"
                ? `확인 (${selections.genre.length}개 선택)`
                : "확인"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function SyncingView({ insets, userFirstName }: any) {
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [syncStep, setSyncStep] = useState(0);
  const [syncDone, setSyncDone] = useState(false);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 3200,
      useNativeDriver: false,
    }).start();

    const t1 = setTimeout(() => setSyncStep(1), 850);
    const t2 = setTimeout(() => setSyncStep(2), 1750);
    const t3 = setTimeout(() => setSyncDone(true), 2550);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View
      style={[
        styles.centered,
        styles.syncScreen,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 18 },
      ]}
    >
      <View style={styles.syncHeaderBlock}>
        <View style={styles.syncHeader}>
          <LogoIcon size={56} radius={16} animated />
          <View>
            <Text style={styles.syncTitle}>안녕하세요, {userFirstName}님!</Text>
            <Text style={styles.syncSub}>데이터를 동기화하고 있어요</Text>
          </View>
        </View>
      </View>

      <View style={styles.syncWaveContainer}>
        <Waveform
          barCount={58}
          height={Math.round(H * 0.36)}
          active
          intensity={0.62}
          mode="analyzing"
        />
      </View>

      <View style={styles.syncBottomBlock}>
        <View style={styles.syncStepStack}>
          {SYNC_STEPS.map((label, i) => {
            const isDone =
              i < syncStep || (syncDone && i === SYNC_STEPS.length - 1);
            const isActive = !syncDone && i === syncStep;
            return (
              <GlassCard
                key={i}
                style={[
                  styles.syncStep,
                  ...(isDone ? [styles.syncStepDoneCard] : []),
                ]}
                padding={14}
              >
                <View
                  style={[
                    styles.syncStepDot,
                    isDone && styles.syncStepDotDone,
                    isActive && styles.stepDotActive,
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      color: isDone ? "#000" : Colors.t3,
                      fontWeight: "700",
                    }}
                  >
                    {isDone ? "✓" : i + 1}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.syncStepText,
                    (isDone || isActive) && { color: Colors.t1 },
                  ]}
                >
                  {label}
                </Text>
                <Text
                  style={[
                    styles.syncStepStatus,
                    {
                      color: isDone
                        ? Colors.green
                        : isActive
                          ? Colors.t2
                          : Colors.t3,
                    },
                  ]}
                >
                  {isDone ? "완료" : isActive ? "진행중" : "대기"}
                </Text>
              </GlassCard>
            );
          })}
        </View>

        <View style={[styles.progressTrack, styles.syncProgressTrack]}>
          <Animated.View
            style={[styles.progressBar, { width: progressWidth }]}
          />
        </View>
        {syncDone ? (
          <View style={styles.syncDonePanel}>
            <Text style={styles.syncDoneCheck}>✓</Text>
            <Text style={styles.syncDoneText}>
              3/3 완료 · 홈 화면으로 이동 중
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ════════════════════════════════════════════════════════
//  S3 — HOME INPUT VIEW
// ════════════════════════════════════════════════════════
function HomeInputView({
  insets,
  userFirstName,
  moodText,
  setMoodText,
  moodSuggestions,
  onRefreshMoods,
  onResetInput,
  canResetInput,
  canGenerate,
  finalPrompt,
  selections,
  onOpenSetting,
  onResetSettings,
  canResetSettings,
  onGenerate,
}: any) {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () =>
      setIsKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener("keyboardDidHide", () =>
      setIsKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerLeft}>
          <LogoIcon size={44} radius={13} animated={false} />
          <View>
            <Text style={styles.brandName}>MoodTune</Text>
            <Text style={styles.brandSub}>AI 플레이리스트 메이커</Text>
          </View>
        </View>
        {/* 아바타 */}
        <TouchableOpacity onPress={() => router.push("/(tabs)/profile" as any)}>
          <LogoIcon size={38} circular animated={false} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.homeBody,
          { paddingBottom: insets.bottom + HOME_SCROLL_BOTTOM_SPACER },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 인사말 */}
        <View style={styles.greetRow}>
          <Text style={styles.greetTitle}>안녕하세요 {userFirstName}님</Text>
          <View style={styles.greetIconWrap}>
            <Hand size={16} color={Colors.greenL} strokeWidth={2.2} />
          </View>
        </View>
        <Text style={styles.greetSub}>오늘 어떤 기분인가요?</Text>

        {/* 무드 텍스트 입력 */}
        <View style={styles.inputWrapper}>
          <View style={styles.inputHeaderRow}>
            <Text style={styles.inputHeaderTitle}>사용자 입력</Text>
            <TouchableOpacity
              style={[
                styles.inlineResetBtn,
                canResetInput
                  ? styles.inlineResetBtnActive
                  : styles.inlineResetBtnDisabled,
              ]}
              onPress={onResetInput}
              disabled={!canResetInput}
              activeOpacity={0.75}
            >
              <RefreshCw
                size={13}
                color={canResetInput ? Colors.greenL : Colors.t3}
                strokeWidth={2.2}
              />
              <Text
                style={[
                  styles.inlineResetText,
                  canResetInput
                    ? styles.inlineResetTextActive
                    : styles.inlineResetTextDisabled,
                ]}
              >
                리셋
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.moodInput}
            value={moodText}
            onChangeText={setMoodText}
            placeholder="지금 기분이나 원하는 음악을 알려주세요&#10;예: 비오는 날 카페에서 듣는 재즈..."
            placeholderTextColor={Colors.t3}
            multiline
            maxLength={200}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{moodText.length}/200</Text>
        </View>
        <View style={styles.promptPreviewCard}>
          <View style={styles.promptPreviewGlow} />
          <View style={styles.promptPreviewHeader}>
            <View style={styles.promptPreviewTitleWrap}>
              <Sparkles size={14} color={Colors.greenL} strokeWidth={2.2} />
              <Text style={styles.promptPreviewTitle}>생성될 프롬프트</Text>
            </View>
            <View style={styles.promptPreviewBadge}>
              <Text style={styles.promptPreviewBadgeText}>AI READY</Text>
            </View>
          </View>
          <Text style={styles.promptPreviewText}>
            {finalPrompt || "입력 후 생성 가능합니다."}
          </Text>
        </View>

        {/* 무드 추천 알약 */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>추천 무드</Text>
          <TouchableOpacity
            style={styles.moodRefreshBtn}
            onPress={onRefreshMoods}
            activeOpacity={0.75}
          >
            <RefreshCw size={14} color={Colors.greenL} strokeWidth={2.2} />
            <Text style={styles.moodRefreshText}>새로고침</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.pillsGrid}>
          {moodSuggestions.map((p: MoodSuggestionItem) => (
            <TouchableOpacity
              key={p.id}
              style={styles.moodPill}
              onPress={() => setMoodText(p.text)}
              activeOpacity={0.75}
            >
              <View style={styles.moodPillIconWrap}>
                <p.Icon size={14} color={Colors.greenL} strokeWidth={2.2} />
              </View>
              <Text style={styles.moodPillText}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 옵션 토글 */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>설정</Text>
          <TouchableOpacity
            style={[
              styles.inlineResetBtn,
              canResetSettings
                ? styles.inlineResetBtnActive
                : styles.inlineResetBtnDisabled,
            ]}
            onPress={onResetSettings}
            disabled={!canResetSettings}
            activeOpacity={0.75}
          >
            <RefreshCw
              size={13}
              color={canResetSettings ? Colors.greenL : Colors.t3}
              strokeWidth={2.2}
            />
            <Text
              style={[
                styles.inlineResetText,
                canResetSettings
                  ? styles.inlineResetTextActive
                  : styles.inlineResetTextDisabled,
              ]}
            >
              설정 리셋
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.toggleGrid}>
          {GENRE_TOGGLES.map(g => (
            <TouchableOpacity
              key={g.id}
              style={[
                styles.toggle,
                isSettingActive(selections, g.id) && styles.toggleActive,
              ]}
              onPress={() => onOpenSetting(g.id)}
              activeOpacity={0.75}
            >
              <View style={styles.toggleIconWrap}>
                <g.Icon
                  size={16}
                  color={
                    isSettingActive(selections, g.id) ? Colors.green : Colors.t2
                  }
                  strokeWidth={2.1}
                />
              </View>
              <View style={styles.toggleTextWrap}>
                <Text
                  style={[
                    styles.toggleLabel,
                    isSettingActive(selections, g.id) &&
                      styles.toggleLabelActive,
                  ]}
                >
                  {g.label}
                </Text>
                <Text
                  style={[
                    styles.toggleSubLabel,
                    isSettingActive(selections, g.id) &&
                      styles.toggleSubLabelActive,
                  ]}
                >
                  {selectionLabel(selections, g.id, g.desc)}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* CTA 버튼 */}
      {!isKeyboardVisible ? (
        <View
          style={[
            styles.ctaBar,
            { paddingBottom: insets.bottom + HOME_CTA_BOTTOM_OFFSET },
          ]}
        >
          <PrimaryButton
            label="플레이리스트 생성하기"
            onPress={onGenerate}
            disabled={!canGenerate}
            style={{ width: "100%" }}
          />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ════════════════════════════════════════════════════════
//  S4 — LOADING VIEW
// ════════════════════════════════════════════════════════
function LoadingView({ insets, requestState, analysisProgress }: any) {
  const progress = useRef(new Animated.Value(0.1)).current;
  const settledCardAnim = useRef(new Animated.Value(0)).current;
  const previewCardAnim = useRef(new Animated.Value(0)).current;
  const [visualStep, setVisualStep] = useState(0);
  const [phaseText, setPhaseText] = useState(LOADING_PHASE_LABELS[0]);
  const [previewCardIndex, setPreviewCardIndex] = useState(0);
  const progressLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewLoopStopRef = useRef(false);

  const isAnalyzing = requestState === "loading";
  const isComplete = requestState === "complete";
  const isFailed = requestState === "failed";
  const isSettled = isComplete || isFailed;
  const hasRealProgress = Boolean(analysisProgress);
  const currentStage = LP_STAGE_META[visualStep] ?? LP_STAGE_META[0];

  const loadingHeadline = isSettled
    ? isFailed
      ? "추천을 정리 중이에요"
      : "AI Playlist Ready"
    : "AI가 당신의 무드를 듣고 있어요";
  const loadingSubline = isSettled
    ? isFailed
      ? "잠시만요, 결과를 안정적으로 마무리하고 있어요"
      : "분석이 완료됐어요. 결과 카드를 준비하고 있어요"
    : phaseText;

  const safeProgressValue = clampNumber(
    Number(analysisProgress?.progress ?? 0.12),
    0.08,
    1,
  );

  const waveformIntensity = useMemo(() => {
    if (isSettled) return isFailed ? 0.8 : 0.92;
    if (safeProgressValue < 0.2) return 0.32;
    if (safeProgressValue < 0.8) return 0.44 + (safeProgressValue - 0.2) * 0.78;
    return 0.76;
  }, [isFailed, isSettled, safeProgressValue]);

  const waveformMode: "loading" | "analyzing" | "completed" = isSettled
    ? "completed"
    : isAnalyzing
      ? "analyzing"
      : "loading";

  const previewMessage = PREVIEW_CARD_MESSAGES[previewCardIndex];

  useEffect(() => {
    if (!isAnalyzing) return;

    setPhaseText("프롬프트를 분석하고 있어요");
    setVisualStep(0);
    setPreviewCardIndex(0);
    settledCardAnim.setValue(0);
    progress.setValue(0.1);

    progressLoopRef.current?.stop();
    let step1: ReturnType<typeof setTimeout> | null = null;
    let step2: ReturnType<typeof setTimeout> | null = null;
    let step3: ReturnType<typeof setTimeout> | null = null;

    if (!hasRealProgress) {
      progressLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(progress, {
            toValue: 0.4,
            duration: 1500,
            useNativeDriver: false,
          }),
          Animated.timing(progress, {
            toValue: 0.62,
            duration: 1300,
            useNativeDriver: false,
          }),
          Animated.timing(progress, {
            toValue: 0.82,
            duration: 1200,
            useNativeDriver: false,
          }),
        ]),
      );
      progressLoopRef.current.start();

      step1 = setTimeout(() => {
        setVisualStep(1);
        setPhaseText("분위기와 템포를 맞추고 있어요");
      }, 1200);
      step2 = setTimeout(() => {
        setVisualStep(3);
        setPhaseText("지금 듣기 좋은 흐름으로 정리하고 있어요");
      }, 2900);
      step3 = setTimeout(() => {
        setVisualStep(4);
        setPhaseText("추천 순서를 마지막으로 다듬고 있어요");
      }, 4600);
    }

    return () => {
      if (step1) clearTimeout(step1);
      if (step2) clearTimeout(step2);
      if (step3) clearTimeout(step3);
      progressLoopRef.current?.stop();
    };
  }, [hasRealProgress, isAnalyzing, progress, settledCardAnim]);

  useEffect(() => {
    if (!isAnalyzing || !hasRealProgress) return;

    const nextProgress = clampNumber(
      Number(analysisProgress?.progress ?? 0.1),
      0.08,
      0.99,
    );
    const apiStepRaw = Number(analysisProgress?.step ?? 0);
    const mappedApiStep =
      apiStepRaw <= 2
        ? Math.round((apiStepRaw / 2) * (LP_STAGE_META.length - 1))
        : Math.round(apiStepRaw);
    const mappedProgressStep = Math.floor(nextProgress * LP_STAGE_META.length);
    const nextStep = clampNumber(
      Math.max(mappedApiStep, mappedProgressStep),
      0,
      LP_STAGE_META.length - 1,
    );
    const nextLabel = String(analysisProgress?.label ?? "").trim();

    setVisualStep(nextStep);
    setPhaseText(nextLabel || LP_STAGE_META[nextStep].desc);

    progressLoopRef.current?.stop();
    Animated.timing(progress, {
      toValue: nextProgress,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [analysisProgress, hasRealProgress, isAnalyzing, progress]);

  useEffect(() => {
    if (isAnalyzing) return;

    progressLoopRef.current?.stop();
    setVisualStep(LP_STAGE_META.length - 1);
    setPhaseText(
      isFailed
        ? "분석 결과를 안정적으로 정리하고 있어요"
        : "분석이 끝났어요. 결과를 준비하고 있어요",
    );

    Animated.timing(progress, {
      toValue: 1,
      duration: 520,
      useNativeDriver: false,
    }).start();
    Animated.timing(settledCardAnim, {
      toValue: 1,
      duration: 320,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [isAnalyzing, isFailed, progress, settledCardAnim]);

  useEffect(() => {
    previewLoopStopRef.current = false;
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);

    if (!isAnalyzing) {
      Animated.timing(previewCardAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start();
      return () => {
        previewLoopStopRef.current = true;
        previewCardAnim.stopAnimation();
      };
    }

    const loopPreview = () => {
      if (previewLoopStopRef.current) return;

      Animated.sequence([
        Animated.timing(previewCardAnim, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.delay(1200),
        Animated.timing(previewCardAnim, {
          toValue: 0,
          duration: 260,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start(({ finished }) => {
        if (!finished || previewLoopStopRef.current) return;
        setPreviewCardIndex(prev => (prev + 1) % PREVIEW_CARD_MESSAGES.length);
        previewTimeoutRef.current = setTimeout(loopPreview, 140);
      });
    };

    loopPreview();

    return () => {
      previewLoopStopRef.current = true;
      previewCardAnim.stopAnimation();
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    };
  }, [isAnalyzing, previewCardAnim]);

  useEffect(() => {
    return () => {
      progressLoopRef.current?.stop();
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    };
  }, []);

  const previewCardOpacity = previewCardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const previewCardTranslate = previewCardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });
  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });
  const settledCardOpacity = settledCardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const settledCardTranslate = settledCardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
  });

  return (
    <View
      style={[
        styles.centered,
        styles.loadingStage,
        { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 18 },
      ]}
    >
      <View style={styles.loadingHeroGroup}>
        <View style={styles.loadingTopBlock}>
          <View style={styles.loadingLogoWrap}>
            <LogoIcon size={78} radius={22} animated />
          </View>
          <Text style={styles.loadingHeadline}>{loadingHeadline}</Text>
          <Text style={styles.loadingBody}>{loadingSubline}</Text>
        </View>
      </View>

      <View style={styles.loadingLowerGroup}>
        <View style={styles.loadingWaveContainer}>
          <View style={styles.loadingWaveLift}>
            <Waveform
              barCount={56}
              height={Math.round(H * 0.37)}
              active={isAnalyzing || isSettled}
              intensity={waveformIntensity}
              mode={waveformMode}
            />
          </View>
        </View>

        <View style={styles.loadingBottomBlock}>
          <View style={styles.loadingInfoSlot}>
            {isSettled ? (
              <Animated.View
                style={[
                  styles.resultMorphCard,
                  {
                    opacity: settledCardOpacity,
                    transform: [{ translateY: settledCardTranslate }],
                  },
                ]}
              >
                <View style={styles.resultMorphIconWrap}>
                  {isFailed ? (
                    <Music2 size={19} color={Colors.greenL} strokeWidth={2.4} />
                  ) : (
                    <Sparkles size={19} color={Colors.greenL} strokeWidth={2.4} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultMorphTitle}>
                    {isFailed ? "추천 플레이리스트 정리 중" : "AI Playlist Ready"}
                  </Text>
                  <Text style={styles.resultMorphMeta}>
                    {isFailed
                      ? "분석 결과를 안정적으로 정리하고 있어요"
                      : "지금 듣기 좋은 흐름으로 정리됐어요"}
                  </Text>
                </View>
              </Animated.View>
            ) : (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.previewCardFloating,
                  {
                    opacity: previewCardOpacity,
                    transform: [{ translateY: previewCardTranslate }],
                  },
                ]}
              >
                <Text style={styles.previewCardTitle}>AI PREVIEW</Text>
                <Text style={styles.previewCardBody} numberOfLines={1}>
                  {previewMessage}
                </Text>
              </Animated.View>
            )}
          </View>

          <View style={styles.progressSection}>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[styles.progressBar, { width: progressWidth }]}
              />
            </View>
            <View style={styles.progressMetaRow}>
              <Text style={styles.progressMetaKey}>
                {isSettled ? (isFailed ? "정리중" : "완료") : currentStage.label}
              </Text>
              <Text style={styles.progressMetaText} numberOfLines={1}>
                {phaseText}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
//  S5 — PREVIEW VIEW (트랙 목록)
// ════════════════════════════════════════════════════════
function PreviewView({
  insets,
  tracks,
  onBack,
  onTrackPress,
  onDelete,
  onLike,
  onSave,
  saving,
}: any) {
  const totalTracks = tracks.length;
  const totalMins = tracks.reduce((sum: number, t: Track) => {
    const [m, s] = t.duration.split(":").map(Number);
    return sum + m + s / 60;
  }, 0);

  return (
    <View style={{ flex: 1 }}>
      {/* 헤더 */}
      <View style={[styles.pvHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn2}
          onPress={onBack}
          activeOpacity={0.85}
        >
          <View style={styles.backBtn2IconWrap}>
            <ChevronLeft size={16} color={Colors.greenL} strokeWidth={2.7} />
          </View>
          <Text style={styles.backBtnText2}>돌아가기</Text>
        </TouchableOpacity>
        <Text style={styles.pvTitle}>AI 추천 플레이리스트</Text>
        <Text style={styles.pvMeta}>
          총{" "}
          <Text style={{ color: Colors.greenL, fontWeight: "600" }}>
            {totalTracks}곡
          </Text>{" "}
          · 약{" "}
          <Text style={{ color: Colors.greenL, fontWeight: "600" }}>
            {Math.round(totalMins)}분
          </Text>{" "}
          분량
        </Text>
      </View>

      {/* 트랙 목록 */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.trackList, { paddingBottom: 220 }]}
        showsVerticalScrollIndicator={false}
      >
        {tracks.map((track: Track, i: number) => (
          <TrackItem
            key={track.id}
            track={track}
            index={i}
            onPress={onTrackPress}
            onDelete={onDelete}
            onLike={onLike}
          />
        ))}
      </ScrollView>

      {/* 하단 저장 바 */}
      <View
        style={[
          styles.pvBar,
          {
            bottom: PREVIEW_BAR_BOTTOM_OFFSET,
            paddingBottom: Math.max(8, insets.bottom * 0.25),
          },
        ]}
      >
        <GlassCard style={styles.pvBarInfo} padding={10}>
          <Music2 size={14} color={Colors.t2} strokeWidth={2.1} />
          <Text
            style={{
              fontSize: FontSize.sm,
              color: Colors.t2,
              fontWeight: "600",
            }}
          >
            {totalTracks}곡
          </Text>
          <View style={styles.pvBarSep} />
          <View style={styles.pvMetaRow}>
            <Timer size={13} color={Colors.t2} strokeWidth={2.1} />
            <Text style={{ fontSize: FontSize.sm, color: Colors.t2 }}>
              {Math.round(totalMins)}분
            </Text>
          </View>
          <View style={styles.pvBarSep} />
          <Text style={{ fontSize: FontSize.xs, color: Colors.t3 }}>
            ← 밀어서 삭제
          </Text>
        </GlassCard>
        <PrimaryButton
          label="Spotify에 저장하기"
          onPress={onSave}
          loading={saving}
          style={styles.pvSaveBtn}
          fontSize={14}
        />
      </View>
    </View>
  );
}

// ════════════════════════════════════════════════════════
//  STYLES
// ════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 28,
  },

  // ── Syncing ───────────────────────────────────────────
  syncScreen: {
    justifyContent: "center",
    paddingHorizontal: 22,
    gap: 10,
  },
  syncHeaderBlock: {
    width: "100%",
    marginTop: 0,
    marginBottom: 2,
  },
  syncHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    alignSelf: "stretch",
    paddingHorizontal: 24,
  },
  syncTitle: {
    fontSize: FontSize["5xl"],
    fontWeight: "800",
    color: Colors.t1,
    letterSpacing: -0.4,
  },
  syncSub: {
    fontSize: FontSize.md,
    color: Colors.t2,
    marginTop: 2,
  },
  syncWaveContainer: {
    width: "100%",
    height: Math.round(H * 0.24),
    justifyContent: "center",
    paddingHorizontal: 2,
    marginTop: 4,
    marginBottom: 8,
  },
  syncBottomBlock: {
    width: "100%",
    gap: 8,
    marginTop: 0,
  },
  syncStepStack: {
    width: "100%",
    paddingHorizontal: 24,
    gap: 8,
    marginTop: 2,
  },
  syncProgressTrack: {},
  syncStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  syncStepDoneCard: {
    borderColor: "rgba(61,220,132,0.34)",
    backgroundColor: "rgba(61,220,132,0.08)",
  },
  syncStepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.t3,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  syncStepDotDone: {
    backgroundColor: Colors.green,
    borderColor: Colors.green,
  },
  syncStepText: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.t3,
  },
  syncStepStatus: {
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  syncDonePanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.42)",
    backgroundColor: "rgba(61,220,132,0.15)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: -2,
  },
  syncDoneCheck: {
    color: "#05200f",
    fontSize: 14,
    fontWeight: "900",
    backgroundColor: Colors.green,
    borderRadius: 11,
    width: 20,
    height: 20,
    lineHeight: 20,
    textAlign: "center",
  },
  syncDoneText: {
    color: Colors.t1,
    fontSize: FontSize.sm,
    fontWeight: "800",
  },
  progressTrack: {
    height: 5,
    backgroundColor: Colors.glass,
    borderRadius: 3,
    overflow: "hidden",
    alignSelf: "stretch",
    marginHorizontal: 24,
  },
  progressBar: {
    height: "100%",
    backgroundColor: Colors.green,
    borderRadius: 3,
  },

  // ── Header ────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingBottom: 14,
    flexShrink: 0,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandName: {
    fontSize: FontSize["3xl"],
    fontWeight: "800",
    color: Colors.t1,
    letterSpacing: -0.3,
  },
  brandSub: {
    fontSize: FontSize.sm,
    color: Colors.t2,
  },

  // ── Home Input ────────────────────────────────────────
  homeBody: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 0,
  },
  greetTitle: {
    fontSize: FontSize["4xl"],
    fontWeight: "700",
    color: Colors.t1,
    letterSpacing: -0.3,
  },
  greetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  greetIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(61,220,132,0.12)",
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.3)",
  },
  greetSub: {
    fontSize: FontSize.md,
    color: Colors.t2,
    marginBottom: 18,
  },
  inputWrapper: {
    backgroundColor: Colors.glass,
    borderWidth: 1.5,
    borderColor: Colors.glassBd,
    borderRadius: 20,
    padding: 16,
    marginBottom: 18,
    minHeight: 120,
  },
  inputHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  inputHeaderTitle: {
    fontSize: FontSize.xs,
    color: Colors.t3,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  moodInput: {
    color: Colors.t1,
    fontSize: FontSize.md,
    lineHeight: 22,
    minHeight: 80,
  },
  charCount: {
    alignSelf: "flex-end",
    fontSize: FontSize.xs,
    color: Colors.t3,
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: FontSize.sm,
    color: Colors.t3,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  moodRefreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.30)",
    backgroundColor: "rgba(61,220,132,0.10)",
    marginBottom: 8,
  },
  moodRefreshText: {
    fontSize: FontSize.xs,
    color: Colors.greenL,
    fontWeight: "700",
  },
  pillsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 20,
  },
  moodPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(12,26,20,0.72)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.25)",
  },
  moodPillIconWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(61,220,132,0.14)",
  },
  moodPillText: {
    fontSize: FontSize.sm,
    color: "rgba(225,255,239,0.92)",
    fontWeight: "600",
  },
  toggleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 16,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.glass,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    width: (W - 48 - 7) / 2,
  },
  toggleActive: {
    backgroundColor: "rgba(61,220,132,0.12)",
    borderColor: Colors.green,
  },
  toggleIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    flexShrink: 0,
  },
  toggleTextWrap: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: FontSize.base,
    color: Colors.t2,
    fontWeight: "600",
  },
  toggleLabelActive: {
    color: Colors.green,
    fontWeight: "700",
  },
  toggleSubLabel: {
    fontSize: FontSize.xs,
    color: Colors.t3,
    lineHeight: 16,
    marginTop: -1,
  },
  toggleSubLabelActive: {
    color: "rgba(190,255,220,0.88)",
  },
  promptPreviewCard: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.34)",
    backgroundColor: "rgba(10,26,18,0.78)",
    marginBottom: 18,
    overflow: "hidden",
    shadowColor: Colors.green,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 4,
  },
  promptPreviewGlow: {
    position: "absolute",
    top: -42,
    right: -36,
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "rgba(61,220,132,0.16)",
  },
  promptPreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  promptPreviewTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  promptPreviewTitle: {
    fontSize: FontSize.xs,
    color: Colors.greenL,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  promptPreviewBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(61,220,132,0.14)",
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.36)",
  },
  promptPreviewBadgeText: {
    fontSize: 10,
    letterSpacing: 0.5,
    color: "rgba(190,255,220,0.95)",
    fontWeight: "800",
  },
  promptPreviewText: {
    fontSize: FontSize.sm,
    lineHeight: 21,
    color: "rgba(240,255,247,0.92)",
  },
  inlineResetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
    marginBottom: 8,
  },
  inlineResetBtnActive: {
    borderColor: "rgba(61,220,132,0.30)",
    backgroundColor: "rgba(61,220,132,0.10)",
  },
  inlineResetBtnDisabled: {
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  inlineResetText: {
    fontSize: FontSize.xs,
    fontWeight: "700",
  },
  inlineResetTextActive: {
    color: Colors.greenL,
  },
  inlineResetTextDisabled: {
    color: Colors.t3,
  },
  ctaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: "transparent",
    borderTopWidth: 0,
  },
  settingModalBackdrop: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  settingModalSheet: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    borderRadius: 20,
    padding: 16,
    backgroundColor: "rgba(8,19,14,0.97)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  settingModalTitle: {
    fontSize: FontSize["2xl"],
    fontWeight: "800",
    color: Colors.t1,
  },
  settingModalSub: {
    marginTop: 4,
    marginBottom: 12,
    fontSize: FontSize.sm,
    color: Colors.t2,
  },
  settingOptionList: {
    gap: 8,
  },
  settingOptionItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  settingOptionItemSelected: {
    borderColor: "rgba(61,220,132,0.62)",
    backgroundColor: "rgba(61,220,132,0.14)",
  },
  settingOptionLabel: {
    fontSize: FontSize.base,
    color: Colors.t2,
    fontWeight: "600",
  },
  settingOptionLabelSelected: {
    color: Colors.greenL,
  },
  settingModalActions: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  settingActionGhost: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
  },
  settingActionGhostText: {
    fontSize: FontSize.sm,
    color: Colors.t2,
    fontWeight: "700",
  },
  settingActionPrimary: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: "rgba(61,220,132,0.18)",
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.55)",
  },
  settingActionPrimaryText: {
    fontSize: FontSize.sm,
    color: Colors.greenL,
    fontWeight: "800",
  },

  // ── Loading ───────────────────────────────────────────
  loadingStage: {
    justifyContent: "center",
    gap: 6,
    overflow: "visible",
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  loadingTopBlock: {
    width: "100%",
    alignItems: "center",
    marginTop: 0,
    paddingHorizontal: 6,
  },
  loadingLogoWrap: {
    marginBottom: 10,
  },
  loadingHeroGroup: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  loadingHeadline: {
    fontSize: FontSize["5xl"],
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  loadingBody: {
    marginTop: 6,
    fontSize: FontSize.md,
    color: "rgba(224,255,244,0.95)",
    textAlign: "center",
    lineHeight: 23,
    minHeight: 30,
  },
  loadingWaveContainer: {
    width: "100%",
    height: Math.round(H * 0.34),
    justifyContent: "center",
    paddingHorizontal: 2,
    paddingVertical: 0,
    marginTop: 0,
    overflow: "hidden",
  },
  loadingWaveLift: {
    width: "100%",
    transform: [{ translateY: -12 }],
  },
  loadingLowerGroup: {
    width: "100%",
    transform: [{ translateY: -14 }],
  },
  loadingInfoSlot: {
    width: "100%",
    minHeight: 68,
    justifyContent: "center",
  },
  loadingBottomBlock: {
    width: "100%",
    marginTop: 2,
    gap: 3,
  },
  loadTitle: {
    fontSize: FontSize["4xl"],
    fontWeight: "700",
    color: Colors.t1,
    letterSpacing: -0.3,
  },
  loadSub: {
    fontSize: FontSize.md,
    color: Colors.t2,
    textAlign: "center",
    minHeight: 20,
  },
  liquidTouchLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  liquidRipple: {
    position: "absolute",
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: "rgba(61,220,132,0.16)",
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.34)",
  },
  loadingRing: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 8,
  },
  loadingRingMini: {
    position: "absolute",
    right: 10,
    top: 8,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,8,6,0.52)",
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.28)",
  },
  ringMiniOuter: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.4,
  },
  ring1: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2.5,
    borderColor: "transparent",
    borderTopColor: Colors.green,
    borderRightColor: "rgba(61,220,132,0.4)",
  },
  ring2: {
    position: "absolute",
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1.5,
    borderColor: "transparent",
    borderTopColor: "rgba(61,220,132,0.6)",
    borderLeftColor: "rgba(61,220,132,0.3)",
  },
  loadStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  loadStepDone: {
    borderColor: "rgba(61,220,132,0.34)",
    backgroundColor: "rgba(61,220,132,0.08)",
  },
  loadStepStatus: {
    fontSize: FontSize.xs,
    color: Colors.t2,
    fontWeight: "700",
  },
  loadStageCard: {
    width: "100%",
    marginTop: 2,
    borderColor: "rgba(61,220,132,0.30)",
  },
  loadStageCardDone: {
    borderColor: "rgba(61,220,132,0.55)",
    backgroundColor: "rgba(61,220,132,0.12)",
  },
  loadStageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadStageTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  loadStageTitle: {
    color: Colors.t1,
    fontSize: FontSize.base,
    fontWeight: "800",
  },
  loadStageSub: {
    color: Colors.t2,
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  loadPhaseBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.36)",
    backgroundColor: "rgba(61,220,132,0.12)",
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  loadPhaseBadgeText: {
    color: Colors.greenL,
    fontSize: FontSize.sm,
    fontWeight: "800",
  },
  previewCardFloating: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.3)",
    backgroundColor: "rgba(8,22,16,0.82)",
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 0,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  previewCardTitle: {
    fontSize: 10,
    color: Colors.greenL,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  previewCardBody: {
    fontSize: FontSize.sm,
    color: "#E8FFF7",
    lineHeight: 18,
    fontWeight: "600",
  },
  lpStageEnhanced: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    marginBottom: 2,
  },
  lpStage: {
    width: LP_DISC_SIZE + 40,
    height: LP_STAGE_HEIGHT,
    marginTop: 0,
    marginBottom: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  lpStackWrap: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  lpDiscWrap: {
    position: "absolute",
    top: Math.round((LP_STAGE_HEIGHT - LP_DISC_SIZE) / 2),
    left: Math.round((LP_DISC_SIZE + 40 - LP_DISC_SIZE) / 2),
  },
  lpDiscOuter: {
    width: LP_DISC_SIZE,
    height: LP_DISC_SIZE,
    borderRadius: LP_DISC_RADIUS,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a0a0a",
  },
  lpBackShadow: {
    position: "absolute",
    width: LP_DISC_SIZE,
    height: LP_DISC_SIZE,
    borderRadius: LP_DISC_RADIUS,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  lpDiscActiveGlow: {
    position: "absolute",
    width: LP_DISC_SIZE + 8,
    height: LP_DISC_SIZE + 8,
    borderRadius: LP_DISC_RADIUS + 4,
    backgroundColor: "rgba(61,220,132,0.08)",
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.26)",
    shadowColor: Colors.green,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  lpAlbumImage: {
    width: "100%",
    height: "100%",
  },
  lpDiscShade: {
    position: "absolute",
    inset: 0,
    borderRadius: LP_DISC_RADIUS,
    borderWidth: Math.round(LP_DISC_SIZE * 0.14),
    borderColor: "rgba(0,0,0,0.32)",
  },
  lpGrooveRing1: {
    position: "absolute",
    inset: "9%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  lpGrooveRing2: {
    position: "absolute",
    inset: "16%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  lpGrooveRing3: {
    position: "absolute",
    inset: "24%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  lpCenterHole: {
    position: "absolute",
    width: Math.max(30, Math.round(LP_DISC_SIZE * 0.105)),
    height: Math.max(30, Math.round(LP_DISC_SIZE * 0.105)),
    borderRadius: Math.max(15, Math.round(LP_DISC_SIZE * 0.0525)),
    backgroundColor: "rgba(6,6,6,0.85)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  lpCenterBadge: {
    position: "absolute",
    minWidth: 62,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(5,18,13,0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  lpCenterBadgeActive: {
    borderColor: "rgba(61,220,132,0.64)",
    backgroundColor: "rgba(61,220,132,0.16)",
  },
  lpCenterBadgeText: {
    color: "rgba(232,255,243,0.96)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  resultMorphCard: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.38)",
    backgroundColor: "rgba(10,28,18,0.88)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 0,
    shadowColor: Colors.green,
    shadowOpacity: 0.16,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  resultMorphTitle: {
    color: "#FFFFFF",
    fontSize: FontSize.lg,
    fontWeight: "800",
  },
  resultMorphMeta: {
    color: "rgba(213,255,238,0.96)",
    fontSize: FontSize.sm,
    marginTop: 3,
  },
  resultMorphIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.42)",
    backgroundColor: "rgba(61,220,132,0.12)",
  },
  progressSection: {
    width: "100%",
    marginTop: 2,
    gap: 5,
  },
  progressMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  progressMetaKey: {
    fontSize: FontSize.xs,
    color: "#D8FFE8",
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  progressMetaText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: "rgba(213,255,238,0.9)",
    textAlign: "right",
  },
  lpSleeve: {
    position: "absolute",
    left: LP_SLEEVE_LEFT,
    top: LP_SLEEVE_TOP,
    width: LP_SLEEVE_WIDTH,
    height: LP_SLEEVE_HEIGHT,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#030303",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 10,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  lpSleeveGroundShadow: {
    position: "absolute",
    left: LP_SLEEVE_LEFT - Math.round(LP_SLEEVE_WIDTH * 0.04),
    top: LP_SLEEVE_TOP + LP_SLEEVE_HEIGHT + 2,
    width: Math.round(LP_SLEEVE_WIDTH * 1.12),
    height: 36,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.34)",
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  lpSleeveInnerFrame: {
    position: "absolute",
    left: 7,
    right: 7,
    top: 7,
    bottom: 7,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    opacity: 0.36,
  },
  lpSleeveGoldFrame: {
    position: "absolute",
    left: "16%",
    right: "16%",
    top: "24%",
    bottom: "24%",
    borderWidth: 1.5,
    borderColor: "rgba(196,138,68,0.58)",
    opacity: 0.7,
  },
  lpSleeveEdge: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  lpSleeveGroove: {
    position: "absolute",
    left: "7%",
    right: "7%",
    top: "30%",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.042)",
  },
  lpSleeveFiber1: {
    position: "absolute",
    left: "6%",
    right: "9%",
    top: "12%",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  lpSleeveFiber2: {
    position: "absolute",
    left: "8%",
    right: "8%",
    top: "56%",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  lpSleeveFiber3: {
    position: "absolute",
    left: "8%",
    right: "8%",
    top: "74%",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  lpSleeveSlot: {
    width: "86%",
    height: 9,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginTop: 7,
  },
  lpSleeveRightLip: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.1)",
  },
  lpStickerWrap: {
    position: "absolute",
    top: "34%",
    left: "50%",
    marginLeft: -46,
    width: 92,
    height: 92,
    borderRadius: 6,
    backgroundColor: "rgba(13,13,13,0.98)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.48,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 9 },
    elevation: 9,
  },
  lpStickerPhoto: {
    width: "84%",
    height: "84%",
    borderRadius: 2,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: "#0b0b0b",
  },
  lpSticker: {
    width: "100%",
    height: "100%",
  },
  lpStickerGloss: {
    position: "absolute",
    left: "6%",
    right: "20%",
    top: "6%",
    height: "24%",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.17)",
  },
  stepDotActive: {
    borderColor: Colors.green,
  },

  // ── Preview ───────────────────────────────────────────
  pvHeader: {
    paddingHorizontal: 22,
    paddingBottom: 16,
    flexShrink: 0,
  },
  backBtn2: {
    marginBottom: 12,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 12,
    borderRadius: 999,
    backgroundColor: "rgba(61,220,132,0.14)",
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.28)",
  },
  backBtn2IconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,30,18,0.8)",
  },
  backBtnText2: {
    fontSize: FontSize.sm,
    color: Colors.t1,
    fontWeight: "700",
    letterSpacing: -0.15,
  },
  pvTitle: {
    fontSize: FontSize["4xl"],
    fontWeight: "800",
    color: Colors.t1,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  pvMeta: {
    fontSize: FontSize.base,
    color: Colors.t2,
  },
  trackList: {
    paddingHorizontal: 18,
  },
  pvBar: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingTop: 8,
    backgroundColor: "transparent",
    gap: 10,
    zIndex: 20,
    elevation: 20,
  },
  pvBarInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "100%",
    borderRadius: Radius.md,
  },
  pvSaveBtn: {
    width: "100%",
  },
  pvMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pvBarSep: {
    width: 1,
    height: 14,
    backgroundColor: Colors.glassBd,
  },

  // ── Loading Refs ──────────────────────────────────────
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnText: {
    color: Colors.t1,
    fontSize: 16,
  },
});
