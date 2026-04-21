// src/api/gemini.service.ts
// ─────────────────────────────────────────────────────────
//  Google Gemini AI 서비스
//  사용자 Spotify 데이터 + 무드 입력을 기반으로 개인화 플리 생성
// ─────────────────────────────────────────────────────────
import {
  discoverSpotifyTracks,
  getSpotifyRecommendations,
  getSpotifyApiHealthSnapshot,
  getSpotifySearchBackoffSnapshot,
  getSpotifyTopArtists,
  getSpotifyTopTracks,
  searchSpotifyTracksByQueries,
  SpotifyAudioFeaturesSummary,
  validateSpotifyUserToken,
} from "./spotify.service";
import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  SpotifyArtistSummary,
  SpotifyBootstrapData,
  SpotifyTrackSummary,
  SpotifyUser,
  Track,
} from "../types";
import {
  CanonicalGenre,
  CanonicalSpecialTag,
  normalizeGenre,
  normalizeSpecialTag,
} from "../utils/normalizeIntent";
import {
  extractForcedGenresFromPrompt,
  extractForcedSpecialTagsFromPrompt,
} from "../intent/extractForcedIntent";
import { useAppStore } from "../store/useAppStore";

const GEMINI_PROXY_URL_DEV = String(
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL_DEV ?? "",
).trim();
const GEMINI_PROXY_URL_PROD = String(
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL_PROD ?? "",
).trim();
const GEMINI_PROXY_URL_LEGACY = String(
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL ?? "",
).trim();

type GeminiPlaylistJson = {
  playlistName?: string;
  moodSummary?: string;
  reasoning?: string;
  targetCount?: number;
  mixStrategy?: "familiar" | "balanced" | "discovery";
  includeKeywords?: string[];
  excludeKeywords?: string[];
  genreHints?: string[];
  energyLevel?: "low" | "mid" | "high";
  noveltyLevel?: "safe" | "balanced" | "adventurous";
  focusKeywords?: string[];
};

type GeminiError = Error & {
  status?: number;
  bodyText?: string;
};

type GeminiProxyResponse = {
  playlist?: GeminiPlaylistJson;
  model?: string;
  error?: {
    code?: string;
    message?: string;
    retryAfterMs?: number;
    details?: unknown;
  };
};

type GeminiRecommendationProfile = {
  genres: string[];
  energy: number;
  valence: number;
  acousticness: number;
  source?: "gemini" | "reuse" | "fallback";
  mood?: string;
  activity?: string;
  place?: string;
  time?: string;
  weather?: string;
  durationMinutes?: number;
};

type SpotifyRecommendationParams = {
  seedGenres: string[];
  targetEnergy: number;
  targetValence: number;
  targetAcousticness: number;
  mood?: string;
  activity?: string;
  place?: string;
  time?: string;
  weather?: string;
  durationMinutes?: number;
};

type RecommendationSnapshot = {
  fingerprint: string;
  trackIds: string[];
  artistKeys: string[];
  intentKeywords: string[];
  createdAt: number;
};

type FastWorkingSet = {
  fingerprint: string;
  tracks: SpotifyTrackSummary[];
  updatedAt: number;
};

type FastIntent = {
  moodKeywords: string[];
  excludeKeywords: string[];
  genres: string[];
  energy: "low" | "mid" | "high";
  confidence: number;
};

type FastSemanticTokenPlan = {
  moodTokens: string[];
  textureTokens: string[];
  tempoTokens: string[];
  searchTokens: string[];
  excludeTokens: string[];
  genres: string[];
  energy?: "low" | "mid" | "high";
  confidence: number;
  source: "gemini" | "local";
  strategy: FastRecommendationStrategy;
};

type GeminiQueryPlan = {
  queries: string[];
  reasoning: string;
  energyLevel: "low" | "mid" | "high";
  targetCount: number;
  source: "gemini" | "fallback";
};

type FastRecommendationStrategy = {
  mixStrategy: "familiar" | "balanced" | "discovery";
  noveltyLevel: "safe" | "balanced" | "adventurous";
  diversity: number;
  freshness: number;
  popularityBias: number;
  poolRatio: {
    taste: number;
    general: number;
    exploration: number;
  };
  scoring: {
    taste: number;
    context: number;
    genre: number;
    mood: number;
  };
};

type UserTasteProfile = {
  favoriteArtistIds: Set<string>;
  favoriteArtistNames: Set<string>;
  topTrackIds: Set<string>;
  genreWeights: Map<string, number>;
  decadeWeights: Map<number, number>;
  tempoMedian: number | null;
};

type TimeConstraint = {
  minutes: number;
  mode: "at_least" | "at_most" | "around";
};

type IntentConstraintProfile = {
  requiredKeywords: string[];
  excludedKeywords: string[];
  targetEnergy?: GeminiPlaylistJson["energyLevel"];
  strictness: number; // 0~1
  requireInstrumentalLike: boolean;
  preferVocalLike: boolean;
  yearMin?: number;
  yearMax?: number;
  preferLatest: boolean;
};

type PromptSearchPlan = {
  brief: string;
  include: string[];
  exclude: string[];
  genres: string[];
  activity: string;
  sound: string;
  mood: string;
  timeConstraint: TimeConstraint | null;
  specificity: number;
};

type ParsedIntent = {
  scene: {
    timeOfDay: string[];
    activity: string[];
    place: string[];
    weather: string[];
  };
  mood: {
    primary: string[];
    secondary: string[];
  };
  texture: {
    sound: string[];
    vocal: string[];
    emotional: string[];
  };
  genreIntent: {
    requested: string[];
    blendMode: "single" | "blend";
  };
  duration: {
    targetMinutes: number | null;
  };
  queryTokens: {
    semantic: string[];
    expanded: string[];
    musicContext: string[];
  };
};

type TasteProfileSignals = {
  topArtistIds: Set<string>;
  topTrackIds: Set<string>;
  genreTokens: Set<string>;
  artistTokens: Set<string>;
  topArtistNames: string[];
  recentTrackIds: Set<string>;
  recentArtistIds: Set<string>;
  vocalStyle: string[];
  moods: string[];
  textures: string[];
  preferredEnergyRange: { min: number; max: number };
};

type QueryBundles = {
  strictPrompt: string[];
  semanticMood: string[];
  tasteAnchored: string[];
  exploration: string[];
};
type SearchIntent = {
  locale: "korean" | "global";
  anchorGenres: string[];
  supportGenres: string[];
  soundtrackHints: string[];
  rankingOnlyTags: string[];
  bannedTokens: string[];
};
type GenreBucket = {
  genre: string;
  min: number;
};
type GenreBucketPlan = {
  buckets: GenreBucket[];
};
type StructuredIntent = {
  locale: "korean" | "global";
  genres: CanonicalGenre[];
  genreWeights: Record<string, number>;
  excludedGenres: string[];
  specialTags: CanonicalSpecialTag[];
  locked: {
    genres: CanonicalGenre[];
    specialTags: CanonicalSpecialTag[];
  };
  mood: string[];
  activity: string[];
  environment: string[];
  styles: string[];
  audioFeatures: {
    melody: number;
    energy: number;
    aggression: number;
    vocalType: string;
  };
  tempo: "low" | "mid" | "high" | null;
  energy: number | null;
  durationMin: number;
  durationMax: number | null;
  mixStrategy: "blend" | "sequential" | "single";
};
type DynamicQueryStrategy = {
  primary: string[];
  discovery: string[];
  recovery: string[];
};

type RepeatSuppressionState = {
  recentTrackIds: Set<string>;
  recentArtistIds: Set<string>;
  recentPromptHashes: string[];
  repeatedPrompt: boolean;
  recentArtistFrequency: Map<string, number>;
};

type RecommendationZone = "near" | "expand" | "explore";
type BasePromptFeatures = {
  languageHint: "korean" | "mixed" | "unknown";
  requestedLocale?: "korean" | "global" | "mixed";
  requestedDurationMin?: number;
  requestedDurationAtLeast?: boolean;
  movement: number;
  energy: number;
  tempo: number;
  groove: number;
  brightness: number;
  warmth: number;
  airiness: number;
  aggression: number;
  acousticnessHint: number;
  cinematic: number;
  environment: string[];
  moodTokens: string[];
  textureTokens: string[];
  vocalTokens: string[];
  requestedGenres: string[];
  requestedSpecialTags: string[];
  excludedGenres: string[];
  retention: {
    locale: boolean;
    duration: boolean;
    genreCount: number;
    ostLike: boolean;
    mixIntent: boolean;
  };
  diagnostics?: {
    coverage: number;
    specificity: number;
    consistency: number;
    retention: number;
  };
  confidence: number;
};
type PromptFeatureBundle = {
  energy: "low" | "mid" | "high";
  energyLevel: number;
  movementLevel: number;
  tempoLevel: number;
  grooveLevel: number;
  environment: string[];
  movement: string[];
  groove: string[];
  texture: string[];
  vocal: string[];
  mood: string[];
  aggression: "low" | "mid" | "high";
};
type TasteDescriptorCore = {
  language: string[];
  vocal: string[];
  genreTendency: string[];
  emotion: string[];
  rhythmTolerance: string[];
};

const RECOMMENDATION_MEMORY_MAX = 8;
const recommendationHistory: RecommendationSnapshot[] = [];
const fastWorkingSetByFingerprint = new Map<string, FastWorkingSet>();
const geminiParamCache = new Map<
  string,
  { profile: GeminiRecommendationProfile; cachedAt: number }
>();
const geminiParamInFlight = new Map<string, Promise<GeminiRecommendationProfile>>();
const geminiSemanticCache = new Map<
  string,
  { bundle: PromptFeatureBundle; cachedAt: number }
>();
const geminiSemanticInFlight = new Map<string, Promise<PromptFeatureBundle>>();
let geminiLastSemanticBundle: PromptFeatureBundle | null = null;
const fastPlaylistInFlight = new Map<string, Promise<PersonalizedPlaylistOutput>>();
const candidateCacheByRequestId = new Map<string, SpotifyTrackSummary[]>();
const partialSearchResultsByRequestId = new Map<string, SpotifyTrackSummary[]>();
const partialSearchQueryHitsByRequestId = new Map<string, string[]>();
const forcedIntentSnapshotByRequestId = new Map<
  string,
  {
    forcedGenres: CanonicalGenre[];
    forcedSpecialTags: CanonicalSpecialTag[];
  }
>();
const recentFallbackTrackIds = new Set<string>();
const recentFallbackTrackQueue: string[] = [];
const RECENT_FALLBACK_TRACK_CAP = 240;

function trackIdKey(track: SpotifyTrackSummary): string {
  return String(track.id ?? track.uri ?? "").trim();
}

function rememberRecentFallbackTracks(tracks: SpotifyTrackSummary[]): void {
  for (const track of tracks) {
    const key = trackIdKey(track);
    if (!key) continue;
    if (recentFallbackTrackIds.has(key)) continue;
    recentFallbackTrackIds.add(key);
    recentFallbackTrackQueue.push(key);
    while (recentFallbackTrackQueue.length > RECENT_FALLBACK_TRACK_CAP) {
      const oldest = recentFallbackTrackQueue.shift();
      if (!oldest) break;
      recentFallbackTrackIds.delete(oldest);
    }
  }
}

function filterRecentFallbackTracks(tracks: SpotifyTrackSummary[]): SpotifyTrackSummary[] {
  const filtered = tracks.filter(track => {
    const key = trackIdKey(track);
    if (!key) return true;
    return !recentFallbackTrackIds.has(key);
  });
  return filtered.length ? filtered : tracks;
}
const querySearchCache = new Map<string, SpotifyTrackSummary[]>();
const finishedRequestIds = new Set<string>();
let geminiLastSuccessfulProfile: GeminiRecommendationProfile | null = null;
const playlistSummariesInFlight = new Map<
  string,
  Promise<{ tracks: SpotifyTrackSummary[]; profile: GeminiRecommendationProfile }>
>();
const fastTimeoutBlockedRequestIds = new Set<string>();
const playlistSummariesCache = new Map<
  string,
  {
    data: { tracks: SpotifyTrackSummary[]; profile: GeminiRecommendationProfile };
    cachedAt: number;
  }
>();
const PLAYLIST_SUMMARIES_CACHE_TTL_MS = 8_000;
const PLAYLIST_RESULT_CACHE_TIME_BUCKET_MS = 120_000;
const GEMINI_PARAM_CACHE_TTL_MS = 10 * 60_000;
const GEMINI_PARAM_FALLBACK_CACHE_TTL_MS = 90_000;
const GEMINI_QUOTA_COOLDOWN_MS = 5 * 60_000;
let geminiQuotaCooldownUntil = 0;
let playlistRequestNonce = 0;
const FAST_INTENT_STOPWORDS = new Set([
  "플레이리스트",
  "플리",
  "노래",
  "음악",
  "추천",
  "원해",
  "해줘",
  "해주세요",
  "그리고",
  "또는",
  "분위기",
  "무드",
  "느낌",
  "중심",
  "위주",
  "시간",
  "이상",
  "이내",
  "내외",
  "정도",
  "정도로",
  "중",
]);
const FAST_INTENT_NOISE = new Set([
  "플레이",
  "리스트",
  "추천곡",
  "곡",
  "노래들",
  "추가",
  "요청",
]);

type SemanticLexiconEntry = {
  weights?: Partial<Record<
    | "movement"
    | "energy"
    | "tempo"
    | "groove"
    | "brightness"
    | "warmth"
    | "airiness"
    | "aggression"
    | "acousticnessHint"
    | "cinematic",
    number
  >>;
  environment?: string[];
  moodTokens?: string[];
  textureTokens?: string[];
  vocalTokens?: string[];
  requestedGenres?: string[];
  excludedGenres?: string[];
  languageHint?: BasePromptFeatures["languageHint"];
  category?: "genre" | "situation" | "mood" | "modifier";
};

const BASE_PARSER_NEUTRAL: Omit<
  BasePromptFeatures,
  | "languageHint"
  | "requestedLocale"
  | "requestedDurationMin"
  | "requestedDurationAtLeast"
  | "environment"
  | "moodTokens"
  | "textureTokens"
  | "vocalTokens"
  | "requestedGenres"
  | "requestedSpecialTags"
  | "excludedGenres"
  | "retention"
  | "diagnostics"
  | "confidence"
> = {
  movement: 0.5,
  energy: 0.5,
  tempo: 0.5,
  groove: 0.5,
  brightness: 0.5,
  warmth: 0.5,
  airiness: 0.5,
  aggression: 0.5,
  acousticnessHint: 0.5,
  cinematic: 0.5,
};

const BASE_SEMANTIC_LEXICON: Record<string, SemanticLexiconEntry> = {
  "산책": { category: "situation", weights: { movement: 0.15, tempo: 0.1, groove: 0.12, brightness: 0.08, airiness: 0.1, aggression: -0.1 }, environment: ["outdoor"], moodTokens: ["breezy", "light"] },
  "한강": { category: "situation", weights: { movement: 0.08, airiness: 0.12, brightness: 0.08 }, environment: ["outdoor", "nature"], moodTokens: ["breezy"] },
  "드라이브": { category: "situation", weights: { movement: 0.3, tempo: 0.2, groove: 0.2, brightness: 0.05, aggression: 0.05 }, environment: ["road"], moodTokens: ["dynamic", "flowing"] },
  "여행": { category: "situation", weights: { movement: 0.2, energy: 0.15, groove: 0.1, brightness: 0.15, airiness: 0.12 }, environment: ["outdoor"], moodTokens: ["uplifting", "free"] },
  "바다": { category: "situation", weights: { movement: -0.05, airiness: 0.2, warmth: 0.05, cinematic: 0.1 }, environment: ["nature"], textureTokens: ["airy", "open"] },
  "화창한": { category: "mood", weights: { brightness: 0.25, airiness: 0.15, energy: 0.08 }, moodTokens: ["bright", "refreshing"] },
  "맑은": { category: "mood", weights: { brightness: 0.2, airiness: 0.12 }, moodTokens: ["bright", "light"] },
  "신나는": { category: "mood", weights: { energy: 0.25, tempo: 0.18, groove: 0.18, brightness: 0.1, aggression: 0.05 }, moodTokens: ["upbeat", "uplifting"] },
  "잔잔한": { category: "mood", weights: { energy: -0.2, tempo: -0.15, groove: -0.08, warmth: 0.08, aggression: -0.2 }, moodTokens: ["calm", "soft"] },
  "새벽": { category: "situation", weights: { brightness: -0.1, warmth: 0.05, airiness: 0.08, cinematic: 0.08 }, moodTokens: ["quiet", "late-night"] },
  "비오는": { category: "situation", weights: { brightness: -0.12, airiness: 0.05, cinematic: 0.12 }, moodTokens: ["melancholic", "reflective"] },
  "공부": { category: "situation", weights: { energy: -0.08, aggression: -0.12, acousticnessHint: 0.12 }, moodTokens: ["focused", "stable"], textureTokens: ["clean"] },
  "출근길": { category: "situation", weights: { movement: 0.18, energy: 0.15, tempo: 0.1, groove: 0.1 }, moodTokens: ["upbeat"] },
  "집중": { category: "modifier", weights: { aggression: -0.15, acousticnessHint: 0.15 }, moodTokens: ["focused"], textureTokens: ["clean"] },

  "k-pop": { category: "genre", requestedGenres: ["k-pop"] },
  "kpop": { category: "genre", requestedGenres: ["k-pop"] },
  "멜로디 힙합": { category: "genre", requestedGenres: ["melodic hip hop", "korean hip hop"] },
  "힙합": { category: "genre", requestedGenres: ["korean hip hop"] },
  "r&b": { category: "genre", requestedGenres: ["korean rnb", "rnb"] },
  "rnb": { category: "genre", requestedGenres: ["korean rnb", "rnb"] },
  "소울": { category: "genre", requestedGenres: ["soul"] },
  "ost": { category: "genre", requestedGenres: ["soundtrack", "ost"] },
  "영화음악": { category: "genre", requestedGenres: ["soundtrack", "cinematic"] },
  "인디": { category: "genre", requestedGenres: ["k-indie", "indie pop"] },
  "포크": { category: "genre", requestedGenres: ["folk", "k-folk"] },

  "한국": { category: "modifier", languageHint: "korean", vocalTokens: ["korean vocal"] },
  "국내": { category: "modifier", languageHint: "korean", vocalTokens: ["korean vocal"] },
};

function extractLabeledSegment(input: string, label: string): string {
  const re = new RegExp(`${label}\\s*:\\s*([^,\\n]+)`, "i");
  const m = input.match(re);
  return m ? String(m[1] ?? "").trim() : "";
}

function fastGenreMatchTokens(genre: string): string[] {
  const g = normalizeText(genre);
  if (!g) return [];
  if (g === "k-pop") return ["k pop", "kpop", "케이팝", "korean pop", "pop"];
  if (g === "멜로디 힙합") return ["멜로디 힙합", "melodic hip hop", "korean hip hop"];
  if (g === "힙합") return ["힙합", "hip hop", "rap", "korean hip hop"];
  if (g === "발라드") return ["발라드", "ballad", "korean ballad"];
  if (g === "rnb/소울" || g === "rnb 소울")
    return ["rnb", "r b", "알앤비", "korean rnb", "soul", "소울", "korean soul"];
  if (g === "인디") return ["인디", "indie", "korean indie"];
  if (g === "포크") return ["포크", "folk", "acoustic folk", "korean folk"];
  if (g === "영화음악" || g === "ost")
    return ["ost", "soundtrack", "cinematic", "film score", "movie music"];
  if (g === "edm") return ["edm", "electronic", "일렉"];
  return [g];
}

function computeFastGenreCoverage(
  tracks: SpotifyTrackSummary[],
  requiredGenres: string[],
): number {
  if (!tracks.length || !requiredGenres.length) return 1;
  const tokens = Array.from(
    new Set(requiredGenres.flatMap(fastGenreMatchTokens).map(v => normalizeText(v)).filter(Boolean)),
  );
  if (!tokens.length) return 1;
  let matched = 0;
  for (const t of tracks) {
    const text = normalizeText(
      [
        t.name,
        ...(t.artists ?? []).map(a => a.name),
        ...(t.genres ?? []),
        t.album?.name ?? "",
      ].join(" "),
    );
    if (tokens.some(token => text.includes(token))) matched += 1;
  }
  return matched / tracks.length;
}

function readPublicNumberEnv(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Number.parseInt(String(process.env[key] ?? "").trim(), 10);
  if (!Number.isFinite(raw)) return fallback;
  return clamp(raw, min, max);
}

const SPOTIFY_CATALOG_TIMEOUT_PRIMARY_MS = readPublicNumberEnv(
  "EXPO_PUBLIC_SPOTIFY_CATALOG_TIMEOUT_PRIMARY_MS",
  14000,
  8000,
  45000,
);
const SPOTIFY_CATALOG_TIMEOUT_SECONDARY_MS = readPublicNumberEnv(
  "EXPO_PUBLIC_SPOTIFY_CATALOG_TIMEOUT_SECONDARY_MS",
  11000,
  7000,
  35000,
);
const SPOTIFY_CATALOG_TIMEOUT_RESCUE_MS = readPublicNumberEnv(
  "EXPO_PUBLIC_SPOTIFY_CATALOG_TIMEOUT_RESCUE_MS",
  12000,
  7000,
  40000,
);
const SPOTIFY_CATALOG_TIMEOUT_LAST_RESORT_MS = readPublicNumberEnv(
  "EXPO_PUBLIC_SPOTIFY_CATALOG_TIMEOUT_LAST_RESORT_MS",
  16000,
  12000,
  50000,
);
const PLAYLIST_PIPELINE_BUDGET_MS = readPublicNumberEnv(
  "EXPO_PUBLIC_GEMINI_PIPELINE_BUDGET_MS",
  65000,
  25000,
  120000,
);
const GEMINI_MODEL_TIMEOUT_MS = readPublicNumberEnv(
  "EXPO_PUBLIC_GEMINI_MODEL_TIMEOUT_MS",
  12000,
  5000,
  20000,
);
const PROMPT_FIRST_TIMEOUT_MS = readPublicNumberEnv(
  "EXPO_PUBLIC_PROMPT_FIRST_TIMEOUT_MS",
  16000,
  6000,
  26000,
);
const FAST_HARD_RETURN_MS = readPublicNumberEnv(
  "EXPO_PUBLIC_FAST_HARD_RETURN_MS",
  11000,
  5000,
  20000,
);
const PLAYLIST_RESULT_CACHE_ENABLED =
  String(process.env.EXPO_PUBLIC_PLAYLIST_RESULT_CACHE_ENABLED ?? "false")
    .trim()
    .toLowerCase() === "true";

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || "error";
  if (typeof err === "string") return err;
  return "unknown_error";
}

class CancelledRecommendationError extends Error {
  requestId: string;
  constructor(requestId?: string, stage?: string) {
    super(
      `[Playlist] pipeline aborted requestId=${String(requestId || "-")} stage=${String(stage || "-")}`,
    );
    this.name = "CancelledRecommendationError";
    this.requestId = String(requestId ?? "");
  }
}

function isCancelledRecommendationError(err: unknown): boolean {
  return err instanceof CancelledRecommendationError;
}

function assertNotCancelled(
  requestId?: string,
  abortSignal?: AbortSignal,
  stage?: string,
): void {
  if (abortSignal?.aborted) {
    throw new CancelledRecommendationError(requestId, stage);
  }
}

export type PersonalizedPlaylistInput = {
  moodInput: string;
  spotifyUser: SpotifyUser | null;
  spotifyBootstrap: SpotifyBootstrapData | null;
  spotifyAccessToken?: string | null;
  requestId?: string;
  abortSignal?: AbortSignal;
};

export type PersonalizedPlaylistOutput = {
  status: "success" | "partial" | "failed";
  tracks: Track[];
  playlistName: string;
  reasoning?: string;
  meta?: {
    requestId?: string;
    reason?: string;
    [key: string]: unknown;
  };
  fallbackReason?:
    | "gemini_quota_exceeded"
    | "gemini_error"
    | "spotify_relogin_required"
    | "spotify_scope_required"
    | "spotify_dashboard_user_required";
};

export type AnalysisProgressEvent = {
  stage:
    | "analysis_start"
    | "analysis_done"
    | "queries_ready"
    | "queries_fetching"
    | "queries_done"
    | "ranking"
    | "finalizing";
  progress: number;
  step?: 0 | 1 | 2;
  label?: string;
  analysisStatus?: string;
  queryDone?: number;
  queryTotal?: number;
  requestId?: string;
  finalizeReason?: "timeout" | "enough_tracks" | "search_complete" | "fallback";
  collectedTracks?: number;
};

let latestGeminiAnalysisStatus = "idle";

function setGeminiAnalysisStatus(status: string): void {
  latestGeminiAnalysisStatus = status;
  console.warn(`[Gemini] ANALYSIS_STATUS=${status}`);
}

export function getLatestGeminiAnalysisStatus(): string {
  return latestGeminiAnalysisStatus;
}

function logPipelineResult(result: PersonalizedPlaylistOutput): void {
  console.warn(
    `[PipelineResult] status=${result.status} reason=${String(result.meta?.reason ?? "-")}`,
  );
  console.warn(
    `[PipelineReturn] ${result.status}`,
  );
}

function hasFinishedRequest(requestId?: string): boolean {
  return Boolean(requestId && finishedRequestIds.has(requestId));
}

function markFinishedRequest(requestId?: string): void {
  const key = String(requestId ?? "").trim();
  if (!key) return;
  finishedRequestIds.add(key);
  if (finishedRequestIds.size > 100) {
    const oldest = finishedRequestIds.values().next().value;
    if (oldest) finishedRequestIds.delete(oldest);
  }
}

function finalizePipelineResult(
  requestId: string,
  result: PersonalizedPlaylistOutput,
): PersonalizedPlaylistOutput {
  const key = String(requestId ?? "").trim();
  if (key && hasFinishedRequest(key)) {
    console.warn("[Pipeline] duplicate return blocked", key);
    const blocked: PersonalizedPlaylistOutput = {
      status: "failed",
      tracks: [],
      playlistName: "",
      meta: { requestId: key, reason: "duplicate_return_blocked" },
    };
    logPipelineResult(blocked);
    return blocked;
  }
  markFinishedRequest(key);
  logPipelineResult(result);
  return result;
}

type SpotifyAccessIssueCode =
  | "spotify_relogin_required"
  | "spotify_scope_required"
  | "spotify_dashboard_user_required";

function classifySpotifyValidationIssue(err: unknown): SpotifyAccessIssueCode {
  const msg = String(
    err instanceof Error ? err.message : err ?? "",
  ).toLowerCase();
  if (
    msg.includes("(401)") ||
    msg.includes("invalid_token") ||
    msg.includes("authentication") ||
    msg.includes("인증 만료")
  ) {
    return "spotify_relogin_required";
  }
  if (msg.includes("(403)") && (msg.includes("scope") || msg.includes("insufficient"))) {
    return "spotify_scope_required";
  }
  if (msg.includes("(403)") || msg.includes("forbidden")) {
    return "spotify_dashboard_user_required";
  }
  return "spotify_relogin_required";
}

function spotifyIssueReasonText(code: SpotifyAccessIssueCode): string {
  if (code === "spotify_relogin_required") return "Spotify 재로그인이 필요해요.";
  if (code === "spotify_scope_required") return "Spotify 권한(scope) 재동의가 필요해요.";
  if (code === "spotify_dashboard_user_required")
    return "Spotify Dashboard Users and Access에 테스트 사용자를 등록해야 해요.";
  return "";
}

function toTrack(summary: SpotifyTrackSummary, i: number): Track {
  const artist =
    summary.artists?.map(a => a.name).filter(Boolean).join(", ") ||
    "Unknown Artist";
  const rawDurationMs = Number(summary.duration_ms ?? 0);
  const durationMs = rawDurationMs > 30_000 ? rawDurationMs : 210_000;
  const releaseYear = parseReleaseYear(summary.album?.release_date);
  const bpm = Math.round(Number(summary.tempo ?? 0));
  return {
    id: summary.id,
    emoji: ["♬", "♫", "♪", "♩", "♭"][i % 5],
    name: summary.name || "Unknown Track",
    artist,
    duration: formatDurationMs(durationMs),
    albumImageUrl: summary.album?.images?.[0]?.url || undefined,
    gradientStart: ["#1a2535", "#22323f", "#2a2138", "#163026", "#2f2420"][i % 5],
    gradientEnd: ["#0e1822", "#162730", "#171728", "#0b1d17", "#1f1612"][i % 5],
    album: summary.album?.name || "Spotify",
    year: releaseYear,
    bpm: bpm > 0 ? bpm : 0,
    genre: summary.genres ?? [],
    liked: Boolean(summary.is_saved),
    spotifyUri: summary.uri,
    previewUrl: summary.preview_url ?? undefined,
  };
}

function parseReleaseYear(releaseDate?: string): number {
  if (!releaseDate) return 0;
  const m = releaseDate.match(/^(\d{4})/);
  return m ? Number(m[1]) : 0;
}

async function discoverSpotifyTracksWithTimeout(
  args: {
    accessToken: string;
    moodInput: string;
    bootstrap: SpotifyBootstrapData | null;
    limit: number;
    seedTrackIds?: string[];
    seedArtistIds?: string[];
    enrichMetadata?: boolean;
    fastMode?: boolean;
    maxSearchQueries?: number;
    includeAffinityQueries?: boolean;
  },
  timeoutMs: number,
): Promise<SpotifyTrackSummary[]> {
  const startedAt = Date.now();
  const result = await discoverSpotifyTracks({
    ...args,
    maxDurationMs: timeoutMs,
  });
  if (!result.length && Date.now() - startedAt >= timeoutMs - 250) {
    console.warn(
      `[Spotify] catalog discovery timed out (${timeoutMs}ms), continuing with local picks.`,
    );
  }
  return result;
}

function pickDiverseQueries(rawQueries: string[], maxCount: number): string[] {
  const cleaned = Array.from(
    new Set(
      rawQueries
        .map(v => String(v ?? "").replace(/\s+/g, " ").trim())
        .filter(v => v.length >= 2),
    ),
  );
  const ranked = [...cleaned].sort((a, b) => {
    const aLen = queryDiversitySignature(a).length;
    const bLen = queryDiversitySignature(b).length;
    return bLen - aLen;
  });
  const picked: string[] = [];
  const signatures: string[][] = [];
  for (const query of ranked) {
    const sig = queryDiversitySignature(query)
      .filter(k => !CONTEXT_ONLY_KEYWORDS.has(k))
      .slice(0, 8);
    const isTag = isFastTagQuery(query);
    const isTooSimilar = signatures.some(prev => {
      if (isTag || prev.some(token => token.startsWith("tag:"))) return false;
      const sim = jaccardSimilarity(prev, sig);
      const subset =
        sig.length &&
        (sig.every(t => prev.includes(t)) || prev.every(t => sig.includes(t)));
      return sim >= 0.95 && subset;
    });
    if (!isTooSimilar || picked.length < 4) {
      picked.push(query);
      signatures.push(sig);
    }
    if (picked.length >= maxCount) break;
  }
  return picked.slice(0, maxCount);
}

async function discoverCatalogPoolFromQueries(args: {
  accessToken: string;
  bootstrap: SpotifyBootstrapData | null;
  queries: string[];
  seedTrackIds?: string[];
  seedArtistIds?: string[];
  primaryLimit: number;
  secondaryLimit: number;
  primaryTimeoutMs: number;
  secondaryTimeoutMs: number;
  maxQueries?: number;
  stopAt?: number;
  maxDurationMs?: number;
  discoverMaxSearchQueriesPrimary?: number;
  discoverMaxSearchQueriesSecondary?: number;
}): Promise<SpotifyTrackSummary[]> {
  const maxQueries = clamp(args.maxQueries ?? 4, 2, 6);
  const stopAt = clamp(args.stopAt ?? 80, 25, 120);
  const maxDurationMs = clamp(args.maxDurationMs ?? 18000, 8000, 60000);
  const startedAt = Date.now();
  const queue = pickDiverseQueries(args.queries, maxQueries);
  const dedup = new Map<string, SpotifyTrackSummary>();
  for (let i = 0; i < queue.length; i += 2) {
    if (Date.now() - startedAt >= maxDurationMs) break;
    const batch = queue.slice(i, i + 2);
    const settled = await Promise.allSettled(
      batch.map((moodText, localIdx) => {
        const idx = i + localIdx;
        return discoverSpotifyTracksWithTimeout(
          {
            accessToken: args.accessToken,
            moodInput: moodText,
            bootstrap: args.bootstrap,
            limit: idx === 0 ? args.primaryLimit : args.secondaryLimit,
            seedTrackIds: args.seedTrackIds,
            seedArtistIds: args.seedArtistIds,
            enrichMetadata: false,
            fastMode: true,
            maxSearchQueries:
              idx === 0
                ? Math.max(1, Math.floor(args.discoverMaxSearchQueriesPrimary ?? 2))
                : Math.max(1, Math.floor(args.discoverMaxSearchQueriesSecondary ?? 1)),
            includeAffinityQueries: false,
          },
          idx === 0 ? args.primaryTimeoutMs : args.secondaryTimeoutMs,
        );
      }),
    );
    settled.forEach(result => {
      if (result.status !== "fulfilled") return;
      result.value.forEach(track => {
        const key = trackDedupKey(track);
        if (!key || dedup.has(key)) return;
        dedup.set(key, track);
      });
    });
    if (dedup.size >= stopAt) break;
  }
  return Array.from(dedup.values());
}

function formatDurationMs(durationMs: number): string {
  if (!durationMs || durationMs < 0) return "0:00";
  const totalSec = Math.floor(durationMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function resolveExpoDevHost(): string | null {
  if (Platform.OS === "web") return null;
  if (!__DEV__) return null;

  const anyConstants = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    expoGoConfig?: { debuggerHost?: string };
    manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
    manifest?: { debuggerHost?: string };
  };

  const candidates = [
    anyConstants.expoConfig?.hostUri,
    anyConstants.expoGoConfig?.debuggerHost,
    anyConstants.manifest2?.extra?.expoClient?.hostUri,
    anyConstants.manifest?.debuggerHost,
  ]
    .map(v => String(v ?? "").trim())
    .filter(Boolean);

  for (const raw of candidates) {
    const withoutPath = raw.split("/")[0];
    const host = withoutPath.includes(":")
      ? withoutPath.slice(0, withoutPath.lastIndexOf(":"))
      : withoutPath;
    if (host) return host;
  }
  return null;
}

function rewriteLocalhostForExpoDev(url: string): string {
  if (!url || Platform.OS === "web" || !__DEV__) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(parsed.hostname)) return url;
  if (parsed.port === "8081") {
    // 8081은 Metro 번들러 포트이므로 API 프록시는 기본 3000으로 교정.
    parsed.port = "3000";
  }

  const host = resolveExpoDevHost();
  if (!host) return url;
  parsed.hostname = host;
  return parsed.toString();
}

function buildGeminiProxyUrl(): string {
  const modeUrl = __DEV__ ? GEMINI_PROXY_URL_DEV : GEMINI_PROXY_URL_PROD;
  const normalizedModeUrl = rewriteLocalhostForExpoDev(modeUrl);
  if (normalizedModeUrl) return normalizedModeUrl;
  const normalizedLegacyUrl = rewriteLocalhostForExpoDev(GEMINI_PROXY_URL_LEGACY);
  if (normalizedLegacyUrl) return normalizedLegacyUrl;
  if (__DEV__ && Platform.OS !== "web") {
    const host = resolveExpoDevHost();
    if (host) {
      return `http://${host}:3000/api/gemini-recommend`;
    }
  }
  if (Platform.OS === "web") return "/api/gemini-recommend";
  throw new Error(
    "Missing Gemini proxy URL env. Set EXPO_PUBLIC_GEMINI_PROXY_URL_DEV/PROD (or EXPO_PUBLIC_GEMINI_PROXY_URL fallback).",
  );
}

function extractTargetMinutes(text: string): number | null {
  return extractTimeConstraint(text)?.minutes ?? null;
}

function extractTimeConstraint(text: string): TimeConstraint | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const hourMin = normalized.match(/(\d+)\s*시간\s*(\d+)\s*분/);
  const mode =
    /(이상|넘게|이상으로|over|at least)/i.test(normalized)
      ? "at_least"
      : /(이내|안에|미만|까지|under|at most|max)/i.test(normalized)
        ? "at_most"
        : "around";
  if (hourMin) {
    return {
      minutes: Number(hourMin[1]) * 60 + Number(hourMin[2]),
      mode,
    };
  }
  const hours = normalized.match(/(\d+)\s*시간/);
  if (hours) {
    return { minutes: Number(hours[1]) * 60, mode };
  }
  const mins = normalized.match(/(\d+)\s*분/);
  if (mins) {
    return { minutes: Number(mins[1]), mode };
  }
  return null;
}

function normalizePrompt(prompt: string): string {
  return String(prompt ?? "")
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SEMANTIC_MAP = {
  locale: {
    korean: ["한국", "국내", "kpop", "케이팝", "아이돌", "korean"],
  },
  genre: {
    kpop: ["kpop", "케이팝", "아이돌"],
    pop: ["pop", "팝"],
    hiphop: ["힙합", "랩", "rap"],
    indie: ["인디"],
    folk: ["포크", "어쿠스틱"],
    ost: ["ost", "영화음악", "사운드트랙"],
  },
  mood: {
    upbeat: ["신나는", "업비트"],
    chill: ["잔잔한", "감성적인"],
    bright: ["화창한", "밝은"],
  },
  activity: {
    walk: ["산책"],
    drive: ["드라이브"],
  },
  mix: {
    blend: ["섞", "같이", "적절히", "골고루"],
    sequential: ["순서", "처음엔", "나중엔"],
  },
} as const;

const STYLE_MAP: Record<string, string[]> = {
  melodic: ["멜로디", "감미로운", "노래하는 랩", "singing rap", "melodic"],
  rap: ["랩", "하드한 랩", "빠른 랩", "flow"],
  chill: ["잔잔한", "lofi", "느린"],
  aggressive: ["강한", "빡센", "하드"],
};

function tokenizeSemantic(text: string): string[] {
  return String(text ?? "")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean);
}

function matchSemantic(prompt: string, words: readonly string[]): boolean {
  const tokens = tokenizeSemantic(prompt);
  return words.some(word => {
    const key = normalizeText(word);
    if (!key) return false;
    if (key.includes(" ")) {
      return normalizeText(prompt).includes(key);
    }
    return tokens.some(token => normalizeText(token) === key);
  });
}

type CandidateScores = {
  genres: Record<string, number>;
  mood: Record<string, number>;
  activity: Record<string, number>;
  context: Record<string, number>;
};

type SemanticDbEntry = {
  bucket: keyof CandidateScores;
  label: string;
  words: string[];
  weight: number;
};

const SEMANTIC_DB: SemanticDbEntry[] = [
  ...Object.entries(SEMANTIC_MAP.genre).map(([label, words]) => ({
    bucket: "genres" as const,
    label,
    words: [...words],
    weight: 1,
  })),
  ...Object.entries(SEMANTIC_MAP.mood).map(([label, words]) => ({
    bucket: "mood" as const,
    label,
    words: [...words],
    weight: 0.85,
  })),
  ...Object.entries(SEMANTIC_MAP.activity).map(([label, words]) => ({
    bucket: "activity" as const,
    label,
    words: [...words],
    weight: 0.8,
  })),
  {
    bucket: "context",
    label: "korean",
    words: [...SEMANTIC_MAP.locale.korean],
    weight: 1,
  },
];

function tokenize(text: string): string[] {
  return String(text ?? "")
    .split(/\s+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function generateNGrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let n = 3; n >= 1; n -= 1) {
    for (let i = 0; i <= tokens.length - n; i += 1) {
      out.push(tokens.slice(i, i + n).join(" "));
    }
  }
  return out;
}

function extractCandidates(prompt: string): CandidateScores {
  const tokens = tokenize(prompt);
  const tokenNorm = tokens.map(t => normalizeText(t)).filter(Boolean);
  const tokenSet = new Set(tokenNorm);
  const ngramSet = new Set(generateNGrams(tokens).map(g => normalizeText(g)).filter(Boolean));
  const candidates: CandidateScores = {
    genres: {},
    mood: {},
    activity: {},
    context: {},
  };
  for (const entry of SEMANTIC_DB) {
    let score = 0;
    for (const w of entry.words) {
      const concept = normalizeText(w);
      if (!concept) continue;
      const hit = concept.includes(" ") ? ngramSet.has(concept) : tokenSet.has(concept);
      if (hit) score += entry.weight;
    }
    if (score > 0) {
      candidates[entry.bucket][entry.label] = (candidates[entry.bucket][entry.label] ?? 0) + score;
    }
  }
  return candidates;
}

function extractUnknownTokens(prompt: string): string[] {
  return tokenize(prompt).filter(word => word.length > 1);
}

function inferSemantics(tokens: string[]): Pick<CandidateScores, "genres" | "mood" | "context"> {
  const inferred: Pick<CandidateScores, "genres" | "mood" | "context"> = {
    genres: {},
    mood: {},
    context: {},
  };
  tokens.forEach(t => {
    const token = normalizeText(t);
    if (/감성|우울|잔잔/.test(token)) inferred.mood.chill = (inferred.mood.chill ?? 0) + 0.7;
    if (/운동|헬스/.test(token)) inferred.mood.upbeat = (inferred.mood.upbeat ?? 0) + 0.7;
    if (/파티|클럽/.test(token)) inferred.mood.upbeat = (inferred.mood.upbeat ?? 0) + 0.6;
    if (/아이돌/.test(token)) inferred.genres.kpop = (inferred.genres.kpop ?? 0) + 0.9;
    if (/빌보드/.test(token)) inferred.genres.pop = (inferred.genres.pop ?? 0) + 0.8;
    if (/한국|국내|korean|kpop|케이팝/.test(token)) {
      inferred.context.korean = (inferred.context.korean ?? 0) + 1;
    }
  });
  return inferred;
}

function selectTopK(candidates: Record<string, number>, k = 5): string[] {
  return Object.entries(candidates)
    .filter(([, score]) => Number(score) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([key]) => key);
}

function mergeSemantics(
  known: CandidateScores,
  inferred: Pick<CandidateScores, "genres" | "mood" | "context">,
): { genres: Record<string, number>; mood: Record<string, number>; activity: Record<string, number>; context: Record<string, number>; locale: "korean" | "global" } {
  const mergedGenres: Record<string, number> = { ...known.genres };
  for (const [k, v] of Object.entries(inferred.genres)) mergedGenres[k] = (mergedGenres[k] ?? 0) + v;
  const mergedMood: Record<string, number> = { ...known.mood };
  for (const [k, v] of Object.entries(inferred.mood)) mergedMood[k] = (mergedMood[k] ?? 0) + v;
  const mergedContext: Record<string, number> = { ...known.context };
  for (const [k, v] of Object.entries(inferred.context)) mergedContext[k] = (mergedContext[k] ?? 0) + v;
  return {
    genres: mergedGenres,
    mood: mergedMood,
    activity: { ...known.activity },
    context: mergedContext,
    locale: (mergedContext.korean ?? 0) > 0 ? "korean" : "global",
  };
}

function extractForcedLocale(prompt: string): "korean" | null {
  const p = normalizeText(prompt);
  if (/(한국|국내|k-pop|케이팝|아이돌|한국 노래|korean)/.test(p)) return "korean";
  return null;
}

function extractForcedStyles(prompt: string): string[] {
  const p = normalizeText(prompt);
  const out = new Set<string>();
  if (/(멜로디 힙합|melodic hip hop)/.test(p)) out.add("melodic");
  if (/(랩 위주|rap|하드한 랩|빠른 랩|flow)/.test(p)) out.add("rap");
  return Array.from(out);
}

function parseDuration(prompt: string): { min: number; max: number | null } {
  const norm = normalizePrompt(prompt);
  const range = norm.match(/(\d+)\s*시간\s*(\d+)\s*시간|(\d+)\s*분\s*(\d+)\s*분/);
  if (range) {
    if (range[1] && range[2]) return { min: Number(range[1]) * 60, max: Number(range[2]) * 60 };
    if (range[3] && range[4]) return { min: Number(range[3]), max: Number(range[4]) };
  }
  const tc = extractTimeConstraint(prompt);
  if (!tc) return { min: 60, max: null };
  if (tc.mode === "at_most") return { min: Math.max(20, Math.round(tc.minutes * 0.8)), max: tc.minutes };
  return { min: tc.minutes, max: tc.mode === "around" ? Math.round(tc.minutes * 1.2) : null };
}

function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights).filter(([, v]) => Number.isFinite(v) && v > 0);
  const sum = entries.reduce((acc, [, v]) => acc + v, 0) || 1;
  const out: Record<string, number> = {};
  for (const [k, v] of entries) out[k] = v / sum;
  return out;
}

function analyzeMix(prompt: string, genres: string[]): {
  strategy: "blend" | "sequential" | "single";
  weights: Record<string, number>;
} {
  let strategy: "blend" | "sequential" | "single" = "single";
  if (matchSemantic(prompt, SEMANTIC_MAP.mix.blend) || genres.length >= 3) strategy = "blend";
  if (matchSemantic(prompt, SEMANTIC_MAP.mix.sequential)) strategy = "sequential";
  const base = genres.length ? 1 / genres.length : 1;
  const weights: Record<string, number> = {};
  for (const g of genres) weights[g] = base;
  if (/위주/.test(normalizeText(prompt)) && genres.length) {
    weights[genres[0] as string] = (weights[genres[0] as string] ?? base) + 0.2;
  }
  return { strategy, weights: normalizeWeights(weights) };
}

function extractStyle(prompt: string): string[] {
  const styles: string[] = [];
  for (const [style, words] of Object.entries(STYLE_MAP)) {
    if (matchSemantic(prompt, words)) styles.push(style);
  }
  return Array.from(new Set(styles));
}

function mapStyleToFeatures(styles: string[]): StructuredIntent["audioFeatures"] {
  const features: StructuredIntent["audioFeatures"] = {
    vocalType: "rap",
    melody: 0,
    aggression: 0,
    energy: 0.5,
  };
  for (const style of styles) {
    if (style === "melodic") {
      features.melody = 0.8;
      features.vocalType = "singing";
    }
    if (style === "rap") {
      features.melody = 0.2;
      features.vocalType = "rap";
    }
    if (style === "chill") features.energy = 0.3;
    if (style === "aggressive") {
      features.energy = 0.8;
      features.aggression = 0.7;
    }
  }
  return features;
}

function buildStructuredIntent(prompt: string, base?: BasePromptFeatures | null): StructuredIntent {
  const normalized = normalizePrompt(prompt);
  const knownCandidates = extractCandidates(normalized);
  console.warn(`[CandidatesRaw] payload=${JSON.stringify(knownCandidates)}`);
  const unknown = extractUnknownTokens(normalized);
  const inferred = inferSemantics(unknown);
  const merged = mergeSemantics(knownCandidates, inferred);
  console.warn(`[CandidatesScored] payload=${JSON.stringify(merged)}`);
  const forcedLocale = extractForcedLocale(prompt);
  const forcedGenres = extractForcedGenresFromPrompt(prompt);
  const forcedStyles = extractForcedStyles(prompt);
  const forcedSpecialTags = extractForcedSpecialTagsFromPrompt(prompt);
  console.warn(`[ForcedIntent] promptLockedGenres=${JSON.stringify(forcedGenres)}`);
  console.warn(`[ForcedIntent] promptLockedSpecialTags=${JSON.stringify(forcedSpecialTags)}`);
  const styles = Array.from(new Set([...extractStyle(normalized), ...forcedStyles]));
  const audioFeatures = mapStyleToFeatures(styles);
  const candidateGenres = selectTopK(merged.genres, 8)
    .map(v => normalizeGenre(v))
    .filter((v): v is CanonicalGenre => Boolean(v));
  const baseGenres = (base?.requestedGenres ?? [])
    .map(v => normalizeGenre(v))
    .filter((v): v is CanonicalGenre => Boolean(v));
  let finalGenres = Array.from(
    new Set<CanonicalGenre>([...forcedGenres, ...baseGenres, ...candidateGenres]),
  );
  if (!finalGenres.length) {
    finalGenres = [(forcedLocale ?? merged.locale ?? "global") === "korean" ? "k-pop" : "indie"];
  }
  const selectedMood = selectTopK(merged.mood, 3);
  const selectedActivity = selectTopK(merged.activity, 2);
  const selectedContext = selectTopK(merged.context, 2);
  const selectedSpecialTags = Array.from(new Set<CanonicalSpecialTag>([
    ...forcedSpecialTags,
    ...((base?.requestedSpecialTags ?? [])
      .map(v => normalizeSpecialTag(v))
      .filter((v): v is CanonicalSpecialTag => Boolean(v))),
  ]));
  const locale: "korean" | "global" =
    base?.retention?.locale === true
      ? "korean"
      : (forcedLocale ?? merged.locale ?? "global");
  console.warn(`[IntentMerge] baseGenres=${JSON.stringify(baseGenres)}`);
  console.warn(`[IntentMerge] geminiGenres=[]`);
  console.warn(`[IntentMerge] finalGenres=${JSON.stringify(finalGenres)}`);
  console.warn(`[IntentMerge] finalSpecialTags=${JSON.stringify(selectedSpecialTags)}`);
  console.warn(
    `[FinalSelected] locale=${locale} genres=${finalGenres.join("|") || "-"} mood=${selectedMood.join("|") || "-"} activity=${selectedActivity.join("|") || "-"} context=${selectedContext.join("|") || "-"} specialTags=${selectedSpecialTags.join("|") || "-"}`,
  );

  const effectiveGenres = finalGenres;
  const { strategy, weights } = analyzeMix(normalized, effectiveGenres);
  const duration = parseDuration(prompt);
  const tempo: StructuredIntent["tempo"] =
    audioFeatures.energy >= 0.7 ? "high" : audioFeatures.energy <= 0.35 ? "low" : "mid";
  return {
    locale,
    genres: effectiveGenres,
    genreWeights: weights,
    excludedGenres: [],
    specialTags: selectedSpecialTags,
    locked: {
      genres: forcedGenres,
      specialTags: forcedSpecialTags,
    },
    mood: selectedMood,
    activity: selectedActivity,
    environment: selectedContext,
    styles,
    audioFeatures,
    tempo,
    energy: audioFeatures.energy,
    durationMin: duration.min,
    durationMax: duration.max,
    mixStrategy: strategy,
  };
}

function parseStructuredIntent(prompt: string, base?: BasePromptFeatures | null): StructuredIntent {
  return buildStructuredIntent(prompt, base);
}

function buildStructuredIntentWithSnapshot(args: {
  prompt: string;
  base?: BasePromptFeatures | null;
  requestId?: string;
}): StructuredIntent {
  const intent = buildStructuredIntent(args.prompt, args.base);
  const key = String(args.requestId ?? "").trim();
  if (!key) return intent;
  const snapshot = forcedIntentSnapshotByRequestId.get(key);
  if (!snapshot) return intent;
  const mergedLockedGenres = Array.from(new Set<CanonicalGenre>([
    ...snapshot.forcedGenres,
    ...intent.locked.genres,
  ]));
  const mergedLockedTags = Array.from(new Set<CanonicalSpecialTag>([
    ...snapshot.forcedSpecialTags,
    ...intent.locked.specialTags,
  ]));
  return {
    ...intent,
    genres: Array.from(new Set<CanonicalGenre>([...mergedLockedGenres, ...intent.genres])),
    specialTags: Array.from(new Set<CanonicalSpecialTag>([...mergedLockedTags, ...intent.specialTags])),
    locked: {
      genres: mergedLockedGenres,
      specialTags: mergedLockedTags,
    },
  };
}

function estimateAverageTrackDurationMs(
  pools: Array<SpotifyTrackSummary[] | null | undefined>,
  fallbackMs = 210000,
): number {
  const durations = pools
    .flatMap(pool => pool ?? [])
    .map(t => Number(t?.duration_ms ?? 0))
    .filter(v => Number.isFinite(v) && v >= 90_000 && v <= 900_000);
  if (!durations.length) return fallbackMs;
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  return Math.max(150_000, Math.min(330_000, avg));
}

function deriveTargetTrackCount(args: {
  parsedTargetCount?: number;
  targetMinutes?: number | null;
  timeMode?: TimeConstraint["mode"];
  averageDurationMs: number;
  maxCount?: number;
}): number {
  const maxCount = Math.max(20, Math.min(80, Math.floor(args.maxCount ?? 60)));
  const parsed = Number(args.parsedTargetCount ?? 0);
  const parsedSafe = parsed > 0 ? clamp(parsed, 8, maxCount) : null;
  if (!args.targetMinutes || args.targetMinutes <= 0) {
    return clamp(parsedSafe ?? 20, 10, maxCount);
  }
  const byMinutes = Math.ceil(
    (args.targetMinutes * 60 * 1000) / Math.max(140_000, args.averageDurationMs),
  );
  if (args.timeMode === "at_most") {
    const capped = parsedSafe ? Math.min(parsedSafe, byMinutes) : byMinutes;
    return clamp(capped, 8, maxCount);
  }
  // 시간 조건은 최우선: 특히 at_least는 모델 count보다 작지 않게 맞춘다.
  return clamp(Math.max(parsedSafe ?? 0, byMinutes), 12, maxCount);
}

function sumDurationMs(list: SpotifyTrackSummary[]): number {
  return list.reduce((sum, t) => {
    const d = Number(t?.duration_ms ?? 0);
    const safe = d > 30_000 ? d : 210_000;
    return sum + safe;
  }, 0);
}

function enforceMinimumDuration(args: {
  selected: SpotifyTrackSummary[];
  targetMinutes?: number | null;
  timeConstraint?: TimeConstraint | null;
  candidatePool: SpotifyTrackSummary[];
  minCoverage?: number;
  maxCount?: number;
}): SpotifyTrackSummary[] {
  const targetMinutes = Number(args.targetMinutes ?? 0);
  if (targetMinutes <= 0) return args.selected;
  const mode = args.timeConstraint?.mode ?? "around";
  if (mode === "at_most") return args.selected;
  const targetMs = targetMinutes * 60 * 1000;
  const minCoverage = Math.max(0.8, Math.min(1, args.minCoverage ?? 0.95));
  const minRequiredMs = targetMs * minCoverage;
  const selected = [...args.selected];
  let currentMs = sumDurationMs(selected);
  if (currentMs >= minRequiredMs) return selected;

  const used = new Set(
    selected
      .map(t => trackDedupKey(t))
      .filter((v): v is string => Boolean(v)),
  );
  const dynamicMaxCount = clamp(
    Math.round(targetMinutes * 0.52),
    Math.max(selected.length + 4, 20),
    Math.max(80, args.maxCount ?? 90),
  );
  for (const track of args.candidatePool) {
    if (selected.length >= dynamicMaxCount) break;
    const key = trackDedupKey(track);
    if (!key || used.has(key)) continue;
    selected.push(track);
    used.add(key);
    currentMs = sumDurationMs(selected);
    if (currentMs >= minRequiredMs) break;
  }
  return selected;
}

function mergeUniqueTracks(
  ...lists: Array<SpotifyTrackSummary[] | null | undefined>
): SpotifyTrackSummary[] {
  const map = new Map<string, SpotifyTrackSummary>();
  lists.forEach(list => {
    (list ?? []).forEach(track => {
      const key = trackDedupKey(track);
      if (!key || map.has(key)) return;
      map.set(key, track);
    });
  });
  return Array.from(map.values());
}

function seededUnit(seed: number, key: string): number {
  const h = stableHash(`${seed}|${key}`);
  return (Math.abs(h) % 100000) / 100000;
}

function seededShuffleTracks(
  tracks: SpotifyTrackSummary[],
  seed: number,
): SpotifyTrackSummary[] {
  return [...tracks].sort((a, b) => {
    const ak = `${a.id ?? a.uri ?? a.name}`;
    const bk = `${b.id ?? b.uri ?? b.name}`;
    return seededUnit(seed, ak) - seededUnit(seed, bk);
  });
}

function sampleTracksSeeded(
  tracks: SpotifyTrackSummary[],
  n: number,
  seed: number,
): SpotifyTrackSummary[] {
  return seededShuffleTracks(tracks, seed).slice(0, Math.max(0, n));
}

function interleaveTrackGroups(args: {
  taste: SpotifyTrackSummary[];
  exploration: SpotifyTrackSummary[];
  general: SpotifyTrackSummary[];
  targetCount: number;
  seed: number;
}): SpotifyTrackSummary[] {
  const dedup = new Set<string>();
  const out: SpotifyTrackSummary[] = [];
  const order = [
    "taste",
    "taste",
    "taste",
    "taste",
    "taste",
    "taste",
    "exploration",
    "exploration",
    "exploration",
    "general",
  ] as const;
  const groups = {
    taste: seededShuffleTracks(args.taste, args.seed + 11),
    exploration: seededShuffleTracks(args.exploration, args.seed + 17),
    general: seededShuffleTracks(args.general, args.seed + 23),
  };
  const idx = { taste: 0, exploration: 0, general: 0 };
  let cursor = 0;
  while (out.length < args.targetCount) {
    const key = order[cursor % order.length];
    cursor += 1;
    const arr = groups[key];
    let picked: SpotifyTrackSummary | null = null;
    while (idx[key] < arr.length) {
      const cand = arr[idx[key]++];
      const k = trackDedupKey(cand);
      if (!k || dedup.has(k)) continue;
      picked = cand;
      dedup.add(k);
      break;
    }
    if (picked) {
      out.push(picked);
      continue;
    }
    const fallback = [
      ...groups.taste.slice(idx.taste),
      ...groups.exploration.slice(idx.exploration),
      ...groups.general.slice(idx.general),
    ];
    if (!fallback.length) break;
    const cand = fallback.find(t => {
      const k = trackDedupKey(t);
      return Boolean(k) && !dedup.has(String(k));
    });
    if (!cand) break;
    const k = trackDedupKey(cand);
    if (k) dedup.add(k);
    out.push(cand);
  }
  return out;
}

function buildEmergencyTrackPool(args: {
  catalogPool?: SpotifyTrackSummary[] | null;
  localPicks?: SpotifyTrackSummary[] | null;
  fallback?: SpotifyTrackSummary[] | null;
  bootstrap: SpotifyBootstrapData | null;
}): SpotifyTrackSummary[] {
  return mergeUniqueTracks(
    args.catalogPool ?? [],
    args.localPicks ?? [],
    args.fallback ?? [],
    args.bootstrap?.topTracks ?? [],
    args.bootstrap?.recentlyPlayed ?? [],
  );
}

function buildDurationRescueQueries(args: {
  moodInput: string;
  parsed?: GeminiPlaylistJson;
  bootstrap: SpotifyBootstrapData | null;
}): string[] {
  const include = parseGeminiKeywords(args.parsed?.includeKeywords);
  const focus = parseGeminiKeywords(args.parsed?.focusKeywords);
  const genres = parseGeminiKeywords(args.parsed?.genreHints);
  const topArtistNames = (args.bootstrap?.topArtists ?? [])
    .slice(0, 3)
    .map(a => String(a?.name ?? "").trim())
    .filter(Boolean);

  return Array.from(
    new Set([
      args.moodInput,
      `${[...focus.slice(0, 4), ...genres.slice(0, 4)].join(" ")} playlist`,
      `${[...include.slice(0, 5), ...genres.slice(0, 5)].join(" ")} mix`,
      `${topArtistNames.join(" ")} similar`,
      `${genres.slice(0, 4).join(" ")} best tracks`,
      `${keywordList(args.moodInput).slice(0, 6).join(" ")} radio`,
    ].map(v => String(v ?? "").replace(/\s+/g, " ").trim()).filter(v => v.length >= 2)),
  ).slice(0, 6);
}

function buildStrictIntentQueries(args: {
  moodInput: string;
  parsed?: GeminiPlaylistJson;
}): string[] {
  const include = parseGeminiKeywords(args.parsed?.includeKeywords).filter(
    k => !CONTEXT_ONLY_KEYWORDS.has(k),
  );
  const focus = parseGeminiKeywords(args.parsed?.focusKeywords).filter(
    k => !CONTEXT_ONLY_KEYWORDS.has(k),
  );
  const genres = parseGeminiKeywords(args.parsed?.genreHints);
  const baseKeywords = Array.from(
    new Set([
      ...focus.slice(0, 6),
      ...include.slice(0, 8),
      ...genres.slice(0, 6),
      ...keywordList(args.moodInput).filter(k => !CONTEXT_ONLY_KEYWORDS.has(k)).slice(0, 8),
    ]),
  ).slice(0, 12);

  const composed = [
    baseKeywords.join(" "),
    `${focus.slice(0, 4).join(" ")} ${genres.slice(0, 4).join(" ")}`.trim(),
    `${include.slice(0, 5).join(" ")} playlist`.trim(),
  ]
    .map(v => String(v ?? "").replace(/\s+/g, " ").trim())
    .filter(v => v.length >= 2);
  return Array.from(new Set(composed)).slice(0, 4);
}

function assessPlaylistQuality(args: {
  tracks: SpotifyTrackSummary[];
  moodInput: string;
  parsed?: GeminiPlaylistJson;
  targetMinutes?: number | null;
  intentShift?: number;
}): {
  intentCoverage: number;
  durationCoverage: number;
  isAcceptable: boolean;
} {
  if (!args.tracks.length) {
    return { intentCoverage: 0, durationCoverage: 0, isAcceptable: false };
  }
  const intent = buildUserIntentProfile(args.moodInput);
  const include = Array.from(
    new Set([
      ...keywordList(args.moodInput),
      ...parseGeminiKeywords(args.parsed?.includeKeywords),
      ...parseGeminiKeywords(args.parsed?.focusKeywords),
      ...intent.include,
    ]),
  ).slice(0, 12);
  const exclude = Array.from(
    new Set([
      ...parseGeminiKeywords(args.parsed?.excludeKeywords),
      ...intent.exclude,
    ]),
  ).slice(0, 12);
  const genreHints = parseGeminiKeywords(args.parsed?.genreHints);
  const energy = inferEnergyFromKeywords(include, args.parsed?.energyLevel);
  const profile = buildIntentConstraintProfile({
    moodInput: args.moodInput,
    include,
    exclude,
    genreHints,
    energy,
    specificity: intent.specificity,
    intentShift: Math.min(0.9, Math.max(0, args.intentShift ?? 0)),
  });
  const softThreshold = 0.25 + profile.strictness * 0.95;
  const matched = args.tracks.filter(track => {
    const fit = evaluateTrackIntentFit(track, profile);
    return !fit.forbidden && fit.score >= softThreshold;
  }).length;
  const intentCoverage = matched / Math.max(1, args.tracks.length);

  let durationCoverage = 1;
  const targetMinutes = Number(args.targetMinutes ?? 0);
  if (targetMinutes > 0) {
    const targetMs = targetMinutes * 60 * 1000;
    const actual = sumDurationMs(args.tracks);
    durationCoverage = targetMs > 0 ? actual / targetMs : 1;
  }
  const isAcceptable =
    intentCoverage >= 0.62 &&
    durationCoverage >= 0.9;
  return { intentCoverage, durationCoverage, isAcceptable };
}

function computeFastQualityGate(args: {
  fastIntent: FastIntent;
  searchPlan: PromptSearchPlan;
  currentSpecificity: number;
  timeConstraint: TimeConstraint | null;
  targetMinutes: number | null;
}): {
  intentMin: number;
  genreMin: number;
  durationMin: number;
  fallbackIntentMin: number;
  fallbackGenreMin: number;
  clarityScore: number;
} {
  const clampFloat = (n: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, n));
  const hasKoreanMoodKeywords = args.fastIntent.moodKeywords.some(v => /[가-힣]/.test(v));
  const hasGenre = args.fastIntent.genres.length > 0 ? 1 : 0;
  const hasTime = args.timeConstraint?.minutes ? 1 : 0;
  const hasRichKeywords = args.fastIntent.moodKeywords.length >= 2 ? 1 : 0;
  const specificityNorm = clampFloat(args.currentSpecificity / 10, 0, 1);
  const confidenceNorm = clampFloat(args.fastIntent.confidence, 0, 1);
  const clarityScore = clampFloat(
    0.3 * hasGenre +
      0.25 * hasTime +
      0.2 * hasRichKeywords +
      0.15 * specificityNorm +
      0.1 * confidenceNorm,
    0,
    1,
  );

  const strictBoost = clarityScore;
  const longDurationBoost =
    args.targetMinutes && args.targetMinutes >= 120 ? 0.04 : 0;
  const atLeastBoost = args.timeConstraint?.mode === "at_least" ? 0.04 : 0;
  const koreanRelax = hasKoreanMoodKeywords ? 0.08 : 0;

  const intentMin = clampFloat(0.14 + strictBoost * 0.1 - koreanRelax, 0.08, 0.3);
  const genreMin = clampFloat(0.14 + strictBoost * 0.12 - koreanRelax * 0.7, 0.1, 0.36);
  const durationMin = clampFloat(
    0.5 + strictBoost * 0.12 + longDurationBoost * 0.5 + atLeastBoost * 0.5,
    0.5,
    0.9,
  );
  const fallbackIntentMin = clampFloat(intentMin - 0.05, 0.06, 0.24);
  const fallbackGenreMin = clampFloat(genreMin - 0.04, 0.08, 0.26);

  return {
    intentMin,
    genreMin,
    durationMin,
    fallbackIntentMin,
    fallbackGenreMin,
    clarityScore,
  };
}

function computeFastIntentCoverageProxy(args: {
  qualityIntentCoverage: number;
  genreCoverage: number;
  fastIntent: FastIntent;
  tracks: SpotifyTrackSummary[];
  userTasteAffinity: number;
}): number {
  const clampFloat = (n: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, n));
  const base = clamp(Math.round(args.qualityIntentCoverage * 100), 0, 100) / 100;
  if (!args.fastIntent.genres.length) return base;
  const hasKoreanMoodKeywords = args.fastIntent.moodKeywords.some(v => /[가-힣]/.test(v));
  const genreBoost = args.genreCoverage * (hasKoreanMoodKeywords ? 0.84 : 0.72);
  const energyToken =
    args.fastIntent.energy === "high"
      ? "upbeat"
      : args.fastIntent.energy === "low"
        ? "chill"
        : "";
  let energyMatch = 0;
  if (energyToken) {
    let matched = 0;
    for (const track of args.tracks) {
      const text = normalizeText(
        [track.name, ...(track.artists ?? []).map(a => a.name), ...(track.genres ?? [])].join(" "),
      );
      if (text.includes(energyToken)) matched += 1;
    }
    energyMatch = matched / Math.max(1, args.tracks.length);
  }
  const koreanKeywordBoost = hasKoreanMoodKeywords ? 0.08 : 0;
  return clampFloat(
    Math.max(base, genreBoost + energyMatch * 0.18 + koreanKeywordBoost + args.userTasteAffinity * 0.36),
    0,
    1,
  );
}

function computeFastUserTasteAffinity(args: {
  tracks: SpotifyTrackSummary[];
  userTopTrackIds: Set<string>;
  userTopArtistIds: Set<string>;
  userTopArtistNames: Set<string>;
}): number {
  if (!args.tracks.length) return 0;
  let artistMatched = 0;
  let trackMatched = 0;
  for (const t of args.tracks) {
    const id = String(t.id ?? "").trim();
    if (id && args.userTopTrackIds.has(id)) trackMatched += 1;
    const artistIds = (t.artists ?? []).map(a => String(a?.id ?? "").trim()).filter(Boolean);
    const artistNames = (t.artists ?? []).map(a => normalizeText(a?.name ?? "")).filter(Boolean);
    if (
      artistIds.some(v => args.userTopArtistIds.has(v)) ||
      artistNames.some(v => args.userTopArtistNames.has(v))
    ) {
      artistMatched += 1;
    }
  }
  const artistRatio = artistMatched / Math.max(1, args.tracks.length);
  const trackRatio = trackMatched / Math.max(1, args.tracks.length);
  return Math.min(1, artistRatio * 0.82 + trackRatio * 0.5);
}

function recommendationDayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function logSpotifyApiHealthIfNeeded(context: string): void {
  const health = getSpotifyApiHealthSnapshot();
  const total403 =
    health.audioFeatures403Count +
    health.artist403Count +
    health.savedTrack403Count;
  if (!total403) return;
  console.warn(
    `[Spotify] api health (${context}): metadataEnrich=${health.metadataEnrichEnabled}, 403(audio=${health.audioFeatures403Count}, artist=${health.artist403Count}, saved=${health.savedTrack403Count})`,
  );
}

function logPromptMismatchDiagnostics(args: {
  moodInput: string;
  parsed?: GeminiPlaylistJson;
  tracks: SpotifyTrackSummary[];
  context: string;
}): void {
  if (!args.tracks.length) return;
  const intent = buildUserIntentProfile(args.moodInput);
  const include = Array.from(
    new Set([
      ...keywordList(args.moodInput),
      ...parseGeminiKeywords(args.parsed?.includeKeywords),
      ...parseGeminiKeywords(args.parsed?.focusKeywords),
      ...intent.include,
    ]),
  ).slice(0, 14);
  const exclude = Array.from(
    new Set([
      ...parseGeminiKeywords(args.parsed?.excludeKeywords),
      ...intent.exclude,
    ]),
  ).slice(0, 12);
  const genreHints = parseGeminiKeywords(args.parsed?.genreHints);
  const profile = buildIntentConstraintProfile({
    moodInput: args.moodInput,
    include,
    exclude,
    genreHints,
    energy: inferEnergyFromKeywords(include, args.parsed?.energyLevel),
    specificity: intent.specificity,
    intentShift: 0,
  });
  const softThreshold = 0.25 + profile.strictness * 0.95;
  const mismatched = args.tracks.filter(track => {
    const fit = evaluateTrackIntentFit(track, profile);
    return fit.forbidden || fit.score < softThreshold;
  });
  const mismatchRatio = mismatched.length / Math.max(1, args.tracks.length);
  const includeHits = include.filter(k =>
    args.tracks.some(track => {
      const text = normalizeText(
        [
          track.name,
          ...(track.artists ?? []).map(a => a.name),
          ...(track.genres ?? []),
          track.album?.name ?? "",
        ].join(" "),
      );
      return text.includes(k);
    }),
  );
  if (mismatchRatio < 0.35) return;
  const sample = mismatched
    .slice(0, 3)
    .map(track => `${track.name} - ${(track.artists ?? []).map(a => a.name).join(", ")}`)
    .join(" | ");
  console.warn(
    `[Gemini] prompt-fit diagnostics (${args.context}): mismatch=${Math.round(
      mismatchRatio * 100,
    )}%, includeHit=${includeHits.length}/${include.length}, sample=${sample || "none"}`,
  );
}

function pickFallbackTracks(
  bootstrap: SpotifyBootstrapData | null,
  limit = 12,
): SpotifyTrackSummary[] {
  if (!bootstrap) return [];
  const merged = [...bootstrap.topTracks, ...bootstrap.recentlyPlayed].sort(
    () => Math.random() - 0.5,
  );
  const map = new Map<string, SpotifyTrackSummary>();
  merged.forEach(t => {
    if (t?.id && !map.has(t.id)) map.set(t.id, t);
  });
  return Array.from(map.values()).slice(0, limit);
}

async function buildFallbackTracks(args: {
  prompt: string;
  requestId?: string;
  spotifyBootstrap?: SpotifyBootstrapData | null;
  spotifyAccessToken?: string | null;
  abortSignal?: AbortSignal;
  targetMinutes?: number | null;
}): Promise<Track[]> {
  const requestId = String(args.requestId ?? "").trim();
  const cached = requestId ? candidateCacheByRequestId.get(requestId) ?? [] : [];
  let pool = cached;

  if (!pool.length) {
    const base = buildBasePromptFeatures(args.prompt);
    const intent = buildStructuredIntent(args.prompt, base);
    const queryPlan = buildQueryStrategy(intent);
    const topQueries = queryPlan.finalQueries.slice(0, 4);
    const cachedByQueries = topQueries.flatMap(q => querySearchCache.get(normalizeQueryKey(q)) ?? []);
    pool = mergeUniqueTracks(cachedByQueries);
    if (!pool.length && args.spotifyAccessToken && topQueries.length) {
      const quick = await searchSpotifyTracksByQueries({
        accessToken: args.spotifyAccessToken,
        queries: topQueries,
        perQueryLimit: 10,
        randomSeed: stableHash(`${buildRequestSeed()}|partial_fallback|${requestId || "-"}`),
        concurrency: 2,
        maxDurationMs: 1600,
        requestId,
        abortSignal: args.abortSignal,
        onTracks: event => buildOnTracksCollector(requestId)({
          query: event.query,
          tracks: event.tracks,
        }),
      }).catch(() => [] as SpotifyTrackSummary[]);
      pool = mergeUniqueTracks(quick);
    }
  }

  if (!pool.length) {
    pool = pickFallbackTracks(args.spotifyBootstrap ?? null, 40);
  }

  const baseIntent = buildBasePromptFeatures(args.prompt);
  const intent = buildStructuredIntent(args.prompt, baseIntent);
  const reranked = rerankTracks(pool, intent);
  const quotaApplied = applyGenreQuota(reranked, intent);

  const targetMinutes = Number(args.targetMinutes ?? extractTimeConstraint(args.prompt)?.minutes ?? 120);
  const fitted = fitDuration({
    tracks: quotaApplied.slice(0, 80),
    candidatePool: quotaApplied.slice(0, 80),
    targetMinutes,
    mode: "at_least",
    seed: stableHash(`${requestId || "-"}|partial_fit`),
  });
  return (fitted.length ? fitted : quotaApplied).slice(0, 40).map(toTrack);
}

function buildPartialResultFromSpotifyPool(
  args: {
    pool: SpotifyTrackSummary[];
    prompt: string;
    spotifyBootstrap?: SpotifyBootstrapData | null;
    requestId?: string;
    targetMinutes?: number | null;
  },
): Track[] {
  const base = buildBasePromptFeatures(args.prompt);
  const intent = buildStructuredIntentWithSnapshot({
    prompt: args.prompt,
    base,
    requestId: args.requestId,
  });
  const bootstrapPool = mergeUniqueTracks(
    args.spotifyBootstrap?.topTracks ?? [],
    args.spotifyBootstrap?.recentlyPlayed ?? [],
  );
  const requestedMinutes =
    Number(args.targetMinutes ?? 0) > 0
      ? Number(args.targetMinutes)
      : (extractTimeConstraint(args.prompt)?.minutes ?? intent.durationMin ?? 60);
  const targetMinSeconds = Math.max(30, requestedMinutes) * 60;
  const maxTotalSeconds = Math.round(targetMinSeconds * 1.2);
  const minTrackCount = Math.max(12, Math.round(requestedMinutes * 0.35));
  const maxTrackCount = Math.max(24, Math.round(requestedMinutes * 0.6));
  const sourcePool =
    args.pool.length > 0
      ? args.pool
      : mergeUniqueTracks(
          args.spotifyBootstrap?.topTracks ?? [],
          args.spotifyBootstrap?.recentlyPlayed ?? [],
        );
  const seededSource = seededShuffleTracks(
    sourcePool,
    stableHash(`${args.requestId || "-"}|${promptFingerprint(args.prompt)}|${recommendationDayKey()}`),
  );
  const diversifiedSource = filterRecentFallbackTracks(seededSource);
  const recentHistoryTrackIds = buildHistoryTrackIdSet(320);
  const historyFilteredSource = diversifiedSource.filter(track => {
    const id = String(track?.id ?? "").trim();
    return id ? !recentHistoryTrackIds.has(id) : true;
  });
  const rerankSource = historyFilteredSource.length >= Math.max(8, Math.floor(minTrackCount * 0.7))
    ? historyFilteredSource
    : diversifiedSource;
  const reranked = rerankTracks(rerankSource.length ? rerankSource : seededSource, intent);
  console.warn("[PartialResult] rerankedCount=", reranked.length);
  const quotaApplied = applyGenreQuotaExpanded(reranked, intent);
  console.warn("[PartialResult] quotaCount=", quotaApplied.length);
  const fitted = fitTracksToDurationExpanded(quotaApplied, reranked, {
    targetMinSeconds,
    maxTotalSeconds,
    allowRepeat: false,
    minTrackCount,
    maxTrackCount,
  });
  console.warn("[PartialResult] fittedCount=", fitted.length);
  console.warn("[PartialResult] fittedMinutes=", Math.floor(sumDurationMs(fitted) / 60000));
  const selectedBase = (fitted.length ? fitted : quotaApplied).slice(0, 60);
  const selected = selectedBase.filter(track => {
    const id = String(track?.id ?? "").trim();
    return id ? !recentHistoryTrackIds.has(id) : true;
  });
  let finalSelected = selected.length >= Math.min(10, selectedBase.length)
    ? selected
    : selectedBase;
  if (finalSelected.length < minTrackCount) {
    const rescuePool = mergeUniqueTracks(
      finalSelected,
      reranked,
      seededSource,
      sourcePool,
      bootstrapPool,
      pickFallbackTracks(args.spotifyBootstrap ?? null, 80),
      Array.from(querySearchCache.values()).flatMap(list => list ?? []).slice(0, 240),
    );
    const used = new Set(
      finalSelected
        .map(trackDedupKey)
        .filter((v): v is string => Boolean(v)),
    );
    for (const track of rescuePool) {
      if (finalSelected.length >= minTrackCount || finalSelected.length >= maxTrackCount) break;
      const key = trackDedupKey(track);
      if (!key || used.has(key)) continue;
      const id = String(track?.id ?? "").trim();
      if (id && recentHistoryTrackIds.has(id)) continue;
      finalSelected.push(track);
      used.add(key);
    }
    if (finalSelected.length < Math.max(10, Math.floor(minTrackCount * 0.75))) {
      for (const track of rescuePool) {
        if (finalSelected.length >= minTrackCount || finalSelected.length >= maxTrackCount) break;
        const key = trackDedupKey(track);
        if (!key || used.has(key)) continue;
        finalSelected.push(track);
        used.add(key);
      }
    }
  }
  rememberRecentFallbackTracks(finalSelected);
  pushRecommendationSnapshot(promptFingerprint(args.prompt), args.prompt, finalSelected);
  return finalSelected.map(toTrack);
}

function buildImmediateFallbackTracksSync(args: {
  requestId?: string;
  prompt: string;
  spotifyBootstrap?: SpotifyBootstrapData | null;
}): Track[] {
  const requestId = String(args.requestId ?? "").trim();
  console.warn("[FallbackImmediate] start");

  const partialPool = requestId
    ? readPartialPool(requestId)
    : [];
  if (partialPool.length) {
    console.warn("[FallbackImmediate] source=partialSpotifyPool");
    return buildPartialResultFromSpotifyPool({
      pool: partialPool,
      prompt: args.prompt,
      spotifyBootstrap: null,
      requestId,
      targetMinutes: extractTimeConstraint(args.prompt)?.minutes ?? 60,
    });
  }

  const cached = requestId ? candidateCacheByRequestId.get(requestId) || [] : [];
  if (cached.length) {
    console.warn("[FallbackImmediate] source=candidateCache");
    return buildPartialResultFromSpotifyPool({
      pool: cached,
      prompt: args.prompt,
      spotifyBootstrap: null,
      requestId,
      targetMinutes: extractTimeConstraint(args.prompt)?.minutes ?? 60,
    });
  }

  const base = buildBasePromptFeatures(args.prompt);
  const intent = buildStructuredIntentWithSnapshot({
    prompt: args.prompt,
    base,
    requestId,
  });
  const { finalQueries } = buildQueryStrategy(intent);
  const queryCached = finalQueries
    .slice(0, 8)
    .flatMap(q => querySearchCache.get(normalizeQueryKey(q)) || []);
  if (queryCached.length) {
    console.warn("[FallbackImmediate] source=queryCache");
    return buildPartialResultFromSpotifyPool({
      pool: mergeUniqueTracks(queryCached),
      prompt: args.prompt,
      spotifyBootstrap: null,
      requestId,
      targetMinutes: extractTimeConstraint(args.prompt)?.minutes ?? 60,
    });
  }

  const bootstrapPool = mergeUniqueTracks(
    args.spotifyBootstrap?.topTracks || [],
    args.spotifyBootstrap?.recentlyPlayed || [],
  );
  if (bootstrapPool.length) {
    console.warn("[FallbackImmediate] source=bootstrap");
    return buildPartialResultFromSpotifyPool({
      pool: bootstrapPool,
      prompt: args.prompt,
      spotifyBootstrap: args.spotifyBootstrap,
      requestId,
      targetMinutes: extractTimeConstraint(args.prompt)?.minutes ?? 60,
    });
  }

  console.warn("[FallbackImmediate] source=empty");
  return [];
}

function applyGenreQuotaExpanded(
  tracks: SpotifyTrackSummary[],
  _intent: StructuredIntent,
): SpotifyTrackSummary[] {
  const buckets = {
    kpop: [] as SpotifyTrackSummary[],
    ost: [] as SpotifyTrackSummary[],
    rnbSoul: [] as SpotifyTrackSummary[],
    hiphop: [] as SpotifyTrackSummary[],
    indieFolk: [] as SpotifyTrackSummary[],
    other: [] as SpotifyTrackSummary[],
  };

  for (const t of tracks) {
    const text = normalizeText(
      [
        t.name,
        ...(t.artists ?? []).map(a => a.name),
        ...(t.genres ?? []),
        t.album?.name ?? "",
      ].join(" "),
    );

    if (/k-pop|korean pop|kpop|케이팝|아이돌/.test(text)) buckets.kpop.push(t);
    else if (/ost|soundtrack|movie soundtrack|영화음악|사운드트랙/.test(text)) buckets.ost.push(t);
    else if (/r&b|rnb|korean rnb|soul|korean soul|알앤비|소울/.test(text)) buckets.rnbSoul.push(t);
    else if (/hip hop|hip-hop|rap|korean hip hop|힙합|랩/.test(text)) buckets.hiphop.push(t);
    else if (/indie|korean indie|folk|korean folk|acoustic folk|인디|포크/.test(text)) buckets.indieFolk.push(t);
    else buckets.other.push(t);
  }

  const selected = mergeUniqueTracks(
    buckets.kpop.slice(0, 6),
    buckets.ost.slice(0, 5),
    buckets.rnbSoul.slice(0, 6),
    buckets.hiphop.slice(0, 5),
    buckets.indieFolk.slice(0, 6),
  );

  return mergeUniqueTracks(selected, tracks);
}

function fitTracksToDurationExpanded(
  primaryPool: SpotifyTrackSummary[],
  fullPool: SpotifyTrackSummary[],
  options: {
    targetMinSeconds: number;
    maxTotalSeconds: number;
    allowRepeat: boolean;
    minTrackCount: number;
    maxTrackCount: number;
  },
): SpotifyTrackSummary[] {
  const targetMin = options.targetMinSeconds;
  const maxTotal = options.maxTotalSeconds;

  const result: SpotifyTrackSummary[] = [];
  let total = 0;

  const usedKeys = new Set<string>();
  const pushTrack = (t: SpotifyTrackSummary): boolean => {
    const key = trackDedupKey(t);
    if (!key || usedKeys.has(key)) return false;
    const sec = Math.floor(Number(t.duration_ms ?? 0) / 1000);
    if (!sec || sec < 60) return false;
    if (total + sec > maxTotal) return false;

    result.push(t);
    usedKeys.add(key);
    total += sec;
    return true;
  };

  for (const t of primaryPool) {
    pushTrack(t);
    if (total >= targetMin && result.length >= options.minTrackCount) break;
    if (result.length >= options.maxTrackCount) break;
  }

  if (total < targetMin || result.length < options.minTrackCount) {
    for (const t of fullPool) {
      pushTrack(t);
      if (total >= targetMin && result.length >= options.minTrackCount) break;
      if (result.length >= options.maxTrackCount) break;
    }
  }

  if (options.allowRepeat && (total < targetMin || result.length < options.minTrackCount)) {
    let repeatIndex = 0;
    let failedAttempts = 0;
    const maxFailedAttempts = Math.max(20, fullPool.length * 2);
    const repeatSource = fullPool.filter(t => Number(t.duration_ms ?? 0) > 60_000);

    while (
      repeatSource.length > 0 &&
      (total < targetMin || result.length < options.minTrackCount) &&
      result.length < options.maxTrackCount &&
      failedAttempts < maxFailedAttempts
    ) {
      const base = repeatSource[repeatIndex % repeatSource.length];
      repeatIndex += 1;

      const sec = Math.floor(Number(base.duration_ms ?? 0) / 1000);
      if (!sec || total + sec > maxTotal) {
        failedAttempts += 1;
        continue;
      }

      result.push({
        ...base,
        id: `${base.id}_repeat_${repeatIndex}`,
      });
      total += sec;
      failedAttempts = 0;
    }
  }

  return result;
}

function buildSpotifyQueryGenerationPrompt(args: {
  moodInput: string;
  topArtistNames: string[];
  topArtistGenres: string[];
  topTrackNames: string[];
}): string {
  const userTasteHint = args.topArtistNames.length
    ? `사용자가 평소 즐겨 듣는 아티스트: ${args.topArtistNames.slice(0, 5).join(", ")}`
    : "";
  const userGenreHint = args.topArtistGenres.length
    ? `사용자 취향 장르: ${args.topArtistGenres.slice(0, 5).join(", ")}`
    : "";
  const userTrackHint = args.topTrackNames.length
    ? `사용자 상위 트랙: ${args.topTrackNames.slice(0, 3).join(", ")}`
    : "";

  return `
너는 Spotify 검색 전문가다. 사용자 요청을 분석해서 Spotify search API에서
실제로 좋은 결과가 나오는 검색어를 만드는 것이 유일한 목표다.

[사용자 요청]
${args.moodInput.trim()}

[사용자 음악 취향]
${userTasteHint}
${userGenreHint}
${userTrackHint}

[Spotify 검색어 생성 규칙]
1. 검색어는 반드시 2~4단어 영어 (한국어 단어 포함 가능하나 영어 중심)
2. "드라이브", "카페", "운동" 같은 상황어는 검색어에 넣지 말고 분위기로 변환
   - 드라이브 -> "window down", "feel good", "upbeat"
   - 카페 -> "cozy", "acoustic chill"
   - 운동 -> "energetic", "pump up"
3. 장르는 Spotify에서 실제 검색되는 단어로
   - k-pop, korean rnb, korean indie, korean ballad, korean folk, korean ost
4. 분위기 + 장르 조합 쿼리를 만들 것
   - 좋은 예: "korean rnb feel good", "k-pop upbeat", "korean indie chill"
   - 나쁜 예: "drive music korea", "cafe work study"
5. 사용자 취향 아티스트가 있으면 그 아티스트 이름 단독 쿼리도 포함
6. 장르가 여러 개 명시됐으면 각 장르마다 최소 1개 쿼리 생성

[출력 형식 - JSON만, 설명 없음]
{
  "queries": [
    "korean rnb feel good",
    "k-pop upbeat drive",
    "DAY6",
    "korean indie bright",
    "korean ost emotional",
    "folk acoustic warm",
    "korean soul smooth",
    "kpop happy",
    "LEE MU JIN",
    "korean ballad sweet"
  ],
  "reasoning": "한 줄 요약",
  "energyLevel": "low|mid|high",
  "targetCount": 34
}

queries는 정확히 8~12개. 반드시 JSON만 출력.
`.trim();
}

function buildFallbackQueryPlan(args: {
  moodInput: string;
  topArtistNames: string[];
  topArtistGenres: string[];
}): GeminiQueryPlan {
  const text = normalizeText(args.moodInput);
  const detectedGenres: string[] = [];
  if (/k pop|kpop|케이팝/.test(text)) detectedGenres.push("k-pop");
  if (/rnb|알앤비|r b/.test(text)) detectedGenres.push("korean rnb");
  if (/소울|soul/.test(text)) detectedGenres.push("korean soul");
  if (/ost|영화음악|soundtrack/.test(text)) detectedGenres.push("korean ost");
  if (/인디|indie/.test(text)) detectedGenres.push("korean indie");
  if (/포크|folk/.test(text)) detectedGenres.push("korean folk acoustic");
  if (/발라드|ballad/.test(text)) detectedGenres.push("korean ballad");
  if (/힙합|hip hop|hip-hop/.test(text)) detectedGenres.push("korean hip hop");

  const vibeWord = /기분좋|설레|신나|upbeat|energetic/.test(text)
    ? "feel good"
    : /차분|잔잔|chill|calm/.test(text)
      ? "chill"
      : /감성|몽환|dreamy/.test(text)
        ? "emotional"
        : "soft";

  const queries = Array.from(
    new Set(
      [
        ...detectedGenres.slice(0, 5),
        ...args.topArtistNames.slice(0, 3),
        ...(detectedGenres.length
          ? detectedGenres.slice(0, 2).map(g => `${g} ${vibeWord}`)
          : [`korean music ${vibeWord}`]),
        ...args.topArtistGenres.slice(0, 2),
      ]
        .map(v => sanitizeFastSearchToken(v))
        .filter((v): v is string => Boolean(v)),
    ),
  ).slice(0, 10);

  return {
    queries: queries.length ? queries : ["k-pop", "korean rnb", "korean indie"],
    reasoning: "로컬 폴백 분석",
    energyLevel: /신나|upbeat|energetic/.test(text)
      ? "high"
      : /차분|chill|calm/.test(text)
        ? "low"
        : "mid",
    targetCount: 20,
    source: "fallback",
  };
}

async function getGeminiQueryPlan(args: {
  moodInput: string;
  bootstrap: SpotifyBootstrapData | null;
  requestId?: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<GeminiQueryPlan> {
  const topArtistNames = (args.bootstrap?.topArtists ?? [])
    .slice(0, 6)
    .map(a => String(a?.name ?? "").trim())
    .filter(Boolean);

  const topArtistGenres = Array.from(
    new Set(
      (args.bootstrap?.topArtists ?? [])
        .flatMap(a => a.genres ?? [])
        .map(g => normalizeText(String(g ?? "")))
        .filter(g => g.length >= 3 && g.length <= 24),
    ),
  ).slice(0, 6);

  const topTrackNames = (args.bootstrap?.topTracks ?? [])
    .slice(0, 3)
    .map(t => String(t?.name ?? "").trim())
    .filter(Boolean);

  const fallback = buildFallbackQueryPlan({
    moodInput: args.moodInput,
    topArtistNames,
    topArtistGenres,
  });

  try {
    assertNotCancelled(args.requestId, args.abortSignal, "gemini_query_plan_start");
    const prompt = buildSpotifyQueryGenerationPrompt({
      moodInput: args.moodInput,
      topArtistNames,
      topArtistGenres,
      topTrackNames,
    });
    const timeoutMs = args.timeoutMs ?? 8000;
    const raw = await callGeminiWithTimeout(prompt, timeoutMs);
    assertNotCancelled(args.requestId, args.abortSignal, "gemini_query_plan_done");
    const json = raw as any;
    const baseQueries = Array.isArray(json?.queries)
      ? Array.from(
          new Set(
            (json.queries as unknown[])
              .map(q => sanitizeFastSearchToken(String(q ?? "").trim()))
              .filter((q): q is string => Boolean(q))
              .filter(q => {
                const words = q.split(/\s+/).filter(Boolean).length;
                return words >= 2 && words <= 5;
              })
              .filter(q => !/(^|\s)(car|drive|cafe|카페)(\s|$)/i.test(q)),
          ),
        ).slice(0, 12)
      : [];

    if (!baseQueries.length) {
      console.warn("[GeminiQueryPlan] empty queries, using fallback");
      return fallback;
    }
    const requiredGenreSeeds = [
      { regex: /k pop|kpop|케이팝/i, seed: "k-pop" },
      { regex: /rnb|알앤비|r b/i, seed: "korean rnb" },
      { regex: /indie|인디/i, seed: "korean indie" },
      { regex: /folk|포크/i, seed: "korean folk acoustic" },
    ].filter(item => item.regex.test(args.moodInput));
    const mergedQueries = [...baseQueries];
    for (const item of requiredGenreSeeds) {
      const hasGenre = mergedQueries.some(q => item.regex.test(q));
      if (!hasGenre) {
        const seeded = sanitizeFastSearchToken(item.seed);
        if (seeded) mergedQueries.push(seeded);
      }
    }
    for (const artistName of topArtistNames.slice(0, 3)) {
      const hasArtist = mergedQueries.some(q => normalizeText(q).includes(normalizeText(artistName)));
      if (hasArtist) continue;
      const artistQuery = sanitizeFastSearchToken(artistName);
      if (artistQuery) {
        mergedQueries.push(artistQuery);
        continue;
      }
      const rawArtist = String(artistName ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
      const wordCount = rawArtist.split(" ").filter(Boolean).length;
      if (
        rawArtist &&
        wordCount >= 1 &&
        wordCount <= 4 &&
        !/[:"<>]/.test(rawArtist) &&
        !/(^|\s)(car|drive|cafe|카페)(\s|$)/i.test(rawArtist)
      ) {
        mergedQueries.push(rawArtist);
      }
    }
    const queries = Array.from(new Set(mergedQueries)).slice(0, 12);
    if (queries.length < 8) {
      for (const fallbackQuery of fallback.queries) {
        if (queries.length >= 8) break;
        if (queries.includes(fallbackQuery)) continue;
        queries.push(fallbackQuery);
      }
    }

    const energyLevel = ["low", "mid", "high"].includes(String(json?.energyLevel ?? ""))
      ? (json.energyLevel as "low" | "mid" | "high")
      : fallback.energyLevel;

    const targetCount = Number.isFinite(Number(json?.targetCount))
      ? Math.max(10, Math.min(60, Number(json.targetCount)))
      : fallback.targetCount;

    console.warn(
      `[GeminiQueryPlan] success queries=${queries.join(" || ")} energy=${energyLevel}`,
    );
    return {
      queries,
      reasoning: String(json?.reasoning ?? ""),
      energyLevel,
      targetCount,
      source: "gemini",
    };
  } catch (err) {
    console.warn(`[GeminiQueryPlan] fallback: ${safeErrorMessage(err)}`);
    return fallback;
  }
}

function buildPrompt(input: PersonalizedPlaylistInput): string {
  // 개인정보 보호: Gemini에는 Spotify 사용자/계정/청취 데이터는 전송하지 않는다.
  // 오직 사용자가 직접 입력한 텍스트만 전송.
  const safeMoodInput = input.moodInput.trim().replace(/\s+/g, " ");
  const intent = buildUserIntentProfile(input.moodInput);
  const includeSeed = intent.include.join(", ") || "없음";
  const excludeSeed = intent.exclude.join(", ") || "없음";
  const facets = extractPromptFacets(input.moodInput);

  return [
    "너는 음악 큐레이션 AI다. 답변은 반드시 JSON만 반환해라.",
    `사용자 요청: ${safeMoodInput}`,
    `로컬 추출 핵심 키워드: ${includeSeed}`,
    `로컬 추출 제외 키워드: ${excludeSeed}`,
    `의도 구체성 점수(0~10): ${intent.specificity}`,
    `활동/상황 힌트: ${facets.activity || "없음"}`,
    `사운드 성향 힌트: ${facets.sound || "없음"}`,
    `분위기 힌트: ${facets.mood || "없음"}`,
    "",
    "아래 JSON 스키마로만 답해라(마크다운/설명 금지).",
    '{"playlistName":"string","moodSummary":"string","reasoning":"string","targetCount":12,"mixStrategy":"familiar|balanced|discovery","includeKeywords":["string"],"excludeKeywords":["string"],"genreHints":["string"],"focusKeywords":["string"],"energyLevel":"low|mid|high","noveltyLevel":"safe|balanced|adventurous"}',
    "",
    "제약:",
    "- targetCount는 8~24 정수",
    "- mixStrategy는 familiar, balanced, discovery 중 하나",
    "- includeKeywords는 4~12개 핵심 키워드(사용자 요청 변화 반영)",
    "- focusKeywords는 includeKeywords에서 특히 중요한 2~6개",
    "- excludeKeywords는 피하고 싶은 분위기/장르 키워드(없으면 빈 배열)",
    "- genreHints는 장르 힌트 1~8개",
    "- energyLevel은 low/mid/high 중 하나",
    "- noveltyLevel은 safe/balanced/adventurous 중 하나",
    "- 사용자 제외 조건은 반드시 최우선으로 반영",
    "- 사용자가 프롬프트를 바꿨으면, 이전과 다른 키워드/장르 방향을 명확히 반영",
    "- 키워드는 의미 중심으로 추출하고, 단순 제목 단어 매칭용 키워드는 지양",
    "- 사용자가 시간(예: 2시간 이상/45분 내외)을 명시하면 반드시 targetCount에 강하게 반영",
    "- '이상/이내/내외' 시간 표현을 해석해 목표 길이를 우선 충족",
    "- 시간 조건을 충족하기 어렵다면 targetCount를 충분히 늘려서 맞출 것",
  ].join("\n");
}

function buildLocalParsedPlan(args: {
  moodInput: string;
  timeConstraint?: TimeConstraint | null;
  bootstrap: SpotifyBootstrapData | null;
}): GeminiPlaylistJson {
  const intent = buildUserIntentProfile(args.moodInput);
  const include = Array.from(new Set(intent.include)).slice(0, 10);
  const exclude = Array.from(new Set(intent.exclude)).slice(0, 8);
  const genreHints = include.filter(k =>
    /kpop|트로트|힙합|rnb|알앤비|재즈|록|rock|edm|일렉|인디|발라드|ost|로파이|ambient|soul|metal|pop/i.test(k),
  ).slice(0, 8);
  const energy = inferEnergyFromKeywords(include);
  const specificity = intent.specificity;
  const noveltyLevel: GeminiPlaylistJson["noveltyLevel"] =
    specificity >= 7 ? "balanced" : "safe";
  const mixStrategy: GeminiPlaylistJson["mixStrategy"] =
    specificity >= 8 ? "discovery" : specificity >= 5 ? "balanced" : "familiar";
  const avgDurationMs = estimateAverageTrackDurationMs([
    args.bootstrap?.topTracks ?? [],
    args.bootstrap?.recentlyPlayed ?? [],
  ]);
  const targetCount = deriveTargetTrackCount({
    targetMinutes: args.timeConstraint?.minutes ?? null,
    timeMode: args.timeConstraint?.mode,
    averageDurationMs: avgDurationMs,
    maxCount: 60,
  });

  return {
    playlistName: buildPromptFocusedPlaylistName(args.moodInput),
    moodSummary: "로컬 프롬프트 분석 기반 큐레이션",
    reasoning: "Gemini 미사용 환경에서 로컬 의도 분석으로 추천 규칙을 구성했어요.",
    targetCount,
    mixStrategy,
    includeKeywords: include,
    focusKeywords: include.slice(0, 6),
    excludeKeywords: exclude,
    genreHints,
    energyLevel: energy,
    noveltyLevel,
  };
}

function resolveGeminiProxyAuthToken(explicitToken?: string | null): string | null {
  const direct = String(explicitToken ?? "").trim();
  if (direct) return direct;
  try {
    const token = String(useAppStore.getState()?.spotifyTokens?.accessToken ?? "").trim();
    return token || null;
  } catch {
    return null;
  }
}

async function callGemini(
  prompt: string,
  spotifyAccessToken?: string | null,
): Promise<GeminiPlaylistJson> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const bearer = resolveGeminiProxyAuthToken(spotifyAccessToken);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetch(buildGeminiProxyUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt }),
  });
  const raw = await res.text();
  let json: GeminiProxyResponse | null = null;
  if (raw) {
    try {
      json = JSON.parse(raw) as GeminiProxyResponse;
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const detail =
      json?.error?.message ??
      (raw ? raw.slice(0, 180) : "empty response body");
    const err = new Error(
      `[GeminiProxy] request failed (${res.status}): ${detail}`,
    ) as GeminiError;
    err.status = res.status;
    err.bodyText = raw || JSON.stringify(json?.error ?? {});
    throw err;
  }

  if (!json?.playlist) {
    throw new Error("[GeminiProxy] invalid response shape");
  }
  return json.playlist;
}

async function callGeminiWithTimeout(
  prompt: string,
  timeoutMs: number,
  spotifyAccessToken?: string | null,
): Promise<GeminiPlaylistJson> {
  return Promise.race([
    callGemini(prompt, spotifyAccessToken),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`[GeminiProxy] request timed out (${timeoutMs}ms)`)),
        timeoutMs,
      ),
    ),
  ]);
}

function clampUnit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeGeminiGenres(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map(v => normalizeText(String(v ?? "")))
        .map(v => v.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  ).slice(0, 6);
}

function tokenizePrompt(prompt: string): string[] {
  const stop = new Set([
    "플레이리스트",
    "추천",
    "노래",
    "음악",
    "분위기",
    "위주",
    "중심",
    "그리고",
    "자연스럽게",
    "섞어",
    "주세요",
  ]);
  return Array.from(
    new Set(
      keywordList(prompt)
        .map(v => normalizeText(v))
        .filter(v => v.length >= 2)
        .filter(v => !stop.has(v)),
    ),
  ).slice(0, 12);
}

function inferMoodFromTokens(tokens: string[]): string {
  const text = tokens.join(" ");
  if (/화창|sunny|bright|breezy/.test(text)) return "bright";
  if (/차분|calm|잔잔|relax|힐링/.test(text)) return "calm";
  if (/몽환|dream|cinematic|영화/.test(text)) return "cinematic";
  if (/신나|upbeat|party|energetic|운동/.test(text)) return "upbeat";
  return "balanced";
}

function inferContextFromTokens(tokens: string[]): string {
  const text = tokens.join(" ");
  if (/한강|river|산책|walk|outdoor/.test(text)) return "outdoor";
  if (/카페|cafe|작업|study|집중|work/.test(text)) return "focus";
  if (/드라이브|drive|night|야경/.test(text)) return "drive";
  if (/운동|gym|run|workout/.test(text)) return "workout";
  return "everyday";
}

function inferEnergyFromTokens(tokens: string[]): number {
  const text = tokens.join(" ");
  if (/신나|upbeat|energetic|운동|party|dance/.test(text)) return 0.74;
  if (/차분|calm|잔잔|relax|sleep/.test(text)) return 0.38;
  return 0.54;
}

function inferValenceFromTokens(tokens: string[]): number {
  const text = tokens.join(" ");
  if (/우울|sad|melancholy|gloom/.test(text)) return 0.36;
  if (/행복|happy|sunny|bright|기분좋/.test(text)) return 0.68;
  return 0.53;
}

function inferAcousticnessFromTokens(tokens: string[]): number {
  const text = tokens.join(" ");
  if (/acoustic|어쿠스틱|포크|folk|piano|잔잔/.test(text)) return 0.74;
  if (/edm|electronic|힙합|dance|party/.test(text)) return 0.24;
  return 0.48;
}

function inferGenresFromTokens(tokens: string[]): string[] {
  const text = tokens.join(" ");
  const out: string[] = [];
  if (/kpop|k pop|케이팝/.test(text)) out.push("k-pop");
  if (/rnb|알앤비|soul|소울/.test(text)) out.push("korean rnb");
  if (/인디|indie/.test(text)) out.push("indie");
  if (/포크|folk|acoustic/.test(text)) out.push("folk");
  if (/힙합|hip hop|rap/.test(text)) out.push("hip-hop");
  if (/영화|ost|soundtrack|cinematic/.test(text)) out.push("soundtracks");
  if (/재즈|jazz/.test(text)) out.push("jazz");
  if (/팝|pop/.test(text)) out.push("pop");
  if (!out.length) out.push("k-pop", "indie");
  return Array.from(new Set(out)).slice(0, 4);
}

function parseGeminiRecommendationProfile(raw: unknown): GeminiRecommendationProfile | null {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!obj) return null;
  const genres = normalizeGeminiGenres(obj.genres);
  if (!genres.length) return null;
  const mood = normalizeText(String(obj.mood ?? "")).slice(0, 24) || undefined;
  const activity = normalizeText(String(obj.activity ?? "")).slice(0, 24) || undefined;
  const place = normalizeText(String(obj.place ?? "")).slice(0, 24) || undefined;
  const time = normalizeText(String(obj.time ?? "")).slice(0, 24) || undefined;
  const weather = normalizeText(String(obj.weather ?? "")).slice(0, 24) || undefined;
  const durationRaw = Number(obj.durationMinutes ?? NaN);
  return {
    genres,
    source: "gemini",
    energy: clampUnit(Number(obj.energy), 0.5),
    valence: clampUnit(Number(obj.valence), 0.55),
    acousticness: clampUnit(Number(obj.acousticness), 0.45),
    mood,
    activity,
    place,
    time,
    weather,
    durationMinutes:
      Number.isFinite(durationRaw) && durationRaw > 0 ? clamp(durationRaw, 10, 180) : undefined,
  };
}

async function callGeminiProxyForParams(
  prompt: string,
  timeoutMs: number,
): Promise<GeminiRecommendationProfile | null> {
  const startedAt = Date.now();
  try {
    console.warn(`[Gemini] proxy request start timeout=${timeoutMs}ms`);
    const json = await callGeminiWithTimeout(prompt, timeoutMs);
    return parseGeminiRecommendationProfile(json as unknown);
  } finally {
    console.warn(`[Gemini] proxy request done elapsed=${Date.now() - startedAt}ms`);
  }
}

function buildGeminiRecommendationProfilePrompt(prompt: string): string {
  const cleaned = String(prompt ?? "").replace(/\s+/g, " ").trim();
  return [
    "사용자 입력을 Spotify 음악 추천 파라미터로 변환하라.",
    `사용자 요청: ${cleaned}`,
    "",
    "출력은 반드시 JSON 형식만 사용:",
    '{"mood":"bright","activity":"walk","place":"outdoor","time":"day","weather":"sunny","genres":["k-pop","r-n-b","indie"],"energy":0.5,"valence":0.6,"acousticness":0.4,"durationMinutes":60}',
    "",
    "규칙:",
    "- mood/activity/place/time/weather는 짧은 영문 토큰으로 반환",
    "- 실제 음악 추천에 사용할 수 있는 값만 반환",
    "- genres는 Spotify에서 사용 가능한 장르값만 사용",
    "- genres: 1~4개",
    "- energy/valence/acousticness는 0~1 숫자, durationMinutes는 10~180 정수",
    "- 설명/마크다운/추가 텍스트 금지",
  ].join("\n");
}

function inferSemanticFromPromptRule(prompt: string): {
  mood?: string;
  activity?: string;
  place?: string;
  time?: string;
  weather?: string;
  durationMinutes?: number;
} {
  const text = normalizeText(prompt);
  const mood =
    /산뜻|화창|bright|breezy|sunny/.test(text)
      ? "bright"
      : /차분|잔잔|calm|soft/.test(text)
      ? "calm"
      : /우울|sad|moody|dark/.test(text)
      ? "moody"
      : /신나|upbeat|energetic|party/.test(text)
      ? "upbeat"
      : undefined;
  const activity =
    /작업|업무|work|study|집중/.test(text)
      ? "work"
      : /산책|walk|러닝|run/.test(text)
      ? "walk"
      : /운동|workout|gym/.test(text)
      ? "workout"
      : /드라이브|drive/.test(text)
      ? "drive"
      : undefined;
  const place =
    /카페|cafe/.test(text)
      ? "cafe"
      : /한강|공원|야외|outdoor/.test(text)
      ? "outdoor"
      : /집|home/.test(text)
      ? "home"
      : undefined;
  const time =
    /아침|morning/.test(text)
      ? "morning"
      : /점심|낮|day/.test(text)
      ? "day"
      : /저녁|밤|night/.test(text)
      ? "night"
      : /새벽|dawn/.test(text)
      ? "dawn"
      : undefined;
  const weather =
    /맑|화창|sunny/.test(text)
      ? "sunny"
      : /비|rain/.test(text)
      ? "rainy"
      : /눈|snow/.test(text)
      ? "snowy"
      : /흐림|cloud/.test(text)
      ? "cloudy"
      : undefined;
  const plan = extractPromptSearchPlan(prompt);
  const durationMinutes = plan.timeConstraint?.minutes
    ? clamp(plan.timeConstraint.minutes, 10, 180)
    : undefined;
  return { mood, activity, place, time, weather, durationMinutes };
}

function mergeGeminiWithRuleProfile(
  gemini: GeminiRecommendationProfile,
  prompt: string,
): GeminiRecommendationProfile {
  const rule = inferSemanticFromPromptRule(prompt);
  return {
    ...gemini,
    ...Object.fromEntries(
      Object.entries(rule).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    ),
  };
}

function buildLocalRecommendationProfile(prompt: string): GeminiRecommendationProfile {
  const tokens = tokenizePrompt(prompt);
  const variation = (stableHash(normalizeText(prompt)) % 17) / 100;
  const signed = stableHash(`${prompt}|sign`) % 2 === 0 ? 1 : -1;
  const nudge = signed * variation;
  const genres = inferGenresFromTokens(tokens);
  return {
    genres,
    source: "fallback",
    energy: clampUnit(inferEnergyFromTokens(tokens) + nudge * 0.35, 0.52),
    valence: clampUnit(inferValenceFromTokens(tokens) + nudge * 0.28, 0.53),
    acousticness: clampUnit(inferAcousticnessFromTokens(tokens) - nudge * 0.3, 0.48),
    ...inferSemanticFromPromptRule(prompt),
  };
}

function withAnalysisSource(
  profile: GeminiRecommendationProfile,
  source: GeminiRecommendationProfile["source"],
): GeminiRecommendationProfile {
  return { ...profile, source };
}

async function getGeminiRecommendationProfile(
  prompt: string,
  options?: {
    requestId?: string;
    allowInflightReuse?: boolean;
    abortSignal?: AbortSignal;
  },
): Promise<GeminiRecommendationProfile> {
  const fallback = buildLocalRecommendationProfile(prompt);
  const key = normalizeText(prompt);
  const requestId = String(options?.requestId ?? "").trim();
  const allowInflightReuse =
    typeof options?.allowInflightReuse === "boolean"
      ? options.allowInflightReuse
      : true;
  const inFlightKey = allowInflightReuse
    ? key
    : `${key}::${requestId || buildRequestSeed()}`;
  assertNotCancelled(requestId, options?.abortSignal, "analyze_before_cache");
  const now = Date.now();
  const cached = geminiParamCache.get(key);
  if (cached && now - cached.cachedAt <= GEMINI_PARAM_CACHE_TTL_MS) {
    console.warn(`[Gemini] analyzePrompt cache hit key=${stableHash(key).toString(16).slice(0, 8)}`);
    setGeminiAnalysisStatus("cache_hit");
    return cached.profile;
  }
  const sharedInFlight = geminiParamInFlight.get(key);
  if (sharedInFlight) {
    if (!allowInflightReuse) {
      console.warn(
        `[Gemini] analyzePrompt in-flight reuse blocked by requestId key=${stableHash(key).toString(16).slice(0, 8)} requestId=${requestId || "-"}`,
      );
    } else {
      console.warn(`[Gemini] analyzePrompt in-flight reuse key=${stableHash(key).toString(16).slice(0, 8)}`);
      setGeminiAnalysisStatus("inflight_reuse");
      return sharedInFlight;
    }
  }
  if (now < geminiQuotaCooldownUntil) {
    const quotaCached = geminiParamCache.get(key);
    if (quotaCached && now - quotaCached.cachedAt <= GEMINI_PARAM_FALLBACK_CACHE_TTL_MS) {
      console.warn(`[Gemini] analyzePrompt quota-cooldown cache hit key=${stableHash(key).toString(16).slice(0, 8)}`);
      setGeminiAnalysisStatus("cooldown_cache_hit");
      return quotaCached.profile;
    }
    if (geminiLastSuccessfulProfile) {
      console.warn(`[Gemini] analyzePrompt quota cooldown active; reusing last-success profile key=${stableHash(key).toString(16).slice(0, 8)}`);
      const reused = withAnalysisSource(geminiLastSuccessfulProfile, "reuse");
      geminiParamCache.set(key, { profile: reused, cachedAt: now });
      setGeminiAnalysisStatus("quota_reuse_last_success");
      return reused;
    }
    console.warn(`[Gemini] analyzePrompt quota cooldown active; using local fallback key=${stableHash(key).toString(16).slice(0, 8)}`);
    setGeminiAnalysisStatus("quota_fallback_local");
    return fallback;
  }
  console.warn(`[Gemini] analyzePrompt cache miss key=${stableHash(key).toString(16).slice(0, 8)}`);
  const request = (async (): Promise<GeminiRecommendationProfile> => {
    assertNotCancelled(requestId, options?.abortSignal, "analyze_before_request");
    const promptPayload = buildGeminiRecommendationProfilePrompt(prompt);
    try {
      console.warn("[Gemini] analyzePrompt request start try=1 timeout=15000ms proxy");
      const parsed = await callGeminiProxyForParams(promptPayload, 15_000);
      assertNotCancelled(requestId, options?.abortSignal, "analyze_after_request");
      if (parsed) {
        const merged = mergeGeminiWithRuleProfile(parsed, prompt);
        geminiLastSuccessfulProfile = merged;
        geminiParamCache.set(key, { profile: merged, cachedAt: Date.now() });
        console.warn(`[Gemini] analyzePrompt success try=1 genres=${merged.genres.join("|") || "-"} energy=${merged.energy.toFixed(2)} valence=${merged.valence.toFixed(2)} acousticness=${merged.acousticness.toFixed(2)} mood=${merged.mood ?? "-"} activity=${merged.activity ?? "-"} place=${merged.place ?? "-"}`);
        setGeminiAnalysisStatus("gemini_success_try1");
        return merged;
      }
      if (geminiLastSuccessfulProfile) {
        console.warn("[Gemini] analyzePrompt invalid shape on try=1; reusing last-success profile");
        const reused = withAnalysisSource(geminiLastSuccessfulProfile, "reuse");
        geminiParamCache.set(key, { profile: reused, cachedAt: Date.now() });
        setGeminiAnalysisStatus("invalid_shape_reuse");
        return reused;
      }
      console.warn("[Gemini] analyzePrompt invalid shape on try=1; using dynamic fallback");
      setGeminiAnalysisStatus("invalid_shape_fallback");
      return fallback;
    } catch (err) {
      const status = Number((err as GeminiError)?.status ?? 0);
      const msg = String((err as Error)?.message ?? err ?? "");
      const isQuota = status === 429 || /quota|429|resource exhausted|too many requests/i.test(msg);
      if (isQuota) {
        geminiQuotaCooldownUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
        if (geminiLastSuccessfulProfile) {
          console.warn(`[Gemini] analyzePrompt quota exceeded; cooldown=${GEMINI_QUOTA_COOLDOWN_MS}ms, reusing last-success profile`);
          const reused = withAnalysisSource(geminiLastSuccessfulProfile, "reuse");
          geminiParamCache.set(key, { profile: reused, cachedAt: Date.now() });
          setGeminiAnalysisStatus("quota_reuse_last_success");
          return reused;
        }
        console.warn(`[Gemini] analyzePrompt quota exceeded; cooldown=${GEMINI_QUOTA_COOLDOWN_MS}ms, using local fallback`);
        setGeminiAnalysisStatus("quota_fallback_local");
        return fallback;
      }
      // Retry once only for non-quota transient errors.
      console.warn("[Gemini] analyzePrompt retry try=2 timeout=15000ms proxy");
      try {
        const parsedRetry = await callGeminiProxyForParams(promptPayload, 15_000);
        assertNotCancelled(requestId, options?.abortSignal, "analyze_after_retry");
        if (parsedRetry) {
          const mergedRetry = mergeGeminiWithRuleProfile(parsedRetry, prompt);
          geminiLastSuccessfulProfile = mergedRetry;
          geminiParamCache.set(key, { profile: mergedRetry, cachedAt: Date.now() });
          console.warn(`[Gemini] analyzePrompt success try=2 genres=${mergedRetry.genres.join("|") || "-"} energy=${mergedRetry.energy.toFixed(2)} valence=${mergedRetry.valence.toFixed(2)} acousticness=${mergedRetry.acousticness.toFixed(2)} mood=${mergedRetry.mood ?? "-"} activity=${mergedRetry.activity ?? "-"} place=${mergedRetry.place ?? "-"}`);
          setGeminiAnalysisStatus("gemini_success_try2");
          return mergedRetry;
        }
      } catch (retryErr) {
        const retryStatus = Number((retryErr as GeminiError)?.status ?? 0);
        const retryMsg = String((retryErr as Error)?.message ?? retryErr ?? "");
        if (
          retryStatus === 429 ||
          /quota|429|resource exhausted|too many requests/i.test(retryMsg)
        ) {
          geminiQuotaCooldownUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
          console.warn(`[Gemini] analyzePrompt quota exceeded on retry; cooldown=${GEMINI_QUOTA_COOLDOWN_MS}ms`);
        } else {
          console.warn(`[Gemini] analyzePrompt retry failed: ${safeErrorMessage(retryErr)}`);
        }
      }
      if (geminiLastSuccessfulProfile) {
        console.warn(`[Gemini] analyzePrompt failed; reusing last-success profile: ${safeErrorMessage(err)}`);
        const reused = withAnalysisSource(geminiLastSuccessfulProfile, "reuse");
        geminiParamCache.set(key, { profile: reused, cachedAt: Date.now() });
        setGeminiAnalysisStatus("error_reuse_last_success");
        return reused;
      }
      console.warn(`[Gemini] parameter profile fallback(local): ${safeErrorMessage(err)}`);
      setGeminiAnalysisStatus("error_fallback_local");
      return fallback;
    }
  })();
  geminiParamInFlight.set(inFlightKey, request);
  try {
    return await request;
  } finally {
    geminiParamInFlight.delete(inFlightKey);
  }
}

async function analyzePrompt(
  prompt: string,
  options?: {
    requestId?: string;
    allowInflightReuse?: boolean;
    abortSignal?: AbortSignal;
  },
): Promise<GeminiRecommendationProfile> {
  return getGeminiRecommendationProfile(prompt, options);
}

function normalizeSpotifySeedGenre(raw: string): string {
  const v = normalizeText(raw);
  if (!v) return "";
  if (v.includes("k pop") || v.includes("케이팝")) return "k-pop";
  if (v.includes("korean rnb") || v === "rnb" || v.includes("알앤비")) return "r-n-b";
  if (v.includes("indie")) return "indie";
  if (v.includes("folk") || v.includes("포크")) return "folk";
  if (v.includes("lofi")) return "lo-fi";
  if (v.includes("hip hop") || v.includes("힙합")) return "hip-hop";
  if (v.includes("city pop")) return "j-pop";
  if (v.includes("cinematic") || v.includes("soundtrack") || v.includes("ost")) return "soundtracks";
  if (v.includes("soul") || v.includes("소울")) return "soul";
  if (v.includes("pop")) return "pop";
  if (v.includes("jazz") || v.includes("재즈")) return "jazz";
  return v.replace(/\s+/g, "-");
}

export function mapGeminiProfileToSpotifyParams(
  profile: GeminiRecommendationProfile,
): SpotifyRecommendationParams {
  const seedGenres = Array.from(
    new Set((profile.genres ?? []).map(normalizeSpotifySeedGenre).filter(Boolean)),
  ).slice(0, 2);
  const activity = normalizeText(String(profile.activity ?? "").trim()) || "commute";
  const moodBase = normalizeText(String(profile.mood ?? "").trim()) || "calm";
  const mood =
    moodBase === "calm"
      ? "calm night focus"
      : moodBase === "bright"
      ? "bright uplifting day"
      : moodBase === "upbeat"
      ? "upbeat energetic drive"
      : `${moodBase} textured vibe`;
  return {
    seedGenres,
    targetEnergy: clampUnit(profile.energy, 0.5),
    targetValence: clampUnit(profile.valence, 0.55),
    targetAcousticness: clampUnit(profile.acousticness, 0.45),
    mood,
    activity,
    place: profile.place,
    time: profile.time,
    weather: profile.weather,
    durationMinutes: profile.durationMinutes,
  };
}

function buildRequestSeed(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  playlistRequestNonce = (playlistRequestNonce + 1) % 10000;
  const nonce = String(playlistRequestNonce).padStart(4, "0");
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `${yyyy}-${mm}-${dd}-${hh}-${mi}-${nonce}-${rand}`;
}

function seededShuffleValues<T>(values: T[], seed: number, keyOf: (v: T) => string): T[] {
  return [...values].sort((a, b) => seededUnit(seed, keyOf(a)) - seededUnit(seed, keyOf(b)));
}

function buildHistoryTrackIdSet(maxItems = 240): Set<string> {
  return new Set(
    recommendationHistory
      .flatMap(item => item.trackIds)
      .map(v => String(v ?? "").trim())
      .filter(Boolean)
      .slice(0, maxItems),
  );
}

function extractDuration(prompt: string): { minutes: number; min: boolean } | null {
  const plan = extractPromptSearchPlan(prompt);
  if (plan.timeConstraint?.minutes) {
    return {
      minutes: clamp(plan.timeConstraint.minutes, 10, 300),
      min: plan.timeConstraint.mode === "at_least",
    };
  }
  const text = normalizeText(prompt);
  if (/2\s*시간|두\s*시간/.test(text)) return { minutes: 120, min: true };
  if (/3\s*시간|세\s*시간/.test(text)) return { minutes: 180, min: true };
  return null;
}

function buildPlaylistByDuration(args: {
  tracks: SpotifyTrackSummary[];
  targetMinutes: number;
  isMinimum: boolean;
  seed: number;
  maxPerArtist: number;
}): SpotifyTrackSummary[] {
  const targetMinutes = Math.max(
    10,
    args.targetMinutes === 120 && args.isMinimum ? 150 : args.targetMinutes,
  );
  const hardCapMinutes = targetMinutes + 30;
  const shuffled = seededShuffleTracks(args.tracks, args.seed + 991);
  const out: SpotifyTrackSummary[] = [];
  const artistCounts = new Map<string, number>();
  let total = 0;

  for (const track of shuffled) {
    const artistKeys = trackArtistKeys(track).filter(Boolean);
    const overCap = artistKeys.some(k => (artistCounts.get(k) ?? 0) >= args.maxPerArtist);
    if (overCap) continue;
    const minutes = Number(track.duration_ms ?? 0) > 0 ? Number(track.duration_ms) / 60000 : 3.5;
    out.push(track);
    artistKeys.forEach(k => artistCounts.set(k, (artistCounts.get(k) ?? 0) + 1));
    total += minutes;
    if (total >= hardCapMinutes) break;
  }
  return out;
}

function packTracksToDurationWindow(args: {
  selected: SpotifyTrackSummary[];
  pool: SpotifyTrackSummary[];
  targetMs: number;
  minMs: number;
  maxMs: number;
}): SpotifyTrackSummary[] {
  if (!args.targetMs || !args.selected.length) return args.selected;
  const dedupPool = mergeUniqueTracks(args.selected, args.pool);
  const used = new Set<string>();
  const pick: SpotifyTrackSummary[] = [];
  let currentMs = 0;
  for (const track of dedupPool) {
    const key = trackDedupKey(track);
    if (!key || used.has(key)) continue;
    const dur = Number(track.duration_ms ?? 0) || 210000;
    if (currentMs + dur > args.maxMs && currentMs >= args.minMs) continue;
    pick.push(track);
    used.add(key);
    currentMs += dur;
    if (currentMs >= args.minMs && currentMs <= args.maxMs) break;
  }
  if (!pick.length) return args.selected;
  let best = pick;
  let bestDiff = Math.abs(sumDurationMs(best) - args.targetMs);
  const remaining = dedupPool.filter(t => !used.has(String(trackDedupKey(t) ?? "")));
  for (let i = 0; i < best.length; i += 1) {
    const without = best.filter((_, idx) => idx !== i);
    const withoutMs = sumDurationMs(without);
    for (const cand of remaining.slice(0, 24)) {
      const candidate = [...without, cand];
      const ms = sumDurationMs(candidate);
      if (ms < args.minMs || ms > args.maxMs) continue;
      const diff = Math.abs(ms - args.targetMs);
      if (diff < bestDiff) {
        best = candidate;
        bestDiff = diff;
      }
    }
  }
  return best;
}

function dedupeWithDiversity(args: {
  tracks: SpotifyTrackSummary[];
  userHistory: Set<string>;
  maxPerArtist: number;
  limit: number;
  state?: {
    usedTrackIds: Set<string>;
    artistCounts: Map<string, number>;
  };
}): SpotifyTrackSummary[] {
  const usedTrackIds = args.state?.usedTrackIds ?? new Set<string>();
  const artistCounts = args.state?.artistCounts ?? new Map<string, number>();
  const out: SpotifyTrackSummary[] = [];
  for (const track of args.tracks) {
    if (out.length >= args.limit) break;
    const id = String(track?.id ?? "").trim();
    if (!id || usedTrackIds.has(id) || args.userHistory.has(id)) continue;
    const artistKeys = trackArtistKeys(track).filter(Boolean);
    const overCap = artistKeys.some(k => (artistCounts.get(k) ?? 0) >= args.maxPerArtist);
    if (overCap) continue;
    usedTrackIds.add(id);
    artistKeys.forEach(k => artistCounts.set(k, (artistCounts.get(k) ?? 0) + 1));
    out.push(track);
  }
  return out;
}

function extractPromptKeywords(prompt: string): {
  mood: string;
  activity: string;
  context: string;
  tokens: string[];
} {
  const plan = extractPromptSearchPlan(prompt);
  const mood = normalizeText(plan.mood || "mood");
  const activity = normalizeText(plan.activity || "daily");
  const context = normalizeText(plan.sound || "context");
  const tokens = Array.from(
    new Set([
      ...keywordList(prompt).map(v => normalizeText(v)).filter(v => v.length >= 2),
      ...plan.include.map(v => normalizeText(v)).filter(v => v.length >= 2),
    ]),
  ).slice(0, 10);
  return { mood, activity, context, tokens };
}

function normalizeGenreSearchLabel(raw: string): string {
  const v = normalizeText(raw);
  if (!v) return "";
  if (v.includes("k pop") || v.includes("k-pop") || v.includes("kpop")) return "k-pop";
  if (
    v.includes("r n b") ||
    v.includes("r&b") ||
    v.includes("rnb") ||
    v.includes("알앤비")
  ) {
    return "r&b";
  }
  if (v.includes("hip hop") || v.includes("hip-hop") || v.includes("힙합")) return "hip-hop";
  if (v.includes("indie")) return "indie";
  if (v.includes("soul") || v.includes("소울")) return "soul";
  if (v.includes("ballad") || v.includes("발라드")) return "ballad";
  return v.replace(/\s+/g, "-");
}

function buildContextSearchTokens(args: {
  mood: string;
  activity: string;
  place: string;
  targetEnergy: number;
  targetValence: number;
}): string[] {
  const moodWords =
    args.targetValence >= 0.62
      ? ["bright", "happy"]
      : args.targetValence <= 0.42
      ? ["moody", "calm"]
      : ["cozy", "balanced"];
  const energyWords =
    args.targetEnergy >= 0.62
      ? ["upbeat", "drive"]
      : args.targetEnergy <= 0.42
      ? ["chill", "soft"]
      : ["steady", "daily"];
  const activity = normalizeText(args.activity);
  const place = normalizeText(args.place);
  const out = new Set<string>([...moodWords, ...energyWords]);
  if (activity && !["daily", "none", "-"].includes(activity)) out.add(activity);
  if (place && !["context", "none", "-"].includes(place)) out.add(place);
  return Array.from(out).slice(0, 6);
}

function compactSearchWords(parts: Array<string | undefined>, maxWords = 4): string[] {
  const out: string[] = [];
  for (const raw of parts) {
    const n = normalizeText(String(raw ?? ""));
    if (!n) continue;
    const token = n.split(" ").slice(0, 2).join(" ");
    if (!token || out.includes(token)) continue;
    out.push(token);
    if (out.length >= maxWords) break;
  }
  return out;
}

function normalizeTextureToken(value: string): string {
  const t = normalizeText(value);
  if (!t) return "textured";
  if (/(calm|soft|chill|ambient|acoustic)/.test(t)) return "soft";
  if (/(upbeat|drive|energetic|party)/.test(t)) return "dynamic";
  if (/(focus|study|work)/.test(t)) return "focused";
  return t.split(" ").slice(0, 2).join(" ");
}

function buildStructuredQuery(args: {
  genre: string;
  mood: string;
  activity: string;
  texture: string;
  locale?: string;
}): string {
  const locale = normalizeText(args.locale || "korean");
  const words = compactSearchWords(
    [locale, args.genre, args.mood, args.activity, args.texture],
    4,
  );
  return sanitizeFastSearchToken(words.join(" "));
}

function forceFallbackQueries(args: {
  params: SpotifyRecommendationParams;
  prompt: string;
}): string[] {
  const plan = extractPromptSearchPlan(args.prompt);
  const genre = normalizeGenreSearchLabel(args.params.seedGenres?.[0] || "k-pop");
  const mood = normalizeText(args.params.mood || plan.mood || "calm");
  const activity = normalizeText(args.params.activity || plan.activity || "commute");
  const texture = normalizeTextureToken(args.params.place || plan.sound || "soft");
  const raw = [
    [genre, mood, activity],
    [genre, activity, texture],
    ["korean", genre, activity],
    [genre, "night", mood],
    [genre, "focus", texture],
  ];
  return raw
    .map(tokens => sanitizeFastSearchToken(compactSearchWords(tokens, 4).join(" ")))
    .filter(Boolean)
    .slice(0, 5);
}

function generateQueries(params: SpotifyRecommendationParams, prompt: string): string[] {
  const k = extractPromptKeywords(prompt);
  const moodToken = normalizeText(params.mood || k.mood || "calm focus");
  const activityToken = normalizeText(params.activity || k.activity || "commute");
  const textureToken = normalizeTextureToken(params.place || k.context || "textured");
  const genres = (params.seedGenres ?? [])
    .map(v => normalizeGenreSearchLabel(v))
    .filter(Boolean);
  const base = genres.length ? genres : ["k-pop", "indie"];
  const g0 = base[0] || "k-pop";
  const g1 = base[1] || g0;
  const candidates = [
    buildStructuredQuery({
      genre: g0,
      mood: moodToken,
      activity: activityToken,
      texture: textureToken,
      locale: "korean",
    }),
    buildStructuredQuery({
      genre: g1,
      mood: moodToken,
      activity: activityToken,
      texture: textureToken,
      locale: "korean",
    }),
    buildStructuredQuery({
      genre: g0,
      mood: moodToken,
      activity: "night",
      texture: textureToken,
      locale: "korean",
    }),
    buildStructuredQuery({
      genre: g1,
      mood: moodToken,
      activity: "commute",
      texture: textureToken,
      locale: "korean",
    }),
    ...k.tokens.slice(0, 2).map(t =>
      buildStructuredQuery({
        genre: g0,
        mood: t,
        activity: activityToken,
        texture: textureToken,
        locale: "korean",
      }),
    ),
  ];
  const queries = Array.from(new Set(candidates.map(v => sanitizeFastSearchToken(v)).filter(Boolean))).slice(0, 8);
  if (queries.length) return queries;
  return forceFallbackQueries({ params, prompt });
}

function generateExplorationQueries(params: SpotifyRecommendationParams, prompt: string): string[] {
  const k = extractPromptKeywords(prompt);
  const moodToken = normalizeText(params.mood || k.mood || "calm focus");
  const activityToken = normalizeText(params.activity || k.activity || "commute");
  const textureToken = normalizeTextureToken(params.place || k.context || "textured");
  const genres = (params.seedGenres ?? [])
    .map(v => normalizeGenreSearchLabel(v))
    .filter(Boolean);
  const g0 = genres[0] || "k-pop";
  const g1 = genres[1] || "indie";
  const candidates = [
    buildStructuredQuery({
      genre: g0,
      mood: moodToken,
      activity: activityToken,
      texture: textureToken,
      locale: "korean",
    }),
    buildStructuredQuery({
      genre: g1,
      mood: moodToken,
      activity: activityToken,
      texture: textureToken,
      locale: "korean",
    }),
    buildStructuredQuery({
      genre: g0,
      mood: moodToken,
      activity: "walking",
      texture: textureToken,
      locale: "korean",
    }),
    buildStructuredQuery({
      genre: g1,
      mood: moodToken,
      activity: "late night",
      texture: textureToken,
      locale: "korean",
    }),
  ];
  const queries = Array.from(new Set(candidates.map(v => sanitizeFastSearchToken(v)).filter(Boolean))).slice(0, 10);
  if (queries.length) return queries;
  return forceFallbackQueries({ params, prompt });
}

function buildRelatedArtistQueries(args: {
  topArtists: SpotifyArtistSummary[];
  favoriteGenres: string[];
}): string[] {
  const artistNames = args.topArtists
    .map(a => String(a?.name ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);
  const genreQueries = args.favoriteGenres.slice(0, 3).map(g => `${g} artists`);
  const queries = [
    ...artistNames.map(name => `${name} similar artists`),
    ...artistNames.map(name => `${name} vibes`),
    ...genreQueries,
    "korean indie artists",
    "korean hip hop underground",
    "new korean rnb artists",
  ];
  return Array.from(new Set(queries.map(v => sanitizeFastSearchToken(v)).filter(Boolean))).slice(0, 10);
}

function buildTopTrackExpansionQueries(topTracks: SpotifyTrackSummary[]): string[] {
  const queries = topTracks.slice(0, 6).flatMap(track => {
    const artistName = String(track?.artists?.[0]?.name ?? "").trim();
    const trackName = String(track?.name ?? "").trim();
    if (!artistName) return [] as string[];
    return [
      artistName,
      trackName ? `${artistName} ${trackName}`.slice(0, 48) : "",
    ].filter(Boolean) as string[];
  });
  return Array.from(
    new Set(
      queries
        .map(v => String(v ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function buildTopArtistExpansionQueries(topArtists: SpotifyArtistSummary[]): string[] {
  const queries = topArtists.slice(0, 6).flatMap(artist => {
    const name = String(artist?.name ?? "").trim();
    if (!name) return [] as string[];
    return [
      name,
      `${name} playlist`,
    ];
  });
  return Array.from(
    new Set(
      queries
        .map(v => String(v ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  ).slice(0, 10);
}

function buildArtistDirectQueries(
  bootstrap: SpotifyBootstrapData | null,
  fastIntent: FastIntent,
): string[] {
  if (!bootstrap?.topArtists?.length) return [];
  const energyMod =
    fastIntent.energy === "high" ? "upbeat" : fastIntent.energy === "low" ? "chill" : "";
  const topArtists = bootstrap.topArtists
    .slice(0, 6)
    .map(artist => String(artist?.name ?? "").trim())
    .filter(Boolean);
  const artistQueries = topArtists.flatMap(name => {
    const out = [name];
    if (energyMod) out.push(`${name} ${energyMod}`);
    return out;
  });
  const genreQueries = Array.from(
    new Set(
      bootstrap.topArtists
        .slice(0, 6)
        .flatMap(artist => artist?.genres ?? [])
        .map(genre => String(genre ?? "").trim())
        .filter(genre => genre.length >= 3 && genre.length <= 20),
    ),
  ).slice(0, 4);
  return Array.from(
    new Set(
      [...artistQueries, ...genreQueries]
        .map(query => sanitizeFastSearchToken(query))
        .filter((query): query is string => Boolean(query)),
    ),
  ).slice(0, 8);
}

function buildPersonalizationQueries(args: {
  topTracks: SpotifyTrackSummary[];
  topArtists: SpotifyArtistSummary[];
  params: SpotifyRecommendationParams;
  prompt: string;
}): string[] {
  const energyMod =
    args.params.targetEnergy >= 0.62 ? "upbeat" : args.params.targetEnergy <= 0.42 ? "chill" : "";
  const artistQueries = args.topArtists
    .slice(0, 6)
    .map(artist => String(artist?.name ?? "").trim())
    .filter(Boolean)
    .flatMap(name => {
      const out = [name];
      if (energyMod) out.push(`${name} ${energyMod}`);
      return out;
    });
  const artistGenreQueries = Array.from(
    new Set(
      args.topArtists
        .slice(0, 6)
        .flatMap(artist => artist?.genres ?? [])
        .map(genre => String(genre ?? "").trim())
        .filter(genre => genre.length >= 3 && genre.length <= 20),
    ),
  );
  const fallbackGenre = normalizeGenreSearchLabel(args.params.seedGenres?.[0] || "k-pop");
  const merged = Array.from(
    new Set(
      [...artistQueries, ...artistGenreQueries, fallbackGenre]
        .map(query => sanitizeFastSearchToken(query))
        .filter((query): query is string => Boolean(query)),
    ),
  ).slice(0, 8);
  return merged.length ? merged : forceFallbackQueries({ params: args.params, prompt: args.prompt });
}

function filterExpansionSeedTracks(args: {
  topTracks: SpotifyTrackSummary[];
  params: SpotifyRecommendationParams;
  prompt: string;
  requestId?: string;
}): SpotifyTrackSummary[] {
  const requestId = String(args.requestId ?? "").trim();
  const chosen = args.topTracks.slice(0, 5);
  console.warn(
    `[Playlist] expansion seed accepted requestId=${requestId || "-"} tracks=${chosen.length} (unconditional)`,
  );
  return chosen;
}

function filterExpansionSeedArtists(args: {
  topArtists: SpotifyArtistSummary[];
  params: SpotifyRecommendationParams;
  prompt: string;
  requestId?: string;
}): SpotifyArtistSummary[] {
  const requestId = String(args.requestId ?? "").trim();
  const chosen = args.topArtists.slice(0, 5);
  console.warn(
    `[Playlist] expansion seed accepted requestId=${requestId || "-"} artists=${chosen.length} (unconditional)`,
  );
  return chosen;
}

function trackPopularity(track: SpotifyTrackSummary): number {
  const raw = Number((track as any)?.popularity ?? NaN);
  if (!Number.isFinite(raw)) return 55;
  return clamp(raw, 0, 100);
}

function deprioritizePopular(tracks: SpotifyTrackSummary[]): SpotifyTrackSummary[] {
  return [...tracks].sort((a, b) => trackPopularity(a) - trackPopularity(b));
}

function similarity(a: number, b: number): number {
  return Math.max(0, 1 - Math.abs(a - b));
}

function attachAudioFeatures(
  tracks: SpotifyTrackSummary[],
  featuresMap: Record<string, SpotifyAudioFeaturesSummary>,
): Array<SpotifyTrackSummary & { audio?: SpotifyAudioFeaturesSummary }> {
  return tracks.map(track => {
    const id = String(track?.id ?? "").trim();
    const audio = id ? featuresMap[id] : undefined;
    if (!audio) return track;
    return { ...track, audio };
  });
}

function estimateTrackEnergy(track: SpotifyTrackSummary): number {
  const direct = Number((track as any)?.audio?.energy ?? NaN);
  if (Number.isFinite(direct)) return clampUnit(direct, 0.5);
  const tempo = Number(track.tempo ?? NaN);
  if (Number.isFinite(tempo)) return clampUnit((tempo - 70) / 90, 0.5);
  const text = normalizeText(
    [track.name, ...(track.genres ?? []), ...(track.artists ?? []).map(a => a.name)].join(" "),
  );
  if (/upbeat|dance|party|energetic|edm|hip hop/.test(text)) return 0.72;
  if (/chill|soft|calm|ballad|acoustic|lofi/.test(text)) return 0.38;
  return 0.53;
}

function estimateTrackValence(track: SpotifyTrackSummary): number {
  const direct = Number((track as any)?.audio?.valence ?? NaN);
  if (Number.isFinite(direct)) return clampUnit(direct, 0.55);
  const text = normalizeText(
    [track.name, ...(track.genres ?? []), ...(track.artists ?? []).map(a => a.name)].join(" "),
  );
  if (/happy|sunny|bright|feel good|cheer/.test(text)) return 0.72;
  if (/sad|blue|melancholy|dark|moody/.test(text)) return 0.34;
  return 0.54;
}

function estimateTrackDanceability(track: SpotifyTrackSummary): number {
  const direct = Number((track as any)?.audio?.danceability ?? NaN);
  if (Number.isFinite(direct)) return clampUnit(direct, 0.5);
  const tempo = Number((track as any)?.audio?.tempo ?? track.tempo ?? NaN);
  if (Number.isFinite(tempo) && tempo > 0) {
    if (tempo >= 110 && tempo <= 132) return 0.68;
    if (tempo < 90) return 0.42;
    return 0.56;
  }
  const text = normalizeText([track.name, ...(track.genres ?? [])].join(" "));
  if (/dance|club|edm|house|hip hop/.test(text)) return 0.7;
  if (/acoustic|ballad|ambient|piano/.test(text)) return 0.4;
  return 0.55;
}

function estimateTrackAcousticness(track: SpotifyTrackSummary): number {
  const direct = Number((track as any)?.audio?.acousticness ?? NaN);
  if (Number.isFinite(direct)) return clampUnit(direct, 0.45);
  const text = normalizeText([track.name, ...(track.genres ?? [])].join(" "));
  if (/acoustic|folk|piano|indie folk/.test(text)) return 0.72;
  if (/edm|electronic|dance|hip hop/.test(text)) return 0.24;
  return 0.46;
}

function buildUserProfile(
  topTracks: Array<SpotifyTrackSummary & { audio?: SpotifyAudioFeaturesSummary }>,
  topArtists: SpotifyArtistSummary[],
): {
  topArtistIds: Set<string>;
  favoriteArtistIds: Set<string>;
  topTrackIds: Set<string>;
  topGenreTokens: Set<string>;
  favoriteGenres: string[];
  avgEnergy: number;
  avgValence: number;
  avgDanceability: number;
  avgAcousticness: number;
} {
  const topArtistIds = new Set(
    topArtists.map(a => String(a?.id ?? "").trim()).filter(Boolean),
  );
  const topTrackIds = new Set(
    topTracks.map(t => String(t?.id ?? "").trim()).filter(Boolean),
  );
  const topGenreTokens = new Set<string>();
  topArtists.forEach(a => (a.genres ?? []).forEach(g => topGenreTokens.add(normalizeText(g))));
  topTracks.forEach(t => (t.genres ?? []).forEach(g => topGenreTokens.add(normalizeText(g))));
  const trackCount = Math.max(1, topTracks.length);
  const avgEnergy = topTracks.reduce((acc, t) => acc + estimateTrackEnergy(t), 0) / trackCount;
  const avgValence = topTracks.reduce((acc, t) => acc + estimateTrackValence(t), 0) / trackCount;
  const avgDanceability =
    topTracks.reduce((acc, t) => acc + estimateTrackDanceability(t), 0) / trackCount;
  const avgAcousticness =
    topTracks.reduce((acc, t) => acc + estimateTrackAcousticness(t), 0) / trackCount;
  return {
    topArtistIds,
    favoriteArtistIds: topArtistIds,
    topTrackIds,
    topGenreTokens,
    favoriteGenres: Array.from(topGenreTokens).slice(0, 8),
    avgEnergy: clampUnit(avgEnergy, 0.52),
    avgValence: clampUnit(avgValence, 0.55),
    avgDanceability: clampUnit(avgDanceability, 0.5),
    avgAcousticness: clampUnit(avgAcousticness, 0.45),
  };
}

function trackTasteSimilarity(
  track: SpotifyTrackSummary & { audio?: SpotifyAudioFeaturesSummary },
  refs: Array<SpotifyTrackSummary & { audio?: SpotifyAudioFeaturesSummary }>,
): number {
  if (!refs.length) return 0.45;
  const tEnergy = estimateTrackEnergy(track);
  const tValence = estimateTrackValence(track);
  const tDanceability = estimateTrackDanceability(track);
  const tAcousticness = estimateTrackAcousticness(track);
  const tText = normalizeText(
    [track.name, ...(track.artists ?? []).map(a => a.name), ...(track.genres ?? [])].join(" "),
  );
  let maxSim = 0;
  for (const ref of refs) {
    const rEnergy = estimateTrackEnergy(ref);
    const rValence = estimateTrackValence(ref);
    const rDanceability = estimateTrackDanceability(ref);
    const rAcousticness = estimateTrackAcousticness(ref);
    const audioSim =
      similarity(tEnergy, rEnergy) * 0.3 +
      similarity(tValence, rValence) * 0.3 +
      similarity(tDanceability, rDanceability) * 0.25 +
      similarity(tAcousticness, rAcousticness) * 0.15;
    const rText = normalizeText(
      [ref.name, ...(ref.artists ?? []).map(a => a.name), ...(ref.genres ?? [])].join(" "),
    );
    const lexical = tText && rText && tText === rText ? 1 : tText && rText && (tText.includes(rText) || rText.includes(tText)) ? 0.65 : 0.3;
    const sim = audioSim * 0.8 + lexical * 0.2;
    if (sim > maxSim) maxSim = sim;
  }
  return clampUnit(maxSim, 0.45);
}

function popularityAdjustment(popularity: number): number {
  if (popularity >= 85) return -1.5;
  if (popularity >= 70) return -0.5;
  if (popularity <= 30) return 1.0;
  return 0;
}

function computeArtistMatch(args: {
  track: SpotifyTrackSummary;
  favoriteArtistIds: Set<string>;
  similarArtistIds: Set<string>;
}): number {
  const artistIds = (args.track.artists ?? []).map(a => String(a?.id ?? "").trim()).filter(Boolean);
  if (artistIds.some(id => args.favoriteArtistIds.has(id))) return 1;
  if (artistIds.some(id => args.similarArtistIds.has(id))) return 0.65;
  return 0;
}

function computeExpansionMatch(args: {
  track: SpotifyTrackSummary;
  expansionTrackIds: Set<string>;
  expansionArtistIds: Set<string>;
}): number {
  const trackId = String(args.track?.id ?? "").trim();
  if (trackId && args.expansionTrackIds.has(trackId)) return 1;
  const artistIds = (args.track.artists ?? []).map(a => String(a?.id ?? "").trim()).filter(Boolean);
  if (artistIds.some(id => args.expansionArtistIds.has(id))) return 0.7;
  return 0;
}

function semanticTokenMatch(
  kind: "mood" | "activity" | "place",
  token: string | undefined,
  text: string,
): number {
  const t = normalizeText(token ?? "");
  if (!t) return 0;
  const aliases = (() => {
    if (kind === "mood") {
      if (t === "bright") return ["bright", "sunny", "happy", "light"];
      if (t === "calm") return ["calm", "soft", "chill", "ambient"];
      if (t === "moody") return ["moody", "dark", "sad", "night"];
      if (t === "upbeat") return ["upbeat", "energetic", "dance", "party"];
    }
    if (kind === "activity") {
      if (t === "work") return ["work", "study", "focus", "concentration"];
      if (t === "walk") return ["walk", "stroll", "outdoor"];
      if (t === "drive") return ["drive", "road", "night drive"];
      if (t === "workout") return ["workout", "gym", "run", "training"];
    }
    if (kind === "place") {
      if (t === "cafe") return ["cafe", "coffee", "acoustic"];
      if (t === "outdoor") return ["outdoor", "park", "river", "walk"];
      if (t === "home") return ["home", "lofi", "indoor"];
    }
    return [t];
  })();
  return aliases.some(a => text.includes(normalizeText(a))) ? 1 : 0;
}

function scoreTrackForSelection(args: {
  track: SpotifyTrackSummary & { audio?: SpotifyAudioFeaturesSummary };
  userProfile: {
    topArtistIds: Set<string>;
    favoriteArtistIds: Set<string>;
    topTrackIds: Set<string>;
    topGenreTokens: Set<string>;
    favoriteGenres: string[];
    avgEnergy: number;
    avgValence: number;
    avgDanceability: number;
    avgAcousticness: number;
  };
  params: SpotifyRecommendationParams;
  similarArtistIds: Set<string>;
  expansionTrackIds: Set<string>;
  expansionArtistIds: Set<string>;
  tasteSimilarity: number;
  recentTrackIds: Set<string>;
  seed: number;
}): number {
  const id = String(args.track?.id ?? "").trim();
  const trackGenres = new Set((args.track.genres ?? []).map(v => normalizeText(v)).filter(Boolean));
  const promptGenreHit = (args.params.seedGenres ?? []).some(g => {
    const token = normalizeText(g).replace(/-/g, " ");
    for (const tg of trackGenres) {
      if (tg.includes(token) || token.includes(tg)) return true;
    }
    return false;
  });
  const tasteGenreHit = [...trackGenres].some(g => args.userProfile.topGenreTokens.has(g));
  const energy = estimateTrackEnergy(args.track);
  const valence = estimateTrackValence(args.track);
  const danceability = estimateTrackDanceability(args.track);
  const acousticness = estimateTrackAcousticness(args.track);
  const promptEnergyScore = similarity(energy, args.params.targetEnergy);
  const promptValenceScore = similarity(valence, args.params.targetValence);
  const promptAcousticScore = similarity(acousticness, args.params.targetAcousticness);
  const promptMatch = Math.max(
    0,
    Math.min(
      1,
      (promptGenreHit ? 0.45 : 0) +
        promptEnergyScore * 0.25 +
        promptValenceScore * 0.2 +
        promptAcousticScore * 0.1,
    ),
  );
  const trackArtistIds = (args.track.artists ?? [])
    .map(a => String(a?.id ?? "").trim())
    .filter(Boolean);
  const trackArtistNames = (args.track.artists ?? [])
    .map(a => normalizeText(a?.name ?? ""))
    .filter(Boolean);
  const isFavoriteArtist =
    trackArtistIds.some(aid => args.userProfile.favoriteArtistIds.has(aid)) ||
    trackArtistIds.some(aid => args.userProfile.topArtistIds.has(aid));
  const artistMatch = isFavoriteArtist ? 1 : 0;
  const expansionMatch = computeExpansionMatch({
    track: args.track,
    expansionTrackIds: args.expansionTrackIds,
    expansionArtistIds: args.expansionArtistIds,
  });
  const semanticText = normalizeText(
    [
      args.track.name,
      args.track.album?.name ?? "",
      ...trackArtistNames,
      ...(args.track.genres ?? []),
    ].join(" "),
  );
  const placeMatch = semanticTokenMatch("place", args.params.place, semanticText);
  const activityMatch = semanticTokenMatch("activity", args.params.activity, semanticText);
  const moodMatch = semanticTokenMatch("mood", args.params.mood, semanticText);
  const popularity = trackPopularity(args.track);
  const novelty = id && !args.recentTrackIds.has(id) ? 0.25 : 0;
  const random = seededUnit(args.seed + 311, `${id}|${args.track.name}|${Date.now()}`) * 0.5;
  let score = 0;
  score += 9 * clampUnit(args.tasteSimilarity, 0.45);
  score += isFavoriteArtist ? 8 : 0;
  score += 5 * artistMatch;
  score += 4 * expansionMatch;
  score += 5.5 * promptMatch;
  score += 2 * placeMatch;
  score += 2.5 * activityMatch;
  score += 3 * moodMatch;
  if (tasteGenreHit) score += 0.6;
  if (id && args.userProfile.topTrackIds.has(id)) score += 3;
  score += novelty;
  score += popularityAdjustment(popularity) * 0.5;
  score += random;
  return score;
}

function weightedRandomTracks<T extends { score: number }>(
  items: T[],
  count: number,
  seed: number,
): T[] {
  const pool = [...items];
  const out: T[] = [];
  let nonce = 0;
  while (out.length < count && pool.length > 0) {
    const total = pool.reduce((sum, item) => sum + Math.max(0.001, item.score), 0);
    const r = seededUnit(seed + nonce, `pick:${nonce}:${pool.length}`) * total;
    nonce += 1;
    let acc = 0;
    let picked = -1;
    for (let i = 0; i < pool.length; i += 1) {
      acc += Math.max(0.001, pool[i].score);
      if (acc >= r) {
        picked = i;
        break;
      }
    }
    const idx = picked >= 0 ? picked : pool.length - 1;
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

function applyTasteBoost(
  tracks: SpotifyTrackSummary[],
  userTopArtistIds: Set<string>,
): SpotifyTrackSummary[] {
  const score = (track: SpotifyTrackSummary): number => {
    let s = 0;
    for (const artist of track.artists ?? []) {
      const id = String(artist?.id ?? "").trim();
      if (id && userTopArtistIds.has(id)) s += 2;
    }
    return s;
  };
  return [...tracks].sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return seededUnit(97, String(a.id ?? "")) - seededUnit(97, String(b.id ?? ""));
  });
}

async function recommendWithRetryStrategy(args: {
  userToken: string;
  seedArtists: string[];
  seedTracks: string[];
  seedGenres: string[];
  targetEnergy: number;
  targetValence: number;
}): Promise<SpotifyTrackSummary[]> {
  const genres = args.seedGenres.slice(0, 1);
  const artistsTop2 = args.seedArtists.slice(0, 2);
  const artistsTop1 = args.seedArtists.slice(0, 1);
  const tracksTop2 = args.seedTracks.slice(0, 2);
  const tracksTop1 = args.seedTracks.slice(0, 1);

  const attempt1 = artistsTop2.length
    ? await getSpotifyRecommendations({
        accessToken: args.userToken,
        seedArtists: artistsTop2,
        seedGenres: genres,
        targetEnergy: args.targetEnergy,
        targetValence: args.targetValence,
        limit: 40,
      })
    : await getSpotifyRecommendations({
        accessToken: args.userToken,
        seedTracks: tracksTop2,
        seedGenres: genres,
        targetEnergy: args.targetEnergy,
        targetValence: args.targetValence,
        limit: 40,
      });
  if (attempt1.length) return attempt1;

  const attempt2 = artistsTop1.length
    ? await getSpotifyRecommendations({
        accessToken: args.userToken,
        seedArtists: artistsTop1,
        seedGenres: genres,
        limit: 40,
      })
    : await getSpotifyRecommendations({
        accessToken: args.userToken,
        seedTracks: tracksTop1,
        seedGenres: genres,
        limit: 40,
      });
  if (attempt2.length) return attempt2;

  return [];
}

function injectTaste(args: {
  candidate: SpotifyTrackSummary[];
  topTracks: SpotifyTrackSummary[];
  seed: number;
}): SpotifyTrackSummary[] {
  const taste = seededShuffleTracks(
    (args.topTracks ?? []).slice(0, 5),
    args.seed + 301,
  );
  return seededShuffleTracks(
    mergeUniqueTracks(taste, args.candidate),
    args.seed + 337,
  );
}

function blendRecommendationAndExploration(args: {
  recommendations: SpotifyTrackSummary[];
  exploration: SpotifyTrackSummary[];
  targetCount: number;
  seed: number;
  userHistory: Set<string>;
}): SpotifyTrackSummary[] {
  const recTarget = Math.max(1, Math.round(args.targetCount * 0.7));
  const expTarget = Math.max(0, args.targetCount - recTarget);
  const usedTrackIds = new Set<string>();
  const artistCounts = new Map<string, number>();
  const recPicked = dedupeWithDiversity({
    tracks: seededShuffleTracks(args.recommendations, args.seed + 11),
    userHistory: args.userHistory,
    maxPerArtist: 2,
    limit: recTarget,
    state: { usedTrackIds, artistCounts },
  });
  const expPicked = dedupeWithDiversity({
    tracks: seededShuffleTracks(args.exploration, args.seed + 29),
    userHistory: args.userHistory,
    maxPerArtist: 2,
    limit: expTarget,
    state: { usedTrackIds, artistCounts },
  });
  const merged = interleaveTrackGroups({
    taste: recPicked,
    exploration: expPicked,
    general: recPicked,
    targetCount: args.targetCount,
    seed: args.seed + 47,
  });
  if (merged.length >= args.targetCount) return merged.slice(0, args.targetCount);
  const refill = dedupeWithDiversity({
    tracks: seededShuffleTracks(
      mergeUniqueTracks(args.recommendations, args.exploration),
      args.seed + 71,
    ),
    userHistory: args.userHistory,
    maxPerArtist: 2,
    limit: args.targetCount - merged.length,
    state: { usedTrackIds, artistCounts },
  });
  return mergeUniqueTracks(merged, refill).slice(0, args.targetCount);
}

function buildPlaylistSummariesKey(args: {
  prompt: string;
  userToken: string;
  preAnalyzedProfile?: GeminiRecommendationProfile | null;
  preloadedBootstrap?: SpotifyBootstrapData | null;
  requestId?: string;
}): string {
  const promptPlan = extractPromptSearchPlan(args.prompt);
  const normalizedPrompt = normalizeText(promptPlan.brief || args.prompt).slice(0, 140);
  const tokenKey = String(args.userToken ?? "").slice(0, 8);
  const p = args.preAnalyzedProfile;
  const profileKey = p
    ? [
        p.genres.map(v => normalizeText(v)).filter(Boolean).sort().join("|"),
        `e${Math.round(p.energy * 10) / 10}`,
        `v${Math.round(p.valence * 10) / 10}`,
        `a${Math.round(p.acousticness * 10) / 10}`,
        `m:${normalizeText(p.mood ?? "-")}`,
        `act:${normalizeText(p.activity ?? "-")}`,
        `pl:${normalizeText(p.place ?? "-")}`,
        `d:${Math.round(Number(p.durationMinutes ?? 0) / 10) * 10}`,
      ].join("|")
    : "-";
  const topTrackKey = (args.preloadedBootstrap?.topTracks ?? [])
    .slice(0, 5)
    .map(t => String(t?.id ?? "").trim())
    .filter(Boolean)
    .join(",");
  const topArtistKey = (args.preloadedBootstrap?.topArtists ?? [])
    .slice(0, 5)
    .map(a => String(a?.id ?? "").trim())
    .filter(Boolean)
    .join(",");
  const timeBucket = Math.floor(Date.now() / PLAYLIST_RESULT_CACHE_TIME_BUCKET_MS);
  const requestKey = String(args.requestId ?? "").trim();
  return [
    `p:${normalizedPrompt}`,
    `g:${(promptPlan.genres ?? []).map(v => normalizeText(v)).filter(Boolean).sort().join("|")}`,
    `m:${normalizeText(promptPlan.mood)}`,
    `act:${normalizeText(promptPlan.activity)}`,
    `tk:${tokenKey}`,
    `pf:${profileKey}`,
    `tt:${topTrackKey}`,
    `ta:${topArtistKey}`,
    `tb:${timeBucket}`,
    requestKey ? `rid:${requestKey}` : "",
  ]
    .filter(Boolean)
    .join("|");
}

function estimateSearchQueryRunCount(queries: string[], budgetMs: number): number {
  const count = Array.isArray(queries) ? queries.filter(Boolean).length : 0;
  if (!count) return 0;
  if (budgetMs <= 5200) return Math.min(4, count);
  if (budgetMs <= 4500) return Math.min(8, count);
  return Math.min(12, count);
}

const MUSIC_QUERY_ANCHORS = [
  "k-pop",
  "korean rnb",
  "soul",
  "korean indie",
  "korean folk",
  "korean ost",
  "vocal",
  "acoustic",
  "melodic hip hop",
];

const NON_MUSIC_AUDIO_TERMS = [
  "asmr",
  "white noise",
  "nature sounds",
  "sleep",
  "deep sleep",
  "meditation",
  "stress reducing",
  "cats",
  "anxiety",
  "healing sounds",
  "spa",
  "binaural",
  "study sounds",
  "rain sounds",
  "focus sounds",
  "ambient noise",
  "office music",
  "work music",
  "chill work music",
  "study playlist",
  "background noise",
  "instrumental",
  "workout",
  "machine",
];

const SCENE_SURFACE_TOKENS = new Set([
  "walk",
  "stroll",
  "outdoor",
  "sunny",
  "breezy",
  "rainy",
  "night",
  "dawn",
  "morning",
  "evening",
  "river",
  "hangang",
  "road",
  "drive",
  "weather",
]);

const MUSIC_DESCRIPTOR_VOCAB = new Set([
  "vocal",
  "soft vocal",
  "emotional vocal",
  "clean vocal",
  "male vocal",
  "female vocal",
  "acoustic",
  "smooth",
  "melodic",
  "chill",
  "warm",
  "cozy",
  "bright",
  "breezy",
  "light",
  "airy",
  "easy listening",
  "upbeat",
  "steady groove",
  "mid tempo",
  "low intensity",
  "korean rnb",
  "soul",
  "k-pop",
  "korean indie",
  "korean folk",
  "korean ost",
  "melodic hip hop",
]);

type SemanticConcept = {
  id: string;
  cues: RegExp[];
  expanded: string[];
  musicContext: string[];
  scene?: Partial<ParsedIntent["scene"]>;
  moodPrimary?: string[];
  moodSecondary?: string[];
  texture?: Partial<ParsedIntent["texture"]>;
  genre?: string[];
};

const SEMANTIC_CONCEPTS: SemanticConcept[] = [
  {
    id: "warm",
    cues: [/따뜻|warm|cozy|comforting/i],
    expanded: ["warm", "cozy", "comforting", "soft"],
    musicContext: ["acoustic", "soft vocal", "mid tempo", "low harshness"],
    moodPrimary: ["warm", "cozy"],
    texture: { sound: ["soft"], vocal: ["vocal"], emotional: ["comforting"] },
  },
  {
    id: "relaxed",
    cues: [/편안|잔잔|relaxed|calm|gentle/i],
    expanded: ["calm", "relaxed", "gentle", "soft"],
    musicContext: ["soft vocal", "acoustic", "steady tempo"],
    moodPrimary: ["calm"],
    texture: { sound: ["soft"], emotional: ["gentle"] },
  },
  {
    id: "breezy",
    cues: [/화창|맑|sunny|bright|breezy/i],
    expanded: ["sunny", "bright", "breezy", "light", "refreshing"],
    musicContext: ["light", "upbeat", "clean sound"],
    scene: { weather: ["sunny", "clear"] },
    moodPrimary: ["bright", "breezy"],
  },
  {
    id: "rainy",
    cues: [/비|rain|rainy|wet|grey/i],
    expanded: ["rainy", "wet", "grey", "melancholic"],
    musicContext: ["slow", "emotional vocal", "minor tone"],
    scene: { weather: ["rainy"] },
    moodSecondary: ["melancholic"],
  },
  {
    id: "walk",
    cues: [/산책|walk|stroll/i],
    expanded: ["walk", "outdoor", "light movement", "breezy"],
    musicContext: ["mid tempo", "light groove", "easy vocal"],
    scene: { activity: ["walk", "stroll"], place: ["outdoor"] },
  },
  {
    id: "hangang",
    cues: [/한강|hangang|river/i],
    expanded: ["hangang", "river", "outdoor", "open air"],
    musicContext: ["breezy", "light", "clean sound"],
    scene: { place: ["river", "outdoor"] },
  },
  {
    id: "night",
    cues: [/밤|night|late night/i],
    expanded: ["night", "late night", "dim", "quiet"],
    musicContext: ["soft vocal", "moody", "low intensity"],
    scene: { timeOfDay: ["night"] },
  },
  {
    id: "dawn",
    cues: [/새벽|dawn|early morning/i],
    expanded: ["dawn", "quiet", "grey", "slow start"],
    musicContext: ["soft", "slow", "ambient melodic"],
    scene: { timeOfDay: ["dawn"] },
  },
  {
    id: "drive",
    cues: [/드라이브|drive|road/i],
    expanded: ["road", "window down", "motion", "uplift"],
    musicContext: ["upbeat", "steady groove", "clear hook"],
    scene: { activity: ["drive"], place: ["road"] },
  },
  {
    id: "focus",
    cues: [/공부|집중|study|focus/i],
    expanded: ["focus", "steady", "non-distracting", "clear"],
    musicContext: ["steady tempo", "low clutter", "clean mix"],
    scene: { activity: ["focus"] },
  },
  {
    id: "vocal",
    cues: [/보컬|vocal|sing|singer/i],
    expanded: ["vocal", "melodic vocal"],
    musicContext: ["vocal", "lyric-forward"],
    texture: { vocal: ["vocal"] },
  },
  {
    id: "ost",
    cues: [/ost|영화음악|soundtrack|cinematic/i],
    expanded: ["korean ost", "soundtrack", "cinematic"],
    musicContext: ["emotional vocal", "cinematic harmony"],
    genre: ["korean ost"],
  },
];

function expandSemanticTokens(input: string[]): string[] {
  const text = normalizeText(input.join(" "));
  const out = new Set<string>();
  SEMANTIC_CONCEPTS.forEach(concept => {
    if (concept.cues.some(re => re.test(text))) {
      concept.expanded.forEach(v => out.add(normalizeText(v)));
    }
  });
  input.map(v => normalizeText(v)).filter(Boolean).forEach(v => out.add(v));
  return Array.from(out).slice(0, 24);
}

function deriveMusicContext(tokens: string[]): string[] {
  const text = normalizeText(tokens.join(" "));
  const out = new Set<string>();
  SEMANTIC_CONCEPTS.forEach(concept => {
    if (concept.cues.some(re => re.test(text))) {
      concept.musicContext.forEach(v => out.add(normalizeText(v)));
    }
  });
  if (!out.size) {
    ["vocal", "acoustic", "mid tempo", "clean sound"].forEach(v => out.add(v));
  }
  return Array.from(out).slice(0, 18);
}

function toEnglishQueryToken(token: string): string {
  const mapped = expandSemanticTokens([token])[0] ?? token;
  const cleaned = String(mapped ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function analyzeIntent(prompt: string): ParsedIntent {
  const plan = extractPromptSearchPlan(prompt);
  const intent = buildUserIntentProfile(prompt);
  const timeConstraint = extractTimeConstraint(prompt);
  const tokens = Array.from(
    new Set([
      ...keywordList(prompt),
      ...plan.include,
      ...plan.genres,
    ]),
  ).map(v => normalizeText(v)).filter(Boolean);

  const scene = {
    timeOfDay: new Set<string>(),
    activity: new Set<string>(),
    place: new Set<string>(),
    weather: new Set<string>(),
  };
  const moodPrimarySet = new Set<string>();
  const moodSecondarySet = new Set<string>();
  const texture = {
    sound: new Set<string>(),
    vocal: new Set<string>(),
    emotional: new Set<string>(),
  };
  const conceptText = normalizeText(tokens.join(" "));
  SEMANTIC_CONCEPTS.forEach(concept => {
    if (!concept.cues.some(re => re.test(conceptText))) return;
    concept.scene?.timeOfDay?.forEach(v => scene.timeOfDay.add(normalizeText(v)));
    concept.scene?.activity?.forEach(v => scene.activity.add(normalizeText(v)));
    concept.scene?.place?.forEach(v => scene.place.add(normalizeText(v)));
    concept.scene?.weather?.forEach(v => scene.weather.add(normalizeText(v)));
    concept.moodPrimary?.forEach(v => moodPrimarySet.add(normalizeText(v)));
    concept.moodSecondary?.forEach(v => moodSecondarySet.add(normalizeText(v)));
    concept.texture?.sound?.forEach(v => texture.sound.add(normalizeText(v)));
    concept.texture?.vocal?.forEach(v => texture.vocal.add(normalizeText(v)));
    concept.texture?.emotional?.forEach(v => texture.emotional.add(normalizeText(v)));
  });
  const timeOfDay = Array.from(scene.timeOfDay).slice(0, 3);
  const activity = Array.from(scene.activity).slice(0, 4);
  const place = Array.from(scene.place).slice(0, 4);
  const weather = Array.from(scene.weather).slice(0, 3);
  const moodPrimary = Array.from(moodPrimarySet).slice(0, 4);
  const moodSecondary = Array.from(moodSecondarySet).slice(0, 4);
  const sound = Array.from(texture.sound).slice(0, 4);
  const vocal = Array.from(texture.vocal).slice(0, 3);
  const emotional = Array.from(texture.emotional).slice(0, 4);
  const explicitGenreFromPrompt = (() => {
    const text = normalizeText(prompt);
    const out: string[] = [];
    if (/k[\s-]?pop|케이팝/.test(text)) out.push("k-pop");
    if (/멜로디\s*힙합|melodic\s*hip[\s-]?hop/.test(text)) out.push("melodic hip hop");
    if (/\bhip[\s-]?hop\b|힙합|랩/.test(text)) out.push("hip hop");
    if (/\br[\s&-]?n[\s&-]?b\b|r&b|알앤비/.test(text)) out.push("korean rnb");
    if (/소울|soul/.test(text)) out.push("soul");
    if (/ost|사운드트랙|soundtrack|영화음악|영화 음악/.test(text)) out.push("korean ost");
    return out;
  })();
  const genreRequested = Array.from(
    new Set(
      [...plan.genres, ...explicitGenreFromPrompt]
        .flatMap(v => expandSemanticTokens([v]))
        .map(v => normalizeText(v))
        .filter(Boolean),
    ),
  ).slice(0, 6);
  const expanded = expandSemanticTokens([...tokens, ...moodPrimary, ...moodSecondary, ...weather]);
  const musicContext = deriveMusicContext([...expanded, ...genreRequested, ...sound, ...emotional]);
  const semantic = Array.from(
    new Set(
      [
        ...timeOfDay,
        ...activity,
        ...place,
        ...moodPrimary,
        ...moodSecondary,
        ...sound,
        ...emotional,
      ]
        .flatMap(v => expandSemanticTokens([v]))
        .map(v => normalizeText(v))
        .filter(Boolean),
    ),
  ).slice(0, 18);

  return {
    scene: { timeOfDay, activity, place, weather },
    mood: { primary: moodPrimary, secondary: moodSecondary },
    texture: { sound, vocal, emotional },
    genreIntent: {
      requested: genreRequested,
      blendMode: genreRequested.length > 1 ? "blend" : "single",
    },
    duration: { targetMinutes: timeConstraint?.minutes ?? null },
    queryTokens: { semantic, expanded, musicContext },
  };
}

function buildUserTasteProfileSignals(args: {
  bootstrap: SpotifyBootstrapData | null;
}): TasteProfileSignals {
  const extractDescriptorTokens = (texts: string[]): string[] => {
    const joined = normalizeText(texts.join(" "));
    if (!joined) return [];
    const out = new Set<string>();
    MUSIC_DESCRIPTOR_VOCAB.forEach(token => {
      if (joined.includes(normalizeText(token))) out.add(normalizeText(token));
    });
    return Array.from(out).slice(0, 16);
  };
  const topArtistIds = new Set(
    (args.bootstrap?.topArtists ?? [])
      .map(a => String(a?.id ?? "").trim())
      .filter(Boolean),
  );
  const topTrackIds = new Set(
    (args.bootstrap?.topTracks ?? [])
      .map(t => String(t?.id ?? "").trim())
      .filter(Boolean),
  );
  const topArtistNames = (args.bootstrap?.topArtists ?? [])
    .map(a => String(a?.name ?? "").trim())
    .filter(Boolean)
    .slice(0, 12);
  const artistTokens = new Set(topArtistNames.map(v => normalizeText(v)).filter(Boolean));
  const genreTokens = new Set(
    [
      ...(args.bootstrap?.topArtists ?? []).flatMap(a => a.genres ?? []),
      ...(args.bootstrap?.topTracks ?? []).flatMap(t => t.genres ?? []),
    ]
      .map(v => normalizeText(String(v ?? "")))
      .filter(Boolean),
  );
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  const recentTrackIds = new Set<string>();
  const recentArtistIds = new Set<string>();
  recommendationHistory.forEach(snapshot => {
    if (snapshot.createdAt < cutoff24h) return;
    snapshot.trackIds.forEach(id => recentTrackIds.add(String(id ?? "").trim()));
    snapshot.artistKeys.forEach(key => recentArtistIds.add(String(key ?? "").trim()));
  });
  const topTextSignals = (args.bootstrap?.topTracks ?? []).flatMap(track => [
    String(track?.name ?? ""),
    String(track?.album?.name ?? ""),
    ...(track?.artists ?? []).map(a => String(a?.name ?? "")),
    ...(track?.genres ?? []).map(g => String(g ?? "")),
  ]);
  const artistGenreSignals = (args.bootstrap?.topArtists ?? []).flatMap(artist => [
    String(artist?.name ?? ""),
    ...(artist?.genres ?? []).map(g => String(g ?? "")),
  ]);
  const descriptorTokens = extractDescriptorTokens([...topTextSignals, ...artistGenreSignals]);
  const vocalStyle = descriptorTokens.filter(t => /vocal|male|female/.test(t)).slice(0, 6);
  const moods = descriptorTokens.filter(t => /chill|warm|cozy|bright|emotional|breezy|light/.test(t)).slice(0, 6);
  const textures = descriptorTokens.filter(t => /soft|smooth|melodic|acoustic|airy|easy listening/.test(t)).slice(0, 6);
  const energies = (args.bootstrap?.topTracks ?? [])
    .map(track => estimateTrackEnergy(track))
    .filter(v => Number.isFinite(v));
  const energyMin = energies.length ? Math.min(...energies) : 0.3;
  const energyMax = energies.length ? Math.max(...energies) : 0.75;
  return {
    topArtistIds,
    topTrackIds,
    genreTokens,
    artistTokens,
    topArtistNames,
    recentTrackIds,
    recentArtistIds,
    vocalStyle,
    moods,
    textures,
    preferredEnergyRange: {
      min: Math.max(0, Math.min(1, energyMin)),
      max: Math.max(0, Math.min(1, energyMax)),
    },
  };
}

function compactQueryTokens(parts: string[], minWords = 2, maxWords = 4): string {
  const words = parts
    .map(v => toEnglishQueryToken(v))
    .flatMap(v => v.split(" "))
    .map(v => v.trim())
    .filter(v => v.length >= 2);
  const dedup = Array.from(new Set(words)).slice(0, maxWords);
  if (dedup.length < minWords) return "";
  return sanitizeFastSearchToken(dedup.join(" "));
}

function extractBaseParserTokens(prompt: string): string[] {
  const text = normalizeText(String(prompt ?? ""))
    .replace(/[^a-z0-9가-힣\s&/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let n = 3; n >= 1; n -= 1) {
    for (let i = 0; i <= words.length - n; i += 1) {
      const phrase = words.slice(i, i + n).join(" ").trim();
      if (!phrase) continue;
      if (BASE_SEMANTIC_LEXICON[phrase]) out.add(phrase);
      if (phrase === "r b") out.add("r&b");
      if (phrase === "r n b") out.add("r&b");
    }
  }
  words.forEach(w => {
    if (BASE_SEMANTIC_LEXICON[w]) out.add(w);
  });
  return Array.from(out);
}

function buildBasePromptFeatures(prompt: string): BasePromptFeatures {
  const normalizedPrompt = normalizeText(prompt);
  const timeConstraint = extractTimeConstraint(prompt);
  const requestedLocale: BasePromptFeatures["requestedLocale"] = (() => {
    const hasKorean = /(한국|국내|korean|k-pop|kpop|케이팝|한글|가요)/.test(normalizedPrompt);
    const hasGlobal = /(global|해외|world|international|팝송)/.test(normalizedPrompt);
    if (hasKorean && hasGlobal) return "mixed";
    if (hasKorean) return "korean";
    if (hasGlobal) return "global";
    return undefined;
  })();
  const features: BasePromptFeatures = {
    languageHint: /[가-힣]/.test(prompt) ? "mixed" : "unknown",
    requestedLocale,
    requestedDurationMin: timeConstraint?.minutes ?? undefined,
    requestedDurationAtLeast: timeConstraint?.mode === "at_least" ? true : undefined,
    ...BASE_PARSER_NEUTRAL,
    environment: [],
    moodTokens: [],
    textureTokens: [],
    vocalTokens: [],
    requestedGenres: [],
    requestedSpecialTags: [],
    excludedGenres: [],
    retention: {
      locale: false,
      duration: false,
      genreCount: 0,
      ostLike: false,
      mixIntent: false,
    },
    diagnostics: undefined,
    confidence: 0.35,
  };
  const tokens = extractBaseParserTokens(prompt);
  let genreHit = 0;
  let situationHit = 0;
  let moodHit = 0;
  let modifierHit = 0;
  for (const token of tokens) {
    const entry = BASE_SEMANTIC_LEXICON[token];
    if (!entry) continue;
    const w = entry.weights ?? {};
    features.movement = clampUnit(features.movement + Number(w.movement ?? 0), features.movement);
    features.energy = clampUnit(features.energy + Number(w.energy ?? 0), features.energy);
    features.tempo = clampUnit(features.tempo + Number(w.tempo ?? 0), features.tempo);
    features.groove = clampUnit(features.groove + Number(w.groove ?? 0), features.groove);
    features.brightness = clampUnit(features.brightness + Number(w.brightness ?? 0), features.brightness);
    features.warmth = clampUnit(features.warmth + Number(w.warmth ?? 0), features.warmth);
    features.airiness = clampUnit(features.airiness + Number(w.airiness ?? 0), features.airiness);
    features.aggression = clampUnit(features.aggression + Number(w.aggression ?? 0), features.aggression);
    features.acousticnessHint = clampUnit(
      features.acousticnessHint + Number(w.acousticnessHint ?? 0),
      features.acousticnessHint,
    );
    features.cinematic = clampUnit(features.cinematic + Number(w.cinematic ?? 0), features.cinematic);
    if (entry.environment?.length) features.environment.push(...entry.environment);
    if (entry.moodTokens?.length) features.moodTokens.push(...entry.moodTokens);
    if (entry.textureTokens?.length) features.textureTokens.push(...entry.textureTokens);
    if (entry.vocalTokens?.length) features.vocalTokens.push(...entry.vocalTokens);
    if (entry.requestedGenres?.length) features.requestedGenres.push(...entry.requestedGenres);
    if (entry.excludedGenres?.length) features.excludedGenres.push(...entry.excludedGenres);
    if (entry.languageHint) features.languageHint = entry.languageHint;
    if (entry.category === "genre") genreHit += 1;
    else if (entry.category === "situation") situationHit += 1;
    else if (entry.category === "mood") moodHit += 1;
    else if (entry.category === "modifier") modifierHit += 1;
  }
  if (/[가-힣]/.test(prompt) && features.languageHint === "unknown") features.languageHint = "mixed";
  if (/한국|korean|k-pop|kpop/.test(normalizeText(prompt))) features.languageHint = "korean";
  if (/(ost|사운드트랙|soundtrack|영화음악|영화 음악|cinematic)/.test(normalizedPrompt)) {
    features.requestedSpecialTags.push("ost-like");
  }
  if (/(mix|blend|섞|다양|여러 장르|장르 믹스)/.test(normalizedPrompt)) {
    features.requestedSpecialTags.push("mix");
  }
  if (/(acoustic|어쿠스틱)/.test(normalizedPrompt)) {
    features.requestedSpecialTags.push("acoustic");
  }
  if (/(vocal|보컬)/.test(normalizedPrompt)) {
    features.requestedSpecialTags.push("vocal");
  }
  features.environment = Array.from(new Set(features.environment.map(v => normalizeText(v)).filter(Boolean))).slice(0, 4);
  features.moodTokens = Array.from(new Set(features.moodTokens.map(v => normalizeText(v)).filter(Boolean))).slice(0, 6);
  features.textureTokens = Array.from(new Set(features.textureTokens.map(v => normalizeText(v)).filter(Boolean))).slice(0, 6);
  features.vocalTokens = Array.from(new Set(features.vocalTokens.map(v => normalizeText(v)).filter(Boolean))).slice(0, 5);
  features.requestedGenres = Array.from(new Set(features.requestedGenres.map(v => normalizeText(v)).filter(Boolean))).slice(0, 8);
  features.requestedSpecialTags = Array.from(
    new Set(features.requestedSpecialTags.map(v => normalizeText(v)).filter(Boolean)),
  ).slice(0, 8);
  features.excludedGenres = Array.from(new Set(features.excludedGenres.map(v => normalizeText(v)).filter(Boolean))).slice(0, 6);
  if (!features.moodTokens.length) {
    features.moodTokens = [features.energy >= 0.62 ? "upbeat" : features.energy <= 0.42 ? "calm" : "balanced"];
  }
  if (!features.textureTokens.length) {
    features.textureTokens = [features.acousticnessHint >= 0.58 ? "acoustic" : "clean"];
  }
  if (!features.vocalTokens.length) {
    features.vocalTokens = [features.languageHint === "korean" ? "korean vocal" : "clear vocal"];
  }
  const hasLocaleRequest = Boolean(features.requestedLocale);
  const hasDurationRequest = Number(features.requestedDurationMin ?? 0) > 0;
  const hasOstLikeRequest =
    features.requestedGenres.some(v => /ost|soundtrack|cinematic/.test(v)) ||
    features.requestedSpecialTags.some(v => v.includes("ost"));
  const hasMixIntent =
    features.requestedGenres.length > 1 ||
    features.requestedSpecialTags.some(v => v.includes("mix"));
  features.retention = {
    locale: !hasLocaleRequest || features.languageHint === "korean" || features.requestedLocale === "global",
    duration: !hasDurationRequest || Boolean(features.requestedDurationMin),
    genreCount: features.requestedGenres.length,
    ostLike: !hasOstLikeRequest || features.requestedGenres.some(v => /ost|soundtrack|cinematic/.test(v)),
    mixIntent: !hasMixIntent || features.requestedGenres.length > 1,
  };
  const coverage = Math.max(
    0,
    Math.min(1, (genreHit + situationHit + moodHit + modifierHit) / 6),
  );
  const specificity = Math.max(
    0,
    Math.min(1, (features.requestedGenres.length * 0.24 + features.requestedSpecialTags.length * 0.16 + (hasDurationRequest ? 0.2 : 0) + (hasLocaleRequest ? 0.2 : 0))),
  );
  const consistency = Math.max(
    0,
    Math.min(
      1,
      1 -
        Math.max(0, features.energy - 0.88) * 0.4 -
        Math.max(0, features.acousticnessHint - 0.88) * 0.3 -
        Math.max(0, features.aggression - 0.88) * 0.3,
    ),
  );
  const retentionScore = Math.max(
    0,
    Math.min(
      1,
      Number(features.retention.locale) * 0.25 +
        Number(features.retention.duration) * 0.2 +
        Math.min(1, features.retention.genreCount / 3) * 0.2 +
        Number(features.retention.ostLike) * 0.2 +
        Number(features.retention.mixIntent) * 0.15,
    ),
  );
  features.diagnostics = { coverage, specificity, consistency, retention: retentionScore };
  let confidence =
    coverage * 0.3 +
    specificity * 0.2 +
    consistency * 0.2 +
    retentionScore * 0.3;
  if (!features.retention.locale) confidence = Math.min(confidence, 0.78);
  if (!features.retention.ostLike) confidence = Math.min(confidence, 0.72);
  if (!features.retention.mixIntent) confidence = Math.min(confidence, 0.68);
  if (!features.retention.duration) confidence = Math.min(confidence, 0.74);
  features.confidence = Math.max(0.25, Math.min(1, confidence));
  return features;
}

function basePromptFeaturesToBundle(base: BasePromptFeatures, intent: ParsedIntent): PromptFeatureBundle {
  const energy: "low" | "mid" | "high" =
    base.energy >= 0.67 ? "high" : base.energy <= 0.34 ? "low" : "mid";
  const movement = Array.from(
    new Set(
      [
        base.movement >= 0.62 ? "steady walking rhythm" : base.movement <= 0.38 ? "stable movement" : "mid movement",
        ...intent.scene.activity.map(v => toEnglishQueryToken(v)),
      ].filter(Boolean),
    ),
  ).slice(0, 4);
  const groove = Array.from(
    new Set(
      [
        base.groove >= 0.62 ? "light bounce" : base.groove <= 0.38 ? "soft groove" : "mid groove",
        base.tempo >= 0.62 ? "upbeat groove" : base.tempo <= 0.38 ? "slow groove" : "steady groove",
      ],
    ),
  ).slice(0, 4);
  const texture = Array.from(
    new Set(
      [
        ...base.textureTokens,
        base.airiness >= 0.6 ? "airy" : "clean",
        base.warmth >= 0.6 ? "warm" : "",
      ].filter(Boolean),
    ),
  ).slice(0, 6);
  const mood = Array.from(
    new Set(
      [
        ...base.moodTokens,
        base.brightness >= 0.62 ? "bright" : base.brightness <= 0.38 ? "calm" : "balanced",
      ],
    ),
  ).slice(0, 6);
  return {
    energy,
    energyLevel: clampUnit(base.energy, 0.5),
    movementLevel: clampUnit(base.movement, 0.5),
    tempoLevel: clampUnit(base.tempo, 0.5),
    grooveLevel: clampUnit(base.groove, 0.5),
    environment: Array.from(new Set([...base.environment, ...intent.scene.place.map(v => toEnglishQueryToken(v))])).slice(0, 5),
    movement,
    groove,
    texture,
    vocal: base.vocalTokens.slice(0, 4),
    mood,
    aggression: base.aggression >= 0.67 ? "high" : base.aggression <= 0.34 ? "low" : "mid",
  };
}

function buildPromptFeatureBundle(intent: ParsedIntent, prompt?: string): PromptFeatureBundle {
  if (prompt && prompt.trim()) {
    return basePromptFeaturesToBundle(buildBasePromptFeatures(prompt), intent);
  }
  return basePromptFeaturesToBundle(buildBasePromptFeatures(intent.queryTokens.semantic.join(" ")), intent);
}

function buildPromptFeatureBundleFromAnalyzedProfile(
  intent: ParsedIntent,
  profile: GeminiRecommendationProfile | null | undefined,
  prompt?: string,
  baseFeatures?: BasePromptFeatures,
): PromptFeatureBundle {
  const base = buildPromptFeatureBundle(intent, prompt);
  const baseRef = baseFeatures ?? (prompt ? buildBasePromptFeatures(prompt) : null);
  if (!profile) return base;
  const energyNum = Number(profile.energy);
  const valenceNum = Number(profile.valence);
  const adjustWithin = (baseValue: number, target: number, limit = 0.1): number => {
    if (!Number.isFinite(target)) return baseValue;
    const delta = Math.max(-limit, Math.min(limit, target - baseValue));
    return clampUnit(baseValue + delta, baseValue);
  };
  const shouldRefine = profile.source === "gemini" && (baseRef?.confidence ?? 0.5) < 0.65;
  const energyLevel = Number.isFinite(energyNum)
    ? (shouldRefine ? adjustWithin(base.energyLevel, energyNum, 0.1) : base.energyLevel)
    : base.energyLevel;
  const moodHints = [profile.mood, profile.activity, profile.place, profile.time, profile.weather]
    .map(v => toEnglishQueryToken(String(v ?? "")))
    .filter(Boolean);
  const mood = Array.from(new Set([...base.mood, ...moodHints])).slice(0, 6);
  const textureHints =
    Number.isFinite(valenceNum) && valenceNum >= 0.62
      ? ["clean", "airy"]
      : Number.isFinite(valenceNum) && valenceNum <= 0.38
        ? ["soft", "ambient"]
        : [];
  return {
    ...base,
    energy:
      energyLevel >= 0.67
        ? "high"
        : energyLevel <= 0.34
          ? "low"
          : "mid",
    energyLevel,
    mood,
    texture: Array.from(new Set([...base.texture, ...textureHints])).slice(0, 6),
  };
}

function buildTasteDescriptorCore(taste: TasteProfileSignals): TasteDescriptorCore {
  const genreTendency = Array.from(
    new Set(
      Array.from(taste.genreTokens)
        .map(v => toEnglishQueryToken(v))
        .filter(v => MUSIC_QUERY_ANCHORS.includes(v)),
    ),
  ).slice(0, 6);
  const vocal = Array.from(
    new Set(
      taste.vocalStyle
        .map(v => toEnglishQueryToken(v))
        .filter(Boolean),
    ),
  ).slice(0, 5);
  const emotion = Array.from(
    new Set(
      taste.moods
        .map(v => toEnglishQueryToken(v))
        .filter(Boolean),
    ),
  ).slice(0, 5);
  const rhythmTolerance = Array.from(
    new Set(
      [
        ...taste.textures.map(v => toEnglishQueryToken(v)),
        taste.preferredEnergyRange.max <= 0.5 ? "low aggression" : "mid groove",
        taste.preferredEnergyRange.min >= 0.45 ? "steady groove" : "soft groove",
      ].filter(Boolean),
    ),
  ).slice(0, 5);
  return {
    language: ["korean"],
    vocal: vocal.length ? vocal : ["soft vocal", "melodic vocal", "clear vocal"],
    genreTendency: genreTendency.length
      ? genreTendency
      : ["korean rnb", "melodic hip hop", "k-pop", "korean indie"],
    emotion: emotion.length ? emotion : ["warm", "reflective", "emotional"],
    rhythmTolerance: rhythmTolerance.length ? rhythmTolerance : ["mid groove", "low aggression"],
  };
}

type GeminiSemanticParseJson = {
  movement?: "low" | "medium" | "high" | string;
  energy?: "low" | "medium" | "high" | string;
  tempo?: "slow" | "medium" | "fast" | string;
  groove?: "low" | "medium" | "high" | string;
  environment?: string[];
  mood?: string[];
  texture?: string[];
  vocal?: string[];
};

type GeminiSemanticVector = {
  movement: "low" | "medium" | "high";
  energy: "low" | "medium" | "high";
  tempo: "slow" | "medium" | "fast";
  groove: "low" | "medium" | "high";
  mood: string[];
  texture: string[];
  environment: string[];
  vocal: string[];
};

const GEMINI_SEMANTIC_ALLOWED = {
  movement: new Set(["low", "medium", "high"]),
  energy: new Set(["low", "medium", "high"]),
  tempo: new Set(["slow", "medium", "fast"]),
  groove: new Set(["low", "medium", "high"]),
  mood: new Set([
    "bright",
    "calm",
    "dark",
    "uplifting",
    "melancholic",
    "emotional",
    "light",
    "breezy",
    "warm",
    "cool",
    "peaceful",
    "neutral",
  ]),
  texture: new Set(["clean", "airy", "dense", "soft", "acoustic", "electronic", "ambient"]),
  environment: new Set(["indoor", "outdoor", "road", "nature", "city", "unknown"]),
  vocal: new Set(["instrumental", "soft", "clear", "strong"]),
};

function defaultGeminiSemanticVector(): GeminiSemanticVector {
  return {
    movement: "medium",
    energy: "medium",
    tempo: "medium",
    groove: "medium",
    mood: ["neutral"],
    texture: ["clean"],
    environment: ["unknown"],
    vocal: ["clear"],
  };
}

function normalizeGeminiScalar(
  value: unknown,
  allowed: Set<string>,
  fallback: string,
): string {
  const raw = normalizeText(String(value ?? ""));
  if (!raw) return fallback;
  if (allowed.has(raw)) return raw;
  if (raw === "mid") return allowed.has("medium") ? "medium" : fallback;
  if (raw === "medium fast") return allowed.has("fast") ? "fast" : fallback;
  if (raw === "medium slow") return allowed.has("medium") ? "medium" : fallback;
  if (raw === "high energy" && allowed.has("high")) return "high";
  if (raw === "low energy" && allowed.has("low")) return "low";
  return fallback;
}

function normalizeGeminiArray(
  value: unknown,
  allowed: Set<string>,
  fallback: string[],
): string[] {
  const raw = Array.isArray(value) ? value : [];
  const normalized = raw
    .map(v => normalizeText(String(v ?? "")))
    .filter(v => allowed.has(v));
  const dedup = Array.from(new Set(normalized));
  if (dedup.length) return dedup;
  return Array.from(new Set(fallback.filter(v => allowed.has(v))));
}

function canonicalizeGeminiSemanticVector(
  raw: GeminiSemanticParseJson | null | undefined,
): GeminiSemanticVector {
  const fallback = defaultGeminiSemanticVector();
  return {
    movement: normalizeGeminiScalar(raw?.movement, GEMINI_SEMANTIC_ALLOWED.movement, fallback.movement) as "low" | "medium" | "high",
    energy: normalizeGeminiScalar(raw?.energy, GEMINI_SEMANTIC_ALLOWED.energy, fallback.energy) as "low" | "medium" | "high",
    tempo: normalizeGeminiScalar(raw?.tempo, GEMINI_SEMANTIC_ALLOWED.tempo, fallback.tempo) as "slow" | "medium" | "fast",
    groove: normalizeGeminiScalar(raw?.groove, GEMINI_SEMANTIC_ALLOWED.groove, fallback.groove) as "low" | "medium" | "high",
    mood: normalizeGeminiArray(raw?.mood, GEMINI_SEMANTIC_ALLOWED.mood, fallback.mood).slice(0, 4),
    texture: normalizeGeminiArray(raw?.texture, GEMINI_SEMANTIC_ALLOWED.texture, fallback.texture).slice(0, 3),
    environment: normalizeGeminiArray(raw?.environment, GEMINI_SEMANTIC_ALLOWED.environment, fallback.environment).slice(0, 3),
    vocal: normalizeGeminiArray(raw?.vocal, GEMINI_SEMANTIC_ALLOWED.vocal, fallback.vocal).slice(0, 2),
  };
}

function stabilizeGeminiSemanticVectors(
  a: GeminiSemanticVector,
  b: GeminiSemanticVector,
): GeminiSemanticVector {
  const fallback = defaultGeminiSemanticVector();
  const pickScalar = (x: string, y: string, fb: string): string => (x === y ? x : fb);
  const pickArray = (x: string[], y: string[], fb: string[]): string[] => {
    const intersection = x.filter(v => y.includes(v));
    if (intersection.length) return Array.from(new Set(intersection));
    const union = Array.from(new Set([...x, ...y]));
    return union.length ? union.slice(0, Math.max(1, fb.length)) : fb;
  };
  return {
    movement: pickScalar(a.movement, b.movement, fallback.movement) as "low" | "medium" | "high",
    energy: pickScalar(a.energy, b.energy, fallback.energy) as "low" | "medium" | "high",
    tempo: pickScalar(a.tempo, b.tempo, fallback.tempo) as "slow" | "medium" | "fast",
    groove: pickScalar(a.groove, b.groove, fallback.groove) as "low" | "medium" | "high",
    mood: pickArray(a.mood, b.mood, fallback.mood),
    texture: pickArray(a.texture, b.texture, fallback.texture),
    environment: pickArray(a.environment, b.environment, fallback.environment),
    vocal: pickArray(a.vocal, b.vocal, fallback.vocal),
  };
}

function buildGeminiSemanticParserPrompt(prompt: string): string {
  return [
    "You are a music semantic parser.",
    "",
    "Your job is to convert user natural language into structured music features.",
    "",
    "STRICT RULES:",
    "- Output JSON ONLY",
    "- No explanation, no extra text",
    "- Do NOT recommend songs",
    "- Do NOT mention artists or genres unless they are explicitly in the input",
    "- Do NOT guess unknown information",
    "- Always follow the exact schema",
    "",
    "OUTPUT SCHEMA:",
    "{",
    '  "movement": "low | medium | high",',
    '  "energy": "low | medium | high",',
    '  "tempo": "slow | medium | fast",',
    '  "groove": "low | medium | high",',
    '  "mood": [string],',
    '  "texture": [string],',
    '  "environment": [string],',
    '  "vocal": [string]',
    "}",
    "",
    "RULES:",
    "- All fields must be present",
    "- Arrays must not be empty (at least 1 value)",
    "- Use simple lowercase tokens",
    "- No duplicate values",
    "",
    "Normalization-friendly values:",
    "- movement: low, medium, high",
    "- energy: low, medium, high",
    "- tempo: slow, medium, fast",
    "- groove: low, medium, high",
    "- mood: bright, calm, dark, uplifting, melancholic, emotional, light, breezy, warm, cool, peaceful",
    "- texture: clean, airy, dense, soft, acoustic, electronic, ambient",
    "- environment: indoor, outdoor, road, nature, city",
    "- vocal: instrumental, soft, clear, strong",
    "",
    "If input is unclear, use neutral fallback:",
    "{",
    '  "movement": "medium",',
    '  "energy": "medium",',
    '  "tempo": "medium",',
    '  "groove": "medium",',
    '  "mood": ["neutral"],',
    '  "texture": ["clean"],',
    '  "environment": ["unknown"],',
    '  "vocal": ["clear"]',
    "}",
    "",
    "USER INPUT:",
    prompt.trim(),
    "",
    "OUTPUT:",
    "JSON ONLY",
  ].join("\n");
}

function normalizeGeminiLevel(value: string | undefined, fallback: number): number {
  const v = normalizeText(String(value ?? ""));
  if (v === "low") return 0.2;
  if (v === "medium" || v === "mid") return 0.5;
  if (v === "high") return 0.8;
  return fallback;
}

function expandDescriptorSeed(token: string): string[] {
  const t = normalizeText(token);
  if (!t) return [];
  if (t === "bright") return ["bright", "breezy", "light"];
  if (t === "calm") return ["calm", "soft", "stable"];
  if (t === "breezy") return ["breezy", "airy", "light"];
  if (t === "warm") return ["warm", "cozy", "soft"];
  if (t === "dynamic") return ["dynamic", "upbeat", "steady groove"];
  return [t];
}

function buildPromptFeatureBundleFromGemini(args: {
  semantic: GeminiSemanticVector;
  fallback: PromptFeatureBundle;
}): PromptFeatureBundle {
  const dedupTokens = (values: string[], limit: number): string[] =>
    Array.from(
      new Set(
        values
          .map(toEnglishQueryToken)
          .filter(Boolean),
      ),
    ).slice(0, limit);
  const movementLevel = normalizeGeminiLevel(args.semantic.movement, args.fallback.movementLevel);
  const energyLevel = normalizeGeminiLevel(args.semantic.energy, args.fallback.energyLevel);
  const tempoLevel =
    args.semantic.tempo === "slow" ? 0.2 : args.semantic.tempo === "fast" ? 0.8 : 0.5;
  const grooveRaw = normalizeGeminiLevel(args.semantic.groove, args.fallback.grooveLevel);
  const grooveLevel = Math.max(0, Math.min(1, grooveRaw * 0.6 + movementLevel * 0.2 + tempoLevel * 0.2));
  const energy: "low" | "mid" | "high" =
    energyLevel >= 0.67 ? "high" : energyLevel <= 0.34 ? "low" : "mid";
  const environment = dedupTokens(
    Array.from(new Set([...(args.semantic.environment ?? []), ...args.fallback.environment])),
    6,
  );
  const movement = dedupTokens(Array.from(
    new Set(
      args.semantic.environment
        .concat(args.semantic.mood)
        .flatMap(expandDescriptorSeed)
        .concat(args.fallback.movement),
    ),
  ), 4);
  const mood = dedupTokens(Array.from(
    new Set([...args.semantic.mood.flatMap(expandDescriptorSeed), ...args.fallback.mood]),
  ), 6);
  const texture = dedupTokens(Array.from(
    new Set([...args.semantic.texture.flatMap(expandDescriptorSeed), ...args.fallback.texture]),
  ), 6);
  const vocal = dedupTokens(Array.from(
    new Set([...args.semantic.vocal.flatMap(expandDescriptorSeed), ...args.fallback.vocal]),
  ), 5);
  const groove = dedupTokens(Array.from(
    new Set(
      [
        movementLevel >= 0.7 ? "driving groove" : movementLevel <= 0.3 ? "steady groove" : "mid groove",
        grooveLevel >= 0.7 ? "light bounce" : grooveLevel <= 0.35 ? "soft groove" : "smooth groove",
        tempoLevel >= 0.7 ? "fast tempo" : tempoLevel <= 0.35 ? "slow tempo" : "mid tempo",
        ...args.fallback.groove,
      ].flatMap(expandDescriptorSeed),
    ),
  ), 5);
  const aggression: "low" | "mid" | "high" = energyLevel <= 0.55 ? "low" : "mid";
  return {
    energy,
    energyLevel,
    movementLevel,
    tempoLevel,
    grooveLevel,
    environment,
    movement,
    groove,
    texture,
    vocal,
    mood,
    aggression,
  };
}

async function parsePromptFeatureBundleWithGemini(args: {
  prompt: string;
  intent: ParsedIntent;
  requestId?: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PromptFeatureBundle> {
  const fallback = buildPromptFeatureBundle(args.intent);
  const key = `semantic:${promptFingerprint(args.prompt)}`;
  const ttlMs = 10 * 60_000;
  const cached = geminiSemanticCache.get(key);
  if (cached && Date.now() - cached.cachedAt <= ttlMs) return cached.bundle;
  const inFlight = geminiSemanticInFlight.get(key);
  if (inFlight) return inFlight;

  const run = (async (): Promise<PromptFeatureBundle> => {
    try {
      assertNotCancelled(args.requestId, args.abortSignal, "gemini_semantic_start");
      const prompt = buildGeminiSemanticParserPrompt(args.prompt);
      const timeout = args.timeoutMs ?? 7000;
      const [rawA, rawB] = await Promise.all([
        callGeminiWithTimeout(prompt, timeout),
        callGeminiWithTimeout(prompt, timeout),
      ]);
      assertNotCancelled(args.requestId, args.abortSignal, "gemini_semantic_done");
      const jsonA = rawA as GeminiSemanticParseJson;
      const jsonB = rawB as GeminiSemanticParseJson;
      const normalizedA = canonicalizeGeminiSemanticVector(jsonA);
      const normalizedB = canonicalizeGeminiSemanticVector(jsonB);
      const diff = JSON.stringify(normalizedA) !== JSON.stringify(normalizedB);
      const stabilized = diff
        ? stabilizeGeminiSemanticVectors(normalizedA, normalizedB)
        : normalizedA;
      console.warn(
        `[GeminiSemantic] requestId=${args.requestId || "-"} rawA=${JSON.stringify(jsonA)} rawB=${JSON.stringify(jsonB)} normalizedA=${JSON.stringify(normalizedA)} normalizedB=${JSON.stringify(normalizedB)} diff=${diff}`,
      );
      const bundle = buildPromptFeatureBundleFromGemini({
        semantic: stabilized,
        fallback,
      });
      geminiSemanticCache.set(key, { bundle, cachedAt: Date.now() });
      geminiLastSemanticBundle = bundle;
      return bundle;
    } catch (err) {
      const message = safeErrorMessage(err).toLowerCase();
      if (geminiLastSemanticBundle && (message.includes("timed out") || message.includes("timeout"))) {
        console.warn("[GeminiSemantic] timeout fallback -> reusing last semantic bundle");
        return geminiLastSemanticBundle;
      }
      console.warn(`[GeminiSemantic] fallback: ${safeErrorMessage(err)}`);
      return fallback;
    }
  })();
  geminiSemanticInFlight.set(key, run);
  try {
    return await run;
  } finally {
    geminiSemanticInFlight.delete(key);
  }
}

function buildQueryBundles(intent: ParsedIntent, taste: TasteProfileSignals, repeat: RepeatSuppressionState): QueryBundles {
  const moodToken = intent.mood.primary[0] || intent.mood.secondary[0] || "calm";
  const vocalToken = intent.texture.vocal[0] ? toEnglishQueryToken(intent.texture.vocal[0]) : "vocal";
  const genreForTaste = Array.from(taste.genreTokens)
    .map(v => toEnglishQueryToken(v))
    .filter(v => MUSIC_QUERY_ANCHORS.includes(v))
    .slice(0, 6);
  const musicFeaturePool = Array.from(
    new Set(
      intent.queryTokens.musicContext
        .map(v => toEnglishQueryToken(v))
        .filter(v => v && !SCENE_SURFACE_TOKENS.has(v)),
    ),
  );
  const moodFeaturePool = Array.from(
    new Set(
      [...intent.mood.primary, ...intent.mood.secondary, ...intent.texture.emotional]
        .map(v => toEnglishQueryToken(v))
        .filter(v => v && !SCENE_SURFACE_TOKENS.has(v)),
    ),
  );
  const requestedAnchors = intent.genreIntent.requested
    .map(v => toEnglishQueryToken(v))
    .filter(v => MUSIC_QUERY_ANCHORS.includes(v));
  const anchorPool = Array.from(
    new Set([
      ...requestedAnchors,
      ...genreForTaste,
    ]),
  ).filter(Boolean);
  const safeAnchorPool = anchorPool.length
    ? anchorPool
    : ["k-pop", "korean rnb", "soul", "korean ost", "melodic hip hop"];
  const pickAnchor = (idx: number): string =>
    safeAnchorPool[idx % safeAnchorPool.length] || "k-pop";
  const pickFeature = (idx: number): string =>
    musicFeaturePool[idx % Math.max(1, musicFeaturePool.length)] ||
    moodFeaturePool[idx % Math.max(1, moodFeaturePool.length)] ||
    "acoustic";
  const anchored = (anchor: string, parts: string[]): string =>
    compactQueryTokens([anchor, ...parts.filter(Boolean)], 3, 4);
  const strictPrompt = Array.from(
    new Set(
      safeAnchorPool
        .slice(0, 8)
        .map((a, idx) => anchored(a, [vocalToken, idx % 2 ? moodToken : pickFeature(idx)]))
        .filter(Boolean),
    ),
  ).slice(0, 10);
  const semanticMood = Array.from(
    new Set(
      [
        anchored(pickAnchor(0), [pickFeature(0), moodToken]),
        anchored(pickAnchor(1), [intent.texture.sound[0] || "soft", pickFeature(1)]),
        anchored(pickAnchor(2), [intent.texture.emotional[0] || "cozy", pickFeature(2)]),
        anchored(pickAnchor(3), [intent.queryTokens.musicContext[0] || "vocal", intent.queryTokens.musicContext[1] || "acoustic"]),
      ].filter(Boolean),
    ),
  ).slice(0, 10);
  const tasteAnchored = Array.from(
    new Set(
      genreForTaste
        .slice(0, 8)
        .flatMap(genre => [
          anchored(genre, [vocalToken, moodToken]),
          anchored(genre, [intent.texture.sound[0] || "acoustic", pickFeature(3)]),
        ])
        .filter(Boolean),
    ),
  ).slice(0, 10);
  const explorationBoost = repeat.repeatedPrompt ? 2 : 0;
  const exploration = Array.from(
    new Set(
      [
        anchored(pickAnchor(4), ["hidden", pickFeature(4)]),
        anchored(pickAnchor(5), ["underrated", intent.texture.emotional[0] || "soft"]),
        anchored(pickAnchor(6), ["deep", moodToken]),
        anchored(pickAnchor(7), ["fresh", moodToken]),
      ]
        .filter(Boolean)
        .slice(0, 4 + explorationBoost),
    ),
  ).slice(0, 10);
  return { strictPrompt, semanticMood, tasteAnchored, exploration };
}

function buildStrictQueries(): never {
  throw new Error("LEGACY PIPELINE DISABLED");
}

function buildSemanticQueries(): never {
  throw new Error("LEGACY PIPELINE DISABLED");
}

function buildExplorationQueries(): never {
  throw new Error("LEGACY PIPELINE DISABLED");
}

function runGeminiFallback(): never {
  throw new Error("LEGACY PIPELINE DISABLED");
}

const SEARCH_RANKING_ONLY_TOKEN_SET = new Set([
  "outdoor",
  "walk",
  "sunny",
  "breezy",
  "airy",
  "warm",
  "clean",
]);

function normalizeSearchGenre(raw: string): string {
  const canonical = normalizeGenre(raw);
  if (!canonical) return normalizeText(raw);
  if (canonical === "k-pop") return "k-pop";
  if (canonical === "melodic-hip-hop") return "melodic hip hop";
  if (canonical === "hip-hop") return "korean hip hop";
  if (canonical === "indie") return "korean indie";
  if (canonical === "folk") return "korean folk";
  if (canonical === "ost") return "korean ost";
  if (canonical === "r&b") return "korean r&b";
  if (canonical === "soul") return "korean soul";
  const g = normalizeText(raw);
  if (!g) return "";
  return g;
}

function isInvalidSearchQuery(query: string): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  if (/genre:|outdoor|walk|breezy|airy|warm|clean/.test(q)) return true;
  if (q === "korean hip") return true;
  if (q === "melodic hip hop vocal") return true;
  if (/^korean\s+hip$/.test(q)) return true;
  return false;
}

function buildSearchIntent(
  intent: StructuredIntent,
): SearchIntent {
  const locale: SearchIntent["locale"] = intent.locale;
  const anchorGenres = [...intent.genres];
  const soundtrackHints = Array.from(
    new Set(
      [
        ...intent.genres.filter(g => g === "ost").map(g => String(g)),
        ...intent.specialTags.filter(tag => tag === "ost"),
      ],
    ),
  );
  const rankingOnlyTags = Array.from(
    new Set(
      [
        ...intent.mood,
        ...intent.activity,
        ...intent.environment,
      ]
        .map(v => normalizeText(v))
        .filter(Boolean)
        .filter(v => SEARCH_RANKING_ONLY_TOKEN_SET.has(v)),
    ),
  );
  const bannedTokens = Array.from(SEARCH_RANKING_ONLY_TOKEN_SET);
  const supportGenres: string[] = [];
  return {
    locale,
    anchorGenres,
    supportGenres,
    soundtrackHints,
    rankingOnlyTags,
    bannedTokens,
  };
}

function buildBucketPlan(intent: StructuredIntent): GenreBucketPlan {
  const minByGenre: Record<string, number> = {
    "k-pop": 12,
    "hip-hop": 10,
    "melodic-hip-hop": 10,
    indie: 10,
    folk: 8,
    ost: 8,
    "r&b": 10,
    soul: 8,
    "korean ost": 8,
  };
  const add = (arr: GenreBucket[], genre: string): void => {
    if (!genre) return;
    if (arr.some(v => v.genre === genre)) return;
    arr.push({ genre, min: minByGenre[genre] ?? 8 });
  };
  const buckets: GenreBucket[] = [];
  for (const g of intent.genres) add(buckets, g);
  if (intent.locale === "korean") add(buckets, "k-pop");
  if (
    intent.genres.some(g => /ost|영화음악|사운드트랙/.test(normalizeText(g))) ||
    intent.specialTags.some(tag => /ost|soundtrack/.test(normalizeText(tag)))
  ) {
    add(buckets, "korean ost");
  }
  if (!buckets.length) add(buckets, "k-pop");
  return { buckets };
}

function mapRawGenreToQueryGenre(raw: string): string {
  return normalizeSearchGenre(raw);
}

function buildBucketQueries(bucket: GenreBucket): {
  primary: string[];
  discovery: string[];
  recovery: string[];
} {
  const genre = mapRawGenreToQueryGenre(bucket.genre);
  const discoveryMap: Record<string, string[]> = {
    "k-pop": ["korean rnb"],
    "korean indie": ["k-indie acoustic"],
    "korean hip hop": ["korean mellow rap"],
    "korean folk": ["k-indie acoustic"],
    "korean ost": ["korean movie soundtrack"],
  };
  const recoveryMap: Record<string, string[]> = {
    "k-pop": ["k-pop playlist"],
    "korean indie": ["korean indie playlist"],
    "korean hip hop": ["korean playlist"],
    "korean folk": ["korean playlist"],
    "korean ost": ["korean playlist"],
  };
  const primary = [genre].filter(v => !isInvalidSearchQuery(v));
  const discovery = (discoveryMap[genre] ?? []).filter(v => !isInvalidSearchQuery(v));
  const recovery = (recoveryMap[genre] ?? ["korean playlist"]).filter(v => !isInvalidSearchQuery(v));
  return { primary, discovery, recovery };
}

function buildDynamicQueryStrategy(intent: StructuredIntent): DynamicQueryStrategy {
  const genres = intent.genres.length
    ? intent.genres.map(mapRawGenreToQueryGenre).filter(Boolean)
    : intent.locale === "korean"
      ? ["k-pop", "korean indie", "korean hip hop", "korean ost"]
      : ["global pop", "indie pop", "hip hop"];
  const primary = Array.from(new Set(genres))
    .filter(v => !isInvalidSearchQuery(v))
    .slice(0, 10);
  const discovery = Array.from(
    new Set(
      genres.flatMap(g => {
        if (g === "korean hip hop") return ["korean mellow rap", "korean rnb"];
        if (g === "korean indie") return ["k-indie acoustic", "acoustic korean indie"];
        if (g === "k-pop") return ["k-pop", "korean pop"];
        if (g === "korean ost") return ["korean movie soundtrack"];
        return [g];
      }),
    ),
  )
    .filter(v => !isInvalidSearchQuery(v))
    .slice(0, 10);
  if (intent.styles.includes("melodic")) discovery.push("melodic hip hop");
  if (intent.styles.includes("rap")) discovery.push("hard rap");
  const recovery = Array.from(
    new Set(
      [
        intent.locale === "korean" ? "korean playlist" : "global pop",
        "k-pop playlist",
        "korean indie playlist",
        ...genres.map(g => `${g} playlist`),
      ],
    ),
  )
    .map(v => v.replace(/\s+/g, " ").trim())
    .filter(v => !isInvalidSearchQuery(v))
    .slice(0, 10);
  return { primary, discovery, recovery };
}

function scaleBuckets(
  intent: StructuredIntent,
  durationMin: number | null,
  bucketPlan: GenreBucketPlan,
): GenreBucketPlan {
  const total = (durationMin ?? intent.durationMin) >= 120 ? 50 : 30;
  const multiplier = (durationMin ?? intent.durationMin) >= 180 ? 2.0 : (durationMin ?? intent.durationMin) >= 120 ? 1.5 : 1.0;
  const targetTotal = Math.max(20, Math.round(total * multiplier));
  const fallbackWeight = bucketPlan.buckets.length ? 1 / bucketPlan.buckets.length : 1;
  return {
    buckets: bucketPlan.buckets.map(bucket => ({
      genre: bucket.genre,
      min: Math.max(
        6,
        Math.max(
          bucket.min,
          Math.floor((intent.genreWeights[bucket.genre] ?? intent.genreWeights[normalizeText(bucket.genre)] ?? fallbackWeight) * targetTotal),
        ),
      ),
    })),
  };
}

function relaxQuery(query: string, level: number): string {
  const q = String(query ?? "").replace(/\s+/g, " ").trim();
  if (!q) return "";
  if (level <= 1) {
    return q
      .replace(/\b(bright|sunny|breezy|airy|warm|clean|soft|light)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (level === 2) {
    const n = normalizeText(q);
    if (/korean mellow rap|melodic hip hop/.test(n)) return "korean hip hop";
    if (/k-indie acoustic|acoustic korean indie/.test(n)) return "korean indie";
    return q;
  }
  return /korean|k-pop|kpop|한국|국내/.test(normalizeText(q)) ? "korean playlist" : "global pop";
}

function composeFinalPlaylist(candidates: SpotifyTrackSummary[], intent: StructuredIntent): SpotifyTrackSummary[] {
  if (!candidates.length) return [];
  const keyOf = (t: SpotifyTrackSummary): string => trackDedupKey(t) ?? `${t.name}|${t.artists?.[0]?.name ?? "-"}`;
  const artistKey = (t: SpotifyTrackSummary): string => normalizeText(String(t.artists?.[0]?.name ?? ""));
  const genreKey = (t: SpotifyTrackSummary): string => normalizeText(String(t.genres?.[0] ?? "unknown"));
  const groupByGenre = new Map<string, SpotifyTrackSummary[]>();
  const intentGenresMapped = intent.genres.map(mapRawGenreToQueryGenre).filter(Boolean);
  for (const track of candidates) {
    const text = normalizeText(`${track.name} ${(track.genres ?? []).join(" ")}`);
    const match = intentGenresMapped.find(g => text.includes(normalizeText(g))) ?? genreKey(track);
    const list = groupByGenre.get(match) ?? [];
    list.push(track);
    groupByGenre.set(match, list);
  }
  const orderedGenres = intentGenresMapped.length ? intentGenresMapped : Array.from(groupByGenre.keys());
  let composed: SpotifyTrackSummary[] = [];
  if (intent.mixStrategy === "sequential") {
    for (const genre of orderedGenres) {
      composed.push(...(groupByGenre.get(genre) ?? []));
    }
  } else if (intent.mixStrategy === "blend") {
    const weightedGenres = orderedGenres
      .map(genre => ({
        genre,
        quota: Math.max(
          1,
          Math.round(
            ((intent.genreWeights[genre] ?? intent.genreWeights[normalizeText(genre)] ?? (1 / Math.max(1, orderedGenres.length))) * candidates.length),
          ),
        ),
      }))
      .sort((a, b) => b.quota - a.quota);
    const buckets = new Map<string, SpotifyTrackSummary[]>();
    weightedGenres.forEach(v => buckets.set(v.genre, [...(groupByGenre.get(v.genre) ?? [])]));
    while (Array.from(buckets.values()).some(bucket => bucket.length > 0)) {
      for (const wg of weightedGenres) {
        const bucket = buckets.get(wg.genre) ?? [];
        const takeN = Math.max(1, Math.round(wg.quota / Math.max(1, candidates.length / 10)));
        for (let i = 0; i < takeN; i += 1) {
          const next = bucket.shift();
          if (!next) break;
          composed.push(next);
        }
      }
    }
  } else {
    composed = [...candidates];
  }
  const deduped: SpotifyTrackSummary[] = [];
  const seen = new Set<string>();
  const artistCount = new Map<string, number>();
  let lastGenre = "";
  let sameGenreStreak = 0;
  for (const track of composed) {
    const k = keyOf(track);
    if (!k || seen.has(k)) continue;
    const a = artistKey(track);
    if ((artistCount.get(a) ?? 0) >= 2) continue;
    const g = genreKey(track);
    const nextStreak = g === lastGenre ? sameGenreStreak + 1 : 1;
    if (nextStreak > 3) continue;
    seen.add(k);
    deduped.push(track);
    artistCount.set(a, (artistCount.get(a) ?? 0) + 1);
    lastGenre = g;
    sameGenreStreak = nextStreak;
  }
  let ensured = [...deduped];
  if (ensured.length === 0) {
    console.warn("[Composition] fallback: using top reranked tracks");
    ensured = candidates.slice(0, 30);
  }
  const MIN_TRACKS = 25;
  if (ensured.length < MIN_TRACKS) {
    console.warn("[Composition] expanding selection to minimum");
    ensured = mergeUniqueTracks(ensured, candidates.slice(0, 40));
  }
  ensured = expandWithGenreBalance(ensured, candidates, intent);
  console.warn("[CompositionDebug]", {
    rerankedCount: candidates.length,
    selectedCount: ensured.length,
  });
  const sortedByEnergy = [...ensured].sort((a, b) => estimateTrackEnergy(a) - estimateTrackEnergy(b));
  const n = sortedByEnergy.length;
  if (n < 8) return sortedByEnergy;
  const q = Math.max(1, Math.floor(n / 4));
  const start = sortedByEnergy.slice(0, q);
  const mid = sortedByEnergy.slice(q, q * 2);
  const peak = sortedByEnergy.slice(q * 2, q * 3).sort((a, b) => estimateTrackEnergy(b) - estimateTrackEnergy(a));
  const cool = sortedByEnergy.slice(q * 3);
  return [...start, ...mid, ...peak, ...cool];
}

function expandWithGenreBalance(
  selected: SpotifyTrackSummary[],
  reranked: SpotifyTrackSummary[],
  _intent: StructuredIntent,
): SpotifyTrackSummary[] {
  const buckets = {
    kpop: [] as SpotifyTrackSummary[],
    ost: [] as SpotifyTrackSummary[],
    rnb: [] as SpotifyTrackSummary[],
    hiphop: [] as SpotifyTrackSummary[],
    indie: [] as SpotifyTrackSummary[],
  };

  for (const t of reranked) {
    const text = normalizeText(
      `${t.name} ${(t.genres ?? []).join(" ")} ${(t.artists ?? []).map(a => a.name).join(" ")}`,
    );
    if (/k-pop|korean pop|kpop|케이팝/.test(text)) buckets.kpop.push(t);
    else if (/ost|soundtrack|movie soundtrack|영화음악|사운드트랙/.test(text)) buckets.ost.push(t);
    else if (/r&b|rnb|soul|알앤비|소울/.test(text)) buckets.rnb.push(t);
    else if (/hip hop|hip-hop|rap|힙합|랩/.test(text)) buckets.hiphop.push(t);
    else buckets.indie.push(t);
  }

  return mergeUniqueTracks(
    selected,
    buckets.kpop.slice(0, 6),
    buckets.ost.slice(0, 5),
    buckets.rnb.slice(0, 6),
    buckets.hiphop.slice(0, 5),
    buckets.indie.slice(0, 6),
  );
}

function mergeAndRank(
  tracks: SpotifyTrackSummary[],
  scored: Array<{ track: SpotifyTrackSummary; finalScore: number }>,
): SpotifyTrackSummary[] {
  const seen = new Set<string>();
  const scoreByKey = new Map(
    scored
      .map(item => [trackDedupKey(item.track) ?? "", item.finalScore] as const)
      .filter(([k]) => Boolean(k)),
  );
  return [...tracks]
    .sort((a, b) => (scoreByKey.get(trackDedupKey(b) ?? "") ?? 0) - (scoreByKey.get(trackDedupKey(a) ?? "") ?? 0))
    .filter(track => {
      const key = trackDedupKey(track) ?? "";
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function rankFlexibleGenres(
  flexible: CanonicalGenre[],
  intent: StructuredIntent,
  base?: BasePromptFeatures | null,
): CanonicalGenre[] {
  const baseSet = new Set(
    (base?.requestedGenres ?? [])
      .map(v => normalizeGenre(v))
      .filter((v): v is CanonicalGenre => Boolean(v)),
  );
  const specialTags = new Set(intent.specialTags ?? []);
  const scores: Record<string, number> = {};
  for (const g of flexible) {
    let score = 1;
    if (baseSet.has(g)) score += 3;
    if (intent.locale === "korean" && (g === "k-pop" || g === "melodic-hip-hop")) score += 2;
    if (g === "ost") score += specialTags.has("ost") ? 4 : 2;
    if (g === "melodic-hip-hop") score += 2;
    if (g === "hip-hop" || g === "indie" || g === "folk" || g === "r&b" || g === "soul") score += 1;
    scores[g] = score;
  }
  return [...flexible].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
}

function rankGenresByImportance(
  intent: StructuredIntent,
  base?: BasePromptFeatures | null,
  prompt?: string,
): CanonicalGenre[] {
  const forcedGenres = extractForcedGenresFromPrompt(String(prompt ?? ""));
  const locked = Array.from(new Set<CanonicalGenre>([...intent.locked.genres, ...forcedGenres]));
  const lockedSet = new Set(locked);
  const flexible = intent.genres.filter(g => !lockedSet.has(g));
  return [...locked, ...rankFlexibleGenres(flexible, intent, base)];
}

function selectCoreGenres(
  intent: StructuredIntent,
  base?: BasePromptFeatures | null,
  prompt?: string,
): CanonicalGenre[] {
  const locked = Array.from(new Set(intent.locked.genres ?? []));
  const flexible = (intent.genres ?? []).filter(g => !locked.includes(g));
  const rankedFlexible = rankFlexibleGenres(flexible, intent, base);
  const result: CanonicalGenre[] = [...locked, ...rankedFlexible.slice(0, 2)];
  if (prompt) {
    for (const g of extractForcedGenresFromPrompt(prompt)) {
      if (!result.includes(g)) result.unshift(g);
    }
  }
  const selected = Array.from(new Set(result));
  console.warn(`[CoreGenres] locked=${JSON.stringify(locked)}`);
  console.warn(`[CoreGenres] flexible=${JSON.stringify(flexible)}`);
  console.warn(`[CoreGenres] selected=${JSON.stringify(selected)}`);
  return selected;
}

function normalizeQueryKey(q: string): string {
  return String(q ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function withLocale(locale: "korean" | "global", text: string): string {
  const compact = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const prefix = locale === "korean" ? "korean" : "global";
  if (compact.toLowerCase().startsWith(`${prefix} `) || compact.toLowerCase() === prefix) {
    return compact;
  }
  return `${prefix} ${compact}`.replace(/\s+/g, " ").trim();
}

type QueryStrategyPlan = {
  buckets?: {
    kpop: string[];
    ost: string[];
    rnbSoul: string[];
    melodicHipHop: string[];
    indieFolk: string[];
  };
  lockedQueries: string[];
  flexibleQueries: string[];
  finalQueries: string[];
};

function buildQueryStrategy(intent: StructuredIntent): QueryStrategyPlan {
  const lockedQueries: string[] = [];
  const flexibleQueries: string[] = [];
  const lockedGenreSet = new Set(intent.locked.genres ?? []);
  const lockedTagSet = new Set(intent.locked.specialTags ?? []);

  if (lockedGenreSet.has("k-pop")) {
    lockedQueries.push("korean k-pop", "korean k-pop playlist");
  }
  if (lockedGenreSet.has("ost") || lockedTagSet.has("ost")) {
    lockedQueries.push(
      "korean ost",
      "korean soundtrack",
      "korean movie soundtrack",
      "korean ost playlist",
    );
  }
  if (lockedGenreSet.has("melodic-hip-hop")) {
    lockedQueries.push("korean melodic hip hop", "korean melodic hip hop playlist");
  }
  if (lockedGenreSet.has("melodic-hip-hop") || lockedGenreSet.has("hip-hop")) {
    lockedQueries.push("korean melodic hip hop", "korean hip hop playlist");
  }
  if (lockedGenreSet.has("r&b") || lockedGenreSet.has("soul")) {
    lockedQueries.push("korean r&b", "korean soul", "korean r&b soul playlist");
  }
  if (lockedGenreSet.has("indie") || lockedGenreSet.has("folk")) {
    lockedQueries.push("korean indie", "korean folk", "korean indie playlist");
  }

  for (const g of intent.genres ?? []) {
    const queryGenre = mapRawGenreToQueryGenre(g);
    if (!queryGenre) continue;
    flexibleQueries.push(withLocale(intent.locale, queryGenre));
    flexibleQueries.push(withLocale(intent.locale, `${queryGenre} playlist`));
  }

  const buckets = {
    kpop: lockedGenreSet.has("k-pop")
      ? ["korean k-pop", "korean k-pop playlist"]
      : [],
    ost:
      lockedGenreSet.has("ost") || lockedTagSet.has("ost")
        ? ["korean ost", "korean soundtrack", "korean movie soundtrack", "korean ost playlist"]
        : [],
    rnbSoul:
      lockedGenreSet.has("r&b") || lockedGenreSet.has("soul")
        ? ["korean r&b", "korean soul", "korean r&b soul playlist"]
        : [],
    melodicHipHop:
      lockedGenreSet.has("melodic-hip-hop") || lockedGenreSet.has("hip-hop")
        ? ["korean melodic hip hop", "korean melodic hip hop playlist", "korean hip hop playlist"]
        : [],
    indieFolk:
      lockedGenreSet.has("indie") || lockedGenreSet.has("folk")
        ? ["korean indie", "korean folk", "korean indie playlist", "korean folk playlist"]
        : [],
  };
  const vibeQueries = (() => {
    const moodText = normalizeText((intent.mood ?? []).join(" "));
    const activityText = normalizeText((intent.activity ?? []).join(" "));
    const envText = normalizeText((intent.environment ?? []).join(" "));
    const out: string[] = [];
    if (/warm|cozy|따뜻|포근/.test(moodText)) out.push("warm acoustic korean indie");
    if (/emotional|감성|잔잔|soft/.test(moodText)) out.push("emotional korean ost acoustic");
    if (/night|새벽|야간/.test(moodText) || /night|새벽|야간/.test(envText)) out.push("night walk korean acoustic");
    if (/work|study|focus|작업|공부/.test(activityText)) out.push("soft korean r&b soul");
    if (!out.length) out.push("warm acoustic korean indie", "soft korean r&b soul");
    return out.slice(0, 4);
  })();
  const rawQueries = [
    ...buckets.kpop.slice(0, 2),
    ...buckets.ost.slice(0, 3),
    ...buckets.rnbSoul.slice(0, 2),
    ...buckets.melodicHipHop.slice(0, 2),
    ...buckets.indieFolk.slice(0, 2),
    ...vibeQueries,
    ...lockedQueries,
    ...flexibleQueries,
  ].filter(v => !isInvalidSearchQuery(v));
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const q of rawQueries) {
    const key = normalizeQueryKey(q);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(q);
  }
  const finalQueries = deduped.slice(0, 12);
  console.warn(`[QueryStrategy] lockedQueries=${JSON.stringify(Array.from(new Set(lockedQueries)))}`);
  console.warn(`[QueryStrategy] flexibleQueries=${JSON.stringify(Array.from(new Set(flexibleQueries)))}`);
  console.warn(`[QueryStrategy] finalQueries=${JSON.stringify(finalQueries)}`);
  console.warn(`[QueryStrategy] queryCountBeforeDedupe=${rawQueries.length}`);
  console.warn(`[QueryStrategy] queryCountAfterDedupe=${finalQueries.length}`);
  return {
    buckets,
    lockedQueries: Array.from(new Set(lockedQueries)),
    flexibleQueries: Array.from(new Set(flexibleQueries)),
    finalQueries,
  };
}

const MAX_SPOTIFY_CALLS = 8;
const FAST_QUERY_BUDGET_MS = 9000;
const FAST_TOTAL_BUDGET_MS = 20000;
const MIN_DISPATCHED_QUERIES = 4;

function appendPartialResults(
  requestId: string | undefined,
  query: string,
  tracks: SpotifyTrackSummary[],
): void {
  if (!requestId || !tracks.length) return;
  const prevTracks = partialSearchResultsByRequestId.get(requestId) ?? [];
  const mergedTracks = mergeUniqueTracks(prevTracks, tracks);
  partialSearchResultsByRequestId.set(requestId, mergedTracks);
  const prevQueries = partialSearchQueryHitsByRequestId.get(requestId) ?? [];
  if (!prevQueries.includes(query)) {
    partialSearchQueryHitsByRequestId.set(requestId, [...prevQueries, query]);
  }
  console.warn("[APPEND SUCCESS]", {
    requestId,
    query,
    added: tracks.length,
    poolSize: mergedTracks.length,
  });
}

function readPartialPool(requestId?: string): SpotifyTrackSummary[] {
  const key = String(requestId ?? "").trim();
  const pool = key ? partialSearchResultsByRequestId.get(key) ?? [] : [];
  console.warn("[READ PARTIAL POOL]", {
    requestId: key || requestId || "",
    poolSize: pool.length,
    keys: Array.from(partialSearchResultsByRequestId.keys()),
  });
  return pool;
}

function clearPartialPool(requestId?: string): void {
  if (!requestId) return;
  partialSearchResultsByRequestId.delete(requestId);
  partialSearchQueryHitsByRequestId.delete(requestId);
  forcedIntentSnapshotByRequestId.delete(requestId);
}

function buildOnTracksCollector(requestId?: string) {
  const initialKey = String(requestId ?? "").trim();
  return (event: {
    requestId?: string;
    query: string;
    tracks: SpotifyTrackSummary[];
  }): void => {
    if (!event?.query || !event?.tracks?.length) return;
    const key = String(initialKey || event.requestId || "").trim();
    if (!key) return;
    querySearchCache.set(normalizeQueryKey(event.query), event.tracks.slice(0, 40));
    appendPartialResults(key, event.query, event.tracks);
    const prev = candidateCacheByRequestId.get(key) ?? [];
    candidateCacheByRequestId.set(key, mergeUniqueTracks(prev, event.tracks).slice(0, 250));
    console.warn("[COLLECTOR STORED]", {
      requestId: key,
      query: event.query,
      added: event.tracks.length,
    });
  };
}

async function safeSearch(args: {
  query: string;
  accessToken: string;
  requestId?: string;
  abortSignal?: AbortSignal;
  randomSeed: number;
  callState: { count: number };
  onTracks?: (event: {
    requestId?: string;
    query: string;
    queryIndex: number;
    queryTotal: number;
    tracks: SpotifyTrackSummary[];
    totalCollected: number;
  }) => void;
}): Promise<SpotifyTrackSummary[]> {
  if (args.callState.count >= MAX_SPOTIFY_CALLS) return [];
  args.callState.count += 1;
  const result = await searchSpotifyTracksByQueries({
    accessToken: args.accessToken,
    queries: [args.query],
    perQueryLimit: 18,
    randomSeed: args.randomSeed + args.callState.count * 13,
    concurrency: 1,
    maxDurationMs: FAST_QUERY_BUDGET_MS,
    requestId: args.requestId,
    abortSignal: args.abortSignal,
    onTracks: args.onTracks,
  }).catch(() => [] as SpotifyTrackSummary[]);
  if (result.length) {
    querySearchCache.set(normalizeQueryKey(args.query), result.slice(0, 40));
  }
  return result;
}

async function dispatchQueries(args: {
  queries: string[];
  accessToken: string;
  requestId?: string;
  abortSignal?: AbortSignal;
  randomSeed: number;
  seedGenresHint?: string[];
  targetEnergy?: number;
  targetValence?: number;
  targetAcousticness?: number;
}): Promise<{ tracks: SpotifyTrackSummary[]; callCount: number; dispatchedQueries: string[] }> {
  const normalizedQueries: string[] = [];
  const seen = new Set<string>();
  for (const q of args.queries) {
    const key = normalizeQueryKey(q);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalizedQueries.push(q);
  }
  const minFill =
    normalizedQueries.length >= MIN_DISPATCHED_QUERIES
      ? []
      : ["korean k-pop", "korean ost", "korean r&b", "korean hip hop playlist"];
  for (const q of minFill) {
    if (normalizedQueries.length >= MIN_DISPATCHED_QUERIES) break;
    const key = normalizeQueryKey(q);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalizedQueries.push(q);
  }
  const searchBackoff = getSpotifySearchBackoffSnapshot();
  const inLimitedMode = searchBackoff.limited;
  const guaranteedBudget = inLimitedMode ? Math.min(2, MIN_DISPATCHED_QUERIES) : MIN_DISPATCHED_QUERIES;
  const guaranteedQueries = normalizedQueries.slice(0, guaranteedBudget);
  const optionalQueries = inLimitedMode
    ? []
    : normalizedQueries.slice(guaranteedBudget);
  if (inLimitedMode) {
    console.warn(
      `[SpotifyDispatch] limited mode active cooldownMs=${searchBackoff.cooldownMs} strike=${searchBackoff.strike} guaranteed=${guaranteedQueries.length} optional=0`,
    );
  }
  console.warn(`[SpotifyDispatch] guaranteedCount=${guaranteedQueries.length}`);
  console.warn(`[SpotifyDispatch] optionalCount=${optionalQueries.length}`);
  let effectiveOptionalQueries = [...optionalQueries];
  let dispatchPlan = [...guaranteedQueries, ...effectiveOptionalQueries].slice(
    0,
    Math.max(guaranteedQueries.length, normalizedQueries.length),
  );
  console.warn("[Dispatch]", dispatchPlan);
  let callCount = 0;
  const phaseOnTracks = (event: {
    requestId?: string;
    query: string;
    tracks: SpotifyTrackSummary[];
  }) => {
    if (event?.query && event?.tracks?.length) {
      querySearchCache.set(normalizeQueryKey(event.query), event.tracks.slice(0, 40));
      const key = String(args.requestId ?? "").trim();
      if (key) {
        const prev = candidateCacheByRequestId.get(key) ?? [];
        const merged = mergeUniqueTracks(prev, event.tracks);
        candidateCacheByRequestId.set(key, merged.slice(0, 200));
        appendPartialResults(key, event.query, event.tracks);
      }
    }
  };
  const guaranteedTracks = await searchSpotifyTracksByQueries({
    accessToken: args.accessToken,
    queries: guaranteedQueries,
    perQueryLimit: 14,
    concurrency: 3,
    maxDurationMs: Math.max(8000, Math.min(12000, FAST_TOTAL_BUDGET_MS)),
    randomSeed: args.randomSeed,
    requestId: args.requestId,
    abortSignal: undefined,
    onTracks: phaseOnTracks,
    onQueryDone: () => {
      callCount += 1;
    },
  }).catch(() => [] as SpotifyTrackSummary[]);
  const backoffAfterGuaranteed = getSpotifySearchBackoffSnapshot();
  if (effectiveOptionalQueries.length && backoffAfterGuaranteed.limited) {
    console.warn(
      `[SpotifyDispatch] optional skipped after guaranteed cooldownMs=${backoffAfterGuaranteed.cooldownMs} strike=${backoffAfterGuaranteed.strike}`,
    );
    effectiveOptionalQueries = [];
    dispatchPlan = [...guaranteedQueries];
  }
  const optionalTracks =
    effectiveOptionalQueries.length > 0
      ? await searchSpotifyTracksByQueries({
          accessToken: args.accessToken,
          queries: effectiveOptionalQueries,
          perQueryLimit: 12,
          concurrency: 2,
          maxDurationMs: Math.max(7000, Math.min(11000, FAST_TOTAL_BUDGET_MS)),
          randomSeed: args.randomSeed + 97,
          requestId: args.requestId,
          abortSignal: undefined,
          onTracks: phaseOnTracks,
          onQueryDone: () => {
            callCount += 1;
          },
        }).catch(() => [] as SpotifyTrackSummary[])
      : [];
  const tracks = mergeUniqueTracks(guaranteedTracks, optionalTracks);
  const limitedBackoff = getSpotifySearchBackoffSnapshot();
  const recommendationRescue =
    !tracks.length && limitedBackoff.limited
      ? await getSpotifyRecommendations({
          accessToken: args.accessToken,
          seedGenres: Array.from(
            new Set(
              (args.seedGenresHint ?? [])
                .map(normalizeSpotifySeedGenre)
                .filter(Boolean),
            ),
          ).slice(0, 2),
          targetEnergy: Number.isFinite(args.targetEnergy) ? args.targetEnergy : undefined,
          targetValence: Number.isFinite(args.targetValence) ? args.targetValence : undefined,
          targetAcousticness: Number.isFinite(args.targetAcousticness)
            ? args.targetAcousticness
            : undefined,
          limit: 30,
        }).catch(() => [] as SpotifyTrackSummary[])
      : [];
  const mergedTracks = mergeUniqueTracks(tracks, recommendationRescue);
  if (recommendationRescue.length) {
    console.warn(
      `[SpotifyDispatch] recommendations rescue used size=${recommendationRescue.length} cooldownMs=${limitedBackoff.cooldownMs} strike=${limitedBackoff.strike}`,
    );
  }
  const cacheKey = String(args.requestId ?? "").trim();
  if (cacheKey && mergedTracks.length) {
    appendPartialResults(cacheKey, "__final_batch__", mergedTracks);
  }
  console.warn(`[SpotifyDispatch] dispatchedCount=${dispatchPlan.length}`);
  return {
    tracks: mergeUniqueTracks(mergedTracks),
    callCount,
    dispatchedQueries: dispatchPlan,
  };
}

function scoreTrackStable(track: SpotifyTrackSummary, intent: StructuredIntent, querySource = ""): number {
  let score = 0;
  if (querySource.includes("playlist")) score += 0.4;
  const text = normalizeText(`${track.name} ${(track.genres ?? []).join(" ")}`);
  if (intent.genres.some(g => text.includes(normalizeText(g)))) score += 0.3;
  score += seededUnit(911, `${trackDedupKey(track) ?? track.name}|${querySource}`) * 0.3;
  return score;
}

function buildTrackText(track: SpotifyTrackSummary): string {
  return normalizeText(
    [
      track.name,
      ...(track.artists ?? []).map(a => a.name),
      ...(track.genres ?? []),
      track.album?.name ?? "",
    ].join(" "),
  );
}

function rerankTracks(tracks: SpotifyTrackSummary[], intent: StructuredIntent): SpotifyTrackSummary[] {
  const locked = new Set(intent.locked.genres ?? []);
  return tracks
    .map(track => {
      const text = buildTrackText(track);
      let score = 0;
      if (locked.has("k-pop") && /k-pop|k pop|korean|케이팝|아이돌/.test(text)) score += 2;
      if (locked.has("ost") && /ost|soundtrack|영화음악|사운드트랙/.test(text)) score += 2;
      if (locked.has("r&b") && /rnb|r&b|알앤비/.test(text)) score += 2;
      if (locked.has("soul") && /soul|소울/.test(text)) score += 2;
      if ((locked.has("hip-hop") || locked.has("melodic-hip-hop")) && /hip hop|hip-hop|rap|힙합|랩/.test(text)) score += 1;
      if (locked.has("indie") && /indie|인디/.test(text)) score += 1;
      if (locked.has("folk") && /folk|포크|acoustic|어쿠스틱/.test(text)) score += 1;
      if (/korean|k-pop|한국|국내/.test(text)) score += 1;
      return { track, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(v => v.track);
}

function applyGenreQuota(tracks: SpotifyTrackSummary[], intent: StructuredIntent): SpotifyTrackSummary[] {
  const result: SpotifyTrackSummary[] = [];
  const buckets = {
    kpop: [] as SpotifyTrackSummary[],
    ost: [] as SpotifyTrackSummary[],
    rnb: [] as SpotifyTrackSummary[],
    hiphop: [] as SpotifyTrackSummary[],
    indie: [] as SpotifyTrackSummary[],
  };
  const seen = new Set<string>();
  for (const t of tracks) {
    const key = trackDedupKey(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const text = buildTrackText(t);
    if (/k-pop|k pop|korean|케이팝|아이돌/.test(text)) buckets.kpop.push(t);
    else if (/ost|soundtrack|영화음악|사운드트랙/.test(text)) buckets.ost.push(t);
    else if (/rnb|r&b|soul|알앤비|소울/.test(text)) buckets.rnb.push(t);
    else if (/hip hop|hip-hop|rap|힙합|랩/.test(text)) buckets.hiphop.push(t);
    else buckets.indie.push(t);
  }
  result.push(
    ...buckets.kpop.slice(0, 6),
    ...buckets.ost.slice(0, 4),
    ...buckets.rnb.slice(0, 6),
    ...buckets.hiphop.slice(0, 5),
    ...buckets.indie.slice(0, 9),
  );
  if (!result.length) return tracks.slice(0, 30);
  return mergeUniqueTracks(result).slice(0, 30);
}

function rankTracksStable(tracks: SpotifyTrackSummary[], intent: StructuredIntent): SpotifyTrackSummary[] {
  return tracks
    .map(t => ({
      track: t,
      score: scoreTrackStable(t, intent),
    }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.track);
}

function composeStable(tracks: SpotifyTrackSummary[], intent: StructuredIntent): SpotifyTrackSummary[] {
  if (intent.mixStrategy !== "blend") return tracks;
  const keyed = tracks.map(t => ({ t, key: stableHash(trackDedupKey(t) ?? t.name ?? "") }));
  keyed.sort((a, b) => a.key - b.key);
  return keyed.map(v => v.t);
}

async function fallbackToGlobalPopular(args: {
  accessToken: string;
  requestId?: string;
  abortSignal?: AbortSignal;
  randomSeed: number;
  maxDurationMs: number;
}): Promise<SpotifyTrackSummary[]> {
  const queries = ["k-pop hits", "global pop", "top spotify playlist"];
  return searchSpotifyTracksByQueries({
    accessToken: args.accessToken,
    queries,
    perQueryLimit: 25,
    randomSeed: args.randomSeed + 1401,
    concurrency: 2,
    maxDurationMs: Math.max(900, Math.min(3200, args.maxDurationMs)),
    requestId: args.requestId,
    abortSignal: args.abortSignal,
    onTracks: event => buildOnTracksCollector(args.requestId)({
      query: event.query,
      tracks: event.tracks,
    }),
  }).catch(() => [] as SpotifyTrackSummary[]);
}

function buildPlaylistFallbackQueries(searchIntent: SearchIntent): string[] {
  return Array.from(
    new Set(
      searchIntent.anchorGenres.map(g => `${mapRawGenreToQueryGenre(g)} playlist`),
    ),
  )
    .map(v => v.replace(/\s+/g, " ").trim())
    .filter(v => !isInvalidSearchQuery(v))
    .slice(0, 10);
}

function buildArtistFallbackQueries(searchIntent: SearchIntent): string[] {
  const map: Record<string, string[]> = {
    "k-pop": ["newjeans", "ive", "aespa"],
    "korean indie": ["검정치마", "혁오", "잔나비"],
    "korean hip hop": ["zico", "be'o", "ash island"],
    "melodic hip hop": ["be'o", "ph-1", "loco"],
    "korean folk": ["아이유 포크", "akmu", "윤하"],
    "korean ost": ["도깨비 ost", "호텔 델루나 ost", "사랑의 불시착 ost"],
  };
  const out = new Set<string>();
  for (const g of searchIntent.anchorGenres) {
    for (const q of map[mapRawGenreToQueryGenre(g)] ?? []) {
      if (isInvalidSearchQuery(q)) continue;
      out.add(q);
      if (out.size >= 10) break;
    }
    if (out.size >= 10) break;
  }
  return Array.from(out);
}

async function recoverFromEmptySearch(args: {
  accessToken: string;
  bucketPlan: GenreBucketPlan;
  searchIntent: SearchIntent;
  requestId?: string;
  abortSignal?: AbortSignal;
  randomSeed: number;
  maxDurationMs: number;
}): Promise<{
  tracks: SpotifyTrackSummary[];
  stage: "discovery" | "recovery" | "playlist" | "artist" | "none";
}> {
  const discoveryQueries = Array.from(
    new Set(args.bucketPlan.buckets.flatMap(bucket => buildBucketQueries(bucket).discovery)),
  ).slice(0, 10);
  const recoveryQueries = Array.from(
    new Set(args.bucketPlan.buckets.flatMap(bucket => buildBucketQueries(bucket).recovery)),
  ).slice(0, 10);
  const playlistFallback = buildPlaylistFallbackQueries(args.searchIntent);
  const artistFallback = buildArtistFallbackQueries(args.searchIntent);
  const run = async (queries: string[], seedOffset: number): Promise<SpotifyTrackSummary[]> => {
    if (!queries.length) return [];
    return searchSpotifyTracksByQueries({
      accessToken: args.accessToken,
      queries,
      perQueryLimit: 24,
      randomSeed: args.randomSeed + seedOffset,
      concurrency: 2,
      maxDurationMs: Math.max(900, Math.min(3200, args.maxDurationMs)),
      requestId: args.requestId,
      abortSignal: args.abortSignal,
      onTracks: event => buildOnTracksCollector(args.requestId)({
        query: event.query,
        tracks: event.tracks,
      }),
    }).catch(() => [] as SpotifyTrackSummary[]);
  };
  const discovery = await run(discoveryQueries, 101);
  if (discovery.length) return { tracks: discovery, stage: "discovery" };
  const recovery = await run(recoveryQueries, 211);
  if (recovery.length) return { tracks: recovery, stage: "recovery" };
  const playlist = await run(playlistFallback, 307);
  if (playlist.length) return { tracks: playlist, stage: "playlist" };
  const artist = await run(artistFallback, 401);
  if (artist.length) return { tracks: artist, stage: "artist" };
  return { tracks: [], stage: "none" };
}

async function collectCandidates(args: {
  accessToken: string;
  bucketPlan: GenreBucketPlan;
  searchIntent: SearchIntent;
  queryStrategy: DynamicQueryStrategy;
  targetMinutes: number;
  requestId?: string;
  abortSignal?: AbortSignal;
  randomSeed: number;
  maxDurationMs: number;
}): Promise<{
  near: SpotifyTrackSummary[];
  expand: SpotifyTrackSummary[];
  explore: SpotifyTrackSummary[];
  all: SpotifyTrackSummary[];
  metrics: {
    spotifyQueryCount: number;
    spotifyQueryUniqueCount: number;
    earlyReturnTriggered: boolean;
    searchStage: "tier1" | "tier2" | "tier3" | "none";
    minTracks: number;
    minDurationMs: number;
    collectedDurationMs: number;
  };
}> {
  const minTracks = 45;
  const collectionTargetMs = Math.round(args.targetMinutes * 1.8 * 60_000);
  const minDurationMs = Math.round(args.targetMinutes * 1.5 * 60_000);
  const dedup = new Map<string, SpotifyTrackSummary>();
  const near: SpotifyTrackSummary[] = [];
  const expand: SpotifyTrackSummary[] = [];
  const explore: SpotifyTrackSummary[] = [];
  const usedQueries = new Set<string>();
  let queryCount = 0;
  let searchStage: "tier1" | "tier2" | "tier3" | "none" = "none";
  const addTracks = (tracks: SpotifyTrackSummary[], zone: RecommendationZone): void => {
    for (const track of tracks) {
      const key = trackDedupKey(track);
      if (!key || dedup.has(key)) continue;
      dedup.set(key, track);
      if (zone === "near") near.push(track);
      else if (zone === "expand") expand.push(track);
      else explore.push(track);
    }
  };
  const runStage = async (
    queries: string[],
    zone: RecommendationZone,
    seedOffset: number,
    label: "tier1" | "tier2" | "tier3",
  ): Promise<void> => {
    const prepared = Array.from(
      new Set(
        queries
          .map(v => String(v ?? "").trim())
          .filter(Boolean)
          .filter(v => !isInvalidSearchQuery(v))
          .filter(v => {
            const k = normalizeQueryKey(v);
            if (!k || usedQueries.has(k)) return false;
            usedQueries.add(k);
            return true;
          }),
      ),
    ).slice(0, 10);
    if (!prepared.length) return;
    queryCount += prepared.length;
    searchStage = label;
    let tracks = await searchSpotifyTracksByQueries({
      accessToken: args.accessToken,
      queries: prepared,
      perQueryLimit: 18,
      randomSeed: args.randomSeed + seedOffset,
      concurrency: 2,
      maxDurationMs: Math.max(7000, Math.min(12000, args.maxDurationMs)),
      requestId: args.requestId,
      abortSignal: args.abortSignal,
      onTracks: event => buildOnTracksCollector(args.requestId)({
        query: event.query,
        tracks: event.tracks,
      }),
    }).catch(() => [] as SpotifyTrackSummary[]);
    if (!tracks.length) {
      let level = 1;
      let relaxedQueries = prepared;
      while (!tracks.length && level <= 3) {
        relaxedQueries = Array.from(
          new Set(
            relaxedQueries
              .map(q => relaxQuery(q, level))
              .filter(Boolean)
              .filter(q => !isInvalidSearchQuery(q)),
          ),
        ).slice(0, 8);
        if (!relaxedQueries.length) break;
        console.warn(
          `[QueryRelax] requestId=${args.requestId || "-"} level=${level} before=${JSON.stringify(prepared)} after=${JSON.stringify(relaxedQueries)}`,
        );
        tracks = await searchSpotifyTracksByQueries({
          accessToken: args.accessToken,
          queries: relaxedQueries,
          perQueryLimit: 16,
          randomSeed: args.randomSeed + seedOffset + level * 17,
          concurrency: 2,
          maxDurationMs: Math.max(6000, Math.min(10000, args.maxDurationMs)),
          requestId: args.requestId,
          abortSignal: args.abortSignal,
          onTracks: event => buildOnTracksCollector(args.requestId)({
            query: event.query,
            tracks: event.tracks,
          }),
        }).catch(() => [] as SpotifyTrackSummary[]);
        level += 1;
      }
    }
    addTracks(tracks, zone);
  };
  const getTotalDurationMs = (): number => sumDurationMs(Array.from(dedup.values()));
  const primary = Array.from(
    new Set(args.bucketPlan.buckets.flatMap(bucket => buildBucketQueries(bucket).primary)),
  );
  const discovery = Array.from(
    new Set(args.bucketPlan.buckets.flatMap(bucket => buildBucketQueries(bucket).discovery)),
  );
  const recovery = Array.from(
    new Set(args.bucketPlan.buckets.flatMap(bucket => buildBucketQueries(bucket).recovery)),
  );
  const playlistFallback = Array.from(
    new Set([...buildPlaylistFallbackQueries(args.searchIntent), ...args.queryStrategy.recovery]),
  );
  const primaryMerged = Array.from(new Set([...primary, ...args.queryStrategy.primary]));
  const discoveryMerged = Array.from(new Set([...discovery, ...args.queryStrategy.discovery]));
  const recoveryMerged = Array.from(new Set([...recovery, ...args.queryStrategy.recovery]));
  await runStage(primaryMerged, "near", 23, "tier1");
  if (dedup.size < minTracks || getTotalDurationMs() < minDurationMs) {
    await runStage(discoveryMerged, "expand", 41, "tier2");
  }
  if (dedup.size < minTracks || getTotalDurationMs() < minDurationMs) {
    await runStage(recoveryMerged, "explore", 61, "tier3");
  }
  if (dedup.size < minTracks || getTotalDurationMs() < minDurationMs) {
    await runStage(playlistFallback, "explore", 73, "tier3");
  }
  if (getTotalDurationMs() < collectionTargetMs && playlistFallback.length) {
    await runStage(playlistFallback.slice(0, 5), "explore", 89, "tier3");
  }
  const all = Array.from(dedup.values());
  return {
    near,
    expand,
    explore,
    all,
    metrics: {
      spotifyQueryCount: queryCount,
      spotifyQueryUniqueCount: usedQueries.size,
      earlyReturnTriggered: all.length >= minTracks && getTotalDurationMs() >= collectionTargetMs,
      searchStage,
      minTracks,
      minDurationMs,
      collectedDurationMs: getTotalDurationMs(),
    },
  };
}

function buildRepeatSuppressionState(currentPromptHash: string): RepeatSuppressionState {
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  const recentTrackIds = new Set<string>();
  const recentArtistIds = new Set<string>();
  const recentPromptHashes: string[] = [];
  const recentArtistFrequency = new Map<string, number>();
  recommendationHistory.forEach(snapshot => {
    if (snapshot.createdAt < cutoff24h) return;
    recentPromptHashes.push(snapshot.fingerprint);
    snapshot.trackIds.forEach(id => recentTrackIds.add(String(id ?? "").trim()));
    snapshot.artistKeys.forEach(key => {
      const k = String(key ?? "").trim();
      if (!k) return;
      recentArtistIds.add(k);
      recentArtistFrequency.set(k, (recentArtistFrequency.get(k) ?? 0) + 1);
    });
  });
  return {
    recentTrackIds,
    recentArtistIds,
    recentPromptHashes,
    repeatedPrompt: recentPromptHashes.includes(currentPromptHash),
    recentArtistFrequency,
  };
}

function shrinkSearchQuery(query: string): string {
  const words = String(query ?? "").split(/\s+/).filter(Boolean);
  if (words.length <= 2) return "";
  return sanitizeFastSearchToken(words.slice(0, words.length - 1).join(" "));
}

async function collectCandidatesFromBundles(args: {
  accessToken: string;
  bundles: QueryBundles;
  requestId?: string;
  abortSignal?: AbortSignal;
  randomSeed: number;
  maxDurationMs: number;
}): Promise<{
  tracks: SpotifyTrackSummary[];
  stageCount: Record<string, number>;
}> {
  const stageCount: Record<string, number> = {};
  const stageOrder: Array<{ key: keyof QueryBundles; limit: number; perQueryLimit: number }> = [
    { key: "strictPrompt", limit: 8, perQueryLimit: 10 },
    { key: "semanticMood", limit: 8, perQueryLimit: 8 },
    { key: "tasteAnchored", limit: 8, perQueryLimit: 8 },
    { key: "exploration", limit: 8, perQueryLimit: 8 },
  ];
  const dedup = new Map<string, SpotifyTrackSummary>();
  const startedAt = Date.now();
  for (const stage of stageOrder) {
    if (Date.now() - startedAt >= args.maxDurationMs) break;
    const rawQueries = args.bundles[stage.key].slice(0, stage.limit);
    if (!rawQueries.length) {
      stageCount[stage.key] = 0;
      continue;
    }
    const queries = pickDiverseQueries(rawQueries, stage.limit);
    const pool = await searchSpotifyTracksByQueries({
      accessToken: args.accessToken,
      queries,
      perQueryLimit: stage.perQueryLimit,
      randomSeed: args.randomSeed + stableHash(stage.key),
      maxDurationMs: Math.max(1000, Math.min(3200, args.maxDurationMs - (Date.now() - startedAt))),
      requestId: args.requestId,
      abortSignal: args.abortSignal,
      onTracks: event => buildOnTracksCollector(args.requestId)({
        query: event.query,
        tracks: event.tracks,
      }),
    }).catch(() => [] as SpotifyTrackSummary[]);
    let stageTracks = pool;
    if (!stageTracks.length) {
      const reduced = queries.map(shrinkSearchQuery).filter(Boolean);
      if (reduced.length) {
        stageTracks = await searchSpotifyTracksByQueries({
          accessToken: args.accessToken,
          queries: reduced,
          perQueryLimit: stage.perQueryLimit,
          randomSeed: args.randomSeed + stableHash(`${stage.key}:reduced`),
          maxDurationMs: Math.max(900, Math.min(2200, args.maxDurationMs - (Date.now() - startedAt))),
          requestId: args.requestId,
          abortSignal: args.abortSignal,
          onTracks: event => buildOnTracksCollector(args.requestId)({
            query: event.query,
            tracks: event.tracks,
          }),
        }).catch(() => [] as SpotifyTrackSummary[]);
      }
    }
    stageCount[stage.key] = stageTracks.length;
    stageTracks.forEach(track => {
      const key = trackDedupKey(track);
      if (!key || dedup.has(key)) return;
      dedup.set(key, track);
    });
  }
  return { tracks: Array.from(dedup.values()), stageCount };
}

function buildZoneCandidateQueries(args: {
  bundles: QueryBundles;
  intent: ParsedIntent;
  taste: TasteProfileSignals;
  promptBundle: PromptFeatureBundle;
}): {
  near: string[];
  expand: string[];
  explore: string[];
} {
  const sanitizeSpotifyFilterQuery = (raw: string): string => {
    const compact = String(raw ?? "")
      .replace(/[“”]/g, "\"")
      .replace(/[’]/g, "'")
      .replace(/[\[\]{}()]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64);
    if (!compact) return "";
    const words = compact.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 4) return "";
    if (/^[^A-Za-z가-힣0-9:\-"]+$/.test(compact)) return "";
    if (/[:;"<>]/.test(compact.replace(/\bgenre:/gi, ""))) return "";
    return compact;
  };
  const mapToGenreFilter = (raw: string): { filter: string; plain: string } | null => {
    const g = normalizeText(raw);
    if (!g) return null;
    if (/k[\s-]?pop|케이팝|팝/.test(g)) return { filter: "k-pop", plain: "k-pop" };
    if (/멜로디 힙합|melodic hip hop/.test(g)) return { filter: "hip-hop", plain: "korean hip hop" };
    if (/힙합|hip hop|hip-hop|rap/.test(g)) return { filter: "hip-hop", plain: "korean hip hop" };
    if (/rnb|r&b|r-n-b|알앤비|소울|soul/.test(g)) return { filter: "r-n-b", plain: "korean rnb" };
    if (/인디|k-indie|indie/.test(g)) return { filter: "indie", plain: "k-indie" };
    if (/포크|folk/.test(g)) return { filter: "folk", plain: "korean folk" };
    if (/ost|영화음악|soundtrack|cinematic/.test(g)) return { filter: "soundtrack", plain: "soundtrack" };
    return null;
  };
  const buildGenreDrivenQueries = (
    specs: { filter: string; plain: string }[],
    keywords: string[],
    limit: number,
    seedKey: string,
  ): string[] => {
    const out = new Set<string>();
    const orderedSpecs = [...specs].sort(
      (a, b) =>
        stableHash(`${seedKey}|${a.filter}|${a.plain}`) -
        stableHash(`${seedKey}|${b.filter}|${b.plain}`),
    );
    const orderedKeywords = [...new Set(keywords)].sort(
      (a, b) => stableHash(`${seedKey}|kw|${a}`) - stableHash(`${seedKey}|kw|${b}`),
    );
    for (const spec of orderedSpecs) {
      out.add(`genre:${spec.filter}`);
      for (const kw of orderedKeywords.slice(0, 2)) {
        out.add(`genre:${spec.filter} ${kw}`);
      }
      if (out.size >= limit * 2) break;
    }
    return Array.from(out)
      .map(sanitizeSpotifyFilterQuery)
      .filter(Boolean)
      .slice(0, limit);
  };
  const SIMPLE_QUERY_KEYWORDS = ["upbeat", "chill", "acoustic", "happy"] as const;
  const seededOrder = (values: string[], seed: string): string[] => {
    const uniq = Array.from(new Set(values.map(v => String(v ?? "").trim()).filter(Boolean)));
    return uniq.sort((a, b) => stableHash(`${seed}|${a}`) - stableHash(`${seed}|${b}`));
  };
  const pickSimpleKeyword = (
    primary: string[],
    fallback: readonly string[],
    seed: string,
  ): string => {
    const pool = primary.length ? seededOrder(primary, `${seed}:p`) : seededOrder([...fallback], `${seed}:f`);
    return pool[0] ?? fallback[0] ?? "chill";
  };
  const promptBundle = args.promptBundle;
  const tasteCore = buildTasteDescriptorCore(args.taste);
  const requestedGenreSpecs = Array.from(
    new Map(
      args.intent.genreIntent.requested
        .map(v => mapToGenreFilter(v))
        .filter((v): v is { filter: string; plain: string } => Boolean(v))
        .map(v => [`${v.filter}|${v.plain}`, v]),
    ).values(),
  ).slice(0, 8);
  const tasteGenreSpecs = Array.from(
    new Map(
      tasteCore.genreTendency
        .map(v => mapToGenreFilter(v))
        .filter((v): v is { filter: string; plain: string } => Boolean(v))
        .map(v => [`${v.filter}|${v.plain}`, v]),
    ).values(),
  ).slice(0, 6);
  const genreSpecs = requestedGenreSpecs.length
    ? requestedGenreSpecs
    : tasteGenreSpecs.length
      ? tasteGenreSpecs
      : [
          { filter: "k-pop", plain: "k-pop" },
          { filter: "hip-hop", plain: "korean hip hop" },
          { filter: "r-n-b", plain: "korean rnb" },
        ];
  const tasteVocal = tasteCore.vocal.slice(0, 4);
  const tasteEmotion = tasteCore.emotion.slice(0, 4);
  const tasteRhythm = tasteCore.rhythmTolerance.slice(0, 4);
  const promptMood = promptBundle.mood
    .filter(v => !/sunny|walk|stroll|outdoor|river|hangang/.test(normalizeText(v)))
    .slice(0, 4);
  const promptTexture = promptBundle.texture.slice(0, 4);
  const promptGroove = promptBundle.groove.slice(0, 4);
  const promptVocal = promptBundle.vocal.slice(0, 4);
  const promptEnergy = Number(promptBundle.energy ?? 0.5);
  const isHighEnergyPrompt = promptEnergy >= 0.62;
  const isLowEnergyPrompt = promptEnergy <= 0.42;
  const promptSimpleKeywords = Array.from(
    new Set(
      [...promptMood, ...promptTexture, ...promptGroove, ...promptVocal]
        .map(v => normalizeText(v))
        .flatMap(v => {
          if (!v) return [] as string[];
          if (/upbeat|energetic|exciting|dynamic|bounce|drive/.test(v)) return ["upbeat", "happy"];
          if (/calm|soft|relaxed|gentle|stable/.test(v)) return ["chill", "acoustic"];
          if (/clear|clean|airy|acoustic/.test(v)) return ["acoustic"];
          if (/bright|breezy|refreshing|light/.test(v)) return ["happy", "upbeat"];
          return [] as string[];
        }),
    ),
  ).filter(v => SIMPLE_QUERY_KEYWORDS.includes(v as (typeof SIMPLE_QUERY_KEYWORDS)[number]));
  const tasteSimpleKeywords = Array.from(
    new Set(
      [...tasteVocal, ...tasteEmotion, ...tasteRhythm]
        .map(v => normalizeText(v))
        .flatMap(v => {
          if (!v) return [] as string[];
          if (/aggressive|hard|heavy/.test(v)) return ["upbeat"];
          if (/soft|warm|smooth|calm|low aggression/.test(v)) return ["chill", "acoustic"];
          if (/melodic|clear|clean/.test(v)) return ["acoustic"];
          return [] as string[];
        }),
    ),
  ).filter(v => SIMPLE_QUERY_KEYWORDS.includes(v as (typeof SIMPLE_QUERY_KEYWORDS)[number]));
  const nearDefault = isHighEnergyPrompt ? ["upbeat", "happy"] : isLowEnergyPrompt ? ["chill", "acoustic"] : ["chill", "upbeat"];
  const expandDefault = isHighEnergyPrompt ? ["upbeat", "happy"] : isLowEnergyPrompt ? ["acoustic", "chill"] : ["upbeat", "chill", "happy"];
  const exploreDefault = isHighEnergyPrompt ? ["happy", "upbeat", "acoustic"] : ["acoustic", "chill", "happy"];
  const seen = new Set<string>();
  const finalize = (queries: string[], limit: number): string[] => {
    const out: string[] = [];
    for (const q of pickDiverseQueries(queries.filter(Boolean), limit * 2)) {
      const key = normalizeText(q);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(q);
      if (out.length >= limit) break;
    }
    return out;
  };

  const near = finalize(
    buildGenreDrivenQueries(
      genreSpecs.slice(0, 6),
      [pickSimpleKeyword(tasteSimpleKeywords, nearDefault, "near:kw")],
      10,
      "near",
    ),
    10,
  );
  const expand = finalize(
    buildGenreDrivenQueries(
      genreSpecs.slice(0, 7),
      [
        pickSimpleKeyword(promptSimpleKeywords, expandDefault, "expand:kw1"),
        pickSimpleKeyword([...promptSimpleKeywords, ...tasteSimpleKeywords], expandDefault, "expand:kw2"),
      ],
      10,
      "expand",
    ),
    10,
  );
  const explore = finalize(
    buildGenreDrivenQueries(
      genreSpecs.slice(0, 6),
      [
        pickSimpleKeyword(promptSimpleKeywords, exploreDefault, "explore:kw1"),
        pickSimpleKeyword(SIMPLE_QUERY_KEYWORDS.filter(v => v !== "upbeat"), exploreDefault, "explore:kw2"),
      ],
      10,
      "explore",
    ),
    10,
  );
  return { near, expand, explore };
}

function extractGenreAnchorsFromQueries(queries: string[]): string[] {
  const out = new Set<string>();
  for (const query of queries) {
    const q = normalizeText(query);
    if (!q) continue;
    if (q.includes("k-pop") || q.includes("kpop")) out.add("k-pop");
    if (q.includes("korean hip hop") || q.includes("hip hop") || q.includes("hip-hop") || q.includes("rap")) {
      out.add("korean hip hop");
    }
    if (q.includes("rnb") || q.includes("r-n-b") || q.includes("soul")) out.add("korean rnb");
    if (q.includes("indie")) out.add("korean indie");
    if (q.includes("folk")) out.add("korean folk");
    if (q.includes("ost") || q.includes("soundtrack") || q.includes("cinematic")) out.add("korean ost");
  }
  if (!out.size) {
    out.add("k-pop");
    out.add("korean hip hop");
    out.add("korean rnb");
    out.add("korean indie");
  }
  return Array.from(out).slice(0, 6);
}

function buildSimpleFallbackQueries(args: {
  sourceQueries: string[];
  randomSeed: number;
  stageKey: string;
}): string[] {
  const anchors = extractGenreAnchorsFromQueries(args.sourceQueries);
  const keywordGroups = [
    ["upbeat", "happy"],
    ["chill", "acoustic"],
    ["acoustic", "happy"],
  ];
  const picked: string[] = [];
  anchors.forEach((genre, idx) => {
    const groupIdx = Math.abs(stableHash(`${args.randomSeed}|${args.stageKey}|${genre}|g${idx}`)) % keywordGroups.length;
    const group = keywordGroups[groupIdx] ?? keywordGroups[0] ?? ["chill"];
    const tokenIdx = Math.abs(stableHash(`${args.randomSeed}|${args.stageKey}|${genre}|t${idx}`)) % group.length;
    const token = group[tokenIdx] ?? group[0] ?? "chill";
    const filterGenre =
      genre === "k-pop" ? "k-pop"
      : genre === "korean hip hop" ? "hip-hop"
      : genre === "korean rnb" ? "r-n-b"
      : genre === "korean indie" ? "indie"
      : genre === "korean folk" ? "folk"
      : genre === "korean ost" ? "soundtrack"
      : "";
    if (filterGenre) picked.push(`genre:${filterGenre} ${token}`);
  });
  const deduped = Array.from(new Set(picked)).slice(0, 10);
  return deduped.length
    ? deduped
    : anchors
        .map(v => sanitizeFastSearchToken(v))
        .filter((v): v is string => Boolean(v))
        .slice(0, 8);
}

function buildGenreOnlyFallbackQueries(sourceQueries: string[], randomSeed: number, stageKey: string): string[] {
  const anchors = extractGenreAnchorsFromQueries(sourceQueries);
  const ordered = [...anchors].sort(
    (a, b) =>
      stableHash(`${randomSeed}|${stageKey}|${a}`) -
      stableHash(`${randomSeed}|${stageKey}|${b}`),
  );
  const expanded: string[] = [];
  for (const v of ordered) {
    const filterGenre =
      v === "k-pop" ? "k-pop"
      : v === "korean hip hop" ? "hip-hop"
      : v === "korean rnb" ? "r-n-b"
      : v === "korean indie" ? "indie"
      : v === "korean folk" ? "folk"
      : v === "korean ost" ? "soundtrack"
      : "";
    if (filterGenre) expanded.push(`genre:${filterGenre}`);
  }
  return expanded
    .map(v => sanitizeFastSearchToken(v) || String(v ?? "").trim())
    .map(v => v.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 10);
}

async function collectCandidatesByZone(args: {
  accessToken: string;
  nearQueries: string[];
  expandQueries: string[];
  exploreQueries: string[];
  requestId?: string;
  abortSignal?: AbortSignal;
  randomSeed: number;
  maxDurationMs: number;
}): Promise<{
  near: SpotifyTrackSummary[];
  expand: SpotifyTrackSummary[];
  explore: SpotifyTrackSummary[];
  all: SpotifyTrackSummary[];
  metrics: {
    spotifyQueryCount: number;
    spotifyQueryUniqueCount: number;
    earlyReturnTriggered: boolean;
    searchStage: "tier1" | "tier2" | "tier3" | "none";
  };
}> {
  const MAX_TOTAL_QUERIES = 8;
  const EARLY_RETURN_POOL_SIZE = 60;
  const usedQueries = new Set<string>();
  let consumedQueryCount = 0;
  let earlyReturnTriggered = false;
  let searchStage: "tier1" | "tier2" | "tier3" | "none" = "none";
  const canRunMore = () => consumedQueryCount < MAX_TOTAL_QUERIES && !args.abortSignal?.aborted;
  const pickBudgetedQueries = (rawQueries: string[], cap: number): string[] => {
    if (!canRunMore()) return [];
    const out: string[] = [];
    for (const q of pickDiverseQueries(rawQueries, cap * 2)) {
      const key = normalizeText(q);
      if (!key || usedQueries.has(key)) continue;
      usedQueries.add(key);
      out.push(q);
      consumedQueryCount += 1;
      if (out.length >= cap || consumedQueryCount >= MAX_TOTAL_QUERIES) break;
    }
    return out;
  };
  const runSearch = async (
    queries: string[],
    perQueryLimit: number,
    randomSeed: number,
    budgetMs: number,
    stageLabel: "tier1" | "tier2" | "tier3",
  ): Promise<SpotifyTrackSummary[]> => {
    if (!queries.length) return [];
    searchStage = stageLabel;
    return searchSpotifyTracksByQueries({
      accessToken: args.accessToken,
      queries,
      perQueryLimit,
      randomSeed,
      concurrency: 2,
      maxDurationMs: budgetMs,
      requestId: args.requestId,
      abortSignal: args.abortSignal,
      onTracks: event => buildOnTracksCollector(args.requestId)({
        query: event.query,
        tracks: event.tracks,
      }),
    }).catch(() => [] as SpotifyTrackSummary[]);
  };
  const runZone = async (
    queries: string[],
    seedOffset: number,
    perQueryLimit: number,
    stageKey: "near" | "expand" | "explore",
    currentPoolSize: () => number,
  ): Promise<SpotifyTrackSummary[]> => {
    if (!queries.length || !canRunMore()) return [];
    const stageSeed = args.randomSeed + seedOffset;
    const tier1Queries = pickBudgetedQueries(queries, 4);
    const tier1 = await runSearch(
      tier1Queries,
      perQueryLimit,
      stageSeed,
      Math.max(900, Math.min(2400, args.maxDurationMs)),
      "tier1",
    );
    if (tier1.length || !canRunMore() || currentPoolSize() >= EARLY_RETURN_POOL_SIZE) return tier1;

    const tier2Candidates = buildGenreOnlyFallbackQueries(tier1Queries.length ? tier1Queries : queries, stageSeed + 97, `${stageKey}:tier2`);
    const tier2Queries = pickBudgetedQueries(tier2Candidates, 2);
    const tier2 = await runSearch(
      tier2Queries,
      perQueryLimit,
      stageSeed + 97,
      Math.max(800, Math.min(1800, args.maxDurationMs)),
      "tier2",
    );
    if (tier2.length || !canRunMore() || currentPoolSize() >= EARLY_RETURN_POOL_SIZE) return tier2;

    const tier3Candidates = ["korean music", "k-pop"];
    const tier3Queries = pickBudgetedQueries(tier3Candidates, 2);
    return runSearch(
      tier3Queries,
      perQueryLimit,
      stageSeed + 181,
      Math.max(700, Math.min(1400, args.maxDurationMs)),
      "tier3",
    );
  };

  let near: SpotifyTrackSummary[] = [];
  let expand: SpotifyTrackSummary[] = [];
  let explore: SpotifyTrackSummary[] = [];
  const currentPoolSize = () => mergeUniqueTracks(near, expand, explore).length;
  near = await runZone(args.nearQueries, 11, 30, "near", currentPoolSize);
  if (currentPoolSize() >= EARLY_RETURN_POOL_SIZE) earlyReturnTriggered = true;
  if (!earlyReturnTriggered) {
    expand = await runZone(args.expandQueries, 37, 30, "expand", currentPoolSize);
    if (currentPoolSize() >= EARLY_RETURN_POOL_SIZE) earlyReturnTriggered = true;
  }
  if (!earlyReturnTriggered) {
    explore = await runZone(args.exploreQueries, 71, 24, "explore", currentPoolSize);
    if (currentPoolSize() >= EARLY_RETURN_POOL_SIZE) earlyReturnTriggered = true;
  }

  const all = mergeUniqueTracks(near, expand, explore);
  return {
    near,
    expand,
    explore,
    all,
    metrics: {
      spotifyQueryCount: consumedQueryCount,
      spotifyQueryUniqueCount: usedQueries.size,
      earlyReturnTriggered,
      searchStage,
    },
  };
}

function applyCandidateFiltering(args: {
  tracks: SpotifyTrackSummary[];
  intent: ParsedIntent;
  repeat: RepeatSuppressionState;
  taste: TasteProfileSignals;
}): SpotifyTrackSummary[] {
  return args.tracks.filter(track => {
    const id = String(track?.id ?? "").trim();
    if (!id) return false;
    if (args.repeat.recentTrackIds.has(id) || args.taste.recentTrackIds.has(id)) return false;
    const artistKeys = trackArtistKeys(track);
    if (artistKeys.some(k => args.repeat.recentArtistFrequency.get(k) && (args.repeat.recentArtistFrequency.get(k) ?? 0) >= 3)) {
      return false;
    }
    const text = normalizeText(
      [track.name, track.album?.name ?? "", ...(track.artists ?? []).map(a => a.name), ...(track.genres ?? [])].join(" "),
    );
    const isNonMusicAudio = NON_MUSIC_AUDIO_TERMS.some(term => text.includes(normalizeText(term)));
    if (isNonMusicAudio) return false;
    return true;
  });
}

function scoreMusicDomainFit(text: string): number {
  const nonMusicHits = NON_MUSIC_AUDIO_TERMS.filter(term =>
    text.includes(normalizeText(term)),
  ).length;
  if (nonMusicHits >= 2) return 0;
  if (nonMusicHits === 1) return 0.2;
  const musicAnchorHits = MUSIC_QUERY_ANCHORS.filter(anchor =>
    text.includes(normalizeText(anchor)),
  ).length;
  return Math.min(1, 0.45 + musicAnchorHits * 0.15);
}

function tokenMatchRatioWithTitleCap(args: {
  tokens: string[];
  titleText: string;
  metaText: string;
}): number {
  const tokens = Array.from(new Set(args.tokens.map(v => normalizeText(v)).filter(Boolean)));
  if (!tokens.length) return 0;
  let metaHits = 0;
  tokens.forEach(t => {
    if (args.metaText.includes(t)) metaHits += 1;
  });
  const metaRatio = metaHits / tokens.length;
  return Math.min(1, metaRatio);
}

function isKoreanTrack(track: SpotifyTrackSummary): boolean {
  const text = normalizeText(
    [
      track.name,
      track.album?.name ?? "",
      ...(track.artists ?? []).map(a => a.name),
      ...(track.genres ?? []),
    ].join(" "),
  );
  return /(korean|k pop|k-pop|케이팝|한국|국내|hangul|krnb|khip|ost|가요|한글|보컬)/.test(text);
}

function inferTrackFeatures(args: {
  track: SpotifyTrackSummary;
  promptBundle: PromptFeatureBundle;
  tasteCore: TasteDescriptorCore;
  sourceZone?: RecommendationZone;
  queryProvenance: string[];
  requestLocale?: "korean" | "global";
  requestedGenres?: string[];
}): {
  energy: number;
  tempo: number;
  aggression: number;
  promptFeatureFit: number;
  tasteDescriptorFit: number;
  movementFit: number;
  grooveFit: number;
  localeMatch: number;
  genreMatch: number;
  moodMatch: number;
  featureAligned: boolean;
} {
  const metaText = normalizeText(
    [
      args.track.album?.name ?? "",
      ...(args.track.artists ?? []).map(a => a.name),
      ...(args.track.genres ?? []),
      ...args.queryProvenance,
    ].join(" "),
  );
  const energy = estimateTrackEnergy(args.track);
  const tempo = Number(args.track.tempo ?? NaN);
  const tempoNorm = Number.isFinite(tempo) ? clampUnit((tempo - 70) / 90, 0.5) : estimateTrackDanceability(args.track);
  const valence = estimateTrackValence(args.track);
  const energyTarget =
    args.promptBundle.energy === "high" ? 0.75 : args.promptBundle.energy === "low" ? 0.35 : 0.55;
  const aggressionPenaltyTerms = ["hard", "aggressive", "metal", "noise", "screamo", "distortion"];
  const aggressionHits = aggressionPenaltyTerms.filter(t => metaText.includes(t)).length;
  const aggression = Math.max(0, Math.min(1, energy * 0.6 + aggressionHits * 0.2));
  const movementFit = tokenMatchRatioWithTitleCap({
    tokens: [...args.promptBundle.movement, ...args.promptBundle.groove],
    titleText: "",
    metaText,
  });
  const grooveFit = tokenMatchRatioWithTitleCap({
    tokens: args.promptBundle.groove,
    titleText: "",
    metaText,
  });
  const environmentFit = tokenMatchRatioWithTitleCap({
    tokens: args.promptBundle.environment,
    titleText: "",
    metaText,
  });
  const textureFit = tokenMatchRatioWithTitleCap({
    tokens: args.promptBundle.texture,
    titleText: "",
    metaText,
  });
  const vocalFit = tokenMatchRatioWithTitleCap({
    tokens: args.promptBundle.vocal,
    titleText: "",
    metaText,
  });
  const moodFit = tokenMatchRatioWithTitleCap({
    tokens: args.promptBundle.mood,
    titleText: "",
    metaText,
  });
  const energyFit = similarity(energy, energyTarget);
  const tempoFit = similarity(tempoNorm, args.promptBundle.tempoLevel);
  const movementNumericFit = similarity(tempoNorm, args.promptBundle.movementLevel);
  const aggressionFit = args.promptBundle.aggression === "low" ? 1 - aggression : 1 - Math.abs(aggression - 0.5);
  const promptFeatureFit = Math.max(
    0,
    Math.min(
      1,
      movementFit * 0.15 +
        grooveFit * 0.15 +
        textureFit * 0.2 +
        vocalFit * 0.15 +
        moodFit * 0.15 +
        environmentFit * 0.08 +
        energyFit * 0.06 +
        tempoFit * 0.04 +
        movementNumericFit * 0.02 +
        aggressionFit * 0,
    ),
  );
  const tasteGenreFit = tokenMatchRatioWithTitleCap({
    tokens: args.tasteCore.genreTendency,
    titleText: "",
    metaText,
  });
  const tasteVocalFit = tokenMatchRatioWithTitleCap({
    tokens: args.tasteCore.vocal,
    titleText: "",
    metaText,
  });
  const tasteEmotionFit = tokenMatchRatioWithTitleCap({
    tokens: args.tasteCore.emotion,
    titleText: "",
    metaText,
  });
  const tasteRhythmFit = tokenMatchRatioWithTitleCap({
    tokens: args.tasteCore.rhythmTolerance,
    titleText: "",
    metaText,
  });
  const tasteDescriptorFit = Math.max(
    0,
    Math.min(1, tasteGenreFit * 0.35 + tasteVocalFit * 0.3 + tasteEmotionFit * 0.2 + tasteRhythmFit * 0.15),
  );
  const localeMatch =
    args.requestLocale === "korean"
      ? (isKoreanTrack(args.track) ? 1 : 0)
      : 1;
  const genreMatch = tokenMatchRatioWithTitleCap({
    tokens: (args.requestedGenres ?? []).map(v => normalizeText(v)).filter(Boolean),
    titleText: "",
    metaText,
  });
  const moodMatch = tokenMatchRatioWithTitleCap({
    tokens: [...args.promptBundle.mood, ...args.promptBundle.texture]
      .map(v => normalizeText(v))
      .filter(Boolean),
    titleText: "",
    metaText,
  });
  const featureAligned =
    localeMatch > 0.7 &&
    genreMatch > 0.45 &&
    moodMatch > 0.4 &&
    promptFeatureFit >= 0.42 &&
    (textureFit >= 0.25 || moodFit >= 0.25 || movementFit >= 0.25) &&
    (args.promptBundle.aggression !== "low" || aggression <= 0.55) &&
    (args.sourceZone !== "expand" || (tasteDescriptorFit >= 0.3 && promptFeatureFit >= 0.45));
  return {
    energy,
    tempo: tempoNorm,
    aggression,
    promptFeatureFit,
    tasteDescriptorFit,
    movementFit,
    grooveFit,
    localeMatch,
    genreMatch,
    moodMatch,
    featureAligned,
  };
}

function scoreTrackSemantic(args: {
  track: SpotifyTrackSummary;
  intent: ParsedIntent;
  taste: TasteProfileSignals;
  repeat: RepeatSuppressionState;
  promptBundle: PromptFeatureBundle;
  tasteCore: TasteDescriptorCore;
  sourceZone?: RecommendationZone;
  queryProvenance: string[];
  requestLocale?: "korean" | "global";
  styleFeatures?: StructuredIntent["audioFeatures"];
  styles?: string[];
}): {
  zone: RecommendationZone;
  total: number;
  finalScore: number;
  featureAligned: boolean;
  promptFit: number;
  promptShiftScore: number;
  sceneFit: number;
  moodFit: number;
  genreFit: number;
  textureFit: number;
  musicDomainFit: number;
  expansionScore: number;
  tasteSimilarity: number;
  tasteFit: number;
  freshness: number;
  diversity: number;
  penalty: number;
} {
  const titleText = normalizeText(args.track.name ?? "");
  const metaText = normalizeText(
    [
      args.track.album?.name ?? "",
      ...(args.track.artists ?? []).map(a => a.name),
      ...(args.track.genres ?? []),
      ...args.queryProvenance,
    ].join(" "),
  );
  const fullText = `${titleText} ${metaText}`.trim();
  const sceneTokens = [...args.promptBundle.movement, ...args.promptBundle.groove]
    .map(v => normalizeText(v))
    .filter(Boolean);
  const moodTokens = args.promptBundle.mood.map(v => normalizeText(v)).filter(Boolean);
  const genreTokens = Array.from(
    new Set(
      [
        ...args.intent.genreIntent.requested.map(v => toEnglishQueryToken(v)),
        ...args.tasteCore.genreTendency,
      ]
        .map(v => normalizeText(v))
        .filter(Boolean),
    ),
  );
  const contextTokens = [
    ...args.promptBundle.texture,
    ...args.promptBundle.vocal,
  ]
    .map(v => normalizeText(v))
    .filter(Boolean);
  const sceneFitRatio = tokenMatchRatioWithTitleCap({ tokens: sceneTokens, titleText: "", metaText });
  const moodFitRatio = tokenMatchRatioWithTitleCap({ tokens: moodTokens, titleText: "", metaText });
  const genreFitRatio = tokenMatchRatioWithTitleCap({ tokens: genreTokens, titleText: "", metaText });
  const contextFitRatio = tokenMatchRatioWithTitleCap({ tokens: contextTokens, titleText: "", metaText });
  const musicDomainFit = scoreMusicDomainFit(fullText);
  const intentEnergyTarget = args.promptBundle.energy === "high" ? 0.75 : args.promptBundle.energy === "low" ? 0.35 : 0.55;
  const energyFit = similarity(estimateTrackEnergy(args.track), intentEnergyTarget);
  const valenceFit = similarity(
    estimateTrackValence(args.track),
      /emotional|nostalgic|moody/.test(normalizeText(args.intent.mood.primary.join(" "))) ? 0.4 : 0.6,
  );
  const sceneFit = Math.max(0, Math.min(1, sceneFitRatio));
  const moodFit = Math.max(0, Math.min(1, moodFitRatio * 0.7 + energyFit * 0.2 + valenceFit * 0.1));
  const genreFit = Math.max(0, Math.min(1, genreFitRatio));
  const textureFit = Math.max(0, Math.min(1, contextFitRatio));
  const musicDomainFitNorm = Math.max(0, Math.min(1, musicDomainFit));
  const genrePriority = args.intent.genreIntent.requested.length >= 2 ? 0.7 : 0.45;
  const moodPriority = args.intent.mood.primary.length >= 1 ? 0.65 : 0.35;
  const activityPriority = args.intent.scene.activity.length >= 1 ? 0.62 : 0.32;
  const genreWeight = genrePriority > 0.6 ? 0.5 : 0.3;
  const moodWeight = moodPriority > 0.6 ? 0.4 : 0.3;
  const activityWeight = activityPriority > 0.6 ? 0.3 : 0.2;
  const textureWeight = Math.max(0.05, 1 - (genreWeight + moodWeight + activityWeight));
  const promptFitNorm =
    sceneFit * activityWeight + moodFit * moodWeight + genreFit * genreWeight + textureFit * textureWeight;
  const musicDomainFitScore = Math.max(0, Math.min(10, musicDomainFitNorm * 10));
  let promptFit = Math.max(0, Math.min(1, promptFitNorm));
  const inferred = inferTrackFeatures({
    track: args.track,
    promptBundle: args.promptBundle,
    tasteCore: args.tasteCore,
    sourceZone: args.sourceZone,
    queryProvenance: args.queryProvenance,
    requestLocale: args.requestLocale,
    requestedGenres: args.intent.genreIntent.requested,
  });
  promptFit = Math.max(0, Math.min(1, promptFit * 0.2 + inferred.promptFeatureFit * 0.8));

  const trackArtistIds = (args.track.artists ?? [])
    .map(a => String(a?.id ?? "").trim())
    .filter(Boolean);
  const trackArtistNames = (args.track.artists ?? []).map(a => normalizeText(a?.name ?? "")).filter(Boolean);
  const tasteArtistHit =
    trackArtistIds.some(id => args.taste.topArtistIds.has(id)) ||
    trackArtistNames.some(name => args.taste.artistTokens.has(name));
  const genreHits = (args.track.genres ?? [])
    .map(g => normalizeText(g))
    .filter(g => args.taste.genreTokens.has(g)).length;
  const tasteGenreAffinity = Math.max(0, Math.min(1, genreHits / 3));
  const vocalAffinity = tokenMatchRatioWithTitleCap({
    tokens: args.tasteCore.vocal,
    titleText: "",
    metaText,
  });
  const moodAffinity = tokenMatchRatioWithTitleCap({
    tokens: args.tasteCore.emotion,
    titleText: "",
    metaText,
  });
  const textureAffinity = tokenMatchRatioWithTitleCap({
    tokens: args.tasteCore.rhythmTolerance,
    titleText: "",
    metaText,
  });
  const artistSimilarity = tasteArtistHit ? 1 : 0;
  const genreSimilarity = Math.max(
    tasteGenreAffinity,
    tokenMatchRatioWithTitleCap({
      tokens: args.tasteCore.genreTendency,
      titleText: "",
      metaText,
    }),
  );
  const vocalSimilarity = vocalAffinity;
  const tasteSimilarityNorm = Math.max(
    0,
    Math.min(
      1,
      genreSimilarity * 0.35 +
        vocalSimilarity * 0.3 +
        moodAffinity * 0.2 +
        textureAffinity * 0.15,
    ),
  );
  const tasteFitNorm = Math.max(
    0,
    Math.min(1, tasteSimilarityNorm * 0.65 + inferred.tasteDescriptorFit * 0.3 + artistSimilarity * 0.05),
  );
  const tasteFit = Math.max(0, Math.min(20, tasteFitNorm * 20));

  const id = String(args.track?.id ?? "").trim();
  let freshness = 1;
  if (id && args.repeat.recentTrackIds.has(id)) freshness -= 1;
  const artistKeys = trackArtistKeys(args.track);
  if (artistKeys.some(k => args.repeat.recentArtistIds.has(k))) freshness -= 0.5;
  freshness = Math.max(0, Math.min(1, freshness));

  const diversity = Math.max(
    0,
    Math.min(
      1,
      1 -
        trackArtistNames.reduce(
          (acc, name) => acc + (args.repeat.recentArtistFrequency.get(name) ?? 0) * 0.08,
          0,
        ),
    ),
  );
  const penalty = NON_MUSIC_AUDIO_TERMS.some(v => fullText.includes(normalizeText(v))) ? 25 : 0;
  if (musicDomainFitScore < 3.2) {
    promptFit = Math.min(promptFit, 0.32);
  }
  const newArtist = !artistKeys.some(k => args.repeat.recentArtistIds.has(k));
  const tasteEnergyCenter =
    (args.taste.preferredEnergyRange.min + args.taste.preferredEnergyRange.max) / 2;
  const promptEnergyTarget = intentEnergyTarget;
  const trackEnergy = inferred.energy;
  const desiredShift = promptEnergyTarget - tasteEnergyCenter;
  const actualShift = trackEnergy - tasteEnergyCenter;
  const shiftAlignment = Math.max(0, 1 - Math.abs(desiredShift - actualShift));
  const promptShiftScore = Math.max(
    0,
    Math.min(
      1,
      moodFit * 0.5 + textureFit * 0.25 + sceneFit * 0.15 + shiftAlignment * 0.1,
    ),
  );
  const tooDifferent = tasteSimilarityNorm < 0.22 || promptShiftScore < 0.25;
  const zone: RecommendationZone = args.sourceZone ?? "explore";

  const sameArtist = trackArtistIds.some(id => args.taste.topArtistIds.has(id));
  const adjacentGenre = genreSimilarity >= 0.45;
  let expansionScore = Math.max(
    0,
    Math.min(1, 1 - Math.abs(tasteSimilarityNorm - 0.55) * 2),
  );
  if (sameArtist) expansionScore -= 0.35;
  if (adjacentGenre && newArtist) expansionScore += 0.2;
  if (tooDifferent) expansionScore -= 0.25;
  if (tasteSimilarityNorm > 0.9) expansionScore -= 0.2;
  expansionScore = Math.max(0, Math.min(1, expansionScore));
  if (zone !== "expand") expansionScore *= 0.2;

  const total = Math.max(0, Math.min(1, promptFit));
  const promptFeatureFit = Math.max(0, Math.min(1, inferred.promptFeatureFit * 0.9 + musicDomainFitNorm * 0.1));
  const tasteDescriptorFit = Math.max(0, Math.min(1, inferred.tasteDescriptorFit * 0.8 + tasteFitNorm * 0.2));
  const walkFit = Math.max(
    0,
    Math.min(
      1,
      inferred.movementFit * 0.5 +
        inferred.grooveFit * 0.5 +
        similarity(inferred.energy, args.promptBundle.energyLevel) * 0.2 +
        similarity(inferred.tempo, args.promptBundle.tempoLevel) * 0.2,
    ),
  );
  const energyShift = trackEnergy - tasteEnergyCenter;
  const expandShiftOk =
    (args.promptBundle.energy === "high" && energyShift >= 0.04) ||
    (args.promptBundle.energy === "mid" && Math.abs(energyShift) <= 0.18) ||
    (args.promptBundle.energy === "low" && energyShift <= 0.08);
  const expandCondition =
    zone !== "expand" ||
    (newArtist &&
      tasteDescriptorFit >= 0.35 &&
      promptFeatureFit >= 0.45 &&
      promptShiftScore >= 0.2 &&
      expandShiftOk);
  const expandGatePenalty = zone === "expand" && !expandCondition ? 9 : 0;
  let nearPromptPenalty = 0;
  if (zone === "near" && promptFit < 0.45) nearPromptPenalty = (0.45 - promptFit) * 20;
  const weightedRaw =
    promptFeatureFit * 50 +
    tasteDescriptorFit * 30 +
    freshness * 10 +
    diversity * 10 +
    walkFit * 20;
  const penaltiesNorm = Math.max(
    0,
    Math.min(1, penalty / 25) * 0.35 +
      Math.min(1, expandGatePenalty / 10) * 0.2 +
      Math.min(1, nearPromptPenalty / 20) * 0.15,
  );
  let finalScore = Math.max(0, Math.min(1, weightedRaw / 120 - penaltiesNorm));
  if (promptFeatureFit < 0.45) {
    finalScore = Math.min(finalScore, 0.42);
  }
  if (zone === "near" && promptFeatureFit < 0.55) {
    finalScore = Math.min(finalScore, 0.48);
  }
  const upbeatWalkIntent =
    args.promptBundle.movementLevel >= 0.45 &&
    args.promptBundle.energyLevel >= 0.48 &&
    args.promptBundle.mood.some(v => /bright|breezy|upbeat|refreshing|exciting/.test(v));
  if (upbeatWalkIntent) {
    const danceability = estimateTrackDanceability(args.track);
    const isBalladish = /ballad|sad|late night|night|slow|acoustic ballad/.test(fullText);
    const tooSlow = inferred.energy < 0.45 && danceability < 0.48;
    if (isBalladish || tooSlow) {
      finalScore = Math.max(0, finalScore - 0.22);
    }
  }
  const koreanIntent =
    args.intent.genreIntent.requested.some(v => /korean|k pop|k-pop|케이팝|한국|ost/.test(normalizeText(v))) ||
    /korean|k pop|k-pop|케이팝|한국|ost/.test(normalizeText(args.queryProvenance.join(" ")));
  if (koreanIntent) {
    const koreanLike = /korean|k pop|k-pop|케이팝|ost|한국|krnb|khip|hangul|한/.test(fullText);
    if (!koreanLike) finalScore = Math.max(0, finalScore - 0.12);
  }
  if (args.requestLocale === "korean" && !isKoreanTrack(args.track)) {
    finalScore *= 0.55;
  }
  const styleText = normalizeText(fullText);
  if ((args.styleFeatures?.melody ?? 0) > 0.6) {
    if (/melodic|rnb|ballad|vocal|sing/.test(styleText)) {
      finalScore = Math.min(1, finalScore + 0.08);
    }
  }
  if (args.styleFeatures?.vocalType === "rap") {
    if (/ballad|acoustic ballad|soft vocal/.test(styleText)) {
      finalScore = Math.max(0, finalScore - 0.09);
    }
    if (/hip hop|rap|drill|trap/.test(styleText)) {
      finalScore = Math.min(1, finalScore + 0.06);
    }
  }
  const artistRepeatLoad = trackArtistNames.reduce(
    (acc, name) => acc + (args.repeat.recentArtistFrequency.get(name) ?? 0),
    0,
  );
  const artistUniquenessBoost = Math.max(0, 1 - artistRepeatLoad * 0.15) * 0.012;
  const jitter =
    (seededUnit(131, `${id}|${trackArtistNames.join("|")}|${args.track.name}|${zone}`) - 0.5) *
    0.02;
  finalScore = Math.max(0, Math.min(1, finalScore + artistUniquenessBoost + jitter));
  return {
    zone,
    total,
    finalScore,
    featureAligned: inferred.featureAligned,
    promptFit: promptFeatureFit,
    promptShiftScore,
    sceneFit,
    moodFit,
    genreFit,
    textureFit,
    musicDomainFit: musicDomainFitNorm,
    expansionScore,
    tasteSimilarity: tasteSimilarityNorm,
    tasteFit: tasteDescriptorFit,
    freshness,
    diversity,
    penalty,
  };
}

function prioritizeRankingWithZonePolicy<T extends {
  track: SpotifyTrackSummary;
  zone: RecommendationZone;
  featureAligned: boolean;
  finalScore: number;
  diversity: number;
}>(items: T[], topN = 10): T[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => {
    const z = (zone: RecommendationZone): number => (zone === "expand" ? 2 : zone === "explore" ? 1 : 0);
    const fa = Number(b.featureAligned) - Number(a.featureAligned);
    if (fa !== 0) return fa;
    const zp = z(b.zone) - z(a.zone);
    if (zp !== 0) return zp;
    const div = b.diversity - a.diversity;
    if (Math.abs(div) > 1e-6) return div;
    const genreSpreadA = Math.min(1, (a.track.genres ?? []).length / 4);
    const genreSpreadB = Math.min(1, (b.track.genres ?? []).length / 4);
    const gs = genreSpreadB - genreSpreadA;
    if (Math.abs(gs) > 1e-6) return gs;
    return b.finalScore - a.finalScore;
  });
  const topLimit = Math.min(topN, sorted.length);
  const targetExpand = Math.max(1, Math.ceil(topLimit * 0.5));
  const maxNear = Math.max(1, Math.floor(topLimit * 0.3));

  const expand = sorted.filter(v => v.zone === "expand");
  const near = sorted.filter(v => v.zone === "near");
  const explore = sorted.filter(v => v.zone === "explore");
  const top: T[] = [];
  const used = new Set<string>();
  const pushUnique = (arr: T[], n: number): void => {
    for (const item of arr) {
      if (top.length >= topLimit || n <= 0) break;
      const key = trackDedupKey(item.track);
      if (!key || used.has(key)) continue;
      top.push(item);
      used.add(key);
      n -= 1;
    }
  };

  const expandAligned = expand.filter(v => v.featureAligned);
  const expandRest = expand.filter(v => !v.featureAligned);
  pushUnique(expandAligned, targetExpand);
  pushUnique(expandRest, Math.max(0, targetExpand - top.length));

  const nearQuota = maxNear;
  pushUnique(near, nearQuota);

  if (top.length < topLimit) {
    pushUnique(explore.filter(v => v.featureAligned), topLimit - top.length);
  }
  if (top.length < topLimit) {
    pushUnique(expand, topLimit - top.length);
  }
  if (top.length < topLimit) {
    pushUnique(explore, topLimit - top.length);
  }
  if (top.length < topLimit) {
    pushUnique(near, topLimit - top.length);
  }

  const tail = sorted.filter(item => {
    const key = trackDedupKey(item.track);
    return !key || !used.has(key);
  });
  return [...top, ...tail];
}

function applyDiversityAdjust(args: {
  scored: Array<{
    track: SpotifyTrackSummary;
    zone: RecommendationZone;
    total: number;
    finalScore: number;
    featureAligned: boolean;
    promptFit: number;
    promptShiftScore: number;
    sceneFit: number;
    moodFit: number;
    genreFit: number;
    textureFit: number;
    musicDomainFit: number;
    expansionScore: number;
    tasteSimilarity: number;
    tasteFit: number;
    freshness: number;
    diversity: number;
    penalty: number;
  }>;
  targetCount: number;
  repeat: RepeatSuppressionState;
}): SpotifyTrackSummary[] {
  const ratio = { near: 0.3, expand: 0.5, explore: 0.2 };
  const maxZoneRatio = 0.7;
  const scoreKey = (item: {
    track: SpotifyTrackSummary;
    zone: RecommendationZone;
    featureAligned: boolean;
    finalScore: number;
    diversity: number;
  }): number => {
    const artistUniq = trackArtistKeys(item.track).length > 0 ? 1 : 0;
    const genreSpread = Math.min(1, (item.track.genres ?? []).length / 4);
    const tie = seededUnit(97, trackDedupKey(item.track) ?? item.track.name ?? "");
    const expandPriority = item.zone === "expand" ? 0.03 : item.zone === "near" ? -0.01 : 0.01;
    const featurePriority = item.featureAligned ? 0.04 : 0;
    return item.finalScore + featurePriority + expandPriority + item.diversity * 0.015 + artistUniq * 0.01 + genreSpread * 0.008 + tie * 0.002;
  };
  const quota = {
    near: Math.max(1, Math.round(args.targetCount * ratio.near)),
    expand: Math.max(1, Math.round(args.targetCount * ratio.expand)),
    explore: Math.max(1, args.targetCount - Math.round(args.targetCount * ratio.near) - Math.round(args.targetCount * ratio.expand)),
  };
  const zoneBuckets = {
    near: args.scored.filter(v => v.zone === "near").sort((a, b) => scoreKey(b) - scoreKey(a)),
    expand: args.scored.filter(v => v.zone === "expand").sort((a, b) => scoreKey(b) - scoreKey(a)),
    explore: args.scored.filter(v => v.zone === "explore").sort((a, b) => scoreKey(b) - scoreKey(a)),
  };
  const selected: SpotifyTrackSummary[] = [];
  const artistCount = new Map<string, number>();
  const genreStreakState: { lastGenre: string; streak: number } = { lastGenre: "", streak: 0 };
  const zoneCount: Record<RecommendationZone, number> = { near: 0, expand: 0, explore: 0 };
  const maxPerArtist = 2;
  const maxSameGenreStreak = 3;
  const pickedKeys = new Set<string>();
  const scoreBinCount = new Map<string, number>();
  const dominantGenreKey = (track: SpotifyTrackSummary): string =>
    normalizeText(String(track.genres?.[0] ?? track.album?.name ?? "unknown"));
  const canPickGenre = (track: SpotifyTrackSummary): boolean => {
    const g = dominantGenreKey(track);
    if (!genreStreakState.lastGenre) return true;
    if (g !== genreStreakState.lastGenre) return true;
    return genreStreakState.streak < maxSameGenreStreak;
  };
  const recordPickedGenre = (track: SpotifyTrackSummary): void => {
    const g = dominantGenreKey(track);
    if (!genreStreakState.lastGenre || genreStreakState.lastGenre !== g) {
      genreStreakState.lastGenre = g;
      genreStreakState.streak = 1;
      return;
    }
    genreStreakState.streak += 1;
  };
  const tryPickFromBucket = (
    bucket: Array<{
      track: SpotifyTrackSummary;
      zone: RecommendationZone;
      total: number;
      finalScore: number;
      featureAligned: boolean;
      promptFit: number;
      promptShiftScore: number;
      sceneFit: number;
      moodFit: number;
      genreFit: number;
      textureFit: number;
      musicDomainFit: number;
      expansionScore: number;
      tasteSimilarity: number;
      tasteFit: number;
      freshness: number;
      diversity: number;
      penalty: number;
    }>,
  ): SpotifyTrackSummary | null => {
    let best: SpotifyTrackSummary | null = null;
    let bestAdjusted = -Infinity;
    for (const item of bucket) {
      const key = trackDedupKey(item.track);
      if (!key || pickedKeys.has(key)) continue;
      if (item.zone === "explore" && item.promptFit < 0.35) continue;
      const artistKeys = trackArtistKeys(item.track);
      if (artistKeys.some(k => (artistCount.get(k) ?? 0) >= maxPerArtist)) continue;
      if (artistKeys.some(k => (args.repeat.recentArtistFrequency.get(k) ?? 0) >= 3)) continue;
      if (!canPickGenre(item.track)) continue;
      const bin = item.finalScore.toFixed(3);
      if ((scoreBinCount.get(bin) ?? 0) >= 2) continue;
      const saturationPenalty = artistKeys.reduce((acc, k) => acc + (artistCount.get(k) ?? 0) * 5.5, 0);
      const adjusted = item.finalScore - saturationPenalty;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        best = item.track;
      }
    }
    return best;
  };
  const zoneOrder: RecommendationZone[] = ["expand", "near", "explore"];
  if (zoneBuckets.expand.length > 0 && quota.expand > 0) {
    const forced = tryPickFromBucket(zoneBuckets.expand);
    if (forced) {
      const key = trackDedupKey(forced);
      if (key && !pickedKeys.has(key)) {
        selected.push(forced);
        pickedKeys.add(key);
        const hit = args.scored.find(v => trackDedupKey(v.track) === key);
        if (hit) {
          const bin = hit.finalScore.toFixed(3);
          scoreBinCount.set(bin, (scoreBinCount.get(bin) ?? 0) + 1);
        }
        quota.expand -= 1;
        zoneCount.expand += 1;
        trackArtistKeys(forced).forEach(k => artistCount.set(k, (artistCount.get(k) ?? 0) + 1));
        recordPickedGenre(forced);
      }
    }
  }
  for (const zone of zoneOrder) {
    while (selected.length < args.targetCount && quota[zone] > 0) {
      const picked = tryPickFromBucket(zoneBuckets[zone]);
      if (!picked) break;
      const key = trackDedupKey(picked);
      if (!key || pickedKeys.has(key)) break;
      selected.push(picked);
      pickedKeys.add(key);
      const hit = args.scored.find(v => trackDedupKey(v.track) === key);
      if (hit) {
        const bin = hit.finalScore.toFixed(3);
        scoreBinCount.set(bin, (scoreBinCount.get(bin) ?? 0) + 1);
      }
      quota[zone] -= 1;
      zoneCount[zone] += 1;
      trackArtistKeys(picked).forEach(k => artistCount.set(k, (artistCount.get(k) ?? 0) + 1));
      recordPickedGenre(picked);
    }
  }
  if (selected.length < args.targetCount) {
    const fallback = [...args.scored].sort((a, b) => b.finalScore - a.finalScore);
    for (const item of fallback) {
      if (selected.length >= args.targetCount) break;
      const key = trackDedupKey(item.track);
      if (!key || pickedKeys.has(key)) continue;
      if (item.zone === "explore" && item.promptFit < 0.35) continue;
      const artistKeys = trackArtistKeys(item.track);
      if (artistKeys.some(k => (artistCount.get(k) ?? 0) >= maxPerArtist)) continue;
      if (!canPickGenre(item.track)) continue;
      const projected = zoneCount[item.zone] + 1;
      const projectedRatio = projected / Math.max(1, selected.length + 1);
      if (projectedRatio > maxZoneRatio) continue;
      selected.push(item.track);
      pickedKeys.add(key);
      const bin = item.finalScore.toFixed(3);
      scoreBinCount.set(bin, (scoreBinCount.get(bin) ?? 0) + 1);
      zoneCount[item.zone] += 1;
      artistKeys.forEach(k => artistCount.set(k, (artistCount.get(k) ?? 0) + 1));
      recordPickedGenre(item.track);
    }
  }
  if (selected.length < args.targetCount) {
    const relaxed = [...args.scored].sort((a, b) => b.finalScore - a.finalScore);
    for (const item of relaxed) {
      if (selected.length >= args.targetCount) break;
      const key = trackDedupKey(item.track);
      if (!key || pickedKeys.has(key)) continue;
      if (item.zone === "explore" && item.promptFit < 0.3) continue;
      const artistKeys = trackArtistKeys(item.track);
      if (artistKeys.some(k => (artistCount.get(k) ?? 0) >= maxPerArtist)) continue;
      if (!canPickGenre(item.track)) continue;
      selected.push(item.track);
      pickedKeys.add(key);
      const bin = item.finalScore.toFixed(3);
      scoreBinCount.set(bin, (scoreBinCount.get(bin) ?? 0) + 1);
      zoneCount[item.zone] += 1;
      artistKeys.forEach(k => artistCount.set(k, (artistCount.get(k) ?? 0) + 1));
      recordPickedGenre(item.track);
    }
  }
  const selectedScored = selected
    .map(track => args.scored.find(item => trackDedupKey(item.track) === trackDedupKey(track)))
    .filter((v): v is (typeof args.scored)[number] => Boolean(v));
  const prioritizedTop = prioritizeRankingWithZonePolicy(selectedScored, 10);
  const prioritizedKeys = new Set(
    prioritizedTop
      .map(v => trackDedupKey(v.track))
      .filter((v): v is string => Boolean(v)),
  );
  const tail = selected.filter(track => !prioritizedKeys.has(trackDedupKey(track) ?? ""));
  return [...prioritizedTop.map(v => v.track), ...tail];
}

function logSunnyWalkRegressionDiagnostics(args: {
  prompt: string;
  scored: Array<{
    track: SpotifyTrackSummary;
    zone: RecommendationZone;
    promptFit: number;
    tasteFit: number;
    featureAligned: boolean;
    finalScore: number;
  }>;
  taste: TasteProfileSignals;
  selected?: SpotifyTrackSummary[];
  requestId?: string;
}): void {
  const promptText = normalizeText(args.prompt);
  if (!/(화창|sunny|한강|hangang|산책|walk)/.test(promptText)) return;
  const top = (() => {
    if (!args.selected?.length) return args.scored.slice(0, 10);
    const scoredByKey = new Map(
      args.scored
        .map(item => [trackDedupKey(item.track), item] as const)
        .filter((v): v is [string, (typeof args.scored)[number]] => Boolean(v[0])),
    );
    return args.selected
      .slice(0, 10)
      .map(track => scoredByKey.get(trackDedupKey(track) ?? ""))
      .filter((v): v is (typeof args.scored)[number] => Boolean(v));
  })();
  const isWalkableUpbeat = (track: SpotifyTrackSummary): boolean => {
    const text = normalizeText(
      [track.name, track.album?.name ?? "", ...(track.artists ?? []).map(a => a.name), ...(track.genres ?? [])].join(" "),
    );
    const energy = estimateTrackEnergy(track);
    const dance = estimateTrackDanceability(track);
    const walkCue = /walk|stroll|groove|tempo|bounce|forward|motion|breezy|upbeat|light/.test(text);
    return (energy >= 0.5 && dance >= 0.5) || (walkCue && energy >= 0.45);
  };
  const isNonBallad = (track: SpotifyTrackSummary): boolean => {
    const text = normalizeText(
      [track.name, track.album?.name ?? "", ...(track.artists ?? []).map(a => a.name), ...(track.genres ?? [])].join(" "),
    );
    const energy = estimateTrackEnergy(track);
    return !/ballad|sad|late night|too slow|slow/.test(text) && energy >= 0.42;
  };
  const isKoreanVocal = (track: SpotifyTrackSummary): boolean => {
    const text = normalizeText(
      [track.name, ...(track.artists ?? []).map(a => a.name), ...(track.genres ?? [])].join(" "),
    );
    return /(korean|k pop|k-pop|korean rnb|k-?hip|ost|vocal|보컬|한국)/.test(text);
  };
  const titleDrivenHits = top.filter(item => {
    const title = normalizeText(item.track.name ?? "");
    const artist = normalizeText(String(item.track.artists?.[0]?.name ?? ""));
    const genre = normalizeText((item.track.genres ?? []).join(" "));
    const hasSurfaceTitle = /sunny|walk|light|day|coming|days|river/.test(title);
    const noMusicSupport = !/korean|k pop|k-pop|rnb|soul|hip hop|ost|vocal|groove|tempo/.test(
      `${artist} ${genre}`,
    );
    return hasSurfaceTitle && noMusicSupport;
  }).length;
  const featureAlignedHits = top.filter(item => {
    const energy = estimateTrackEnergy(item.track);
    const dance = estimateTrackDanceability(item.track);
    const text = normalizeText(
      [
        item.track.name,
        item.track.album?.name ?? "",
        ...(item.track.artists ?? []).map(a => a.name),
        ...(item.track.genres ?? []),
      ].join(" "),
    );
    const hasWalkFeature = /groove|tempo|bounce|breezy|light|upbeat|walkable|steady/.test(text);
    return (energy >= 0.45 && dance >= 0.45 && hasWalkFeature) || item.featureAligned;
  }).length;
  const repeatedTopArtists = top.filter(item => {
    const artistName = normalizeText(String(item.track.artists?.[0]?.name ?? ""));
    return artistName && args.taste.topArtistNames.map(v => normalizeText(v)).includes(artistName);
  }).length;
  const zoneDistTop = top.reduce<Record<string, number>>((acc, item) => {
    acc[item.zone] = (acc[item.zone] ?? 0) + 1;
    return acc;
  }, {});
  const tasteZeroCount = top.filter(item => item.tasteFit <= 0.01).length;
  const selectedZoneDist = (args.selected ?? []).reduce<Record<string, number>>((acc, track) => {
    const hit = args.scored.find(item => trackDedupKey(item.track) === trackDedupKey(track));
    const zone = hit?.zone ?? "unknown";
    acc[zone] = (acc[zone] ?? 0) + 1;
    return acc;
  }, {});
  if (args.selected?.length && Object.keys(selectedZoneDist).length === 0) {
    throw new Error("[Regression] invalid selectedZones={} snapshot");
  }
  const selectedExpandCount = selectedZoneDist.expand ?? 0;
  const topUpbeatWalkable = top.filter(item => isWalkableUpbeat(item.track)).length;
  const topNonBallad = top.filter(item => isNonBallad(item.track)).length;
  const topKoreanVocal = top.filter(item => isKoreanVocal(item.track)).length;
  const finalSelection = args.selected ?? [];
  const finalExpandRetention = finalSelection.length
    ? selectedExpandCount / finalSelection.length
    : 0;
  console.warn(
    `[Regression] requestId=${args.requestId || "-"} sunny_walk top10_tasteZero=${tasteZeroCount}/10 titleDriven=${titleDrivenHits}/10 featureAligned=${featureAlignedHits}/10 top10_upbeatWalkable=${topUpbeatWalkable}/10 top10_nonBallad=${topNonBallad}/10 top10_koreanVocal=${topKoreanVocal}/10 topArtistRepeats=${repeatedTopArtists}/10 final_expandRetention=${finalExpandRetention.toFixed(2)} selectedZones=${JSON.stringify(selectedZoneDist)} zonesTop10=${JSON.stringify(zoneDistTop)}`,
  );
}

function fitDuration(args: {
  tracks: SpotifyTrackSummary[];
  candidatePool: SpotifyTrackSummary[];
  targetMinutes: number | null;
  mode: TimeConstraint["mode"] | null;
  seed: number;
}): SpotifyTrackSummary[] {
  if (!args.targetMinutes || args.targetMinutes <= 0) return args.tracks;
  const byDuration = buildPlaylistByDuration({
    tracks: args.tracks,
    targetMinutes: args.targetMinutes,
    isMinimum: args.mode === "at_least",
    seed: args.seed,
    maxPerArtist: 2,
  });
  if (!byDuration.length) return args.tracks;
  const targetMs = args.targetMinutes * 60 * 1000;
  return packTracksToDurationWindow({
    selected: byDuration,
    pool: args.candidatePool,
    targetMs,
    minMs: Math.round(targetMs * 0.9),
    maxMs: Math.round(targetMs * 1.1),
  });
}

function topUpDuration(args: {
  selected: SpotifyTrackSummary[];
  candidatePool: SpotifyTrackSummary[];
  minDurationMs: number;
  maxCount: number;
}): SpotifyTrackSummary[] {
  const selected = [...args.selected];
  const used = new Set(
    selected.map(track => trackDedupKey(track)).filter((v): v is string => Boolean(v)),
  );
  let total = sumDurationMs(selected);
  for (const track of args.candidatePool) {
    if (selected.length >= args.maxCount) break;
    if (total >= args.minDurationMs) break;
    const key = trackDedupKey(track);
    if (!key || used.has(key)) continue;
    selected.push(track);
    used.add(key);
    total = sumDurationMs(selected);
  }
  return selected;
}

function enforceFinalSelectionRetention(args: {
  selected: SpotifyTrackSummary[];
  scored: Array<{
    track: SpotifyTrackSummary;
    zone: RecommendationZone;
    finalScore: number;
    featureAligned: boolean;
  }>;
  minExpandRatio?: number;
  maxNearRatio?: number;
}): SpotifyTrackSummary[] {
  const minExpandRatio = Math.max(0.3, Math.min(0.7, args.minExpandRatio ?? 0.5));
  const maxNearRatio = Math.max(0.1, Math.min(0.5, args.maxNearRatio ?? 0.3));
  if (!args.selected.length) return args.selected;
  const selected = [...args.selected];
  const selectedKeys = new Set(
    selected.map(t => trackDedupKey(t)).filter((v): v is string => Boolean(v)),
  );
  const scoredByKey = new Map(
    args.scored
      .map(item => [trackDedupKey(item.track), item] as const)
      .filter((v): v is [string, (typeof args.scored)[number]] => Boolean(v[0])),
  );
  const countZone = (zone: RecommendationZone): number =>
    selected.reduce((acc, t) => {
      const item = scoredByKey.get(trackDedupKey(t) ?? "");
      return acc + (item?.zone === zone ? 1 : 0);
    }, 0);
  const targetExpand = Math.ceil(selected.length * minExpandRatio);
  const allowedNear = Math.floor(selected.length * maxNearRatio);
  const expandPool = args.scored
    .filter(item => item.zone === "expand" && item.featureAligned)
    .sort((a, b) => b.finalScore - a.finalScore);
  const nearOrExploreByLowScore = selected
    .map(t => ({ track: t, score: scoredByKey.get(trackDedupKey(t) ?? "")?.finalScore ?? 0, zone: scoredByKey.get(trackDedupKey(t) ?? "")?.zone ?? "explore" as RecommendationZone }))
    .filter(v => v.zone !== "expand")
    .sort((a, b) => a.score - b.score);

  let expandCount = countZone("expand");
  let nearCount = countZone("near");
  let swapCursor = 0;
  for (const expandCandidate of expandPool) {
    if (expandCount >= targetExpand && nearCount <= allowedNear) break;
    const key = trackDedupKey(expandCandidate.track);
    if (!key || selectedKeys.has(key)) continue;
    const victim = nearOrExploreByLowScore[swapCursor];
    if (!victim) break;
    swapCursor += 1;
    const victimKey = trackDedupKey(victim.track);
    if (!victimKey) continue;
    const idx = selected.findIndex(t => trackDedupKey(t) === victimKey);
    if (idx < 0) continue;
    selected[idx] = expandCandidate.track;
    selectedKeys.delete(victimKey);
    selectedKeys.add(key);
    expandCount = countZone("expand");
    nearCount = countZone("near");
  }
  return selected;
}

function enforceFinalTop10ExpandPolicy(args: {
  selected: SpotifyTrackSummary[];
  scored: Array<{
    track: SpotifyTrackSummary;
    zone: RecommendationZone;
    finalScore: number;
    featureAligned: boolean;
    diversity: number;
  }>;
  minExpandTop10Ratio?: number;
}): SpotifyTrackSummary[] {
  const minExpandTop10Ratio = Math.max(0.3, Math.min(0.8, args.minExpandTop10Ratio ?? 0.5));
  const selected = [...args.selected];
  if (!selected.length) return selected;
  const scoredByKey = new Map(
    args.scored
      .map(item => [trackDedupKey(item.track), item] as const)
      .filter((v): v is [string, (typeof args.scored)[number]] => Boolean(v[0])),
  );
  const topN = Math.min(10, selected.length);
  const top = selected.slice(0, topN);
  const expandTarget = Math.ceil(topN * minExpandTop10Ratio);
  let expandCount = top.reduce((acc, t) => {
    const zone = scoredByKey.get(trackDedupKey(t) ?? "")?.zone;
    return acc + (zone === "expand" ? 1 : 0);
  }, 0);
  if (expandCount >= expandTarget) return selected;

  const expandPool = args.scored
    .filter(item => item.zone === "expand")
    .sort((a, b) => {
      const fa = Number(b.featureAligned) - Number(a.featureAligned);
      if (fa !== 0) return fa;
      return b.finalScore - a.finalScore;
    })
    .map(item => item.track);
  const selectedKeys = new Set(
    selected.map(t => trackDedupKey(t)).filter((v): v is string => Boolean(v)),
  );
  const victims = top
    .map((track, index) => ({ track, index, score: scoredByKey.get(trackDedupKey(track) ?? "")?.finalScore ?? 0, zone: scoredByKey.get(trackDedupKey(track) ?? "")?.zone ?? "explore" as RecommendationZone }))
    .filter(v => v.zone !== "expand")
    .sort((a, b) => a.score - b.score);
  let victimCursor = 0;
  for (const candidate of expandPool) {
    if (expandCount >= expandTarget) break;
    const cKey = trackDedupKey(candidate);
    if (!cKey || selectedKeys.has(cKey)) continue;
    const victim = victims[victimCursor];
    if (!victim) break;
    victimCursor += 1;
    selected[victim.index] = candidate;
    selectedKeys.delete(trackDedupKey(victim.track) ?? "");
    selectedKeys.add(cKey);
    expandCount += 1;
  }
  return selected;
}

function enforceKoreanVocalTop10(args: {
  selected: SpotifyTrackSummary[];
  scored: Array<{
    track: SpotifyTrackSummary;
    zone: RecommendationZone;
    finalScore: number;
    featureAligned: boolean;
  }>;
  require: boolean;
  minRatio?: number;
}): SpotifyTrackSummary[] {
  if (!args.require || !args.selected.length) return args.selected;
  const minRatio = Math.max(0.5, Math.min(0.9, args.minRatio ?? 0.7));
  const isKoreanLike = (track: SpotifyTrackSummary): boolean => {
    const text = normalizeText(
      [track.name, track.album?.name ?? "", ...(track.artists ?? []).map(a => a.name), ...(track.genres ?? [])].join(" "),
    );
    return /(korean|k pop|k-pop|ost|한국|보컬|krnb|khip|한)/.test(text);
  };
  const selected = [...args.selected];
  const topN = Math.min(10, selected.length);
  const target = Math.ceil(topN * minRatio);
  let current = selected.slice(0, topN).filter(isKoreanLike).length;
  if (current >= target) return selected;

  const selectedKeys = new Set(
    selected.map(t => trackDedupKey(t)).filter((v): v is string => Boolean(v)),
  );
  const pool = args.scored
    .filter(item => isKoreanLike(item.track))
    .sort((a, b) => {
      const fa = Number(b.featureAligned) - Number(a.featureAligned);
      if (fa !== 0) return fa;
      return b.finalScore - a.finalScore;
    })
    .map(v => v.track);
  const victims = selected
    .slice(0, topN)
    .map((track, index) => ({ track, index }))
    .filter(v => !isKoreanLike(v.track));
  let victimCursor = 0;
  for (const candidate of pool) {
    if (current >= target) break;
    const cKey = trackDedupKey(candidate);
    if (!cKey || selectedKeys.has(cKey)) continue;
    const victim = victims[victimCursor];
    if (!victim) break;
    victimCursor += 1;
    selected[victim.index] = candidate;
    selectedKeys.delete(trackDedupKey(victim.track) ?? "");
    selectedKeys.add(cKey);
    current += 1;
  }
  return selected;
}

function isKoreanVocalLikeTrack(track: SpotifyTrackSummary): boolean {
  const text = normalizeText(
    [track.name, track.album?.name ?? "", ...(track.artists ?? []).map(a => a.name), ...(track.genres ?? [])].join(" "),
  );
  return /(korean|k pop|k-pop|kpop|krnb|k-indie|k indie|korean hip hop|ost|soundtrack|한국|국내|케이팝|알앤비|소울)/.test(text);
}

function getRequiredKoreanVocalRatio(args: {
  structuredIntent: StructuredIntent;
  parsedIntent: ParsedIntent;
  prompt: string;
}): number {
  const genres = new Set(args.structuredIntent.locked?.genres ?? []);
  const normalizedPrompt = normalizeText(args.prompt);
  const isWork =
    args.structuredIntent.activity.some(v => /work|study|focus|작업|공부|집중/.test(normalizeText(v))) ||
    args.parsedIntent.scene.activity.some(v => /work|study|focus|작업|공부|집중/.test(normalizeText(v))) ||
    /work|study|focus|작업|공부|집중/.test(normalizedPrompt);
  const isCafe =
    args.structuredIntent.environment.some(v => /cafe|카페/.test(normalizeText(v))) ||
    args.parsedIntent.scene.place.some(v => /cafe|카페/.test(normalizeText(v))) ||
    /cafe|카페/.test(normalizedPrompt);
  const hasWideMix = genres.size >= 6;
  const hasOST = genres.has("ost");
  const hasRnbSoul = genres.has("r&b") || genres.has("soul");
  let ratio = 0.45;
  if (!hasWideMix && !isWork && !isCafe) ratio = 0.6;
  if (isWork || isCafe) ratio = 0.35;
  if (hasWideMix) ratio = Math.min(ratio, 0.35);
  if (hasOST || hasRnbSoul) ratio = Math.min(ratio, 0.4);
  return ratio;
}

function repairKoreanVocalRatio(args: {
  selected: SpotifyTrackSummary[];
  candidatePool: SpotifyTrackSummary[];
  requiredRatio: number;
  maxReplace: number;
}): SpotifyTrackSummary[] {
  const current = [...args.selected];
  if (!current.length) return current;
  let koreanCount = current.filter(isKoreanVocalLikeTrack).length;
  let ratio = koreanCount / current.length;
  if (ratio >= args.requiredRatio) return current;

  const replaceTargets = current.filter(t => !isKoreanVocalLikeTrack(t));
  const replacements = args.candidatePool.filter(
    t =>
      isKoreanVocalLikeTrack(t) &&
      !current.some(s => trackDedupKey(s) === trackDedupKey(t)),
  );

  let replaced = 0;
  for (let i = 0; i < replaceTargets.length && i < replacements.length; i += 1) {
    if (replaced >= args.maxReplace) break;
    const victim = replaceTargets[i];
    const replacement = replacements[i];
    const idx = current.findIndex(t => trackDedupKey(t) === trackDedupKey(victim));
    if (idx < 0) continue;
    current[idx] = replacement;
    replaced += 1;
    koreanCount = current.filter(isKoreanVocalLikeTrack).length;
    ratio = koreanCount / current.length;
    if (ratio >= args.requiredRatio) break;
  }

  console.warn("[Playlist] korean vocal repair result", {
    replaced,
    ratio: Number(ratio.toFixed(2)),
    requiredRatio: Number(args.requiredRatio.toFixed(2)),
    finalCount: current.length,
  });
  return current;
}

async function generatePlaylistSummariesCore(
  prompt: string,
  userToken: string,
  preAnalyzedProfile?: GeminiRecommendationProfile | null,
  preloadedBootstrap?: SpotifyBootstrapData | null,
  onProgress?: (event: AnalysisProgressEvent) => void,
  options?: {
    requestId?: string;
    hardTimeoutMs?: number;
    minimumPlayableTracks?: number;
    earlyFinalizeThreshold?: number;
    targetTracks?: number;
    abortSignal?: AbortSignal;
  },
): Promise<{ tracks: SpotifyTrackSummary[]; profile: GeminiRecommendationProfile }> {
  const requestId = String(options?.requestId ?? "").trim();
  const startedAt = Date.now();
  const normalizedPrompt = normalizePrompt(prompt);
  const hardTimeoutMs = clamp(Number(options?.hardTimeoutMs ?? 21_000), 8_000, 30_000);
  const maxDurationMs = hardTimeoutMs;
  const targetTracks = Math.max(16, Number(options?.targetTracks ?? 36));
  assertNotCancelled(requestId, options?.abortSignal, "pipeline_start");

  onProgress?.({
    stage: "analysis_start",
    progress: 0.12,
    step: 0,
    label: "요청 의도를 분석하고 있어요",
    analysisStatus: getLatestGeminiAnalysisStatus(),
    requestId,
  });

  const topTracks =
    preloadedBootstrap?.topTracks?.length
      ? preloadedBootstrap.topTracks.slice(0, 20)
      : await getSpotifyTopTracks(userToken, 20).catch(() => [] as SpotifyTrackSummary[]);
  const topArtists =
    preloadedBootstrap?.topArtists?.length
      ? preloadedBootstrap.topArtists.slice(0, 20)
      : await getSpotifyTopArtists(userToken, 20).catch(() => [] as SpotifyArtistSummary[]);
  const bootstrap: SpotifyBootstrapData = preloadedBootstrap
    ? { ...preloadedBootstrap, topTracks, topArtists }
    : { topTracks, topArtists, playlists: [], recentlyPlayed: [] };

  const profile = buildLocalRecommendationProfile(prompt);
  const basePromptFeatures = buildBasePromptFeatures(prompt);
  const structuredIntent = parseStructuredIntent(prompt, basePromptFeatures);
  if (requestId) {
    forcedIntentSnapshotByRequestId.set(requestId, {
      forcedGenres: structuredIntent.locked.genres,
      forcedSpecialTags: structuredIntent.locked.specialTags,
    });
  }
  const parsedIntent = analyzeIntent(prompt);
  const intent: ParsedIntent = {
    ...parsedIntent,
    genreIntent: {
      ...parsedIntent.genreIntent,
      requested: structuredIntent.genres.length
        ? structuredIntent.genres.map(mapRawGenreToQueryGenre).filter(Boolean)
        : (basePromptFeatures.requestedGenres.length
            ? basePromptFeatures.requestedGenres
            : parsedIntent.genreIntent.requested),
    },
    duration: {
      targetMinutes:
        structuredIntent.durationMin ??
        parsedIntent.duration.targetMinutes ??
        structuredIntent.durationMax ??
        null,
    },
  };
  const promptHash = promptFingerprint(prompt);
  const repeatState = buildRepeatSuppressionState(promptHash);
  const taste = buildUserTasteProfileSignals({ bootstrap });
  const promptBundle = profile?.source && profile.source !== "fallback"
    ? buildPromptFeatureBundleFromAnalyzedProfile(intent, profile, prompt, basePromptFeatures)
    : basePromptFeaturesToBundle(basePromptFeatures, intent);
  const coreGenres = selectCoreGenres(structuredIntent, basePromptFeatures, prompt);
  const stableIntentForQuery: StructuredIntent = {
    ...structuredIntent,
    genres: coreGenres,
  };
  const stableQueryPlan = buildQueryStrategy(stableIntentForQuery);
  const stableQueries = stableQueryPlan.finalQueries;
  console.warn(
    `[QueryStrategy] requestId=${requestId || "-"} coreGenres=${coreGenres.join("|") || "-"} queries=${stableQueries.join(" || ") || "-"} queryCount=${stableQueries.length}`,
  );
  // Fire-and-forget: start Spotify search immediately so onTracks callbacks
  // keep populating partialSearchResultsByRequestId even after outer timeout fires.
  const _dispatchPromise = dispatchQueries({
    queries: stableQueries,
    accessToken: userToken,
    requestId,
    abortSignal: undefined,
    randomSeed: stableHash(`${buildRequestSeed()}|stable|${promptHash}`),
    seedGenresHint: coreGenres,
    targetEnergy: profile.energy,
    targetValence: profile.valence,
    targetAcousticness: profile.acousticness,
  });
  // Race with 15s local timeout — if Spotify finishes in time, use results directly.
  // If not, partial pool is still being filled by onTracks callbacks in the background.
  const _dispatchRaceTimeout = new Promise<{
    tracks: SpotifyTrackSummary[];
    callCount: number;
    dispatchedQueries: string[];
  }>(resolve =>
    setTimeout(() => resolve({ tracks: [], callCount: 0, dispatchedQueries: [] }), 15000),
  );
  const stableCollected = await Promise.race([_dispatchPromise, _dispatchRaceTimeout]);
  let stablePool = stableCollected.tracks.length
    ? stableCollected.tracks
    : mergeUniqueTracks(
        readPartialPool(requestId),
        candidateCacheByRequestId.get(requestId) ?? [],
      );
  if (requestId) {
    candidateCacheByRequestId.set(requestId, stablePool.slice(0, 120));
  }
  if (!stablePool.length) {
    if (requestId) {
      let retryPool = mergeUniqueTracks(
        readPartialPool(requestId),
        candidateCacheByRequestId.get(requestId) ?? [],
      );
      for (let i = 0; i < 10 && !retryPool.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 800));
        retryPool = mergeUniqueTracks(
          readPartialPool(requestId),
          candidateCacheByRequestId.get(requestId) ?? [],
        );
        console.warn(`[StablePoolWait] requestId=${requestId} poll=${i + 1} size=${retryPool.length}`);
      }
      if (retryPool.length) {
        stablePool = retryPool;
      }
    }
  }
  if (!stablePool.length) {
    stablePool = await fallbackToGlobalPopular({
      accessToken: userToken,
      requestId,
      abortSignal: options?.abortSignal,
      randomSeed: stableHash(`${buildRequestSeed()}|stable_fallback|${promptHash}`),
      maxDurationMs: 3200,
    });
  }
  if (stablePool.length) {
    const rerankedStable = rerankTracks(stablePool, structuredIntent);
    const quotaStable = applyGenreQuota(rerankedStable, structuredIntent);
    const rankedStable = rankTracksStable(quotaStable, structuredIntent);
    const composedStable = composeStable(rankedStable.slice(0, 40), structuredIntent);
    if (composedStable.length) {
      console.warn(
        `[CandidatePool] requestId=${requestId || "-"} total=${composedStable.length} spotifyCalls=${stableCollected.callCount} mode=stable`,
      );
      if (requestId) {
        candidateCacheByRequestId.set(requestId, composedStable.slice(0, 120));
      }
      return { tracks: composedStable, profile };
    }
  }
  const searchIntent = buildSearchIntent(structuredIntent);
  const baseBucketPlan = buildBucketPlan(structuredIntent);
  const bucketPlan = scaleBuckets(
    structuredIntent,
    structuredIntent.durationMin ?? intent.duration.targetMinutes ?? null,
    baseBucketPlan,
  );
  const queryStrategy = buildDynamicQueryStrategy(structuredIntent);
  const geminiCalledCount = 0;
  const tasteCore = buildTasteDescriptorCore(taste);
  const randomSeed = stableHash(`${buildRequestSeed()}|${promptHash}|${recommendationHistory.length}`);
  const bucketPrimaryQueries = Array.from(
    new Set(bucketPlan.buckets.flatMap(bucket => buildBucketQueries(bucket).primary)),
  );
  const bucketAliasQueries = Array.from(
    new Set(bucketPlan.buckets.flatMap(bucket => buildBucketQueries(bucket).discovery)),
  );
  const bucketRelaxedQueries = Array.from(
    new Set(bucketPlan.buckets.flatMap(bucket => buildBucketQueries(bucket).recovery)),
  );
  const bucketPlaylistQueries = buildPlaylistFallbackQueries(searchIntent);

  console.warn(
    `[Intent] requestId=${requestId || "-"} time=${intent.scene.timeOfDay.join("|") || "-"} activity=${intent.scene.activity.join("|") || "-"} place=${intent.scene.place.join("|") || "-"} weather=${intent.scene.weather.join("|") || "-"} mood=${intent.mood.primary.join("|") || "-"} genres=${intent.genreIntent.requested.join("|") || "-"} duration=${intent.duration.targetMinutes ?? "-"}`,
  );
  console.warn(
    `[FeatureVector] requestId=${requestId || "-"} movement=${promptBundle.movementLevel.toFixed(2)} energy=${promptBundle.energyLevel.toFixed(2)} tempo=${promptBundle.tempoLevel.toFixed(2)} groove=${promptBundle.grooveLevel.toFixed(2)} mood=${promptBundle.mood.join("|") || "-"} texture=${promptBundle.texture.join("|") || "-"} environment=${promptBundle.environment.join("|") || "-"} vocal=${promptBundle.vocal.join("|") || "-"}`,
  );
  console.warn(
    `[BaseParser] requestId=${requestId || "-"} confidence=${basePromptFeatures.confidence.toFixed(2)} genres=${basePromptFeatures.requestedGenres.join("|") || "-"} mood=${basePromptFeatures.moodTokens.join("|") || "-"} texture=${basePromptFeatures.textureTokens.join("|") || "-"} vocal=${basePromptFeatures.vocalTokens.join("|") || "-"} locale=${basePromptFeatures.requestedLocale ?? "-"} durationMin=${basePromptFeatures.requestedDurationMin ?? "-"} retention=${JSON.stringify(basePromptFeatures.retention)} diagnostics=${JSON.stringify(basePromptFeatures.diagnostics ?? {})}`,
  );
  console.warn(
    `[SearchIntent] requestId=${requestId || "-"} locale=${searchIntent.locale} anchorGenres=${searchIntent.anchorGenres.join("|") || "-"} supportGenres=${searchIntent.supportGenres.join("|") || "-"} soundtrackHints=${searchIntent.soundtrackHints.join("|") || "-"} rankingOnly=${searchIntent.rankingOnlyTags.join("|") || "-"} banned=${searchIntent.bannedTokens.join("|") || "-"}`,
  );
  console.warn(
    `[StructuredIntent] requestId=${requestId || "-"} payload=${JSON.stringify(structuredIntent)}`,
  );
  console.warn(
    `[BucketPlan] requestId=${requestId || "-"} buckets=${JSON.stringify(bucketPlan.buckets)}`,
  );
  console.warn(
    `[BucketScaling] requestId=${requestId || "-"} durationMin=${structuredIntent.durationMin ?? "-"} scaledBuckets=${JSON.stringify(bucketPlan.buckets)}`,
  );
  console.warn(
    `[QueryStrategy] requestId=${requestId || "-"} primary=${queryStrategy.primary.join(" || ") || "-"} discovery=${queryStrategy.discovery.join(" || ") || "-"} recovery=${queryStrategy.recovery.join(" || ") || "-"}`,
  );
  console.warn(`[Pipeline] requestId=${requestId || "-"} state=ANALYZE_${profile?.source === "fallback" ? "FAIL" : "SUCCESS"} gemini_called_count=${geminiCalledCount}`);

  onProgress?.({
    stage: "queries_fetching",
    progress: 0.35,
    step: 1,
    label: "검색 쿼리로 후보 곡을 수집하고 있어요",
    analysisStatus: getLatestGeminiAnalysisStatus(),
    requestId,
  });

  const durationAwareTargetMinutes = Math.max(120, Number(intent.duration.targetMinutes ?? 120));
  let collectedByZone = await collectCandidates({
    accessToken: userToken,
    bucketPlan,
    searchIntent,
    queryStrategy,
    targetMinutes: durationAwareTargetMinutes,
    requestId,
    abortSignal: options?.abortSignal,
    randomSeed,
    maxDurationMs: Math.min(6_000, maxDurationMs),
  });
  if (!collectedByZone.all.length) {
    console.warn("[FORCE] running recovery");
    const recovered = await recoverFromEmptySearch({
      accessToken: userToken,
      bucketPlan,
      searchIntent,
      requestId,
      abortSignal: options?.abortSignal,
      randomSeed: randomSeed + 991,
      maxDurationMs: Math.min(5_000, maxDurationMs),
    });
    console.warn(
      `[SearchRecovery] requestId=${requestId || "-"} stage=${recovered.stage} recovered=${recovered.tracks.length}`,
    );
    if (recovered.tracks.length) {
      const mergedRecoveredTracks = mergeUniqueTracks(collectedByZone.all, recovered.tracks);
      collectedByZone = {
        near: [],
        expand: recovered.stage === "discovery" ? mergedRecoveredTracks : [],
        explore:
          recovered.stage === "recovery" || recovered.stage === "playlist" || recovered.stage === "artist"
            ? mergedRecoveredTracks
            : [],
        all: mergedRecoveredTracks,
        metrics: {
          ...collectedByZone.metrics,
          spotifyQueryCount: collectedByZone.metrics.spotifyQueryCount + 1,
          spotifyQueryUniqueCount: collectedByZone.metrics.spotifyQueryUniqueCount + 1,
          searchStage: recovered.stage === "discovery" ? "tier2" : recovered.stage === "recovery" ? "tier3" : recovered.stage === "none" ? "none" : "tier3",
        },
      };
    }
    if (!recovered.tracks.length) {
      const bootstrapRecovery = mergeUniqueTracks(
        topTracks.slice(0, 30),
        (bootstrap?.recentlyPlayed ?? []).slice(0, 30) as SpotifyTrackSummary[],
      );
      if (bootstrapRecovery.length) {
        collectedByZone = {
          near: bootstrapRecovery.slice(0, 15),
          expand: bootstrapRecovery.slice(15, 30),
          explore: bootstrapRecovery.slice(30),
          all: bootstrapRecovery,
          metrics: {
            ...collectedByZone.metrics,
            spotifyQueryCount: collectedByZone.metrics.spotifyQueryCount + 1,
            spotifyQueryUniqueCount: collectedByZone.metrics.spotifyQueryUniqueCount + 1,
            searchStage: "tier3",
          },
        };
        console.warn(
          `[SearchRecovery] requestId=${requestId || "-"} stage=bootstrap recovered=${bootstrapRecovery.length}`,
        );
      }
    }
    if (!collectedByZone.all.length) {
      const globalFallbackTracks = await fallbackToGlobalPopular({
        accessToken: userToken,
        requestId,
        abortSignal: options?.abortSignal,
        randomSeed: randomSeed + 1703,
        maxDurationMs: Math.min(4_000, maxDurationMs),
      });
      if (globalFallbackTracks.length) {
        collectedByZone = {
          near: [],
          expand: [],
          explore: globalFallbackTracks,
          all: globalFallbackTracks,
          metrics: {
            ...collectedByZone.metrics,
            spotifyQueryCount: collectedByZone.metrics.spotifyQueryCount + 3,
            spotifyQueryUniqueCount: collectedByZone.metrics.spotifyQueryUniqueCount + 3,
            searchStage: "tier3",
          },
        };
        console.warn(
          `[SearchRecovery] requestId=${requestId || "-"} stage=global_fallback recovered=${globalFallbackTracks.length}`,
        );
      }
    }
  } else {
    console.warn(
      `[SearchRecovery] requestId=${requestId || "-"} stage=none recovered=0`,
    );
  }
  assertNotCancelled(requestId, options?.abortSignal, "collect_candidates_done");
  const zoneHint = new Map<string, RecommendationZone>();
  collectedByZone.near.forEach(track => {
    const key = trackDedupKey(track);
    if (!key) return;
    zoneHint.set(key, "near");
  });
  collectedByZone.expand.forEach(track => {
    const key = trackDedupKey(track);
    if (!key || zoneHint.has(key)) return;
    zoneHint.set(key, "expand");
  });
  collectedByZone.explore.forEach(track => {
    const key = trackDedupKey(track);
    if (!key || zoneHint.has(key)) return;
    zoneHint.set(key, "explore");
  });
  console.warn(
    `[CandidatePool] requestId=${requestId || "-"} total=${collectedByZone.all.length} near=${collectedByZone.near.length} expand=${collectedByZone.expand.length} explore=${collectedByZone.explore.length}`,
  );
  if (requestId && collectedByZone.all.length) {
    candidateCacheByRequestId.set(requestId, collectedByZone.all.slice(0, 160));
  }
  console.warn(
    `[Pipeline] requestId=${requestId || "-"} state=${collectedByZone.all.length ? "SEARCH_SUCCESS" : "SEARCH_EMPTY"} spotify_query_count=${collectedByZone.metrics.spotifyQueryCount} spotify_query_unique_count=${collectedByZone.metrics.spotifyQueryUniqueCount} spotify_search_stage=${collectedByZone.metrics.searchStage} candidate_pool_size=${collectedByZone.all.length} early_return_triggered=${collectedByZone.metrics.earlyReturnTriggered}`,
  );
  console.warn(
    `[DurationCollection] requestId=${requestId || "-"} targetMinutes=${durationAwareTargetMinutes} collectTargetMinutes=${Math.round(durationAwareTargetMinutes * 1.8)} minTracks=${collectedByZone.metrics.minTracks} minDurationMs=${collectedByZone.metrics.minDurationMs} collectedTracks=${collectedByZone.all.length} collectedDurationMs=${collectedByZone.metrics.collectedDurationMs}`,
  );

  onProgress?.({
    stage: "queries_done",
    progress: 0.66,
    step: 1,
    label: "후보를 정제하고 있어요",
    analysisStatus: getLatestGeminiAnalysisStatus(),
    requestId,
    queryDone: collectedByZone.all.length,
    queryTotal: Math.max(1, collectedByZone.metrics.spotifyQueryCount),
    collectedTracks: collectedByZone.all.length,
  });

  if (!collectedByZone.all.length) {
    return { tracks: [], profile };
  }

  const filtered = applyCandidateFiltering({
    tracks: mergeUniqueTracks(collectedByZone.all, topTracks.slice(0, 12)),
    intent,
    repeat: repeatState,
    taste,
  });

  const scored = filtered
    .map(track => {
      const trackKey = trackDedupKey(track);
      const hintedZone = zoneHint.get(trackKey ?? "");
      const isTasteCoreTrack =
        String(track?.id ?? "").trim() && taste.topTrackIds.has(String(track?.id ?? "").trim());
      const sourceZone = hintedZone ?? (isTasteCoreTrack ? "near" : "explore");
      const queryProvenance =
        sourceZone === "near"
          ? bucketPrimaryQueries
          : sourceZone === "expand"
            ? bucketAliasQueries
            : [...bucketRelaxedQueries, ...bucketPlaylistQueries];
      const breakdown = scoreTrackSemantic({
        track,
        intent,
        taste,
        repeat: repeatState,
        promptBundle,
        tasteCore,
        sourceZone,
        queryProvenance,
        requestLocale: searchIntent.locale,
        styleFeatures: structuredIntent.audioFeatures,
        styles: structuredIntent.styles,
      });
      return { track, ...breakdown };
    })
    .sort((a, b) => b.finalScore - a.finalScore);

  if (!scored.length) {
    console.warn("[BLOCKED] legacy fallback disabled");
    return {
      tracks: [],
      profile,
    };
  }

  const rankedForLog = prioritizeRankingWithZonePolicy(scored, 10);
  const topScoreLog = rankedForLog.slice(0, 8).map(item => ({
    track: `${item.track.name} - ${(item.track.artists ?? []).map(a => a.name).join(", ")}`,
    zone: item.zone,
    score: Number(item.finalScore.toFixed(4)),
    promptFit: Number(item.promptFit.toFixed(4)),
    promptShiftScore: Number(item.promptShiftScore.toFixed(4)),
    tasteFit: Number(item.tasteFit.toFixed(4)),
    featureAligned: item.featureAligned,
    freshness: Number(item.freshness.toFixed(4)),
    expansionScore: Number(item.expansionScore.toFixed(4)),
    tasteSimilarity: Number(item.tasteSimilarity.toFixed(4)),
  }));
  const zoneDistribution = rankedForLog.slice(0, 10).reduce<Record<string, number>>((acc, item) => {
    acc[item.zone] = (acc[item.zone] ?? 0) + 1;
    return acc;
  }, {});
  const artistDistribution = scored
    .slice(0, 30)
    .reduce<Record<string, number>>((acc, item) => {
      const artist = String(item.track.artists?.[0]?.name ?? "unknown").trim() || "unknown";
      acc[artist] = (acc[artist] ?? 0) + 1;
      return acc;
    }, {});
  console.warn(
    `[TopScores] requestId=${requestId || "-"} payload=${JSON.stringify(topScoreLog)} zones=${JSON.stringify(zoneDistribution)} artists=${JSON.stringify(artistDistribution)}`,
  );
  onProgress?.({
    stage: "ranking",
    progress: 0.84,
    step: 2,
    label: "개인화 점수와 다양성을 반영하고 있어요",
    analysisStatus: getLatestGeminiAnalysisStatus(),
    requestId,
    collectedTracks: filtered.length,
  });

  const derivedCount = deriveTargetTrackCount({
    parsedTargetCount: undefined,
    targetMinutes: intent.duration.targetMinutes,
    timeMode: extractTimeConstraint(prompt)?.mode,
    averageDurationMs: estimateAverageTrackDurationMs([filtered, topTracks]),
    maxCount: 80,
  });
  const desiredCount = Math.max(10, Math.min(60, intent.duration.targetMinutes ? derivedCount : targetTracks));
  const MIN_SCORE = 0.05;
  const reranked = [...scored].sort((a, b) => b.finalScore - a.finalScore);
  const scoreFiltered = reranked.filter(item => item.finalScore >= MIN_SCORE);
  const selectable = scoreFiltered.length ? scoreFiltered : reranked.slice(0, 60);
  let selected = applyDiversityAdjust({
    scored: selectable,
    targetCount: desiredCount,
    repeat: repeatState,
  });
  selected = mergeAndRank(mergeUniqueTracks(collectedByZone.all, selected), selectable);
  if (selected.length === 0) {
    console.warn("[Composition] fallback: using top reranked tracks");
    selected = reranked.slice(0, 30).map(item => item.track);
  }
  if (selected.length < 25) {
    console.warn("[Composition] expanding selection to minimum");
    selected = mergeUniqueTracks(selected, reranked.slice(0, 40).map(item => item.track));
  }
  selected = expandWithGenreBalance(selected, reranked.map(item => item.track), structuredIntent);
  selected = composeFinalPlaylist(selected, structuredIntent);
  console.warn(
    `[Composition] requestId=${requestId || "-"} mix=${structuredIntent.mixStrategy} styles=${structuredIntent.styles.join("|") || "-"} weights=${JSON.stringify(structuredIntent.genreWeights)} selected=${selected.length}`,
  );

  const beforeDurationFitMs = sumDurationMs(selected);
  selected = fitDuration({
    tracks: selected,
    candidatePool: filtered,
    targetMinutes: intent.duration.targetMinutes,
    mode: extractTimeConstraint(prompt)?.mode ?? null,
    seed: randomSeed + 31,
  });
  const durationFillUsed = sumDurationMs(selected) > beforeDurationFitMs;
  selected = enforceFinalSelectionRetention({
    selected,
    scored,
    minExpandRatio: 0.5,
    maxNearRatio: 0.3,
  });
  selected = enforceFinalTop10ExpandPolicy({
    selected,
    scored,
    minExpandTop10Ratio: 0.5,
  });
  const requireKoreanVocal =
    /korean|k pop|k-pop|케이팝|한국|국내|ost|영화음악|사운드트랙/.test(normalizeText(prompt)) ||
    intent.genreIntent.requested.some(v =>
      /korean|k pop|k-pop|케이팝|ost|영화음악/.test(normalizeText(v)),
    );
  selected = enforceKoreanVocalTop10({
    selected,
    scored,
    require: requireKoreanVocal,
    minRatio: getRequiredKoreanVocalRatio({
      structuredIntent,
      parsedIntent: intent,
      prompt,
    }),
  });
  if (requireKoreanVocal) {
    const requiredRatio = getRequiredKoreanVocalRatio({
      structuredIntent,
      parsedIntent: intent,
      prompt,
    });
    const beforeRatio = selected.length
      ? selected.filter(isKoreanVocalLikeTrack).length / selected.length
      : 0;
    if (beforeRatio < requiredRatio) {
      console.warn("[Playlist] korean vocal soft repair", {
        ratio: Number(beforeRatio.toFixed(2)),
        required: Number(requiredRatio.toFixed(2)),
      });
      selected = repairKoreanVocalRatio({
        selected,
        candidatePool: mergeUniqueTracks(
          filtered,
          topTracks,
          reranked.map(item => item.track),
        ),
        requiredRatio,
        maxReplace: 20,
      });
    }
    const finalKoreanRatio = selected.length
      ? selected.filter(isKoreanVocalLikeTrack).length / selected.length
      : 0;
    if (finalKoreanRatio < requiredRatio) {
      console.warn("[Playlist] korean vocal target not fully met, proceeding", {
        ratio: Number(finalKoreanRatio.toFixed(2)),
        required: Number(requiredRatio.toFixed(2)),
      });
    }
  }

  if (!selected.length) {
    selected = composeFinalPlaylist(
      mergeUniqueTracks(filtered, topTracks).slice(0, Math.max(12, desiredCount)),
      structuredIntent,
    );
  }
  if (!selected.length) {
    console.warn("[Playlist] empty recommendation pool after redesigned pipeline (soft)");
    selected = reranked.slice(0, 30).map(item => item.track);
  }

  let finalTracks = enforceMinimumDuration({
    selected,
    targetMinutes: intent.duration.targetMinutes,
    timeConstraint: extractTimeConstraint(prompt),
    candidatePool: mergeUniqueTracks(filtered, topTracks),
    minCoverage: 0.98,
    maxCount: 90,
  });
  let finalDurationMs = sumDurationMs(finalTracks);
  if ((intent.duration.targetMinutes ?? 0) >= 120) {
    const minDurationMs = 120 * 60 * 1000;
    if (finalDurationMs < minDurationMs) {
      console.warn("[Playlist] duration shortfall detected", {
        actual: finalDurationMs,
        required: minDurationMs,
      });
      const toppedUp = topUpDuration({
        selected: finalTracks,
        candidatePool: mergeUniqueTracks(filtered, topTracks, reranked.map(x => x.track)),
        minDurationMs,
        maxCount: 90,
      });
      const toppedUpDurationMs = sumDurationMs(toppedUp);
      if (toppedUpDurationMs < minDurationMs) {
        console.warn("[Playlist] duration target not fully met, proceeding", {
          actual: toppedUpDurationMs,
          required: minDurationMs,
        });
      }
      finalTracks = toppedUp;
      finalDurationMs = toppedUpDurationMs;
    }
  }
  const finalScoredSnapshot = finalTracks
    .map(track => scored.find(item => trackDedupKey(item.track) === trackDedupKey(track)))
    .filter((v): v is (typeof scored)[number] => Boolean(v));
  if (!finalScoredSnapshot.length) {
    console.warn("[Playlist] invalid selection snapshot: selectedZones={} (soft)");
  }
  if (requireKoreanVocal) {
    const requiredRatio = getRequiredKoreanVocalRatio({
      structuredIntent,
      parsedIntent: intent,
      prompt,
    });
    const top10 = finalTracks.slice(0, 10);
    const koreanCount = top10.filter(isKoreanVocalLikeTrack).length;
    const ratio = top10.length ? koreanCount / top10.length : 0;
    if (ratio < requiredRatio) {
      console.warn("[Playlist] korean vocal ratio below target (soft)", {
        ratio: Number(ratio.toFixed(2)),
        required: Number(requiredRatio.toFixed(2)),
      });
    }
  }
  console.warn(
    `[FinalSelection] requestId=${requestId || "-"} count=${finalTracks.length} durationMs=${finalDurationMs} elapsedMs=${Date.now() - startedAt}`,
  );
  console.warn(
    `[FinalMix] requestId=${requestId || "-"} count=${finalTracks.length} durationMs=${finalDurationMs} top10=${finalTracks.slice(0, 10).map(t => `${t.name}::${t.artists?.[0]?.name ?? "-"}`).join(" | ")}`,
  );
  console.warn(
    `[Pipeline] requestId=${requestId || "-"} state=SELECTION_ONLY duration_fill_used=${durationFillUsed} fallback_reason=none`,
  );
  logSunnyWalkRegressionDiagnostics({
    prompt,
    scored: scored.map(item => ({
      track: item.track,
      zone: item.zone,
      promptFit: item.promptFit,
      tasteFit: item.tasteFit,
      featureAligned: item.featureAligned,
      finalScore: item.finalScore,
    })),
    taste,
    selected: finalTracks,
    requestId,
  });

  onProgress?.({
    stage: "finalizing",
    progress: 1,
    step: 2,
    label: "플레이리스트 구성을 완료했어요",
    analysisStatus: getLatestGeminiAnalysisStatus(),
    requestId,
    collectedTracks: filtered.length,
  });

  pushRecommendationSnapshot(promptHash, prompt, finalTracks);
  return { tracks: finalTracks, profile };
}

async function generatePlaylistSummaries(
  prompt: string,
  userToken: string,
  preAnalyzedProfile?: GeminiRecommendationProfile | null,
  preloadedBootstrap?: SpotifyBootstrapData | null,
  onProgress?: (event: AnalysisProgressEvent) => void,
  options?: {
    requestId?: string;
    allowResultCache?: boolean;
    resultCacheTtlMs?: number;
    hardTimeoutMs?: number;
    minimumPlayableTracks?: number;
    earlyFinalizeThreshold?: number;
    targetTracks?: number;
    abortSignal?: AbortSignal;
  },
): Promise<{ tracks: SpotifyTrackSummary[]; profile: GeminiRecommendationProfile }> {
  const requestId = String(options?.requestId ?? "").trim();
  const allowResultCache =
    typeof options?.allowResultCache === "boolean"
      ? options.allowResultCache
      : PLAYLIST_RESULT_CACHE_ENABLED;
  const resultCacheTtlMs = clamp(
    Number(options?.resultCacheTtlMs ?? PLAYLIST_SUMMARIES_CACHE_TTL_MS),
    1_500,
    20_000,
  );
  if (!allowResultCache) {
    console.warn(
      `[Playlist] result cache disabled requestId=${requestId || "-"} (analyze cache remains enabled)`,
    );
  }
  const key = buildPlaylistSummariesKey({
    prompt,
    userToken,
    preAnalyzedProfile,
    preloadedBootstrap,
    requestId,
  });
  const now = Date.now();
  if (allowResultCache) {
    const cached = playlistSummariesCache.get(key);
    if (cached && now - cached.cachedAt <= resultCacheTtlMs) {
      console.warn(
        `[Playlist] result cache hit key=${stableHash(key).toString(16).slice(0, 8)} requestId=${requestId || "-"} ttlMs=${resultCacheTtlMs}`,
      );
      return cached.data;
    }
  }
  const inFlight = playlistSummariesInFlight.get(key);
  if (inFlight) {
    console.warn(
      `[Playlist] request in-flight reuse key=${stableHash(key).toString(16).slice(0, 8)} requestId=${requestId || "-"}`,
    );
    return inFlight;
  }
  const run = generatePlaylistSummariesCore(
    prompt,
    userToken,
    preAnalyzedProfile,
    preloadedBootstrap,
    onProgress,
    {
      requestId,
      hardTimeoutMs: options?.hardTimeoutMs,
      minimumPlayableTracks: options?.minimumPlayableTracks,
      earlyFinalizeThreshold: options?.earlyFinalizeThreshold,
      targetTracks: options?.targetTracks,
      abortSignal: options?.abortSignal,
    },
  );
  playlistSummariesInFlight.set(key, run);
  try {
    const out = await run;
    if (allowResultCache && out.tracks.length) {
      playlistSummariesCache.set(key, { data: out, cachedAt: Date.now() });
      console.warn(
        `[Playlist] result cache set key=${stableHash(key).toString(16).slice(0, 8)} tracks=${out.tracks.length} requestId=${requestId || "-"}`,
      );
    }
    return out;
  } finally {
    playlistSummariesInFlight.delete(key);
  }
}

export async function generatePlaylist(
  prompt: string,
  userToken: string,
): Promise<Track[]> {
  const generated = await generatePlaylistSummaries(prompt, userToken);
  return generated.tracks.map(toTrack);
}

function buildFallbackPlaylistName(moodInput: string): string {
  const cleaned = moodInput.trim().replace(/\s+/g, " ");
  if (!cleaned) return "AI 맞춤 플레이리스트";
  return `${cleaned.slice(0, 18)}${cleaned.length > 18 ? "…" : ""} 플레이리스트`;
}

function generateFallbackPlaylist(args: {
  moodInput: string;
  bootstrap: SpotifyBootstrapData | null;
}): PersonalizedPlaylistOutput {
  const base = pickFallbackTracks(args.bootstrap, 32);
  const selected = base.slice(0, 30);
  return {
    status: "partial",
    tracks: selected.map(toTrack),
    playlistName: buildFallbackPlaylistName(args.moodInput),
    reasoning: "Gemini fallback 모드로 사용자 취향 기반 기본 추천을 생성했어요.",
    fallbackReason: "gemini_error",
    meta: { reason: "generated_fallback_playlist" },
  };
}

function analyzeFastIntent(rawInput: string): FastIntent {
  const normalized = normalizeText(rawInput);
  if (!normalized) {
    return {
      moodKeywords: [],
      excludeKeywords: [],
      genres: [],
      energy: "mid",
      confidence: 0,
    };
  }

  const genrePatterns: Array<[string, RegExp]> = [
    ["k-pop", /\bk[\s-]?pop\b|케이팝|케이 팝|k pop/i],
    ["멜로디 힙합", /멜로디\s*힙합|melodic\s*hip[\s-]?hop/i],
    ["힙합", /\bhip[\s-]?hop\b|힙합|랩/i],
    ["발라드", /발라드|ballad/i],
    ["rnb/소울", /\br[\s&-]?n[\s&-]?b\b|알앤비|r&b|소울|soul/i],
    ["인디", /인디|indie/i],
    ["포크", /포크|folk|acoustic/i],
    ["영화음악", /영화음악|영화 음악|ost|soundtrack|cinematic/i],
    ["edm", /\bedm\b|일렉|electronic/i],
  ];
  const explicitGenreSegment = [
    extractLabeledSegment(rawInput, "장르"),
    (() => {
      const m = rawInput.match(/장르는?\s*([^.\n]+)/i);
      return m ? String(m[1] ?? "") : "";
    })(),
  ]
    .map(v => String(v ?? "").trim())
    .find(Boolean) ?? "";
  const genreSource = explicitGenreSegment || normalized;
  const genres = genrePatterns
    .filter(([, re]) => re.test(normalized))
    .map(([name]) => name)
    .slice(0, 4);
  const explicitGenres = genrePatterns
    .filter(([, re]) => re.test(genreSource))
    .map(([name]) => name)
    .slice(0, 4);
  const resolvedGenres = explicitGenres.length ? explicitGenres : genres;

  const highEnergy = /신나|파티|운동|에너지|댄스|업템포|drive|boost/i.test(normalized);
  const lowEnergy = /차분|잔잔|편안|힐링|잠|명상|수면|조용|밤산책|chill|calm|relax/i.test(normalized);
  const energy: "low" | "mid" | "high" = highEnergy ? "high" : lowEnergy ? "low" : "mid";

  const negativePattern = /(제외|빼고|말고|피하|없는|싫|without|except)/i;
  const parts = normalized.split(negativePattern);
  const excludeKeywords =
    negativePattern.test(normalized) && parts.length > 1
      ? keywordList(parts[parts.length - 1] ?? "")
          .filter(w => !FAST_INTENT_STOPWORDS.has(w))
          .slice(0, 4)
      : [];

  const moodSegment = normalizeText(extractLabeledSegment(rawInput, "무드"));
  const coreSegment = normalizeText(extractLabeledSegment(rawInput, "핵심"));
  const sourceForMood = [moodSegment, coreSegment, parts[0] ?? normalized]
    .map(v => String(v ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const genreTokens = new Set(resolvedGenres.map(v => normalizeText(v)));
  const genreMatchTokens = new Set(
    resolvedGenres.flatMap(fastGenreMatchTokens).map(v => normalizeText(v)).filter(Boolean),
  );
  let moodKeywords = keywordList(sourceForMood)
    .filter(w => w.length >= 2)
    .filter(w => !FAST_INTENT_STOPWORDS.has(w))
    .filter(w => !FAST_INTENT_NOISE.has(w))
    .filter(w => !/^(듣기|좋은|장르|장르는|노래|곡|플리|플레이리스트)$/.test(w))
    .filter(w => !/^\d+$/.test(w))
    .filter(w => !genreTokens.has(normalizeText(w)))
    .filter(w => !genreMatchTokens.has(normalizeText(w)))
    .filter(w => !excludeKeywords.includes(w))
    .slice(0, 6);
  moodKeywords = Array.from(new Set(moodKeywords)).slice(0, 6);
  if (moodKeywords.length < 2) {
    const inferred = buildUserIntentProfile(normalized).include
      .filter(w => w.length >= 2)
      .filter(w => !FAST_INTENT_STOPWORDS.has(w))
      .filter(w => !FAST_INTENT_NOISE.has(w))
      .filter(w => !/^(듣기|좋은|장르|장르는|노래|곡|플리|플레이리스트)$/.test(w))
      .filter(w => !genreTokens.has(normalizeText(w)))
      .filter(w => !genreMatchTokens.has(normalizeText(w)))
      .slice(0, 4);
    moodKeywords = Array.from(new Set([...moodKeywords, ...inferred])).slice(0, 6);
  }

  const confidence = Math.max(
    0,
    Math.min(
      1,
      moodKeywords.length * 0.16 +
        resolvedGenres.length * 0.17 +
        excludeKeywords.length * 0.14 +
        (energy !== "mid" ? 0.14 : 0),
    ),
  );

  return {
    moodKeywords,
    excludeKeywords,
    genres: resolvedGenres,
    energy,
    confidence,
  };
}

function mapFastKeywordToSearchToken(keyword: string): string {
  const k = normalizeText(keyword);
  if (!k) return "";
  if (/신나|업템포|에너지|파티/.test(k)) return "upbeat";
  if (/차분|잔잔|편안|힐링/.test(k)) return "chill";
  if (/화창|맑은|sunny/.test(k)) return "happy";
  if (/밤|night/.test(k)) return "late night";
  if (/산책|walk/.test(k)) return "easy listening";
  if (/한강|river/.test(k)) return "outdoor chill";
  if (/감성|몽환/.test(k)) return "dreamy";
  if (/약속|데이트|만남/.test(k)) return "feel good";
  if (/준비|메이크업|외출준비/.test(k)) return "getting ready";
  if (/기분.?좋/.test(k)) return "feel good";
  return k;
}

const FAST_TOKEN_BLOCKLIST = new Set([
  "genre",
  "artist",
  "track",
  "music",
  "playlist",
  "플레이리스트",
  "플리",
  "노래",
  "음악",
]);

const FAST_WEAK_CONTEXT_TOKENS = new Set([
  "han",
  "river",
  "walk",
  "stroll",
  "sunny",
  "day",
  "outdoor",
]);

function sanitizeFastSearchToken(raw: string): string {
  const compact = String(raw ?? "")
    .replace(/[“”]/g, "\"")
    .replace(/[’]/g, "'")
    .replace(/[\[\]{}()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  if (!compact) return "";
  if (isFastTagQuery(compact)) return "";
  const lowered = normalizeText(compact);
  if (!lowered) return "";
  const words = compact
    .split(/\s+/)
    .map(w => w.trim())
    .filter(Boolean);
  const knownSingleToken =
    words.length === 1 &&
    /^(k-pop|kpop|indie|soundtrack|playlist|folk|ballad|rnb|soul|hip-hop|hiphop|ost)$/i.test(
      words[0] ?? "",
    );
  if ((words.length < 2 && !knownSingleToken) || words.length > 4) return "";
  if (words.some(w => FAST_TOKEN_BLOCKLIST.has(normalizeText(w)))) return "";
  if (/[:;"<>]/.test(compact)) return "";
  if (/^[^A-Za-z가-힣0-9]+$/.test(compact)) return "";
  if (lowered.length < 6) return "";
  const dedupWords: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const n = normalizeText(w);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    dedupWords.push(w);
    if (dedupWords.length >= 4) break;
  }
  if (dedupWords.length < 2 && !knownSingleToken) return "";
  return dedupWords.join(" ");
}

function isPracticalSpotifySearchToken(token: string): boolean {
  const t = normalizeText(String(token ?? ""));
  if (!t || t.length < 3) return false;
  const parts = keywordList(t);
  if (!parts.length) return false;
  if (
    /(bright|breezy|warm|airy|clean|punchy)\s+(k-pop|kpop|korean|rnb|indie|pop|hip hop|hip-hop)/.test(
      t,
    )
  ) {
    return false;
  }
  return parts.some(p =>
    /k-pop|kpop|korean|rnb|soul|indie|folk|ballad|hip hop|hip-hop|melodic|chill|upbeat|acoustic|playlist|soundtrack|cinematic|summer|happy|dreamy|easy listening|lofi/.test(
      p,
    ),
  );
}

function buildFastTasteSummary(bootstrap: SpotifyBootstrapData | null): string {
  if (!bootstrap) return "선호 장르 요약 없음";
  const genreTop = Array.from(
    new Set(
      (bootstrap.topArtists ?? [])
        .flatMap(a => a.genres ?? [])
        .map(g => normalizeText(String(g ?? "")))
        .filter(Boolean),
    ),
  )
    .slice(0, 4)
    .join(", ");
  const avgTempo = median(
    (bootstrap.topTracks ?? [])
      .map(t => Number(t?.tempo ?? 0))
      .filter(v => Number.isFinite(v) && v > 0),
  );
  const tempoHint =
    avgTempo && avgTempo >= 118 ? "에너지 높음" : avgTempo && avgTempo <= 96 ? "에너지 낮음" : "에너지 중간";
  const artistMoodHint = (bootstrap.topTracks ?? [])
    .map(t => normalizeText(t?.name ?? ""))
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
  const softHint = /잔잔|감성|calm|chill|dream|ballad/i.test(artistMoodHint)
    ? "부드러운 보컬/잔잔 무드 선호"
    : /신나|dance|party|energetic|upbeat/i.test(artistMoodHint)
      ? "업비트/리듬감 선호"
      : "감성/대중성 균형 선호";
  return [
    `선호 장르: ${genreTop || "k-pop, rnb, indie"}`,
    `청취 에너지 성향: ${tempoHint}`,
    `청취 질감: ${softHint}`,
  ].join(" | ");
}

function buildGeminiFastTokenPrompt(args: {
  moodInput: string;
  plan: PromptSearchPlan;
  localIntent: FastIntent;
  tasteSummary: string;
}): string {
  return [
    "너는 Spotify 검색 최적화 분석기다. JSON만 출력해라.",
    `사용자 입력: ${String(args.moodInput ?? "").replace(/\s+/g, " ").trim()}`,
    `로컬 해석 장르: ${args.localIntent.genres.join(", ") || "없음"}`,
    `로컬 해석 에너지: ${args.localIntent.energy}`,
    `사용자 취향 요약: ${args.tasteSummary}`,
    `시간 조건: ${args.plan.timeConstraint ? `${args.plan.timeConstraint.minutes}분 ${args.plan.timeConstraint.mode}` : "없음"}`,
    "",
    "반환 스키마(JSON):",
    '{"playlistName":"FAST_INTENT_PLAN","moodSummary":"string","reasoning":"string","excludeKeywords":["token"],"genreHints":["genre"],"energyLevel":"low|mid|high","targetCount":12,"mixStrategy":"familiar|balanced|discovery","noveltyLevel":"safe|balanced|adventurous","strategy":{"diversity":0.5,"freshness":0.5,"popularityBias":0.5,"genreMix":{"taste":0.6,"general":0.2,"exploration":0.2}},"moodTokens":["token"],"textureTokens":["token"],"tempoTokens":["token"],"spotifySearchQueries":["query 2-4 words"],"activity":"walking|studying|driving|workout|relax|commute|none"}',
    "",
    "규칙:",
    "- spotifySearchQueries는 Spotify에서 바로 검색 가능한 2~4단어 영어/한국어 쿼리 8개를 반환하라.",
    "- 반드시 결과가 잘 나오는 짧고 실용적인 조합을 우선하라 (장르 단독 또는 아티스트+무드 중심).",
    "- 사용자 취향 요약의 상위 아티스트/장르를 최소 3개 쿼리에 반영하라.",
    "- 검색어는 따옴표, 콜론 태그(genre:, artist:, track:), 문장형 표현을 쓰지 마라.",
    "- includeKeywords/focusKeywords는 만들지 마라.",
    "- moodTokens/textureTokens/tempoTokens/genreHints/activity와 strategy도 함께 반환하라.",
    "- 사용자 문장을 그대로 복사하지 마라.",
    "- excludeKeywords에는 피해야 할 분위기를 0~4개.",
    "- genreHints는 1~5개.",
    "- energyLevel은 low/mid/high 중 하나.",
    "",
    "좋은 예:",
    '- "k-pop playlist"',
    '- "korean rnb"',
    '- "newjeans upbeat"',
    '- "iu chill"',
    '- "korean indie"',
    '- "soundtrack playlist"',
    "",
    "나쁜 예:",
    '- "korean rnb chill soft commute vibe"',
    '- "please recommend calm songs for han river walk"',
    '- "genre:\\"k-pop\\" upbeat"',
  ].join("\n");
}

function inferMoodMusicAttributes(
  moodInput: string,
  localIntent: FastIntent,
): { moodTokens: string[]; textureTokens: string[]; tempoTokens: string[] } {
  const text = normalizeText(`${moodInput} ${localIntent.moodKeywords.join(" ")}`);
  const mood = new Set<string>();
  const texture = new Set<string>();
  const tempo = new Set<string>();
  if (/화창|맑|sunny|봄|spring/.test(text)) {
    mood.add("bright");
    mood.add("breezy");
    mood.add("warm");
  }
  if (/한강|river|산책|walk|stroll/.test(text)) {
    mood.add("breezy");
    mood.add("light");
    mood.add("chill");
    texture.add("clean");
    texture.add("airy");
    texture.add("easy listening");
  }
  if (/감성|nostalg|cinematic|영화|ost/.test(text)) {
    mood.add("nostalgic");
    mood.add("cinematic");
    texture.add("soft");
  }
  if (/차분|잔잔|편안|힐링|calm|chill|soft/.test(text)) {
    mood.add("soft");
    mood.add("calm");
    texture.add("acoustic");
    texture.add("warm");
    tempo.add("mid tempo");
  }
  if (/신나|업템포|에너지|파티|upbeat/.test(text)) {
    mood.add("upbeat");
    texture.add("punchy");
    tempo.add("up tempo");
  }
  if (!tempo.size) {
    tempo.add(localIntent.energy === "high" ? "up tempo" : localIntent.energy === "low" ? "low tempo" : "mid tempo");
  }
  if (!mood.size) {
    mood.add(localIntent.energy === "high" ? "energetic" : localIntent.energy === "low" ? "calm" : "balanced");
  }
  if (!texture.size) texture.add("soft");
  return {
    moodTokens: Array.from(mood).slice(0, 4),
    textureTokens: Array.from(texture).slice(0, 4),
    tempoTokens: Array.from(tempo).slice(0, 2),
  };
}

function buildFastRecommendationStrategy(args: {
  localIntent: FastIntent;
  mixStrategy?: "familiar" | "balanced" | "discovery";
  noveltyLevel?: "safe" | "balanced" | "adventurous";
  diversity?: number;
  freshness?: number;
  popularityBias?: number;
  genreMix?: { taste?: number; general?: number; exploration?: number };
}): FastRecommendationStrategy {
  const mixStrategy = args.mixStrategy ?? "balanced";
  const noveltyLevel = args.noveltyLevel ?? "balanced";
  const clamp01 = (v: number, fb: number) =>
    Math.min(1, Math.max(0, Number.isFinite(v) ? v : fb));

  const base = mixStrategy === "familiar"
    ? {
        diversity: 0.35,
        freshness: 0.4,
        popularityBias: 0.7,
        pool: { taste: 0.7, general: 0.2, exploration: 0.1 },
        score: { taste: 0.5, context: 0.25, genre: 0.2, mood: 0.05 },
      }
    : mixStrategy === "discovery"
      ? {
          diversity: 0.75,
          freshness: 0.7,
          popularityBias: 0.35,
          pool: { taste: 0.45, general: 0.25, exploration: 0.3 },
          score: { taste: 0.35, context: 0.3, genre: 0.2, mood: 0.15 },
        }
      : {
          diversity: 0.55,
          freshness: 0.55,
          popularityBias: 0.5,
          pool: { taste: 0.6, general: 0.2, exploration: 0.2 },
          score: { taste: 0.4, context: 0.3, genre: 0.2, mood: 0.1 },
        };

  const noveltyBoost =
    noveltyLevel === "adventurous" ? 0.1 : noveltyLevel === "safe" ? -0.08 : 0;
  const diversity = clamp01((args.diversity ?? base.diversity) + noveltyBoost, base.diversity);
  const freshness = clamp01((args.freshness ?? base.freshness) + noveltyBoost, base.freshness);
  const popularityBias = clamp01(
    (args.popularityBias ?? base.popularityBias) - noveltyBoost * 0.8,
    base.popularityBias,
  );
  const taste = clamp01(args.genreMix?.taste ?? base.pool.taste, base.pool.taste);
  const general = clamp01(args.genreMix?.general ?? base.pool.general, base.pool.general);
  const exploration = clamp01(args.genreMix?.exploration ?? base.pool.exploration, base.pool.exploration);
  const sum = Math.max(0.001, taste + general + exploration);

  const scoreSum = Math.max(
    0.001,
    base.score.taste + base.score.context + base.score.genre + base.score.mood,
  );
  return {
    mixStrategy,
    noveltyLevel,
    diversity,
    freshness,
    popularityBias,
    poolRatio: {
      taste: taste / sum,
      general: general / sum,
      exploration: exploration / sum,
    },
    scoring: {
      taste: base.score.taste / scoreSum,
      context: base.score.context / scoreSum,
      genre: base.score.genre / scoreSum,
      mood: base.score.mood / scoreSum,
    },
  };
}

function buildSearchTokensFromAttributes(args: {
  moodTokens: string[];
  textureTokens: string[];
  tempoTokens: string[];
  genres: string[];
}): string[] {
  const out = new Set<string>();
  const moodMap = (token: string): string[] => {
    const t = normalizeText(token);
    if (/bright/.test(t)) return ["upbeat", "happy", "summer"];
    if (/breezy/.test(t)) return ["chill", "easy listening"];
    if (/warm/.test(t)) return ["acoustic", "soft"];
    if (/airy/.test(t)) return ["dreamy", "light"];
    if (/nostalgic|cinematic/.test(t)) return ["cinematic", "soundtrack"];
    if (/upbeat|punchy/.test(t)) return ["upbeat"];
    if (/calm|soft/.test(t)) return ["soft", "chill"];
    return [t];
  };
  const textureMap = (token: string): string[] => {
    const t = normalizeText(token);
    if (/clean|airy|easy listening/.test(t)) return ["chill", "light"];
    if (/soft/.test(t)) return ["soft", "acoustic"];
    if (/punchy/.test(t)) return ["upbeat"];
    return [t];
  };
  const moods = Array.from(
    new Set(args.moodTokens.flatMap(moodMap).filter(v => v.length >= 2)),
  ).slice(0, 4);
  const textures = Array.from(
    new Set(args.textureTokens.flatMap(textureMap).filter(v => v.length >= 2)),
  ).slice(0, 4);
  const genres = args.genres.slice(0, 4);
  for (const g of genres) {
    const genreToken = normalizeText(g).includes("indie")
      ? "korean indie"
      : normalizeText(g).includes("rnb") || normalizeText(g).includes("soul")
        ? "korean rnb"
      : normalizeText(g).includes("k-pop") || normalizeText(g).includes("kpop")
          ? "k-pop"
          : normalizeText(g).includes("melodic hip hop")
            ? "melodic hip hop"
            : normalizeText(g).includes("ost") || normalizeText(g).includes("cinematic")
              ? "soundtrack"
            : g;
    for (const m of moods) {
      for (const t of textures) {
        const q = sanitizeFastSearchToken(`${m} ${t} ${genreToken}`);
        if (q) out.add(q);
      }
      const q2 = sanitizeFastSearchToken(`${m} ${genreToken}`);
      if (q2) out.add(q2);
    }
    const q3 = sanitizeFastSearchToken(`${genreToken} playlist`);
    if (q3) out.add(q3);
  }
  for (const t of textures) {
    for (const p of args.tempoTokens.slice(0, 1)) {
      const q = sanitizeFastSearchToken(`${t} ${p}`);
      if (q) out.add(q);
    }
  }
  return Array.from(out).slice(0, 8);
}

async function buildFastSemanticTokenPlan(args: {
  moodInput: string;
  searchPlan: PromptSearchPlan;
  localIntent: FastIntent;
  bootstrap: SpotifyBootstrapData | null;
  timeoutMs: number;
  disableGemini?: boolean;
}): Promise<FastSemanticTokenPlan> {
  const inferred = inferMoodMusicAttributes(args.moodInput, args.localIntent);
  const artistDirectSeed = buildArtistDirectQueries(args.bootstrap, args.localIntent).slice(0, 3);
  const mergeSeededSearchTokens = (...groups: string[][]): string[] => {
    const merged = new Set<string>();
    for (const group of groups) {
      for (const raw of group) {
        const token = sanitizeFastSearchToken(raw);
        if (!token) continue;
        merged.add(token);
        if (merged.size >= 8) break;
      }
      if (merged.size >= 8) break;
    }
    return Array.from(merged).slice(0, 8);
  };
  const fallbackLocal = (): FastSemanticTokenPlan => {
    const localGenres = Array.from(
      new Set(
        args.localIntent.genres
          .flatMap(buildFastGenreSearchVariants)
          .filter(Boolean),
      ),
    ).slice(0, 5);
    const localTokens = buildSearchTokensFromAttributes({
      moodTokens: inferred.moodTokens,
      textureTokens: inferred.textureTokens,
      tempoTokens: inferred.tempoTokens,
      genres: localGenres,
    });
    const fallbackSearchTokens = mergeSeededSearchTokens(artistDirectSeed, localTokens);
    return {
      moodTokens: inferred.moodTokens,
      textureTokens: inferred.textureTokens,
      tempoTokens: inferred.tempoTokens,
      searchTokens: fallbackSearchTokens,
      excludeTokens: args.localIntent.excludeKeywords.slice(0, 4),
      genres: localGenres.length ? localGenres : args.localIntent.genres.slice(0, 4),
      energy: args.localIntent.energy,
      confidence: args.localIntent.confidence * 0.88,
      source: "local",
      strategy: buildFastRecommendationStrategy({ localIntent: args.localIntent }),
    };
  };
  const tasteSummary = buildFastTasteSummary(args.bootstrap);
  const prompt = buildGeminiFastTokenPrompt({
    moodInput: args.moodInput,
    plan: args.searchPlan,
    localIntent: args.localIntent,
    tasteSummary,
  });
  if (args.disableGemini) {
    return fallbackLocal();
  }
  try {
    const json = await callGeminiWithTimeout(prompt, clamp(args.timeoutMs, 900, 2600));
    const readAnyStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.map(v => String(v ?? "")).filter(Boolean) : [];
    const rawTokens = Array.from(
      new Set([
        ...readAnyStringArray((json as any).includeKeywords),
        ...readAnyStringArray((json as any).focusKeywords),
      ]),
    )
      .map(v => mapFastKeywordToSearchToken(v))
      .map(v => sanitizeFastSearchToken(v))
      .filter((v): v is string => Boolean(v))
      .slice(0, 6);
    const moodTokens = Array.from(
      new Set(
        readAnyStringArray((json as any).moodTokens)
          .map(v => normalizeText(String(v ?? "")))
          .filter((v: string) => v.length >= 2),
      ),
    ).slice(0, 4);
    const textureTokens = Array.from(
      new Set(
        readAnyStringArray((json as any).textureTokens)
          .map(v => normalizeText(String(v ?? "")))
          .filter((v: string) => v.length >= 2),
      ),
    ).slice(0, 4);
    const tempoTokens = Array.from(
      new Set(
        readAnyStringArray((json as any).tempoTokens)
          .map(v => normalizeText(String(v ?? "")))
          .filter((v: string) => v.length >= 2),
      ),
    ).slice(0, 2);
    const excludeTokens = Array.from(
      new Set(
        (json.excludeKeywords ?? [])
          .map(v => normalizeText(String(v ?? "")))
          .filter(v => v.length >= 2),
      ),
    ).slice(0, 4);
    const genres = Array.from(
      new Set(
        (json.genreHints ?? [])
          .flatMap(buildFastGenreSearchVariants)
          .map(v => normalizeText(String(v ?? "")))
          .filter(v => v.length >= 2),
      ),
    ).slice(0, 5);
    const geminiSpotifyQueries = readAnyStringArray((json as any).spotifySearchQueries)
      .map(v => sanitizeFastSearchToken(v))
      .filter((v): v is string => Boolean(v))
      .slice(0, 8);
    const derivedSearchTokens = buildSearchTokensFromAttributes({
      moodTokens: moodTokens.length ? moodTokens : inferred.moodTokens,
      textureTokens: textureTokens.length ? textureTokens : inferred.textureTokens,
      tempoTokens: tempoTokens.length ? tempoTokens : inferred.tempoTokens,
      genres,
    });
    const searchTokens = mergeSeededSearchTokens(
      artistDirectSeed,
      geminiSpotifyQueries,
      rawTokens,
      derivedSearchTokens,
    );
    if (!searchTokens.length) return fallbackLocal();
    const rawStrategy = (json as any)?.strategy ?? {};
    const strategy = buildFastRecommendationStrategy({
      localIntent: args.localIntent,
      mixStrategy: (json.mixStrategy as any) ?? "balanced",
      noveltyLevel: (json.noveltyLevel as any) ?? "balanced",
      diversity: Number(rawStrategy?.diversity ?? NaN),
      freshness: Number(rawStrategy?.freshness ?? NaN),
      popularityBias: Number(rawStrategy?.popularityBias ?? NaN),
      genreMix: {
        taste: Number(rawStrategy?.genreMix?.taste ?? NaN),
        general: Number(rawStrategy?.genreMix?.general ?? NaN),
        exploration: Number(rawStrategy?.genreMix?.exploration ?? NaN),
      },
    });
    return {
      moodTokens: moodTokens.length ? moodTokens : inferred.moodTokens,
      textureTokens: textureTokens.length ? textureTokens : inferred.textureTokens,
      tempoTokens: tempoTokens.length ? tempoTokens : inferred.tempoTokens,
      searchTokens,
      excludeTokens,
      genres: genres.length ? genres : args.localIntent.genres.slice(0, 4),
      energy: json.energyLevel ?? args.localIntent.energy,
      confidence: Math.max(0.52, args.localIntent.confidence),
      source: "gemini",
      strategy,
    };
  } catch {
    return fallbackLocal();
  }
}

function mergeFastIntentWithSemanticPlan(
  intent: FastIntent,
  semanticPlan: FastSemanticTokenPlan | null,
): FastIntent {
  if (!semanticPlan) return intent;
  const mergedMood = Array.from(
    new Set([
      ...intent.moodKeywords,
      ...semanticPlan.moodTokens.map(v => normalizeText(v)).filter(Boolean),
      ...semanticPlan.textureTokens.map(v => normalizeText(v)).filter(Boolean),
    ]),
  ).slice(0, 8);
  const mergedExclude = Array.from(
    new Set([
      ...intent.excludeKeywords,
      ...semanticPlan.excludeTokens.map(v => normalizeText(v)).filter(Boolean),
    ]),
  ).slice(0, 6);
  return {
    moodKeywords: mergedMood,
    excludeKeywords: mergedExclude,
    genres: intent.genres,
    energy: semanticPlan.energy ?? intent.energy,
    confidence: Math.max(intent.confidence, semanticPlan.confidence),
  };
}

function expandFastKeywordTokens(keyword: string): string[] {
  const k = normalizeText(keyword);
  if (!k) return [];
  if (/화창|맑은|sunny/.test(k)) return ["upbeat", "happy", "summer"];
  if (/한강/.test(k)) return ["outdoor chill", "easy listening"];
  if (/산책|walk/.test(k)) return ["easy listening", "chill"];
  if (/약속|데이트|만남/.test(k)) return ["date", "meeting"];
  if (/준비|메이크업|외출준비/.test(k)) return ["getting ready", "ready"];
  if (/기분.?좋/.test(k)) return ["feel good", "happy vibe"];
  if (/신나|업템포|에너지|파티/.test(k)) return ["upbeat", "energetic"];
  if (/차분|잔잔|편안|힐링/.test(k)) return ["chill", "calm"];
  return [mapFastKeywordToSearchToken(k)];
}

function buildFastGenreSearchVariants(genre: string): string[] {
  const g = normalizeText(genre);
  if (!g) return [];
  if (g === "k-pop") return ["kpop", "k-pop", "케이팝", "korean pop", "kpop korea"];
  if (g === "멜로디 힙합") {
    return [
      "melodic hip hop",
      "korean hip hop rnb",
      "khiphop rnb",
      "감성 힙합",
      "멜로디 힙합",
      "khiphop",
    ];
  }
  if (g === "힙합") return ["hip hop", "korean hip hop", "rap", "힙합"];
  if (g === "rnb/소울" || g === "rnb 소울")
    return ["korean rnb", "korean soul", "rnb soul", "알앤비 소울", "r&b soul"];
  if (g === "발라드") return ["korean ballad", "발라드"];
  if (g === "인디") return ["korean indie", "인디"];
  if (g === "포크") return ["korean folk", "acoustic folk", "folk"];
  if (g === "영화음악" || g === "ost") return ["korean ost", "soundtrack", "cinematic pop"];
  if (g === "edm") return ["edm", "electronic"];
  return [genre];
}

function buildPracticalGenreSeeds(genres: string[]): string[] {
  const out = new Set<string>();
  for (const genre of genres) {
    const g = normalizeText(String(genre ?? ""));
    if (!g) continue;
    if (g.includes("k-pop") || g.includes("kpop")) {
      out.add("k-pop");
      out.add("k-pop playlist");
      continue;
    }
    if (g.includes("rnb") || g.includes("soul") || g.includes("알앤비")) {
      out.add("korean rnb");
      out.add("korean rnb chill");
      out.add("rnb soul");
      continue;
    }
    if (g.includes("indie") || g.includes("인디")) {
      out.add("korean indie");
      out.add("korean indie chill");
      continue;
    }
    if (g.includes("folk") || g.includes("포크")) {
      out.add("korean folk");
      out.add("acoustic folk");
      continue;
    }
    if (g.includes("ost") || g.includes("영화음악") || g.includes("soundtrack") || g.includes("cinematic")) {
      out.add("soundtrack playlist");
      out.add("cinematic soundtrack");
      continue;
    }
    if (g.includes("melodic hip hop")) {
      out.add("melodic hip hop");
      out.add("korean hip hop rnb");
      continue;
    }
    if (g.includes("hip hop") || g.includes("힙합")) {
      out.add("korean hip hop");
      out.add("hip hop");
      continue;
    }
  }
  if (!out.size) {
    out.add("k-pop");
    out.add("korean rnb");
    out.add("korean indie");
  }
  return Array.from(out).slice(0, 8);
}

function addFastQuery(
  list: string[],
  signatures: string[][],
  rawQuery: string,
  maxQueries: number,
): void {
  const base = String(rawQuery ?? "").replace(/\s+/g, " ").trim().slice(0, 64);
  const isTagBase = isFastTagQuery(base);
  const query = isTagBase ? base.slice(0, 48) : sanitizeFastSearchToken(base);
  if (!query) return;
  const isTag = isFastTagQuery(query);
  const tokens = queryDiversitySignature(query).filter(
    t => !FAST_INTENT_NOISE.has(normalizeText(t)),
  );
  if (!tokens.length) return;
  const isTooSimilar = signatures.some(sig => {
    if (isTag || sig.some(token => token.startsWith("tag:"))) return false;
    const sim = jaccardSimilarity(sig, tokens);
    const subset =
      tokens.length &&
      (tokens.every(t => sig.includes(t)) || sig.every(t => tokens.includes(t)));
    return sim >= 0.95 && subset;
  });
  if (isTooSimilar) return;
  list.push(query);
  signatures.push(tokens);
  if (list.length > maxQueries) {
    list.length = maxQueries;
    signatures.length = maxQueries;
  }
}

function buildFastTagQueries(genre: string, moodToken?: string, energyToken?: string): string[] {
  const g = normalizeText(genre);
  if (!g) return [];
  const tagGenre =
    g === "k-pop"
      ? 'genre:"k-pop"'
      : g === "멜로디 힙합"
        ? 'genre:"hip-hop"'
        : g === "힙합"
          ? 'genre:"hip-hop"'
          : g === "rnb/소울" || g === "rnb 소울"
            ? 'genre:"r-n-b"'
            : g === "인디"
              ? 'genre:"indie"'
              : g === "발라드"
                ? 'genre:"k-pop"'
                : "";
  if (!tagGenre) return [];
  const out: string[] = [];
  if (moodToken) out.push(`${tagGenre} ${moodToken}`.slice(0, 48));
  if (energyToken) out.push(`${tagGenre} ${energyToken}`.slice(0, 48));
  out.push(tagGenre);
  return out;
}

function isFastTagQuery(query: string): boolean {
  return /(^|\s)(genre|artist|track)\s*:/.test(String(query ?? "").toLowerCase());
}

function queryDiversitySignature(query: string): string[] {
  const raw = String(query ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  if (!isFastTagQuery(raw)) return keywordList(normalizeText(raw));
  const lowered = raw.toLowerCase();
  const tags = Array.from(
    lowered.matchAll(/\b(genre|artist|track)\s*:\s*"([^"]+)"|\b(genre|artist|track)\s*:\s*([^\s]+)/g),
  )
    .map(m => {
      const key = (m[1] || m[3] || "").trim();
      const value = (m[2] || m[4] || "").trim();
      const normalizedValue = normalizeText(value).replace(/\s+/g, "-");
      return key && normalizedValue ? `tag:${key}=${normalizedValue}` : "";
    })
    .filter(Boolean);
  const withoutTags = lowered
    .replace(/\b(genre|artist|track)\s*:\s*"[^"]+"/g, " ")
    .replace(/\b(genre|artist|track)\s*:\s*[^\s]+/g, " ");
  const textTokens = keywordList(normalizeText(withoutTags));
  return [...tags, ...textTokens];
}

function buildFastSearchQueries(args: {
  input: string;
  intent: FastIntent;
  strategy: FastRecommendationStrategy;
  semanticPlan?: FastSemanticTokenPlan | null;
  timeConstraint?: TimeConstraint | null;
  bootstrap?: SpotifyBootstrapData | null;
}): {
  queries: string[];
  baseQueries: string[];
  tasteExpansionQueries: string[];
  explorationQueries: string[];
} {
  const querySeed = stableHash(`${args.input}|${Date.now()}`);
  let randCursor = 0;
  const seededPick = <T,>(arr: T[]): T | null => {
    if (!arr.length) return null;
    const idx = Math.abs(stableHash(`${querySeed}|${randCursor++}`)) % arr.length;
    return arr[idx] ?? null;
  };
  const shuffle = <T,>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);
  const toShortPair = (q: string): string => {
    const tokens = keywordList(normalizeText(q))
      .filter(t => !FAST_TOKEN_BLOCKLIST.has(normalizeText(t)))
      .filter(t => t.length >= 2)
      .slice(0, 2);
    return tokens.join(" ").trim();
  };
  const semanticSearchTokens = (args.semanticPlan?.searchTokens ?? [])
    .map(v => sanitizeFastSearchToken(v))
    .filter((v): v is string => Boolean(v))
    .filter(isPracticalSpotifySearchToken)
    .slice(0, 6);
  const moodTokens = Array.from(
    new Set([
      ...args.intent.moodKeywords.flatMap(expandFastKeywordTokens),
    ].filter(Boolean)),
  ).slice(0, 8);
  const attributeMoodTokens = (args.semanticPlan?.moodTokens ?? []).slice(0, 4);
  const textureTokens = (args.semanticPlan?.textureTokens ?? []).slice(0, 4);
  const tempoTokens = (args.semanticPlan?.tempoTokens ?? []).slice(0, 2);
  const genreVariants = Array.from(
    new Set([
      ...(args.semanticPlan?.genres ?? []),
      ...args.intent.genres.flatMap(buildFastGenreSearchVariants),
    ].filter(Boolean)),
  ).slice(0, 10);
  const practicalGenreSeeds = buildPracticalGenreSeeds([
    ...args.intent.genres,
    ...(args.semanticPlan?.genres ?? []),
    ...genreVariants,
  ]);
  const effectiveEnergy = args.semanticPlan?.energy ?? args.intent.energy;
  const energyToken = effectiveEnergy === "high" ? "upbeat" : effectiveEnergy === "low" ? "chill" : "";
  const hasSoftMood = [...attributeMoodTokens, ...textureTokens, ...moodTokens]
    .some(t => /breezy|bright|warm|soft|calm|light|acoustic|clean|chill/i.test(String(t)));
  const prunedGenreVariants = hasSoftMood
    ? genreVariants.filter(g => !/trap|drill|hard[\s-]?rap|aggressive/i.test(normalizeText(g)))
    : genreVariants;
  const strictQueries: string[] = [];
  const moodQueries: string[] = [];
  const tasteExpansionQueries: string[] = [];
  const discoveryQueries: string[] = [];
  const strictSig: string[][] = [];
  const moodSig: string[][] = [];
  const tasteExpansionSig: string[][] = [];
  const discoverySig: string[][] = [];
  const maxQueries = 10;

  // 장르 기반 기본 쿼리는 항상 포함한다 (general pool 보호).
  const guaranteedGeneralQueries = Array.from(
    new Set(
      [
        ...practicalGenreSeeds,
        ...moodTokens.slice(0, 3).map(v => sanitizeFastSearchToken(v)).filter(Boolean) as string[],
        ...(energyToken ? practicalGenreSeeds.slice(0, 3).map(g => sanitizeFastSearchToken(`${g} ${energyToken}`)).filter(Boolean) : []),
      ]
        .map(v => sanitizeFastSearchToken(v))
        .filter(Boolean),
    ),
  );

  // 장르 단독/짧은 시드를 먼저 확보해 Spotify 검색 0건 확률을 낮춘다.
  for (const q of guaranteedGeneralQueries) addFastQuery(strictQueries, strictSig, q, maxQueries);
  for (const g of practicalGenreSeeds.slice(0, 4)) {
    addFastQuery(strictQueries, strictSig, g, maxQueries);
  }

  const attributeSearchTokens = buildSearchTokensFromAttributes({
    moodTokens: attributeMoodTokens,
    textureTokens,
    tempoTokens,
    genres: practicalGenreSeeds.length ? practicalGenreSeeds : args.intent.genres,
  })
    .filter(isPracticalSpotifySearchToken)
    .slice(0, 8);

  if (practicalGenreSeeds.length) {
    for (const g of practicalGenreSeeds.slice(0, 5)) {
      addFastQuery(strictQueries, strictSig, g, maxQueries);
      for (const practical of attributeSearchTokens.slice(0, 5)) {
        addFastQuery(moodQueries, moodSig, practical, maxQueries);
      }
      if (energyToken) {
        addFastQuery(moodQueries, moodSig, `${g} ${energyToken}`, maxQueries);
      }
    }
  }

  for (const moodQ of moodTokens.slice(0, 4)) {
    addFastQuery(moodQueries, moodSig, moodQ, maxQueries);
  }
  for (const searchQ of semanticSearchTokens) {
    addFastQuery(moodQueries, moodSig, searchQ, maxQueries);
  }

  if (args.intent.genres.includes("멜로디 힙합") && !hasSoftMood) {
    addFastQuery(strictQueries, strictSig, "korean hip hop rnb", maxQueries);
    addFastQuery(discoveryQueries, discoverySig, "emotional melodic hip hop", maxQueries);
    addFastQuery(discoveryQueries, discoverySig, "khiphop underrated", maxQueries);
  }
  const explorationCandidates = [
    "korean indie",
    "korean indie upbeat",
    "korean rnb",
    "korean rnb chill",
    "k-pop upbeat",
    "korean ost acoustic",
  ];
  const explorationPickCount = 2;
  for (let i = 0; i < explorationPickCount; i += 1) {
    const picked = seededPick(explorationCandidates);
    if (picked) addFastQuery(discoveryQueries, discoverySig, picked, maxQueries);
  }

  const expandedTasteGenres = args.bootstrap
    ? [...expandTasteGenresFromProfile(buildUserTasteProfile(args.bootstrap))]
        .filter(g => /korean|k-pop|kpop|rnb|soul|indie|folk|ballad|melodic/.test(g))
        .slice(0, 6)
    : [];
  const practicalTasteSeeds = buildPracticalGenreSeeds(expandedTasteGenres);
  for (const g of expandedTasteGenres) {
    const mapped = buildPracticalGenreSeeds([g])[0];
    if (!mapped) continue;
    const mood = effectiveEnergy === "high" ? "upbeat" : effectiveEnergy === "low" ? "chill" : "happy";
    addFastQuery(tasteExpansionQueries, tasteExpansionSig, `${mapped} ${mood}`, maxQueries);
    addFastQuery(tasteExpansionQueries, tasteExpansionSig, mapped, maxQueries);
  }
  for (const g of practicalTasteSeeds.slice(0, 4)) {
    addFastQuery(tasteExpansionQueries, tasteExpansionSig, g, maxQueries);
  }
  if (prunedGenreVariants.some(g => /indie|인디/.test(normalizeText(g)))) {
    addFastQuery(discoveryQueries, discoverySig, "underrated korean indie", maxQueries);
    addFastQuery(discoveryQueries, discoverySig, "lofi acoustic chill", maxQueries);
  }
  if (prunedGenreVariants.some(g => /folk|포크/.test(normalizeText(g)))) {
    addFastQuery(discoveryQueries, discoverySig, "warm soft folk acoustic", maxQueries);
  }
  if (prunedGenreVariants.some(g => /ost|cinematic|soundtrack|영화음악/.test(normalizeText(g)))) {
    addFastQuery(discoveryQueries, discoverySig, "cinematic soundtrack", maxQueries);
    addFastQuery(discoveryQueries, discoverySig, "light cinematic pop", maxQueries);
  }

  // 검색 성공률을 위해 2단어 조합을 추가한다.
  for (const q of [...strictQueries, ...moodQueries, ...discoveryQueries]) {
    const shortQ = toShortPair(q);
    if (shortQ && shortQ !== q) addFastQuery(discoveryQueries, discoverySig, shortQ, maxQueries);
  }

  if (!strictQueries.length && !moodQueries.length && !discoveryQueries.length) {
    const fallbackGenres = buildPracticalGenreSeeds(args.intent.genres);
    for (const q of fallbackGenres.length ? fallbackGenres : ["k-pop", "korean rnb", "korean indie"]) {
      addFastQuery(strictQueries, strictSig, q, maxQueries);
    }
  }

  // strategy 기반 ratio
  const baseRatio = {
    base: Math.max(0.2, args.strategy.poolRatio.general + 0.15),
    taste: Math.max(0.2, args.strategy.poolRatio.taste - 0.05),
    exploration: Math.max(0.15, args.strategy.poolRatio.exploration),
  };
  const pickCount = (
    list: string[],
    ratio: number,
    minCount: number,
    remaining: number,
  ): number => {
    if (!list.length || remaining <= 0) return 0;
    const target = Math.max(minCount, Math.round(maxQueries * ratio));
    return Math.min(list.length, remaining, target);
  };
  let remaining = maxQueries;
  const baseMerged = Array.from(new Set([...moodQueries, ...strictQueries]));
  const baseCount = pickCount(baseMerged, baseRatio.base, 5, remaining);
  remaining -= baseCount;
  const tasteCount = pickCount(tasteExpansionQueries, baseRatio.taste, 2, remaining);
  remaining -= tasteCount;
  const discoveryCount = pickCount(discoveryQueries, baseRatio.exploration, 0, remaining);
  remaining -= discoveryCount;
  const baseQueries = shuffle(baseMerged).slice(0, baseCount);
  const tasteQueries = shuffle(tasteExpansionQueries).slice(0, tasteCount);
  const explorationQueries = shuffle(discoveryQueries).slice(0, discoveryCount);
  const queries = [...baseQueries, ...tasteQueries, ...explorationQueries];
  if (remaining > 0) {
    const refill = shuffle([
      ...baseMerged,
      ...tasteExpansionQueries,
      ...discoveryQueries,
    ]);
    for (const q of refill) {
      if (queries.length >= maxQueries) break;
      queries.push(q);
    }
  }
  const compact = Array.from(
    new Set(
      queries.map(q => keywordList(normalizeText(q)).slice(0, 3).join(" ")).filter(Boolean),
    ),
  );
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const sig = keywordList(normalizeText(q))
      .filter(t => !FAST_WEAK_CONTEXT_TOKENS.has(normalizeText(t)))
      .slice(0, 3)
      .join(" ");
    if (!sig || seen.has(sig)) continue;
    seen.add(sig);
    resolved.push(q);
    if (resolved.length >= maxQueries) break;
  }
  if (resolved.length < Math.min(maxQueries, compact.length)) {
    for (const sig of compact) {
      if (resolved.length >= maxQueries) break;
      if (seen.has(sig)) continue;
      seen.add(sig);
      resolved.push(sig);
    }
  }
  return {
    queries: resolved.slice(0, maxQueries),
    baseQueries: baseQueries.slice(0, maxQueries),
    tasteExpansionQueries: tasteQueries.slice(0, maxQueries),
    explorationQueries: explorationQueries.slice(0, maxQueries),
  };
}

function scoreTrackFast(args: {
  track: SpotifyTrackSummary;
  intent: FastIntent;
  strategy?: FastRecommendationStrategy;
  tasteProfile?: UserTasteProfile;
  userTopTrackIds?: Set<string>;
  userTopArtistIds?: Set<string>;
  userTopArtistNames?: Set<string>;
  variationSeed?: number;
  explorationRatio?: number;
}): number {
  const { track, intent } = args;
  const clampUnit = (n: number): number => Math.min(1, Math.max(0, n));
  const explorationRatio = clampUnit(Number(args.explorationRatio ?? 0.28));
  const text = normalizeText(
    [
      track.name,
      ...(track.artists ?? []).map(a => a.name),
      ...(track.genres ?? []),
      track.album?.name ?? "",
    ].join(" "),
  );
  let moodScore = 0;
  let genreScore = 0;

  intent.moodKeywords.forEach(kw => {
    if (text.includes(kw)) moodScore += 2.0;
  });
  intent.genres.forEach(g => {
    const normalized = normalizeText(g);
    if (normalized && text.includes(normalized)) genreScore += 2.0;
  });
  if (intent.genres.length) {
    const hasGenreMatch = intent.genres.some(g => text.includes(normalizeText(g)));
    if (!hasGenreMatch) genreScore -= 2.2;
  }
  intent.excludeKeywords.forEach(ex => {
    if (text.includes(ex)) moodScore -= 2.4;
  });

  const tempo = Number(track.tempo ?? 0);
  if (tempo > 0) {
    if (intent.energy === "high" && tempo >= 116) moodScore += 1.1;
    if (intent.energy === "low" && tempo <= 104) moodScore += 1.1;
    if (intent.energy === "mid" && tempo >= 90 && tempo <= 126) moodScore += 1.0;
  }

  const trackId = String(track.id ?? "").trim();
  let affinityBoost = 0;
  if (trackId && args.userTopTrackIds?.has(trackId)) affinityBoost += 0.45;
  const artistIds = (track.artists ?? [])
    .map(a => String(a?.id ?? "").trim())
    .filter(Boolean);
  if (artistIds.some(id => args.userTopArtistIds?.has(id))) affinityBoost += 0.5;
  const artistNames = (track.artists ?? [])
    .map(a => normalizeText(a?.name ?? ""))
    .filter(Boolean);
  if (artistNames.some(name => args.userTopArtistNames?.has(name))) affinityBoost += 0.35;

  const tasteRaw = args.tasteProfile ? scoreTasteAffinity(track, args.tasteProfile) : 0;
  const tasteAffinityScore = clampUnit(tasteRaw / 2.1 + affinityBoost * 0.65);
  const semanticMoodScore = clampUnit((moodScore + 2.6) / 7.2);
  const genreFitScore = clampUnit((genreScore + 1.8) / 5.2);
  const contextScore = scoreFastContextFit(track, intent);
  const weights = args.strategy?.scoring ?? { taste: 0.4, context: 0.3, genre: 0.2, mood: 0.1 };
  const jitter =
    (((stableHash(`${track.id}|${track.name}|${String(args.variationSeed ?? 0)}|${explorationRatio}`) % 1000) / 1000) - 0.5) * 0.02;

  return (
    tasteAffinityScore * weights.taste +
    contextScore * weights.context +
    genreFitScore * weights.genre +
    semanticMoodScore * weights.mood +
    jitter
  );
}

function shouldApplySoftMoodGate(intent: FastIntent): boolean {
  const text = normalizeText(
    `${intent.moodKeywords.join(" ")} ${intent.excludeKeywords.join(" ")} ${intent.energy}`,
  );
  return /breezy|bright|warm|soft|calm|light|acoustic|clean|chill|sunny|spring/.test(text);
}

function isAggressiveTrack(track: SpotifyTrackSummary): boolean {
  const text = normalizeText(
    [
      track.name,
      ...(track.artists ?? []).map(a => a.name),
      ...(track.genres ?? []),
      track.album?.name ?? "",
    ].join(" "),
  );
  const tempo = Number(track.tempo ?? 0);
  if (/trap|drill|aggressive|hard rap|boom bap|gangsta/.test(text)) return true;
  if (tempo >= 132 && /hip hop|rap/.test(text)) return true;
  return false;
}

function inferFastContextTags(intent: FastIntent): Set<string> {
  const text = normalizeText(
    `${intent.moodKeywords.join(" ")} ${intent.excludeKeywords.join(" ")} ${intent.genres.join(" ")} ${intent.energy}`,
  );
  const tags = new Set<string>();
  if (/산책|walk|stroll|walking/.test(text)) tags.add("walking");
  if (/한강|river|공원|야외|outdoor|outside/.test(text)) tags.add("outdoor");
  if (/화창|맑|sunny|day|낮|아침|morning|afternoon|spring|봄/.test(text)) tags.add("daytime");
  if (/카페|작업|집중|study|focus|work/.test(text)) tags.add("focus");
  if (/출근|퇴근|commute|drive|driving/.test(text)) tags.add("commute");
  return tags;
}

function scoreFastContextFit(track: SpotifyTrackSummary, intent: FastIntent): number {
  const tags = inferFastContextTags(intent);
  if (!tags.size) return 0.55;
  const text = normalizeText(
    [
      track.name,
      ...(track.artists ?? []).map(a => a.name),
      ...(track.genres ?? []),
      track.album?.name ?? "",
    ].join(" "),
  );
  const tempo = Number(track.tempo ?? 0);
  let gained = 0;
  let weight = 0;
  if (tags.has("walking")) {
    weight += 1;
    if (tempo > 0 && tempo >= 88 && tempo <= 124) gained += 0.55;
    if (/chill|easy listening|acoustic|indie|folk|rnb|k-pop|korean pop|light/.test(text)) gained += 0.45;
    if (isAggressiveTrack(track)) gained -= 0.45;
  }
  if (tags.has("outdoor")) {
    weight += 1;
    if (/summer|spring|day|sun|outdoor|breezy|light|acoustic|indie|pop/.test(text)) gained += 0.55;
    if (tempo > 0 && tempo >= 90 && tempo <= 130) gained += 0.35;
    if (isAggressiveTrack(track)) gained -= 0.35;
  }
  if (tags.has("daytime")) {
    weight += 1;
    if (/upbeat|happy|summer|bright|light|feel good|pop/.test(text)) gained += 0.6;
    if (tempo > 0 && tempo >= 95 && tempo <= 128) gained += 0.35;
  }
  if (tags.has("focus")) {
    weight += 1;
    if (/lofi|chill|instrumental|acoustic|indie|ambient|soft/.test(text)) gained += 0.6;
    if (tempo > 0 && tempo >= 78 && tempo <= 118) gained += 0.35;
    if (isAggressiveTrack(track)) gained -= 0.35;
  }
  if (tags.has("commute")) {
    weight += 1;
    if (/upbeat|drive|night|city|pop|hip hop|rnb/.test(text)) gained += 0.45;
    if (tempo > 0 && tempo >= 90 && tempo <= 130) gained += 0.4;
  }
  if (weight <= 0) return 0.55;
  return Math.min(1, Math.max(0, gained / weight));
}

function selectTracksFast(args: {
  tracks: SpotifyTrackSummary[];
  intent: FastIntent;
  targetCount: number;
  targetMinutes?: number | null;
  timeConstraint?: TimeConstraint | null;
  recentAvoidTrackIds?: Set<string>;
  recentAvoidArtistKeys?: Set<string>;
  userTopTrackIds?: Set<string>;
  userTopArtistIds?: Set<string>;
  userTopArtistNames?: Set<string>;
  tasteProfile?: UserTasteProfile;
  tasteCandidateIds?: Set<string>;
  tasteQuota?: number;
  variationSeed?: number;
  explorationRatio?: number;
  strategy?: FastRecommendationStrategy;
}): SpotifyTrackSummary[] {
  const dayKey = recommendationDayKey();
  const dedup = mergeUniqueTracks(args.tracks);
  const expandedTasteGenres = args.tasteProfile
    ? expandTasteGenresFromProfile(args.tasteProfile)
    : new Set<string>();
  const genreMatchTokens = Array.from(
    new Set(args.intent.genres.flatMap(fastGenreMatchTokens).map(normalizeText).filter(Boolean)),
  );
  const hasGenreConstraint = genreMatchTokens.length > 0;
  const genreFiltered = hasGenreConstraint
    ? dedup.filter(track => {
        const text = normalizeText(
          [
            track.name,
            ...(track.artists ?? []).map(a => a.name),
            ...(track.genres ?? []),
            track.album?.name ?? "",
          ].join(" "),
        );
        return genreMatchTokens.some(token => text.includes(token));
      })
    : dedup;
  const pool = hasGenreConstraint
    ? (genreFiltered.length ? genreFiltered : dedup)
    : dedup;
  const applySoftGate = shouldApplySoftMoodGate(args.intent);
  const baseCandidates = pool
    .filter(track => {
      const id = String(track.id ?? "").trim();
      if (id && args.recentAvoidTrackIds?.has(id)) return false;
      const artistHit = trackArtistKeys(track).some(k => args.recentAvoidArtistKeys?.has(k));
      if (artistHit) return false;
      if (applySoftGate && isAggressiveTrack(track)) return false;
      return true;
    })
    .map(track => ({
      track,
      tasteRaw: args.tasteProfile ? scoreTasteAffinity(track, args.tasteProfile) : 0,
      artistAffinityHit: (track.artists ?? []).some(a => {
        const id = String(a?.id ?? "").trim();
        const name = normalizeText(a?.name ?? "");
        return (
          (id && (args.userTopArtistIds?.has(id) ?? false)) ||
          (name && (args.userTopArtistNames?.has(name) ?? false))
        );
      }),
      expandedGenreHit: (track.genres ?? [])
        .map(g => normalizeText(g))
        .some(g => expandedTasteGenres.has(g)),
      score:
        scoreTrackFast({
          track,
          intent: args.intent,
          tasteProfile: args.tasteProfile,
          userTopTrackIds: args.userTopTrackIds,
          userTopArtistIds: args.userTopArtistIds,
          userTopArtistNames: args.userTopArtistNames,
          variationSeed: args.variationSeed,
          explorationRatio: args.explorationRatio,
          strategy: args.strategy,
        }) +
        (((track.artists ?? []).some(a => {
          const id = String(a?.id ?? "").trim();
          const name = normalizeText(a?.name ?? "");
          return (
            (id && (args.userTopArtistIds?.has(id) ?? false)) ||
            (name && (args.userTopArtistNames?.has(name) ?? false))
          );
        }) ? 0.5 : 0)) +
        (((stableHash(`${track.id}|${dayKey}|${args.intent.energy}|${String(args.variationSeed ?? 0)}`) % 1000) / 1000) - 0.5) * 0.25,
    }));
  const tasteFloor = args.tasteProfile ? 0.32 : Number.NEGATIVE_INFINITY;
  const tasteMatched = baseCandidates.filter(
    item => item.tasteRaw >= tasteFloor || item.artistAffinityHit || item.expandedGenreHit,
  );
  const tasteCandidateSet = args.tasteCandidateIds ?? new Set<string>();
  const hasTastePool = tasteCandidateSet.size > 0;
  const scoredSource =
    args.tasteProfile && tasteMatched.length >= Math.max(12, Math.round(args.targetCount * 1.35))
      ? tasteMatched
      : baseCandidates.map(item => ({
          ...item,
          score:
            item.score +
            (item.tasteRaw < tasteFloor && !item.expandedGenreHit ? -3 : 0) +
            ((() => {
              const k = trackDedupKey(item.track);
              return k && hasTastePool && !tasteCandidateSet.has(k) ? -1.1 : 0;
            })()),
        }));
  const scored = scoredSource.sort((a, b) => b.score - a.score);
  const explorationRatio = Math.min(
    1,
    Math.max(0, Number(args.explorationRatio ?? args.strategy?.poolRatio.exploration ?? 0.3)),
  );
  const personalizationRatio = Math.max(0.55, 0.78 - explorationRatio * 0.35);
  const tasteSorted = [...scored].sort((a, b) => b.tasteRaw - a.tasteRaw);
  const tasteKeepCount = Math.max(12, Math.min(scored.length, Math.round(args.targetCount * 2.8)));
  const tasteKeep = new Set(
    tasteSorted
      .slice(0, tasteKeepCount)
      .map(v => trackDedupKey(v.track))
      .filter((v): v is string => Boolean(v)),
  );

  const selected: SpotifyTrackSummary[] = [];
  const artistCount = new Map<string, number>();
  const genreCount = new Map<string, number>();
  const used = new Set<string>();
  const personalTarget = Math.max(6, Math.round(args.targetCount * personalizationRatio));
  for (const item of scored) {
    if (selected.length >= personalTarget) break;
    if (selected.length >= args.targetCount) break;
    const key = trackDedupKey(item.track);
    if (!key || used.has(key)) continue;
    if (!tasteKeep.has(key)) continue;
    const primaryArtist = normalizeText(item.track.artists?.[0]?.name ?? "");
    const primaryGenre = normalizeText(item.track.genres?.[0] ?? "");
    if (primaryArtist && (artistCount.get(primaryArtist) ?? 0) >= 2) continue;
    if (primaryGenre && (genreCount.get(primaryGenre) ?? 0) >= 4) continue;
    selected.push(item.track);
    used.add(key);
    if (primaryArtist) artistCount.set(primaryArtist, (artistCount.get(primaryArtist) ?? 0) + 1);
    if (primaryGenre) genreCount.set(primaryGenre, (genreCount.get(primaryGenre) ?? 0) + 1);
  }

  if (hasTastePool && selected.length) {
    const tasteRatio = Math.min(0.8, Math.max(0.45, Number(args.tasteQuota ?? 0.6)));
    const requiredTaste = Math.max(5, Math.round(args.targetCount * tasteRatio));
    const keyOf = (t: SpotifyTrackSummary): string => String(trackDedupKey(t) ?? "");
    let tasteCount = selected.filter(t => tasteCandidateSet.has(keyOf(t))).length;
    if (tasteCount < requiredTaste) {
      const tasteRanked = scored
        .map(v => v.track)
        .filter(t => {
          const k = keyOf(t);
          return Boolean(k) && tasteCandidateSet.has(k) && !used.has(k);
        });
      for (const t of tasteRanked) {
        if (tasteCount >= requiredTaste) break;
        const k = keyOf(t);
        if (!k || used.has(k)) continue;
        if (selected.length < args.targetCount) {
          selected.push(t);
          used.add(k);
          tasteCount += 1;
          continue;
        }
        const replaceIdx = [...selected.keys()].reverse().find(idx => {
          const sk = keyOf(selected[idx]);
          return Boolean(sk) && !tasteCandidateSet.has(sk);
        });
        if (replaceIdx === undefined || replaceIdx < 0) break;
        const oldKey = keyOf(selected[replaceIdx]);
        selected[replaceIdx] = t;
        used.add(k);
        if (oldKey) used.delete(oldKey);
        tasteCount += 1;
      }
    }
  }

  if (selected.length < Math.max(8, Math.round(args.targetCount * 0.6))) {
    for (const item of scored) {
      if (selected.length >= args.targetCount) break;
      const key = trackDedupKey(item.track);
      if (!key || used.has(key)) continue;
      selected.push(item.track);
      used.add(key);
    }
  }

  return enforceMinimumDuration({
    selected,
    targetMinutes: args.targetMinutes,
    timeConstraint: args.timeConstraint,
    candidatePool: dedup,
    minCoverage: args.timeConstraint?.mode === "at_least" ? 0.97 : 0.9,
    maxCount: 70,
  });
}

function evaluateTrackFinalFit(args: {
  track: SpotifyTrackSummary;
  intent: FastIntent;
  strategy?: FastRecommendationStrategy;
  tasteProfile?: UserTasteProfile;
  userTopTrackIds?: Set<string>;
  userTopArtistIds?: Set<string>;
  userTopArtistNames?: Set<string>;
}): { mood: number; context: number; genre: number; taste: number; total: number } {
  const text = normalizeText(
    [
      args.track.name,
      ...(args.track.artists ?? []).map(a => a.name),
      ...(args.track.genres ?? []),
      args.track.album?.name ?? "",
    ].join(" "),
  );
  let moodRaw = 0;
  const moodKeywords = args.intent.moodKeywords.slice(0, 8);
  moodKeywords.forEach(k => {
    if (text.includes(normalizeText(k))) moodRaw += 1;
  });
  const tempo = Number(args.track.tempo ?? 0);
  if (tempo > 0) {
    if (args.intent.energy === "high" && tempo >= 116) moodRaw += 0.8;
    if (args.intent.energy === "low" && tempo <= 104) moodRaw += 0.8;
    if (args.intent.energy === "mid" && tempo >= 90 && tempo <= 126) moodRaw += 0.7;
  }
  if (shouldApplySoftMoodGate(args.intent) && isAggressiveTrack(args.track)) moodRaw -= 1.2;
  const mood = Math.min(1, Math.max(0, moodRaw / 3));

  let genreRaw = 0;
  const genreTokens = args.intent.genres.flatMap(fastGenreMatchTokens).map(normalizeText).filter(Boolean);
  if (genreTokens.length) {
    const uniqueGenre = Array.from(new Set(genreTokens));
    const hit = uniqueGenre.some(g => text.includes(g));
    genreRaw = hit ? 1 : 0;
  } else {
    genreRaw = 1;
  }
  const genre = Math.min(1, Math.max(0, genreRaw));
  const context = scoreFastContextFit(args.track, args.intent);

  const tasteBase = args.tasteProfile ? scoreTasteAffinity(args.track, args.tasteProfile) : 0;
  const topTrackHit = args.userTopTrackIds?.has(String(args.track.id ?? "").trim()) ? 0.45 : 0;
  const topArtistHit = (args.track.artists ?? []).some(a => {
    const id = String(a?.id ?? "").trim();
    const name = normalizeText(a?.name ?? "");
    return (
      (id && (args.userTopArtistIds?.has(id) ?? false)) ||
      (name && (args.userTopArtistNames?.has(name) ?? false))
    );
  }) ? 0.5 : 0;
  const taste = Math.min(1, Math.max(0, tasteBase / 2.0 + topTrackHit + topArtistHit));
  const weights = args.strategy?.scoring ?? { taste: 0.4, context: 0.3, genre: 0.2, mood: 0.1 };
  const total =
    taste * weights.taste +
    context * weights.context +
    genre * weights.genre +
    mood * weights.mood;
  return { mood, context, genre, taste, total };
}

function applyFinalValidationLayer(args: {
  tracks: SpotifyTrackSummary[];
  intent: FastIntent;
  strategy?: FastRecommendationStrategy;
  targetCount: number;
  tasteProfile?: UserTasteProfile;
  userTopTrackIds?: Set<string>;
  userTopArtistIds?: Set<string>;
  userTopArtistNames?: Set<string>;
  explorationCandidateIds?: Set<string>;
  maxPerArtist?: number;
}): SpotifyTrackSummary[] {
  if (!args.tracks.length) return [];
  const scored = args.tracks.map(track => ({
    track,
    fit: evaluateTrackFinalFit({
      track,
      intent: args.intent,
      strategy: args.strategy,
      tasteProfile: args.tasteProfile,
      userTopTrackIds: args.userTopTrackIds,
      userTopArtistIds: args.userTopArtistIds,
      userTopArtistNames: args.userTopArtistNames,
    }),
  }));
  const maxPerArtist = Math.max(1, Math.min(2, Number(args.maxPerArtist ?? 2)));
  const explorationIds = args.explorationCandidateIds ?? new Set<string>();
  const withScore = scored
    .map(v => ({
      ...v,
      finalScore: v.fit.total,
      isExploration: (() => {
        const k = trackDedupKey(v.track);
        return Boolean(k) && explorationIds.has(String(k));
      })(),
    }))
    .sort((a, b) => b.finalScore - a.finalScore);
  const targetKeep = Math.max(args.targetCount, 10);
  const explorationTarget = Math.min(Math.max(1, Math.round(targetKeep * 0.2)), targetKeep);
  const chosen: typeof withScore = [];
  for (const item of withScore) {
    if (!item.isExploration) continue;
    chosen.push(item);
    if (chosen.length >= explorationTarget) break;
  }
  for (const item of withScore) {
    if (chosen.length >= targetKeep) break;
    const id = String(item.track.id ?? "");
    if (id && chosen.some(v => String(v.track.id ?? "") === id)) continue;
    chosen.push(item);
  }

  const passed: SpotifyTrackSummary[] = [];
  const artistCount = new Map<string, number>();
  for (const item of chosen) {
    const primaryArtist = normalizeText(item.track.artists?.[0]?.name ?? "");
    if (primaryArtist && (artistCount.get(primaryArtist) ?? 0) >= maxPerArtist) continue;
    passed.push(item.track);
    if (primaryArtist) {
      artistCount.set(primaryArtist, (artistCount.get(primaryArtist) ?? 0) + 1);
    }
    if (passed.length >= targetKeep) break;
  }
  if (explorationIds.size) {
    const hasExploration = passed.some(t => {
      const k = trackDedupKey(t);
      return Boolean(k) && explorationIds.has(String(k));
    });
    if (!hasExploration) {
      const explorationPick = withScore
        .map(v => v.track)
        .find(t => {
          const k = trackDedupKey(t);
          return Boolean(k) && explorationIds.has(String(k));
        });
      if (explorationPick) {
        if (passed.length < targetKeep) {
          passed.push(explorationPick);
        } else if (passed.length > 0) {
          passed[passed.length - 1] = explorationPick;
        }
      }
    }
  }
  console.warn(`[FastEngine] final scoring kept=${passed.length}/${args.tracks.length} topN-only`);
  return passed;
}

const TITLE_STOPWORDS = new Set([
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
  "중심",
  "어울리는",
  "느낌",
  "위주",
  "그리고",
  "혹은",
]);

const INTENT_STOPWORDS = new Set([
  ...TITLE_STOPWORDS,
  "분위기",
  "스타일",
  "느낌의",
  "느낌으로",
  "노래들",
  "곡들",
  "트랙",
  "좋은",
  "있는",
  "없는",
  "같은",
  "너무",
  "조금",
  "약간",
  "말고",
  "제외",
  "빼고",
  "싫은",
  "피하고",
  "피해",
  "without",
  "except",
  "avoid",
  "장르",
  "장르는",
  "계열",
  "중심으로",
  "중심",
  "자연스럽게",
  "섞어",
  "구성해줘",
  "구성",
  "총",
  "길이",
  "들을",
  "듣기",
  "어울리는",
  "추가요청",
  "추가",
  "요청",
  "그리고",
]);

const CONTEXT_ONLY_KEYWORDS = new Set([
  "신나는",
  "잔잔한",
  "차분한",
  "감성",
  "힐링",
  "집중",
  "공부",
  "작업",
  "업무",
  "운동",
  "드라이브",
  "밤",
  "새벽",
  "아침",
  "퇴근",
  "출근",
  "파티",
  "카페",
  "로파이",
  "기분전환",
  "에너지",
  "무드",
]);

const HIGH_ENERGY_HINTS = new Set([
  "신나는",
  "운동",
  "파티",
  "에너지",
  "업템포",
  "댄스",
  "달리기",
]);

const LOW_ENERGY_HINTS = new Set([
  "잔잔한",
  "차분한",
  "힐링",
  "수면",
  "잠",
  "새벽",
  "명상",
  "집중",
  "공부",
  "작업",
  "카페",
]);

function buildPromptFocusedPlaylistName(moodInput: string): string {
  const normalized = String(moodInput ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "AI 맞춤 플레이리스트";

  const base = normalized
    .split(/\n+/)[0]
    .split("추가 요청:")[0]
    .trim();
  const cleaned = base
    .replace(/[^0-9A-Za-z가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned
    .split(" ")
    .map(v => v.trim())
    .filter(v => v.length >= 2 && !TITLE_STOPWORDS.has(v));
  const uniq = Array.from(new Set(tokens));

  if (uniq.length >= 2) {
    const title = `${uniq[0]} ${uniq[1]} 무드`;
    return title.length > 22 ? `${title.slice(0, 22)}…` : title;
  }
  if (uniq.length === 1) {
    const title = `${uniq[0]} 무드 플레이리스트`;
    return title.length > 24 ? `${title.slice(0, 24)}…` : title;
  }
  return buildFallbackPlaylistName(normalized);
}

function moodLabelFromGenres(genres: string[]): string {
  const g = genres.map(v => v.toLowerCase());
  if (g.some(v => /jazz|soul|ballad|acoustic|ambient|lofi/.test(v))) return "감성";
  if (g.some(v => /edm|electro|house|techno|dance|trap/.test(v))) return "에너지";
  if (g.some(v => /hiphop|rap|rnb/.test(v))) return "힙합";
  if (g.some(v => /rock|metal|punk|alt/.test(v))) return "록";
  if (g.some(v => /indie|dream|shoegaze|synth/.test(v))) return "몽환";
  if (g.some(v => /pop|funk|disco/.test(v))) return "팝";
  return "무드";
}

function buildAutoPlaylistNameFromTracks(
  summaries: SpotifyTrackSummary[],
  moodInput: string,
): string {
  const promptTitle = buildPromptFocusedPlaylistName(moodInput);
  if (promptTitle && promptTitle !== "AI 맞춤 플레이리스트") return promptTitle;
  if (!summaries.length) return buildFallbackPlaylistName(moodInput);

  const artistCount = new Map<string, number>();
  const genreCount = new Map<string, number>();

  summaries.forEach(track => {
    track.artists?.forEach(a => {
      const name = String(a?.name ?? "").trim();
      if (!name) return;
      artistCount.set(name, (artistCount.get(name) ?? 0) + 1);
    });
    (track.genres ?? []).forEach(g => {
      const name = String(g ?? "").trim();
      if (!name) return;
      genreCount.set(name, (genreCount.get(name) ?? 0) + 1);
    });
  });

  const topArtist = Array.from(artistCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topGenres = Array.from(genreCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(v => v[0]);
  const mood = moodLabelFromGenres(topGenres);
  const base = topArtist
    ? `${topArtist} 중심 ${mood} 플리`
    : `${mood} 플레이리스트`;
  return base.length > 28 ? `${base.slice(0, 28)}…` : base;
}

function pickUniqueFromPool(
  pool: SpotifyTrackSummary[],
  count: number,
  used: Set<string>,
): SpotifyTrackSummary[] {
  const picked: SpotifyTrackSummary[] = [];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  for (const track of shuffled) {
    if (!track?.id || used.has(track.id)) continue;
    picked.push(track);
    used.add(track.id);
    if (picked.length >= count) break;
  }
  return picked;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizeText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^0-9A-Za-z가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordList(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .map(v => v.trim())
    .filter(v => v.length >= 2);
}

function parseGeminiKeywords(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map(v => normalizeText(String(v ?? "")))
        .filter(v => v.length >= 2),
    ),
  ).slice(0, 10);
}

function uniqueKeywords(values: string[], limit = 12): string[] {
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const raw of values) {
    const v = normalizeText(String(raw ?? ""));
    if (!v || seen.has(v)) continue;
    seen.add(v);
    picked.push(v);
    if (picked.length >= limit) break;
  }
  return picked;
}

function isWeakSearchKeyword(value: string): boolean {
  const v = normalizeText(value);
  if (!v) return true;
  if (INTENT_STOPWORDS.has(v)) return true;
  if (/^(장르|장르는|계열|중심|그리고|추가|요청|총|길이|이상|이내|내외)$/.test(v)) {
    return true;
  }
  if (/^(을|를|은|는|이|가|에|의|와|과|도|로)$/.test(v)) return true;
  if (v.length <= 1) return true;
  return false;
}

function dedupeGenresBySpecificity(genres: string[]): string[] {
  return uniqueKeywords(genres, 10);
}

function isGenreLikeToken(value: string): boolean {
  const v = normalizeText(value);
  return /k pop|k-pop|멜로디 힙합|힙합|pop|rnb|알앤비|soul|소울|발라드|인디|포크|재즈|edm|트로트|록|rock/.test(
    v,
  );
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildUserIntentProfile(moodInput: string): {
  include: string[];
  exclude: string[];
  specificity: number;
} {
  const raw = String(moodInput ?? "").trim();
  if (!raw) return { include: [], exclude: [], specificity: 0 };

  const clauses = raw
    .replace(/추가\s*요청\s*[:：]/gi, " ")
    .split(/\n+|[.!?]|,|\/|\|| 그리고 | 하지만 | 대신 /g)
    .map(v => String(v ?? "").trim())
    .filter(Boolean);

  const include: string[] = [];
  const exclude: string[] = [];
  const negativePattern = /(빼고|제외|말고|싫|피하|원치|without|except|avoid|no\s)/i;

  clauses.forEach(clause => {
    const tokens = keywordList(clause).filter(v => !INTENT_STOPWORDS.has(v));
    if (!tokens.length) return;
    if (negativePattern.test(clause)) {
      exclude.push(...tokens);
    } else {
      include.push(...tokens);
    }
  });

  const quotedPhrases = Array.from(
    raw.matchAll(/["']([^"']{2,40})["']/g),
  ).map(match => normalizeText(String(match?.[1] ?? "")));
  include.push(
    ...quotedPhrases.flatMap(phrase =>
      keywordList(phrase).filter(v => !INTENT_STOPWORDS.has(v)),
    ),
  );

  const uniqueInclude = Array.from(new Set(include)).slice(0, 14);
  const uniqueExclude = Array.from(new Set(exclude)).slice(0, 10);
  const specificityRaw =
    uniqueInclude.length * 0.9 + uniqueExclude.length * 1.2 + clauses.length * 0.3;
  const specificity = clamp(Math.round(specificityRaw), 0, 10);
  return {
    include: uniqueInclude,
    exclude: uniqueExclude,
    specificity,
  };
}

function extractPromptFacets(moodInput: string): {
  activity: string;
  sound: string;
  mood: string;
} {
  const tokens = keywordList(moodInput);
  const activitySet = new Set([
    "운동",
    "헬스",
    "달리기",
    "드라이브",
    "작업",
    "업무",
    "공부",
    "카페",
    "파티",
    "출근",
    "퇴근",
    "산책",
  ]);
  const soundSet = new Set([
    "가사",
    "보컬",
    "instrumental",
    "로파이",
    "어쿠스틱",
    "신스",
    "밴드",
    "힙합",
    "edm",
    "재즈",
    "락",
    "인디",
  ]);
  const moodSet = new Set([
    "신나는",
    "잔잔한",
    "차분한",
    "몽환",
    "감성",
    "힐링",
    "어두운",
    "밝은",
    "에너지",
    "집중",
  ]);

  const activity = Array.from(new Set(tokens.filter(v => activitySet.has(v)))).join(", ");
  const sound = Array.from(new Set(tokens.filter(v => soundSet.has(v)))).join(", ");
  const mood = Array.from(new Set(tokens.filter(v => moodSet.has(v)))).join(", ");
  return { activity, sound, mood };
}

function summarizePromptForRecommendation(rawInput: string): string {
  const normalized = String(rawInput ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const tokens = keywordList(normalized);
  const hasCompositeInstruction =
    /추가\s*요청|그리고|총\s*길이|장르|분위기|시대|이상|이내|내외|,|\/|\|/.test(
      normalized,
    );
  if (
    normalized.length <= 140 &&
    tokens.length <= 22 &&
    !hasCompositeInstruction
  ) {
    return normalized;
  }

  const intent = buildUserIntentProfile(normalized);
  const facets = extractPromptFacets(normalized);
  const time = extractTimeConstraint(normalized);
  const genrePatterns: Array<{ canonical: string; re: RegExp }> = [
    { canonical: "k-pop", re: /\bk[\s-]?pop\b|케이팝|케이 팝/i },
    { canonical: "멜로디 힙합", re: /멜로디\s*힙합|melodic\s*hip[\s-]?hop/i },
    { canonical: "힙합", re: /\bhip[\s-]?hop\b|힙합/i },
    { canonical: "인디", re: /인디|indie/i },
    { canonical: "포크", re: /포크|folk/i },
    { canonical: "발라드", re: /발라드|ballad/i },
    { canonical: "rnb", re: /\br[\s&-]?n[\s&-]?b\b|알앤비/i },
    { canonical: "edm", re: /\bedm\b|일렉|electronic/i },
    { canonical: "재즈", re: /재즈|jazz/i },
    { canonical: "트로트", re: /트로트|trot/i },
  ];
  const explicitGenres = genrePatterns
    .filter(item => item.re.test(normalized))
    .map(item => item.canonical)
    .slice(0, 6);

  const include = intent.include
    .filter(
      k =>
        !CONTEXT_ONLY_KEYWORDS.has(k) &&
        !INTENT_STOPWORDS.has(k) &&
        !/자연스럽|구성|계열|플레이리스트|추천|노래|음악|요청|추가|섞/.test(k),
    )
    .slice(0, 10);
  const includeFallback = intent.include
    .filter(k => !INTENT_STOPWORDS.has(k))
    .slice(0, 8);
  const boostedInclude = include.length >= 3 ? include : includeFallback;
  const context = Array.from(
    new Set([facets.activity, facets.mood, facets.sound].filter(Boolean)),
  )
    .join(" ")
    .replace(/,/g, " ")
    .trim();
  const exclude = intent.exclude
    .filter(k => !INTENT_STOPWORDS.has(k))
    .slice(0, 6);
  const timeHint = time
    ? `${time.minutes}분 ${time.mode === "at_least" ? "이상" : time.mode === "at_most" ? "이내" : "내외"}`
    : "";
  const eraHint = /(최신|최근|new release|recent)/i.test(normalized)
    ? "최신곡 우선"
    : /(19\d{2}|20\d{2})\s*년대|90년대|2000년대|2010년대|2020년대/.test(normalized)
      ? "시대 조건 있음"
      : "";

  const segments = [
    context || "",
    explicitGenres.length ? `장르 ${explicitGenres.join(" ")}` : "",
    boostedInclude.length ? boostedInclude.join(" ") : "",
    exclude.length ? `제외 ${exclude.join(" ")}` : "",
    eraHint || "",
    timeHint || "",
  ]
    .map(v => String(v ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const compressed = segments.join(", ").slice(0, 280);
  return compressed.length >= 14 ? compressed : normalized;
}

function extractPromptSearchPlan(rawInput: string): PromptSearchPlan {
  const normalized = String(rawInput ?? "").replace(/\s+/g, " ").trim();
  const intent = buildUserIntentProfile(normalized);
  const facets = extractPromptFacets(normalized);
  const timeConstraint = extractTimeConstraint(normalized);
  const genrePatterns: Array<{ canonical: string; re: RegExp }> = [
    { canonical: "k-pop", re: /\bk[\s-]?pop\b|케이팝|케이 팝/i },
    { canonical: "멜로디 힙합", re: /멜로디\s*힙합|melodic\s*hip[\s-]?hop/i },
    { canonical: "힙합", re: /\bhip[\s-]?hop\b|힙합/i },
    { canonical: "인디", re: /인디|indie/i },
    { canonical: "포크", re: /포크|folk/i },
    { canonical: "발라드", re: /발라드|ballad/i },
    { canonical: "rnb", re: /\br[\s&-]?n[\s&-]?b\b|알앤비/i },
    { canonical: "edm", re: /\bedm\b|일렉|electronic/i },
    { canonical: "재즈", re: /재즈|jazz/i },
    { canonical: "트로트", re: /트로트|trot/i },
  ];
  const genresRaw = genrePatterns
    .filter(item => item.re.test(normalized))
    .map(item => item.canonical)
    .slice(0, 6);
  const genres = dedupeGenresBySpecificity(genresRaw);
  const genreTokenSet = new Set(genres.map(v => normalizeText(v)));
  const include = uniqueKeywords(
    intent.include
    .filter(k => !isWeakSearchKeyword(k))
    .filter(k => !genreTokenSet.has(normalizeText(k))),
    10,
  );
  const exclude = uniqueKeywords(
    intent.exclude
      .filter(k => !isWeakSearchKeyword(k)),
    6,
  );
  const compactGenres = dedupeGenresBySpecificity(uniqueKeywords(genres, 5));
  const compactInclude = uniqueKeywords(include, 8).filter(
    k => !isWeakSearchKeyword(k),
  );
  const compactExclude = uniqueKeywords(exclude, 5);
  const activityPart = uniqueKeywords(keywordList(facets.activity), 2).join(" ");
  const moodPart = uniqueKeywords(
    [
      ...keywordList(facets.mood),
      ...compactInclude.filter(k => !isGenreLikeToken(k)),
    ],
    3,
  ).join(" ");
  const soundPart = uniqueKeywords(
    keywordList(facets.sound).filter(k => !isGenreLikeToken(k)),
    2,
  ).join(" ");
  const timeSegment = timeConstraint
    ? `${timeConstraint.minutes}분 ${timeConstraint.mode === "at_least" ? "이상" : timeConstraint.mode === "at_most" ? "이내" : "내외"}`
    : "";
  const keywordPart = compactInclude
    .filter(k => !isGenreLikeToken(k))
    .slice(0, 3)
    .join(" ");
  const isKeywordDuplicateOfMood =
    keywordPart &&
    normalizeText(keywordPart) === normalizeText(moodPart);
  const segmentParts = [
    activityPart ? `상황:${activityPart}` : "",
    moodPart ? `무드:${moodPart}` : "",
    soundPart ? `사운드:${soundPart}` : "",
    compactGenres.length ? `장르:${compactGenres.join("/")}` : "",
    timeSegment ? `길이:${timeSegment}` : "",
    keywordPart && !isKeywordDuplicateOfMood ? `핵심:${keywordPart}` : "",
    compactExclude.length ? `제외:${compactExclude.join(" ")}` : "",
  ].filter(Boolean);
  const brief = summarizePromptForRecommendation(normalized);
  const compactBrief = segmentParts.join(", ").slice(0, 190);
  return {
    brief: compactBrief.length >= 12 ? compactBrief : brief,
    include: compactInclude,
    exclude: compactExclude,
    genres: compactGenres,
    activity: facets.activity,
    sound: facets.sound,
    mood: facets.mood,
    timeConstraint,
    specificity: intent.specificity,
  };
}

function tempoBand(tempo?: number): "slow" | "mid" | "fast" | "unknown" {
  const t = Number(tempo ?? 0);
  if (!t || t <= 0) return "unknown";
  if (t < 92) return "slow";
  if (t > 126) return "fast";
  return "mid";
}

function promptFingerprint(value: string): string {
  const plan = extractPromptSearchPlan(value);
  const normalizedPrompt = normalizeText(plan.brief || value).slice(0, 120);
  const normalizedGenres = (plan.genres ?? [])
    .map(v => normalizeText(v))
    .filter(Boolean)
    .sort()
    .join("|")
    .slice(0, 80);
  const normalizedMood = normalizeText(plan.mood).slice(0, 40);
  const normalizedActivity = normalizeText(plan.activity).slice(0, 40);
  const durationMinutes = Number(plan.timeConstraint?.minutes ?? 0);
  const durationBucket = durationMinutes > 0 ? Math.max(1, Math.round(durationMinutes / 30) * 30) : 0;
  return normalizeText(
    [
      `p:${normalizedPrompt}`,
      `g:${normalizedGenres}`,
      `m:${normalizedMood}`,
      `a:${normalizedActivity}`,
      `d:${durationBucket}`,
    ].join("|"),
  ).slice(0, 220);
}

function fastWorkingSetKey(fingerprint: string, requestId?: string): string {
  const rid = String(requestId ?? "").trim();
  return rid ? `${fingerprint}::${rid}` : fingerprint;
}

function updateFastWorkingSet(
  fingerprint: string,
  tracks: SpotifyTrackSummary[],
  requestId?: string,
): void {
  if (!fingerprint || !tracks.length) return;
  fastWorkingSetByFingerprint.set(fastWorkingSetKey(fingerprint, requestId), {
    fingerprint,
    tracks: mergeUniqueTracks(tracks).slice(0, 180),
    updatedAt: Date.now(),
  });
}

function readFastWorkingSet(
  fingerprint: string,
  maxAgeMs = 90_000,
  requestId?: string,
): SpotifyTrackSummary[] {
  const key = fastWorkingSetKey(fingerprint, requestId);
  const item = fastWorkingSetByFingerprint.get(key);
  if (!item) return [];
  if (Date.now() - item.updatedAt > maxAgeMs) {
    fastWorkingSetByFingerprint.delete(key);
    return [];
  }
  return mergeUniqueTracks(item.tracks);
}

function clearFastWorkingSet(fingerprint: string, requestId?: string): void {
  if (!fingerprint) return;
  fastWorkingSetByFingerprint.delete(fastWorkingSetKey(fingerprint, requestId));
}

export function consumeFastWorkingRecommendation(args: {
  moodInput: string;
  spotifyBootstrap: SpotifyBootstrapData | null;
  maxAgeMs?: number;
  requestId?: string;
}): PersonalizedPlaylistOutput | null {
  const searchPlan = extractPromptSearchPlan(args.moodInput);
  const effectiveMoodInput = searchPlan.brief || args.moodInput;
  const fingerprint = promptFingerprint(effectiveMoodInput);
  const pool = readFastWorkingSet(
    fingerprint,
    args.maxAgeMs ?? 90_000,
    args.requestId,
  );
  if (!pool.length) return null;
  clearFastWorkingSet(fingerprint, args.requestId);
  const timeConstraint = searchPlan.timeConstraint;
  const targetMinutes = timeConstraint?.minutes ?? null;
  const parsed = buildLocalParsedPlan({
    moodInput: effectiveMoodInput,
    timeConstraint,
    bootstrap: args.spotifyBootstrap,
  });
  const fastIntent = analyzeFastIntent(args.moodInput);
  const tasteProfile = buildUserTasteProfile(args.spotifyBootstrap);
  const variationSeed = stableHash(`${promptFingerprint(effectiveMoodInput)}|${Date.now()}|consume`);
  const targetCount = deriveTargetTrackCount({
    parsedTargetCount: parsed.targetCount,
    targetMinutes,
    timeMode: timeConstraint?.mode,
    averageDurationMs: estimateAverageTrackDurationMs([
      pool,
      args.spotifyBootstrap?.topTracks ?? [],
      args.spotifyBootstrap?.recentlyPlayed ?? [],
    ]),
    maxCount: 60,
  });
  const minCountByDuration = targetMinutes
    ? clamp(Math.ceil((targetMinutes * 60 * 1000) / 220000), 12, 80)
    : 0;
  const userTopTrackIds = new Set(
    (args.spotifyBootstrap?.topTracks ?? [])
      .map(t => String(t?.id ?? "").trim())
      .filter(Boolean),
  );
  const userTopArtistIds = new Set(
    (args.spotifyBootstrap?.topArtists ?? [])
      .map(a => String(a?.id ?? "").trim())
      .filter(Boolean),
  );
  const userTopArtistNames = new Set(
    (args.spotifyBootstrap?.topArtists ?? [])
      .map(a => normalizeText(a?.name ?? ""))
      .filter(Boolean),
  );
  const selected = selectTracksFast({
    tracks: pool,
    intent: fastIntent,
    targetCount: Math.max(targetCount, minCountByDuration),
    targetMinutes,
    timeConstraint,
    userTopTrackIds,
    userTopArtistIds,
    userTopArtistNames,
    tasteProfile,
    variationSeed,
    explorationRatio: 0.32,
  });
  const enrichedSelected = enforceMinimumDuration({
    selected,
    targetMinutes,
    timeConstraint,
    candidatePool: mergeUniqueTracks(
      pool,
      args.spotifyBootstrap?.topTracks ?? [],
      args.spotifyBootstrap?.recentlyPlayed ?? [],
    ),
    minCoverage: timeConstraint?.mode === "at_least" ? 0.94 : 0.88,
    maxCount: 90,
  });
  if (!enrichedSelected.length) return null;
  return {
    status: "partial",
    tracks: enrichedSelected.map(toTrack),
    playlistName: buildAutoPlaylistNameFromTracks(enrichedSelected, effectiveMoodInput),
    reasoning: "타임아웃 직전까지 검색된 곡으로 즉시 추천했어요.",
    meta: { reason: "fast_working_set_timeout_partial" },
  };
}

export function resetFastWorkingRecommendationCache(
  moodInput?: string,
  requestId?: string,
): void {
  if (!moodInput) {
    fastWorkingSetByFingerprint.clear();
    return;
  }
  const plan = extractPromptSearchPlan(moodInput);
  const effectiveMoodInput = plan.brief || moodInput;
  const fingerprint = promptFingerprint(effectiveMoodInput);
  clearFastWorkingSet(fingerprint, requestId);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const A = new Set(a.filter(Boolean));
  const B = new Set(b.filter(Boolean));
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  A.forEach(v => {
    if (B.has(v)) intersection += 1;
  });
  const union = new Set([...A, ...B]).size;
  return union ? intersection / union : 0;
}

function buildRecentAvoidProfile(args: {
  currentFingerprint: string;
  currentIntent: { include: string[]; exclude: string[]; specificity: number };
}): {
  trackIds: Set<string>;
  artistKeys: Set<string>;
  intentShift: number;
} {
  const now = Date.now();
  const recent = recommendationHistory.filter(
    item =>
      item.fingerprint &&
      now - item.createdAt <= 24 * 60 * 60 * 1000,
  );
  if (!recent.length) {
    return { trackIds: new Set<string>(), artistKeys: new Set<string>(), intentShift: 0 };
  }

  const currentKeywords = Array.from(
    new Set([...args.currentIntent.include, ...args.currentIntent.exclude]),
  );

  const freq = new Map<string, number>();
  const artistFreq = new Map<string, number>();
  const similarityScores: number[] = [];
  recent.forEach((item, index) => {
    const sim = jaccardSimilarity(currentKeywords, item.intentKeywords ?? []);
    similarityScores.push(sim);
    const weight =
      sim < 0.35 ? 1.9 : sim < 0.55 ? 1.3 : sim < 0.75 ? 0.9 : 0.45;
    const recencyWeight = 1 + (recent.length - index) * 0.08;
    const finalWeight = weight * recencyWeight;
    item.trackIds.forEach(id => {
      const key = String(id ?? "").trim();
      if (!key) return;
      freq.set(key, (freq.get(key) ?? 0) + finalWeight);
    });
    item.artistKeys.forEach(keyRaw => {
      const key = String(keyRaw ?? "").trim();
      if (!key) return;
      artistFreq.set(key, (artistFreq.get(key) ?? 0) + finalWeight);
    });
  });

  const avgSimilarity = similarityScores.length
    ? similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length
    : 1;
  const intentShift = clamp(Math.round((1 - avgSimilarity) * 100), 0, 100) / 100;

  return {
    trackIds: new Set(
      Array.from(freq.entries())
        .filter(([, count]) => count >= 0.45)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 120)
        .map(v => v[0]),
    ),
    artistKeys: new Set(
      Array.from(artistFreq.entries())
        .filter(([, count]) => count >= 0.45)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 80)
        .map(v => v[0]),
    ),
    intentShift,
  };
}

function buildGlobalReuseGuard(currentFingerprint: string): {
  trackIds: Set<string>;
  artistKeys: Set<string>;
} {
  const now = Date.now();
  const recent = recommendationHistory.filter(
    item =>
      item.fingerprint &&
      now - item.createdAt <= 24 * 60 * 60 * 1000,
  );
  if (!recent.length) {
    return { trackIds: new Set<string>(), artistKeys: new Set<string>() };
  }
  const trackFreq = new Map<string, number>();
  const artistFreq = new Map<string, number>();
  recent.forEach((item, idx) => {
    const recencyWeight = 1 + (recent.length - idx) * 0.12;
    item.trackIds.forEach(id => {
      const key = String(id ?? "").trim();
      if (!key) return;
      trackFreq.set(key, (trackFreq.get(key) ?? 0) + recencyWeight);
    });
    item.artistKeys.forEach(raw => {
      const key = String(raw ?? "").trim();
      if (!key) return;
      artistFreq.set(key, (artistFreq.get(key) ?? 0) + recencyWeight);
    });
  });

  return {
    trackIds: new Set(
      Array.from(trackFreq.entries())
        .filter(([, c]) => c >= 0.45)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 220)
        .map(v => v[0]),
    ),
    artistKeys: new Set(
      Array.from(artistFreq.entries())
        .filter(([, c]) => c >= 0.45)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 140)
        .map(v => v[0]),
    ),
  };
}

function trackArtistKeys(track: SpotifyTrackSummary): string[] {
  const keys: string[] = [];
  (track.artists ?? []).forEach(artist => {
    const id = String(artist?.id ?? "").trim();
    if (id) keys.push(`id:${id}`);
    const name = normalizeText(String(artist?.name ?? ""));
    if (name) keys.push(`nm:${name}`);
  });
  return Array.from(new Set(keys));
}

function buildIntentKeywordsForSnapshot(moodInput: string): string[] {
  const intent = buildUserIntentProfile(moodInput);
  return Array.from(new Set([...intent.include, ...intent.exclude])).slice(0, 18);
}

function pushRecommendationSnapshot(
  fingerprint: string,
  moodInput: string,
  tracks: SpotifyTrackSummary[],
): void {
  if (!fingerprint || !tracks.length) return;
  const artistKeys = Array.from(
    new Set(
      tracks.flatMap(track => trackArtistKeys(track)),
    ),
  ).slice(0, 50);
  recommendationHistory.unshift({
    fingerprint,
    trackIds: tracks
      .map(t => String(t?.id ?? "").trim())
      .filter(Boolean)
      .slice(0, 30),
    artistKeys,
    intentKeywords: buildIntentKeywordsForSnapshot(moodInput),
    createdAt: Date.now(),
  });
  if (recommendationHistory.length > RECOMMENDATION_MEMORY_MAX) {
    recommendationHistory.length = RECOMMENDATION_MEMORY_MAX;
  }
}

function inferEnergyFromKeywords(
  include: string[],
  modelEnergy?: GeminiPlaylistJson["energyLevel"],
): GeminiPlaylistJson["energyLevel"] | undefined {
  if (modelEnergy) return modelEnergy;
  let high = 0;
  let low = 0;
  include.forEach(k => {
    if (HIGH_ENERGY_HINTS.has(k)) high += 1;
    if (LOW_ENERGY_HINTS.has(k)) low += 1;
  });
  if (high >= low + 1) return "high";
  if (low >= high + 1) return "low";
  return "mid";
}

function buildCatalogSearchInputs(args: {
  moodInput: string;
  parsed?: GeminiPlaylistJson;
  intentShift: number;
  searchPlan?: PromptSearchPlan;
}): string[] {
  const base = String(args.searchPlan?.brief ?? args.moodInput ?? "").trim();
  const include =
    args.searchPlan?.include?.length
      ? args.searchPlan.include
      : parseGeminiKeywords(args.parsed?.includeKeywords);
  const focus = parseGeminiKeywords(args.parsed?.focusKeywords);
  const genres =
    args.searchPlan?.genres?.length
      ? args.searchPlan.genres
      : parseGeminiKeywords(args.parsed?.genreHints);
  const exclude =
    args.searchPlan?.exclude?.length
      ? args.searchPlan.exclude
      : parseGeminiKeywords(args.parsed?.excludeKeywords);
  const facets = args.searchPlan
    ? {
        activity: args.searchPlan.activity,
        sound: args.searchPlan.sound,
        mood: args.searchPlan.mood,
      }
    : extractPromptFacets(args.moodInput);

  const coreKeywords = Array.from(
    new Set([
      ...focus,
      ...include.filter(k => !CONTEXT_ONLY_KEYWORDS.has(k)),
      ...genres,
    ]),
  ).slice(0, 10);
  const cleanBase = base
    .replace(/추가\s*요청\s*[:：]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const searchTexts = [
    cleanBase,
    [...coreKeywords.slice(0, 6), ...genres.slice(0, 4)].join(" "),
    [...coreKeywords.slice(2, 10), ...genres.slice(0, 4)].join(" "),
    `${facets.activity} ${genres.slice(0, 4).join(" ")} ${include
      .filter(k => !CONTEXT_ONLY_KEYWORDS.has(k))
      .slice(0, 4)
      .join(" ")}`.trim(),
    `${facets.sound} ${coreKeywords.slice(0, 6).join(" ")} playlist mix`.trim(),
  ]
    .map(v => String(v ?? "").trim())
    .filter(Boolean);

  if (args.intentShift >= 0.5) {
    searchTexts.push(
      [
        ...genres.slice(0, 6),
        ...include.slice(0, 6).filter(k => !CONTEXT_ONLY_KEYWORDS.has(k)),
      ].join(" "),
    );
  }

  if (exclude.length) {
    searchTexts.push(
      `${[...focus, ...genres].join(" ")} ${exclude.slice(0, 4).join(" ")} 제외`,
    );
  }

  return Array.from(
    new Set(
      searchTexts
        .map(v => v.replace(/\s+/g, " ").trim())
        .filter(v => v.length >= 2),
    ),
  ).slice(
    0,
    args.searchPlan?.specificity && args.searchPlan.specificity >= 7
      ? 3
      : args.intentShift >= 0.6
        ? 4
        : 3,
  );
}

function buildTasteSeedProfile(args: {
  bootstrap: SpotifyBootstrapData | null;
  moodInput: string;
  parsed?: GeminiPlaylistJson;
}): {
  seedTrackIds: string[];
  seedArtistIds: string[];
  queryHints: string[];
} {
  const bootstrap = args.bootstrap;
  if (!bootstrap) {
    return { seedTrackIds: [], seedArtistIds: [], queryHints: [] };
  }
  const include = Array.from(
    new Set([
      ...keywordList(args.moodInput),
      ...parseGeminiKeywords(args.parsed?.focusKeywords),
      ...parseGeminiKeywords(args.parsed?.includeKeywords),
      ...parseGeminiKeywords(args.parsed?.genreHints),
    ]),
  )
    .filter(k => !CONTEXT_ONLY_KEYWORDS.has(k))
    .slice(0, 14);
  const exclude = parseGeminiKeywords(args.parsed?.excludeKeywords);

  const candidateTracks = [
    ...(bootstrap.topTracks ?? []),
    ...(bootstrap.recentlyPlayed ?? []),
  ];

  const scored = candidateTracks
    .map(track => {
      const text = normalizeText(
        [
          track.name,
          track.album?.name ?? "",
          ...(track.artists ?? []).map(a => a.name),
          ...(track.genres ?? []),
        ].join(" "),
      );
      let score = 0;
      include.forEach(k => {
        if (text.includes(k)) score += 1.2;
      });
      exclude.forEach(k => {
        if (text.includes(k)) score -= 1.8;
      });
      return { track, score };
    })
    .sort((a, b) => b.score - a.score);

  const topMatched = scored
    .filter(v => v.score > 0)
    .slice(0, 6)
    .map(v => v.track);
  const fallbackTracks = (bootstrap.topTracks ?? []).slice(0, 4);
  const anchors = topMatched.length ? topMatched : fallbackTracks;

  const seedTrackIds = anchors
    .map(t => String(t?.id ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);

  const seedArtistIds = Array.from(
    new Set(
      anchors
        .flatMap(t => t.artists ?? [])
        .map(a => String(a?.id ?? "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 5);

  const artistHints = Array.from(
    new Set(
      anchors
        .flatMap(t => t.artists ?? [])
        .map(a => String(a?.name ?? "").trim())
        .filter(v => v.length >= 2),
    ),
  ).slice(0, 4);
  const genreHints = Array.from(
    new Set(
      anchors
        .flatMap(t => t.genres ?? [])
        .map(g => String(g ?? "").trim())
        .filter(v => v.length >= 2),
    ),
  ).slice(0, 4);

  const queryHints = [
    ...artistHints.map(name => `${name} similar`),
    ...genreHints.map(genre => `${genre} vibe`),
  ].slice(0, 6);

  return { seedTrackIds, seedArtistIds, queryHints };
}

function buildIntentConstraintProfile(args: {
  moodInput: string;
  include: string[];
  exclude: string[];
  genreHints: string[];
  energy?: GeminiPlaylistJson["energyLevel"];
  specificity: number;
  intentShift: number;
}): IntentConstraintProfile {
  const raw = normalizeText(args.moodInput);
  const requiredKeywords = Array.from(
    new Set([
      ...args.genreHints,
      ...args.include.filter(k => !CONTEXT_ONLY_KEYWORDS.has(k)),
    ]),
  ).slice(0, 14);
  const excludedKeywords = Array.from(
    new Set(args.exclude.filter(Boolean)),
  ).slice(0, 12);
  const requireInstrumentalLike =
    /가사\s*없|무가사|instrumental|연주곡|비트만/.test(raw);
  const preferVocalLike =
    /보컬|가사\s*있|sing|vocal/.test(raw);
  const currentYear = new Date().getFullYear();
  let yearMin: number | undefined;
  let yearMax: number | undefined;
  let preferLatest = false;
  if (/최신|최근|new release|recent/i.test(raw)) {
    yearMin = currentYear - 2;
    preferLatest = true;
  }
  const decadeMatch = args.moodInput.match(/(19\d{2}|20\d{2})\s*년대/);
  if (decadeMatch) {
    const decade = Number(decadeMatch[1]);
    if (Number.isFinite(decade)) {
      yearMin = decade;
      yearMax = decade + 9;
      preferLatest = false;
    }
  }
  if (/90년대/.test(args.moodInput)) {
    yearMin = 1990;
    yearMax = 1999;
    preferLatest = false;
  }
  if (/2000년대/.test(args.moodInput)) {
    yearMin = 2000;
    yearMax = 2009;
    preferLatest = false;
  }
  if (/2010년대/.test(args.moodInput)) {
    yearMin = 2010;
    yearMax = 2019;
    preferLatest = false;
  }
  if (/2020년대/.test(args.moodInput)) {
    yearMin = 2020;
    yearMax = 2029;
    preferLatest = false;
  }
  if (/시대\s*혼합|시대\s*섞|era mix/i.test(raw)) {
    yearMin = undefined;
    yearMax = undefined;
    preferLatest = false;
  }
  const strictness = Math.min(
    1,
    Math.max(
      0.2,
      (args.specificity / 10) * 0.7 + args.intentShift * 0.35,
    ),
  );
  return {
    requiredKeywords,
    excludedKeywords,
    targetEnergy: args.energy,
    strictness,
    requireInstrumentalLike,
    preferVocalLike,
    yearMin,
    yearMax,
    preferLatest,
  };
}

function evaluateTrackIntentFit(
  track: SpotifyTrackSummary,
  profile: IntentConstraintProfile,
): { score: number; forbidden: boolean } {
  const title = normalizeText(track.name);
  const artist = normalizeText((track.artists ?? []).map(a => a.name).join(" "));
  const genre = normalizeText((track.genres ?? []).join(" "));
  const album = normalizeText(track.album?.name ?? "");
  const allText = `${title} ${artist} ${genre} ${album}`.trim();

  let forbidden = false;
  profile.excludedKeywords.forEach(k => {
    if (!k) return;
    const contextOnly = CONTEXT_ONLY_KEYWORDS.has(k);
    if (genre.includes(k) || artist.includes(k)) forbidden = true;
    if (!contextOnly && (album.includes(k) || title.includes(k))) forbidden = true;
  });

  let score = 0;
  profile.requiredKeywords.forEach(k => {
    if (!k) return;
    if (genre.includes(k)) score += 1.5;
    else if (artist.includes(k)) score += 1.2;
    else if (album.includes(k)) score += 0.8;
    else if (title.includes(k)) score += 0.4;
  });

  const tempo = Number(track.tempo ?? 0);
  if (tempo > 0 && profile.targetEnergy) {
    if (profile.targetEnergy === "low") {
      score += tempo <= 108 ? 0.9 : tempo >= 132 ? -0.6 : 0.2;
    } else if (profile.targetEnergy === "high") {
      score += tempo >= 118 ? 0.9 : tempo <= 92 ? -0.6 : 0.2;
    } else {
      score += tempo >= 95 && tempo <= 125 ? 0.5 : 0;
    }
  }

  const instrumentalLike = /instrumental|ambient|lofi|classical|neo classical|piano|soundtrack/.test(
    allText,
  );
  if (profile.requireInstrumentalLike) {
    score += instrumentalLike ? 1.1 : -1.0;
  }
  if (profile.preferVocalLike) {
    const vocalLike = /vocal|singer|songwriter|pop|rnb|soul|ballad|indie pop/.test(allText);
    score += vocalLike ? 0.6 : -0.2;
  }
  const releaseYear = parseReleaseYear(track.album?.release_date);
  if (releaseYear > 0) {
    if (profile.yearMin !== undefined) {
      score += releaseYear >= profile.yearMin ? 0.9 : -1.1;
    }
    if (profile.yearMax !== undefined) {
      score += releaseYear <= profile.yearMax ? 0.7 : -1.1;
    }
    if (profile.preferLatest) {
      const currentYear = new Date().getFullYear();
      score += releaseYear >= currentYear - 2 ? 0.9 : releaseYear <= currentYear - 6 ? -0.8 : 0.2;
    }
  } else if (profile.yearMin !== undefined || profile.yearMax !== undefined || profile.preferLatest) {
    score -= 0.45;
  }

  return { score, forbidden };
}

function injectGenreHintsFromQuery(
  tracks: SpotifyTrackSummary[],
  query: string,
  fastIntent: FastIntent,
): SpotifyTrackSummary[] {
  if (!tracks.length) return tracks;
  const text = normalizeText(query);
  const hintSet = new Set<string>();
  if (/k-?pop|korean pop|케이팝/.test(text)) hintSet.add("k-pop");
  if (/rnb|r&b|알앤비/.test(text)) hintSet.add("rnb");
  if (/soul|소울/.test(text)) hintSet.add("soul");
  if (/indie|인디/.test(text)) hintSet.add("indie");
  if (/hip hop|hip-hop|힙합|rap/.test(text)) hintSet.add("hip hop");
  if (/ballad|발라드/.test(text)) hintSet.add("ballad");
  if (/folk|포크|acoustic/.test(text)) hintSet.add("folk");
  if (/ost|soundtrack|cinematic|영화음악/.test(text)) hintSet.add("soundtrack");
  if (/chill|calm|soft|잔잔|차분/.test(text)) hintSet.add("chill");
  if (/upbeat|energetic|dance|신나|업템포/.test(text)) hintSet.add("upbeat");
  if (/lofi|lo-fi/.test(text)) hintSet.add("lofi");

  for (const genre of fastIntent.genres ?? []) {
    const normalized = normalizeText(String(genre ?? ""));
    if (!normalized) continue;
    if (normalized.includes("k-pop") || normalized.includes("kpop")) hintSet.add("k-pop");
    else if (normalized.includes("rnb")) hintSet.add("rnb");
    else if (normalized.includes("soul")) hintSet.add("soul");
    else if (normalized.includes("indie")) hintSet.add("indie");
    else if (normalized.includes("hip hop") || normalized.includes("힙합")) hintSet.add("hip hop");
    else if (normalized.includes("ballad") || normalized.includes("발라드")) hintSet.add("ballad");
    else if (normalized.includes("folk") || normalized.includes("포크")) hintSet.add("folk");
    else if (normalized.includes("ost") || normalized.includes("영화음악")) hintSet.add("soundtrack");
    else hintSet.add(normalized);
  }

  if (!hintSet.size) return tracks;
  const hints = Array.from(hintSet).slice(0, 5);
  return tracks.map(track => {
    const baseGenres = Array.isArray(track.genres) ? track.genres : [];
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const genre of [...baseGenres, ...hints]) {
      const token = normalizeText(String(genre ?? ""));
      if (!token || seen.has(token)) continue;
      seen.add(token);
      merged.push(token);
      if (merged.length >= 5) break;
    }
    return { ...track, genres: merged };
  });
}

function trackDedupKey(track: SpotifyTrackSummary): string {
  if (track.id) return `id:${track.id}`;
  if (track.uri) return `uri:${track.uri}`;
  const name = normalizeText(String(track.name ?? ""))
    .replace(/\b(remaster(ed)?|live|version|edit|mono|stereo)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const artists = (track.artists ?? [])
    .map(a => normalizeText(a.name))
    .filter(Boolean)
    .join(",");
  return `na:${name}|${artists}`;
}

function decadeFromYear(year: number): number | null {
  if (!Number.isFinite(year) || year < 1900) return null;
  return Math.floor(year / 10) * 10;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildUserTasteProfile(
  bootstrap: SpotifyBootstrapData | null,
): UserTasteProfile {
  const favoriteArtistIds = new Set(
    (bootstrap?.topArtists ?? [])
      .map(a => String(a?.id ?? "").trim())
      .filter(Boolean),
  );
  const favoriteArtistNames = new Set(
    (bootstrap?.topArtists ?? [])
      .map(a => normalizeText(a?.name ?? ""))
      .filter(Boolean),
  );
  const topTrackIds = new Set(
    (bootstrap?.topTracks ?? [])
      .map(t => String(t?.id ?? "").trim())
      .filter(Boolean),
  );

  const genreWeights = new Map<string, number>();
  (bootstrap?.topArtists ?? []).forEach((artist, idx) => {
    const weight = Math.max(0.8, 2.6 - idx * 0.08);
    (artist.genres ?? []).forEach(raw => {
      const g = normalizeText(raw);
      if (!g) return;
      genreWeights.set(g, (genreWeights.get(g) ?? 0) + weight);
    });
  });
  (bootstrap?.topTracks ?? []).forEach((track, idx) => {
    const weight = Math.max(0.5, 1.8 - idx * 0.06);
    (track.genres ?? []).forEach(raw => {
      const g = normalizeText(raw);
      if (!g) return;
      genreWeights.set(g, (genreWeights.get(g) ?? 0) + weight);
    });
  });

  const decadeWeights = new Map<number, number>();
  (bootstrap?.topTracks ?? []).forEach((track, idx) => {
    const year = parseReleaseYear(track.album?.release_date);
    const decade = decadeFromYear(year);
    if (!decade) return;
    const weight = Math.max(0.6, 2.1 - idx * 0.07);
    decadeWeights.set(decade, (decadeWeights.get(decade) ?? 0) + weight);
  });

  const tempos = (bootstrap?.topTracks ?? [])
    .map(t => Number(t?.tempo ?? 0))
    .filter(v => Number.isFinite(v) && v > 0);

  return {
    favoriteArtistIds,
    favoriteArtistNames,
    topTrackIds,
    genreWeights,
    decadeWeights,
    tempoMedian: median(tempos),
  };
}

const TASTE_GENRE_EXPANSION: Record<string, string[]> = {
  "korean rnb": ["korean soul", "soul", "korean indie", "lofi"],
  "rnb soul": ["korean soul", "korean rnb", "soul", "lofi"],
  "k-pop": ["korean indie", "korean ballad", "korean pop"],
  "kpop": ["korean indie", "korean ballad", "korean pop"],
  "korean pop": ["korean indie", "korean ballad", "k-pop"],
  "korean indie": ["indie", "korean folk", "lofi", "korean rnb"],
  "melodic hip hop": ["korean hip hop", "korean rnb", "rnb soul"],
  "korean hip hop": ["melodic hip hop", "korean rnb"],
};

function expandTasteGenresFromProfile(profile: UserTasteProfile): Set<string> {
  const topGenres = [...profile.genreWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([g]) => normalizeText(g))
    .filter(Boolean);
  const expanded = new Set<string>(topGenres);
  for (const g of topGenres) {
    for (const ex of TASTE_GENRE_EXPANSION[g] ?? []) {
      const nx = normalizeText(ex);
      if (nx) expanded.add(nx);
    }
  }
  return expanded;
}

function scoreTasteAffinity(
  track: SpotifyTrackSummary,
  profile: UserTasteProfile,
): number {
  let score = 0;
  const genres = (track.genres ?? []).map(g => normalizeText(g)).filter(Boolean);
  if (genres.length && profile.genreWeights.size) {
    const maxW = Math.max(...Array.from(profile.genreWeights.values()), 1);
    const sum = genres.reduce((acc, g) => acc + (profile.genreWeights.get(g) ?? 0), 0);
    score += Math.min(1.35, (sum / Math.max(1, genres.length)) / maxW * 1.6);
    const expandedGenres = expandTasteGenresFromProfile(profile);
    const expandedHit = genres.some(g => expandedGenres.has(g));
    if (expandedHit) score += 0.28;
  }

  const artistIds = (track.artists ?? [])
    .map(a => String(a?.id ?? "").trim())
    .filter(Boolean);
  const artistNames = (track.artists ?? [])
    .map(a => normalizeText(a?.name ?? ""))
    .filter(Boolean);
  if (artistIds.some(id => profile.favoriteArtistIds.has(id))) score += 0.45;
  if (artistNames.some(n => profile.favoriteArtistNames.has(n))) score += 0.38;

  const tempo = Number(track.tempo ?? 0);
  if (profile.tempoMedian && tempo > 0) {
    const diff = Math.abs(tempo - profile.tempoMedian);
    const closeness = Math.max(0, 1 - diff / 42);
    score += closeness * 0.55;
  }

  const year = parseReleaseYear(track.album?.release_date);
  const decade = decadeFromYear(year);
  if (decade && profile.decadeWeights.size) {
    const maxW = Math.max(...Array.from(profile.decadeWeights.values()), 1);
    const exact = profile.decadeWeights.get(decade) ?? 0;
    const near =
      (profile.decadeWeights.get(decade - 10) ?? 0) * 0.45 +
      (profile.decadeWeights.get(decade + 10) ?? 0) * 0.45;
    score += Math.min(0.6, ((exact + near) / maxW) * 0.55);
  }

  return score;
}

function scoreTrackForMood(args: {
  track: SpotifyTrackSummary;
  include: string[];
  exclude: string[];
  genreHints: string[];
  userArtistNames: Set<string>;
  userArtistIds: Set<string>;
  userGenreHints: Set<string>;
  userTopTrackIds: Set<string>;
  energy?: GeminiPlaylistJson["energyLevel"];
  strategy?: GeminiPlaylistJson["mixStrategy"];
  noveltyLevel?: GeminiPlaylistJson["noveltyLevel"];
  moodFingerprint: string;
  intentSpecificity: number;
  recentAvoidTrackIds: Set<string>;
  recentAvoidArtistKeys: Set<string>;
  intentShift: number;
  tasteProfile: UserTasteProfile;
  tasteBlend: number;
  metadataHealth: ReturnType<typeof getSpotifyApiHealthSnapshot>;
}): number {
  const {
    track,
    include,
    exclude,
    genreHints,
    userArtistNames,
    userArtistIds,
    userGenreHints,
    userTopTrackIds,
    energy,
    strategy,
    noveltyLevel,
    moodFingerprint,
    intentSpecificity,
    recentAvoidTrackIds,
    recentAvoidArtistKeys,
    intentShift,
    tasteProfile,
    tasteBlend,
    metadataHealth,
  } = args;
  const text = normalizeText(
    [
      track.name,
      ...(track.artists ?? []).map(a => a.name),
      ...(track.genres ?? []),
      track.album?.name ?? "",
    ].join(" "),
  );
  const artistText = normalizeText((track.artists ?? []).map(a => a.name).join(" "));
  const genreText = normalizeText((track.genres ?? []).join(" "));
  const albumText = normalizeText(track.album?.name ?? "");

  let score = 0;
  const genreSignalReliability =
    metadataHealth.metadataEnrichEnabled &&
    metadataHealth.artist403Count < 2;
  const tempoSignalReliability =
    metadataHealth.metadataEnrichEnabled &&
    metadataHealth.audioFeatures403Count < 2;
  const savedSignalReliability =
    metadataHealth.metadataEnrichEnabled &&
    metadataHealth.savedTrack403Count < 2;
  const keywordBoost = genreSignalReliability ? 1.0 : 1.22;
  const artistBoost = genreSignalReliability ? 1.0 : 1.15;
  const profileWeight =
    intentSpecificity >= 8 ? 0.25 : intentSpecificity >= 5 ? 0.45 : 0.72;
  const familiarityBiasScale = Math.max(0.18, 1 - intentShift * 0.58);
  include.forEach(k => {
    const isContextOnly = CONTEXT_ONLY_KEYWORDS.has(k);
    if (genreText.includes(k)) score += 3.0 * keywordBoost;
    if (artistText.includes(k)) score += 2.6 * artistBoost;
    if (albumText.includes(k) && !isContextOnly) score += 1.2 * keywordBoost;
  });
  genreHints.forEach(k => {
    if (genreText.includes(k)) score += (genreSignalReliability ? 3.3 : 2.1);
    if (artistText.includes(k)) score += 1.3 * artistBoost;
  });
  exclude.forEach(k => {
    const isContextOnly = CONTEXT_ONLY_KEYWORDS.has(k);
    if (genreText.includes(k)) score -= 5.1;
    if (artistText.includes(k)) score -= 4.0;
    if (albumText.includes(k) && !isContextOnly) score -= 2.0;
  });

  const artistNames = (track.artists ?? [])
    .map(a => normalizeText(a.name))
    .filter(Boolean);
  const artistIds = (track.artists ?? [])
    .map(a => String(a?.id ?? "").trim())
    .filter(Boolean);
  const trackGenres = (track.genres ?? []).map(v => normalizeText(v));

  if (artistNames.some(n => userArtistNames.has(n))) {
    score += 3.1 * profileWeight * familiarityBiasScale;
  }
  if (artistIds.some(id => userArtistIds.has(id))) {
    score += 3.4 * profileWeight * familiarityBiasScale;
  }
  if (trackGenres.some(g => userGenreHints.has(g))) {
    score += 2.4 * profileWeight * familiarityBiasScale;
  }
  if (userTopTrackIds.has(String(track.id ?? ""))) {
    score += strategy === "familiar"
      ? 0.2 * profileWeight * familiarityBiasScale
      : -2.0 - intentShift * 0.9;
  }

  const tempo = Number(track.tempo ?? 0);
  if (tempoSignalReliability && tempo > 0) {
    if (energy === "low") {
      if (tempo <= 108) score += 1.6;
      if (tempo >= 135) score -= 1.4;
    } else if (energy === "high") {
      if (tempo >= 118) score += 1.8;
      if (tempo <= 92) score -= 1.2;
    } else {
      if (tempo >= 95 && tempo <= 125) score += 1.1;
    }
  }

  if (savedSignalReliability && strategy === "familiar" && track.is_saved) {
    score += 0.9 * profileWeight * familiarityBiasScale;
  }
  if (savedSignalReliability && strategy === "discovery" && !track.is_saved) {
    score += 1.4 + intentShift * 0.45;
  }
  if (savedSignalReliability && noveltyLevel === "adventurous" && !track.is_saved) score += 1.1;
  if (savedSignalReliability && noveltyLevel === "safe" && track.is_saved) score += 0.9;
  if (noveltyLevel === "adventurous" && userTopTrackIds.has(String(track.id ?? ""))) {
    score -= 1.6;
  }
  if (recentAvoidTrackIds.has(String(track.id ?? "").trim())) {
    score -= 2.2 + intentShift * 1.6;
  }
  const artistKeys = trackArtistKeys(track);
  if (artistKeys.some(key => recentAvoidArtistKeys.has(key))) {
    score -= 1.4 + intentShift * 1.3;
  }
  const tasteAffinity = scoreTasteAffinity(track, tasteProfile);
  const tasteScale =
    intentSpecificity >= 8 ? 0.38 : intentSpecificity >= 6 ? 0.58 : 1.0;
  score += tasteAffinity * (0.95 + tasteBlend * 0.95) * tasteScale;
  const jitterSeed = `${moodFingerprint}|${trackDedupKey(track)}`;
  const jitter = (stableHash(jitterSeed) % 1000) / 1000;
  score += (jitter - 0.5) * 0.66;
  return score;
}

function chooseCuratedTracks(args: {
  catalogPool: SpotifyTrackSummary[];
  localPicks: SpotifyTrackSummary[];
  fallback: SpotifyTrackSummary[];
  bootstrap: SpotifyBootstrapData | null;
  moodInput: string;
  parsed?: GeminiPlaylistJson;
  targetCount: number;
  targetMinutes?: number | null;
  timeConstraint?: TimeConstraint | null;
  recentAvoidTrackIds?: Set<string>;
  recentAvoidArtistKeys?: Set<string>;
  hardAvoidTrackIds?: Set<string>;
  hardAvoidArtistKeys?: Set<string>;
  intentShift?: number;
}): SpotifyTrackSummary[] {
  const metadataHealth = getSpotifyApiHealthSnapshot();
  const intent = buildUserIntentProfile(args.moodInput);
  const include = Array.from(
    new Set([
      ...keywordList(args.moodInput),
      ...parseGeminiKeywords(args.parsed?.includeKeywords),
      ...parseGeminiKeywords(args.parsed?.focusKeywords),
      ...intent.include,
    ]),
  ).slice(0, 12);
  const exclude = Array.from(
    new Set([
      ...parseGeminiKeywords(args.parsed?.excludeKeywords),
      ...intent.exclude,
    ]),
  ).slice(0, 12);
  const genreHints = parseGeminiKeywords(args.parsed?.genreHints);
  const effectiveEnergy = inferEnergyFromKeywords(
    include,
    args.parsed?.energyLevel,
  );
  const shift = Math.min(0.9, Math.max(0, args.intentShift ?? 0));
  const intentProfile = buildIntentConstraintProfile({
    moodInput: args.moodInput,
    include,
    exclude,
    genreHints,
    energy: effectiveEnergy,
    specificity: intent.specificity,
    intentShift: shift,
  });
  const userArtistNames = new Set(
    (args.bootstrap?.topArtists ?? [])
      .map(a => normalizeText(a.name))
      .filter(Boolean),
  );
  const userArtistIds = new Set(
    (args.bootstrap?.topArtists ?? [])
      .map(a => String(a?.id ?? "").trim())
      .filter(Boolean),
  );
  const userGenreHints = new Set(
    (args.bootstrap?.topArtists ?? [])
      .flatMap(a => a.genres ?? [])
      .map(v => normalizeText(v))
      .filter(Boolean),
  );
  const userTopTrackIds = new Set(
    (args.bootstrap?.topTracks ?? [])
      .map(t => String(t?.id ?? "").trim())
      .filter(Boolean),
  );
  const tasteProfile = buildUserTasteProfile(args.bootstrap);
  const moodFingerprint = normalizeText(args.moodInput);

  const combined = [
    ...args.catalogPool,
    ...args.localPicks,
    ...args.fallback,
  ];
  const dedupMap = new Map<string, SpotifyTrackSummary>();
  combined.forEach(track => {
    const key = trackDedupKey(track);
    if (!key) return;
    if (!dedupMap.has(key)) dedupMap.set(key, track);
  });

  const baseTasteBlend =
    args.parsed?.mixStrategy === "familiar"
      ? 0.95
      : args.parsed?.mixStrategy === "discovery"
        ? 0.45
        : 0.72;
  const tasteBlend = Math.max(0.25, baseTasteBlend - shift * 0.25);

  const rawCandidates = Array.from(dedupMap.values());
  const intentEvaluated = rawCandidates.map(track => ({
    track,
    fit: evaluateTrackIntentFit(track, intentProfile),
  }));
  const nonForbidden = intentEvaluated.filter(v => !v.fit.forbidden);
  const strictThreshold = 0.85 + intentProfile.strictness * 1.55;
  const softThreshold = 0.25 + intentProfile.strictness * 0.95;
  const strictPromptMode = intent.specificity >= 7 || genreHints.length >= 2;
  const strictCandidates = nonForbidden.filter(v => v.fit.score >= strictThreshold);
  const softCandidates = nonForbidden.filter(v => v.fit.score >= softThreshold);
  const intentDrivenCandidates = nonForbidden.filter(
    v => v.fit.score >= Math.max(0.15, softThreshold - 0.45),
  );
  const minCandidateCount = Math.max(args.targetCount * 2, 18);
  const candidateTracks =
    strictCandidates.length >= minCandidateCount
      ? strictCandidates.map(v => v.track)
      : softCandidates.length >= Math.max(args.targetCount + 6, 12)
        ? softCandidates.map(v => v.track)
        : strictPromptMode && intentDrivenCandidates.length >= Math.max(8, args.targetCount)
          ? intentDrivenCandidates.map(v => v.track)
          : nonForbidden.map(v => v.track);

  const scored = candidateTracks
    .map(track => ({
      track,
      score: scoreTrackForMood({
        track,
        include,
        exclude,
        genreHints,
        userArtistNames,
        userArtistIds,
        userGenreHints,
        userTopTrackIds,
        energy: effectiveEnergy,
        strategy: args.parsed?.mixStrategy,
        noveltyLevel: args.parsed?.noveltyLevel,
        moodFingerprint,
        intentSpecificity: intent.specificity,
        recentAvoidTrackIds: args.recentAvoidTrackIds ?? new Set<string>(),
        recentAvoidArtistKeys: args.recentAvoidArtistKeys ?? new Set<string>(),
        intentShift: args.intentShift ?? 0,
        tasteProfile,
        tasteBlend,
        metadataHealth,
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const picked: SpotifyTrackSummary[] = [];
  const pickedKeys = new Set<string>();
  const artistCount = new Map<string, number>();
  const genreCount = new Map<string, number>();
  const maxPerArtist =
    args.parsed?.mixStrategy === "familiar"
      ? 2
      : args.parsed?.mixStrategy === "discovery"
        ? 1
        : 2;
  const maxPerGenre =
    args.parsed?.mixStrategy === "discovery"
      ? 2
      : args.parsed?.mixStrategy === "familiar"
        ? 4
        : 3;
  const familiarRatio =
    args.parsed?.mixStrategy === "familiar"
      ? 0.7
      : args.parsed?.mixStrategy === "discovery"
        ? 0.4
        : 0.65;
  const noveltyShiftBonus = args.parsed?.noveltyLevel === "adventurous" ? 0.08 : 0;
  const adjustedFamiliarRatio = clamp(
    Math.round((familiarRatio - shift * 0.28 - noveltyShiftBonus) * 100),
    15,
    80,
  ) / 100;
  const familiarTarget = Math.max(
    2,
    Math.min(args.targetCount - 2, Math.round(args.targetCount * adjustedFamiliarRatio)),
  );
  const baseTopTrackCap = args.parsed?.mixStrategy === "familiar" ? 3 : 1;
  const maxExactTopTracks = Math.max(1, baseTopTrackCap - Math.round(shift * 3));
  let exactTopTracksCount = 0;
  const minFreshRatio =
    args.parsed?.mixStrategy === "familiar"
      ? 0.45
      : args.parsed?.mixStrategy === "discovery"
        ? 0.85
        : 0.7;
  const freshnessTarget = Math.max(
    2,
    Math.round(args.targetCount * Math.min(0.92, minFreshRatio + shift * 0.12)),
  );
  let freshCount = 0;

  const isFamiliarTrack = (track: SpotifyTrackSummary) => {
    const artistNames = (track.artists ?? [])
      .map(a => normalizeText(a.name))
      .filter(Boolean);
    const artistIds = (track.artists ?? [])
      .map(a => String(a?.id ?? "").trim())
      .filter(Boolean);
    const genres = (track.genres ?? []).map(v => normalizeText(v));
    return (
      track.is_saved ||
      artistNames.some(v => userArtistNames.has(v)) ||
      artistIds.some(v => userArtistIds.has(v)) ||
      genres.some(v => userGenreHints.has(v))
    );
  };
  const familiarPool = scored.filter(v => isFamiliarTrack(v.track));
  const discoveryPool = scored.filter(v => !isFamiliarTrack(v.track));

  const diversityPenalty = (track: SpotifyTrackSummary): number => {
    if (!picked.length) return 0;
    const primaryArtist = normalizeText(track.artists?.[0]?.name ?? "");
    const primaryGenre = normalizeText(track.genres?.[0] ?? "");
    const band = tempoBand(track.tempo);
    let penalty = 0;
    if (primaryArtist) {
      penalty += (artistCount.get(primaryArtist) ?? 0) * (3.5 + shift * 1.4);
    }
    if (primaryGenre) {
      penalty += (genreCount.get(primaryGenre) ?? 0) * (2.2 + shift * 1.1);
    }
    const sameTempoBandCount = picked.reduce((acc, current) => {
      return tempoBand(current.tempo) === band ? acc + 1 : acc;
    }, 0);
    if (band !== "unknown") {
      penalty += sameTempoBandCount * 0.7;
    }
    return penalty;
  };

  const pickBestCandidate = (
    pool: Array<{ track: SpotifyTrackSummary; score: number }>,
  ): SpotifyTrackSummary | null => {
    if (!pool.length) return null;
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pool.length; i += 1) {
      const item = pool[i];
      const key = trackDedupKey(item.track);
      if (!key || pickedKeys.has(key)) continue;
      const adjusted = item.score - diversityPenalty(item.track);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return null;
    const [selected] = pool.splice(bestIndex, 1);
    return selected?.track ?? null;
  };

  const isHardAvoidTrack = (track: SpotifyTrackSummary): boolean => {
    const id = String(track.id ?? "").trim();
    if (id && (args.hardAvoidTrackIds?.has(id) ?? false)) return true;
    return trackArtistKeys(track).some(keyRaw =>
      args.hardAvoidArtistKeys?.has(keyRaw),
    );
  };

  const tryPush = (track: SpotifyTrackSummary, allowHardAvoid = false): boolean => {
    const key = trackDedupKey(track);
    if (!key || pickedKeys.has(key)) return false;
    const blockedByRecentTrack =
      shift >= 0.3 &&
      (args.recentAvoidTrackIds?.has(String(track.id ?? "").trim()) ?? false);
    const blockedByRecentArtist =
      shift >= 0.4 &&
      trackArtistKeys(track).some(keyRaw =>
        args.recentAvoidArtistKeys?.has(keyRaw),
      );
    if (blockedByRecentTrack || blockedByRecentArtist) return false;
    const hardAvoid = isHardAvoidTrack(track);
    if (hardAvoid && intent.specificity >= 7) return false;
    if (!allowHardAvoid && hardAvoid && freshCount < freshnessTarget) return false;
    const primaryArtist = normalizeText(track.artists?.[0]?.name ?? "");
    const primaryGenre = normalizeText(track.genres?.[0] ?? "");
    const used = artistCount.get(primaryArtist) ?? 0;
    if (primaryArtist && used >= maxPerArtist) return false;
    const usedGenre = genreCount.get(primaryGenre) ?? 0;
    if (primaryGenre && usedGenre >= maxPerGenre) return false;
    if (userTopTrackIds.has(String(track.id ?? "")) && exactTopTracksCount >= maxExactTopTracks) {
      return false;
    }
    picked.push(track);
    pickedKeys.add(key);
    if (!hardAvoid) freshCount += 1;
    if (primaryArtist) artistCount.set(primaryArtist, used + 1);
    if (primaryGenre) genreCount.set(primaryGenre, usedGenre + 1);
    if (userTopTrackIds.has(String(track.id ?? ""))) {
      exactTopTracksCount += 1;
    }
    return true;
  };

  while (picked.length < familiarTarget) {
    const candidate = pickBestCandidate(familiarPool);
    if (!candidate) break;
    tryPush(candidate);
  }

  while (picked.length < args.targetCount) {
    const candidate = pickBestCandidate(discoveryPool);
    if (!candidate) break;
    tryPush(candidate);
  }

  if (picked.length < args.targetCount) {
    for (const item of scored) {
      const key = trackDedupKey(item.track);
      if (!key || pickedKeys.has(key)) continue;
      if (tryPush(item.track) && picked.length >= args.targetCount) break;
    }
  }

  if (picked.length < args.targetCount) {
    for (const item of scored) {
      const key = trackDedupKey(item.track);
      if (!key || pickedKeys.has(key)) continue;
      const blockedByRecentTrack =
        shift >= 0.45 &&
        (args.recentAvoidTrackIds?.has(String(item.track.id ?? "").trim()) ?? false);
      const blockedByRecentArtist =
        shift >= 0.5 &&
        trackArtistKeys(item.track).some(keyRaw =>
          args.recentAvoidArtistKeys?.has(keyRaw),
        );
      if (blockedByRecentTrack || blockedByRecentArtist) continue;
      if (tryPush(item.track, true) && picked.length >= args.targetCount) break;
    }
  }

  const targetMinutes = Number(args.targetMinutes ?? 0);
  if (targetMinutes > 0) {
    const targetMs = targetMinutes * 60 * 1000;
    const mode = args.timeConstraint?.mode ?? "around";
    const minAcceptMs =
      mode === "at_least"
        ? targetMs * 0.98
        : mode === "at_most"
          ? 0
          : targetMs * 0.9;
    const maxAcceptMs =
      mode === "at_most"
        ? targetMs * 1.03
        : mode === "around"
          ? targetMs * 1.15
          : Number.POSITIVE_INFINITY;
    let currentMs = sumDurationMs(picked);
    const dynamicMaxCount = clamp(
      Math.round(targetMinutes * 0.45),
      Math.max(args.targetCount + 4, 18),
      75,
    );

    if (currentMs < minAcceptMs) {
      for (const item of scored) {
        if (picked.length >= dynamicMaxCount) break;
        const key = trackDedupKey(item.track);
        if (!key || pickedKeys.has(key)) continue;
        const blockedByRecentTrack =
          shift >= 0.45 &&
          (args.recentAvoidTrackIds?.has(String(item.track.id ?? "").trim()) ?? false);
        const blockedByRecentArtist =
          shift >= 0.5 &&
          trackArtistKeys(item.track).some(keyRaw =>
            args.recentAvoidArtistKeys?.has(keyRaw),
          );
        if (blockedByRecentTrack || blockedByRecentArtist) continue;
        if (!tryPush(item.track, true)) continue;
        currentMs = sumDurationMs(picked);
        if (currentMs >= minAcceptMs) break;
      }
    }
    if (currentMs > maxAcceptMs && mode !== "at_least") {
      // 상한 제약(이내/내외)에서는 후미 트랙부터 줄여서 시간 맞춤.
      while (picked.length > Math.max(8, Math.round(args.targetCount * 0.6))) {
        const last = picked[picked.length - 1];
        if (!last) break;
        const d = Number(last.duration_ms ?? 0);
        const safe = d > 30_000 ? d : 210_000;
        if (currentMs - safe < targetMs * 0.85) break;
        picked.pop();
        currentMs -= safe;
        const key = trackDedupKey(last);
        if (key) pickedKeys.delete(key);
        if (currentMs <= maxAcceptMs) break;
      }
    }
  }

  const hardMinCount = Math.max(
    8,
    Math.min(
      args.targetCount,
      targetMinutes > 0 ? Math.max(10, Math.round(args.targetCount * 0.65)) : 12,
    ),
  );
  if (picked.length < hardMinCount) {
    const relaxedPool = Array.from(dedupMap.values());
    for (const track of relaxedPool) {
      if (picked.length >= hardMinCount) break;
      const key = trackDedupKey(track);
      if (!key || pickedKeys.has(key)) continue;
      picked.push(track);
      pickedKeys.add(key);
    }
  }

  if (targetMinutes > 0) {
    const targetMs = targetMinutes * 60 * 1000;
    const minAcceptMs = targetMs * 0.9;
    let currentMs = sumDurationMs(picked);
    const relaxedMaxCount = clamp(
      Math.round(targetMinutes * 0.5),
      Math.max(hardMinCount + 4, args.targetCount + 4),
      80,
    );
    if (currentMs < minAcceptMs) {
      const relaxedPool = Array.from(dedupMap.values());
      for (const track of relaxedPool) {
        if (picked.length >= relaxedMaxCount) break;
        const key = trackDedupKey(track);
        if (!key || pickedKeys.has(key)) continue;
        picked.push(track);
        pickedKeys.add(key);
        currentMs = sumDurationMs(picked);
        if (currentMs >= minAcceptMs) break;
      }
    }
  }

  return picked.slice(0, Math.max(args.targetCount, picked.length));
}

function localPersonalizedPick(
  bootstrap: SpotifyBootstrapData | null,
  strategy: GeminiPlaylistJson["mixStrategy"],
  targetCountRaw?: number,
  targetMinutes?: number | null,
  options?: {
    avoidTrackIds?: Set<string>;
    avoidArtistKeys?: Set<string>;
  },
): SpotifyTrackSummary[] {
  const avoidTrackIds = options?.avoidTrackIds ?? new Set<string>();
  const avoidArtistKeys = options?.avoidArtistKeys ?? new Set<string>();
  const isAvoided = (track: SpotifyTrackSummary): boolean => {
    const id = String(track?.id ?? "").trim();
    if (id && avoidTrackIds.has(id)) return true;
    return trackArtistKeys(track).some(key => avoidArtistKeys.has(key));
  };
  const topRaw = bootstrap?.topTracks ?? [];
  const recentRaw = bootstrap?.recentlyPlayed ?? [];
  const top = topRaw.filter(track => !isAvoided(track));
  const recent = recentRaw.filter(track => !isAvoided(track));
  const pool = [...top, ...recent].filter(t => t?.id);
  const avgDurationMs = pool.length
    ? pool.reduce((sum, t) => sum + Math.max(0, Number(t.duration_ms ?? 0)), 0) /
      pool.length
    : 210000;
  const estimatedCountByMinutes =
    targetMinutes && targetMinutes > 0
      ? Math.round((targetMinutes * 60 * 1000) / Math.max(120000, avgDurationMs))
      : null;
  const baseCount = Number(targetCountRaw ?? 12) || 12;
  const count = Math.max(
    8,
    Math.min(60, estimatedCountByMinutes ?? baseCount),
  );
  const used = new Set<string>();

  const ratio =
    strategy === "familiar"
      ? { top: 0.75, recent: 0.25 }
      : strategy === "discovery"
        ? { top: 0.35, recent: 0.65 }
        : { top: 0.55, recent: 0.45 };

  const topCount = Math.round(count * ratio.top);
  const recentCount = count - topCount;

  const pickedTop = pickUniqueFromPool(top, topCount, used);
  const pickedRecent = pickUniqueFromPool(recent, recentCount, used);
  const merged = [...pickedTop, ...pickedRecent];

  if (merged.length < count) {
    const fallbackPool = [...top, ...recent];
    const fill = pickUniqueFromPool(fallbackPool, count - merged.length, used);
    merged.push(...fill);
  }

  if (!targetMinutes || targetMinutes <= 0) {
    return merged.slice(0, count);
  }

  const targetMs = targetMinutes * 60 * 1000;
  const minAcceptMs = targetMs * 0.9;
  const maxAcceptMs = targetMs * 1.1;
  const byDuration: SpotifyTrackSummary[] = [];
  let acc = 0;

  for (const t of merged) {
    byDuration.push(t);
    acc += Math.max(0, Number(t.duration_ms ?? 0));
    if (acc >= minAcceptMs && (acc >= targetMs || acc <= maxAcceptMs)) {
      break;
    }
  }

  return byDuration.slice(0, count);
}

async function tryPromptFirstRecommendation(args: {
  input: PersonalizedPlaylistInput;
  effectiveMoodInput: string;
  timeConstraint: TimeConstraint | null;
  targetMinutes: number | null;
  searchPlan: PromptSearchPlan;
  parsed: GeminiPlaylistJson;
  fingerprint: string;
  currentIntent: { include: string[]; exclude: string[]; specificity: number };
  recentAvoidProfile: {
    trackIds: Set<string>;
    artistKeys: Set<string>;
    intentShift: number;
  };
  globalReuseGuard: { trackIds: Set<string>; artistKeys: Set<string> };
  maxDurationMs?: number;
}): Promise<PersonalizedPlaylistOutput | null> {
  if (!args.input.spotifyAccessToken) return null;
  const timeoutCap = clamp(
    Number(args.maxDurationMs ?? PROMPT_FIRST_TIMEOUT_MS),
    3000,
    22000,
  );
  const timeoutSecondary = Math.max(2800, Math.round(timeoutCap * 0.78));

  const quickQueryInputs = pickDiverseQueries(
    [
      ...buildStrictIntentQueries({
        moodInput: args.effectiveMoodInput,
        parsed: args.parsed,
      }),
      ...buildCatalogSearchInputs({
        moodInput: args.effectiveMoodInput,
        parsed: args.parsed,
        intentShift: args.recentAvoidProfile.intentShift,
        searchPlan: args.searchPlan,
      }),
    ],
    args.currentIntent.specificity >= 7 ? 3 : 2,
  );
  if (!quickQueryInputs.length) return null;

  const quickSettled = await Promise.allSettled(
    quickQueryInputs.map((query, idx) =>
      discoverSpotifyTracksWithTimeout(
        {
          accessToken: args.input.spotifyAccessToken!,
          moodInput: query,
          bootstrap: args.input.spotifyBootstrap,
          limit: idx === 0 ? 72 : 56,
          includeAffinityQueries: false,
          maxSearchQueries: 1,
          fastMode: true,
        },
        idx === 0 ? timeoutCap : timeoutSecondary,
      ),
    ),
  );
  let quickPool = mergeUniqueTracks(
    ...quickSettled
      .filter((r): r is PromiseFulfilledResult<SpotifyTrackSummary[]> => r.status === "fulfilled")
      .map(r => r.value),
  );

  if (quickPool.length < 10) {
    const broad = await discoverSpotifyTracksWithTimeout(
      {
        accessToken: args.input.spotifyAccessToken!,
        moodInput: args.effectiveMoodInput,
        bootstrap: args.input.spotifyBootstrap,
        limit: 80,
        includeAffinityQueries: false,
        maxSearchQueries: 2,
        fastMode: true,
      },
      timeoutCap,
    );
    quickPool = mergeUniqueTracks(quickPool, broad);
  }

  if (quickPool.length < 8) return null;

  const fallbackBase = pickFallbackTracks(args.input.spotifyBootstrap, 12);
  const quickTarget = deriveTargetTrackCount({
    parsedTargetCount: args.parsed.targetCount,
    targetMinutes: args.targetMinutes,
    timeMode: args.timeConstraint?.mode,
    averageDurationMs: estimateAverageTrackDurationMs([quickPool, fallbackBase]),
    maxCount: 56,
  });
  let quickSelected = chooseCuratedTracks({
    catalogPool: quickPool,
    localPicks: [],
    fallback: [],
    bootstrap: args.input.spotifyBootstrap,
    moodInput: args.effectiveMoodInput,
    parsed: args.parsed,
    targetCount: quickTarget,
    targetMinutes: args.targetMinutes,
    timeConstraint: args.timeConstraint,
    recentAvoidTrackIds: args.recentAvoidProfile.trackIds,
    recentAvoidArtistKeys: args.recentAvoidProfile.artistKeys,
    hardAvoidTrackIds: args.globalReuseGuard.trackIds,
    hardAvoidArtistKeys: args.globalReuseGuard.artistKeys,
    intentShift: args.recentAvoidProfile.intentShift,
  });
  quickSelected = enforceMinimumDuration({
    selected: quickSelected,
    targetMinutes: args.targetMinutes,
    timeConstraint: args.timeConstraint,
    candidatePool: mergeUniqueTracks(
      quickPool,
      args.input.spotifyBootstrap?.topTracks ?? [],
      args.input.spotifyBootstrap?.recentlyPlayed ?? [],
    ),
    minCoverage: args.timeConstraint?.mode === "at_least" ? 0.97 : 0.9,
    maxCount: 70,
  });
  const quickQuality = assessPlaylistQuality({
    tracks: quickSelected,
    moodInput: args.effectiveMoodInput,
    parsed: args.parsed,
    targetMinutes: args.targetMinutes,
    intentShift: args.recentAvoidProfile.intentShift,
  });
  const quickIntentThreshold = args.currentIntent.specificity >= 7 ? 0.56 : 0.45;
  const quickDurationOk =
    !args.targetMinutes || quickQuality.durationCoverage >= 0.72;
  if (
    quickSelected.length < Math.max(10, Math.round(quickTarget * 0.6)) ||
    quickQuality.intentCoverage < quickIntentThreshold ||
    !quickDurationOk
  ) {
    return null;
  }

  pushRecommendationSnapshot(args.fingerprint, args.effectiveMoodInput, quickSelected);
  return {
    status: "partial",
    tracks: quickSelected.map(toTrack),
    playlistName: buildAutoPlaylistNameFromTracks(
      quickSelected,
      args.effectiveMoodInput,
    ),
    reasoning:
      args.parsed.reasoning ||
      args.parsed.moodSummary ||
      "프롬프트 키워드 우선 경로로 빠르게 선별해 추천했어요.",
    meta: { requestId: args.input.requestId, reason: "quick_recommendation_partial" },
  };
}

export async function analyzeMoodAndRecommendFast(
  input: PersonalizedPlaylistInput,
  options?: {
    maxDurationMs?: number;
    onProgress?: (event: AnalysisProgressEvent) => void;
    requestId?: string;
    abortSignal?: AbortSignal;
  },
): Promise<PersonalizedPlaylistOutput> {
  const maxDurationMs = clamp(
    Number(options?.maxDurationMs ?? PROMPT_FIRST_TIMEOUT_MS),
    4500,
    45000,
  );
  const requestId =
    String(options?.requestId ?? input.requestId ?? "").trim() ||
    `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  clearPartialPool(requestId);
  if (hasFinishedRequest(requestId)) {
    console.warn("[Pipeline] duplicate invocation skipped", requestId);
    const skipped: PersonalizedPlaylistOutput = {
      status: "failed",
      tracks: [],
      playlistName: "",
      meta: { requestId, reason: "duplicate_invocation_skipped" },
    };
    logPipelineResult(skipped);
    return skipped;
  }
  const abortSignal = options?.abortSignal ?? input.abortSignal;
  assertNotCancelled(requestId, abortSignal, "fast_pipeline_start");
  const singleFlightKey = [
    requestId,
    normalizeText(input.moodInput),
    input.spotifyAccessToken
      ? stableHash(String(input.spotifyAccessToken)).toString(16)
      : "no-token",
    (input.spotifyBootstrap?.topTracks ?? [])
      .slice(0, 5)
      .map(t => String(t?.id ?? "").trim())
      .filter(Boolean)
      .join("|"),
    (input.spotifyBootstrap?.topArtists ?? [])
      .slice(0, 3)
      .map(a => String(a?.id ?? "").trim())
      .filter(Boolean)
      .join("|"),
    String(maxDurationMs),
  ].join("::");
  const existingFastRequest = fastPlaylistInFlight.get(singleFlightKey);
  if (existingFastRequest) {
    console.warn(
      `[FastEngine] generatePlaylist single-flight reuse key=${stableHash(singleFlightKey).toString(16).slice(0, 8)}`,
    );
    return existingFastRequest;
  }
  const request = (async (): Promise<PersonalizedPlaylistOutput> => {
  const emitProgress = (event: AnalysisProgressEvent) => {
    options?.onProgress?.({
      ...event,
      requestId,
    });
  };
  emitProgress({
    stage: "analysis_start",
    progress: 0.08,
    step: 0,
    label: "프롬프트를 분석하고 있어요",
  });
  const fastStartedAt = Date.now();
  const searchPlan = extractPromptSearchPlan(input.moodInput);
  const effectiveMoodInput = searchPlan.brief || input.moodInput;
  const timeConstraint = searchPlan.timeConstraint;
  const targetMinutes = timeConstraint?.minutes ?? null;
  const fingerprint = promptFingerprint(effectiveMoodInput);
  const currentIntent = buildUserIntentProfile(effectiveMoodInput);
  const recentAvoidProfile = buildRecentAvoidProfile({
    currentFingerprint: fingerprint,
    currentIntent,
  });
  const globalReuseGuard = buildGlobalReuseGuard(fingerprint);
  const parsed = buildLocalParsedPlan({
    moodInput: effectiveMoodInput,
    timeConstraint,
    bootstrap: input.spotifyBootstrap,
  });
  let analyzedParams: GeminiRecommendationProfile | null = null;
  let analysisError: string | null = null;
  let analysisMode: "analyze_success" | "analyze_timeout" | "fallback_mode" = "fallback_mode";
  try {
    analyzedParams = await analyzePrompt(effectiveMoodInput, {
      requestId,
      allowInflightReuse: false,
      abortSignal,
    });
    console.warn(
      `[FastEngine] analyzePrompt active genres=${analyzedParams.genres.join("|") || "-"} energy=${analyzedParams.energy.toFixed(2)} valence=${analyzedParams.valence.toFixed(2)} acousticness=${analyzedParams.acousticness.toFixed(2)} mood=${analyzedParams.mood ?? "-"} activity=${analyzedParams.activity ?? "-"} place=${analyzedParams.place ?? "-"}`,
    );
  } catch (err) {
    analysisError = safeErrorMessage(err);
    if (/timed out|timeout/i.test(analysisError)) analysisMode = "analyze_timeout";
    console.warn(`[FastEngine] analyzePrompt failed: ${analysisError}`);
  }
  const analysisStatus = getLatestGeminiAnalysisStatus();
  emitProgress({
    stage: "analysis_done",
    progress: 0.22,
    step: 0,
    label: "분석 컨텍스트를 정리했어요",
    analysisStatus,
  });
  const isFallbackAnalysis = analyzedParams?.source === "fallback";
  console.warn(
    `[FastEngine] parameter-first gate token=${input.spotifyAccessToken ? "present" : "missing"}`,
  );
  let spotifyUserToken: string | null = input.spotifyAccessToken ?? null;
  let spotifyAccessIssueCode: SpotifyAccessIssueCode | undefined;
  const withSpotifyAccessIssue = (
    out: PersonalizedPlaylistOutput,
  ): PersonalizedPlaylistOutput => {
    if (!spotifyAccessIssueCode || out.fallbackReason) return out;
    const issueText = spotifyIssueReasonText(spotifyAccessIssueCode);
    return {
      ...out,
      fallbackReason: spotifyAccessIssueCode,
      status: out.status === "success" ? "partial" : out.status,
      meta: {
        ...(out.meta ?? {}),
        requestId,
        reason: String(out.meta?.reason ?? "spotify_access_issue"),
      },
      reasoning: out.reasoning
        ? `${out.reasoning} ${issueText}`.trim()
        : issueText || out.reasoning,
    };
  };
  const analysisFailure = (reason: string): PersonalizedPlaylistOutput =>
    withSpotifyAccessIssue({
      status: "failed",
      tracks: [],
      playlistName: buildFallbackPlaylistName(effectiveMoodInput || input.moodInput),
      reasoning: `${reason} 잠시 후 다시 시도해 주세요.`,
      fallbackReason: "gemini_error",
      meta: { requestId, reason: "analysis_failed" },
    });
  const isAnalysisSuccessful =
    analyzedParams !== null &&
    analyzedParams.source !== "fallback" &&
    !/^error_|^quota_fallback_local|^invalid_shape_fallback/.test(analysisStatus);
  if (isAnalysisSuccessful) analysisMode = "analyze_success";
  if (!isAnalysisSuccessful) {
    console.warn(
      `[FastEngine] analysis gate blocked mode=${analysisMode} status=${analysisStatus} source=${analyzedParams?.source ?? "-"} err=${analysisError ?? "-"}`,
    );
    assertNotCancelled(requestId, abortSignal, "fast_analysis_failed_before_finalize");
    return analysisFailure("분석 단계가 안정적으로 완료되지 않았어요.");
  }
  if (spotifyUserToken && !isFallbackAnalysis) {
    try {
      await validateSpotifyUserToken(spotifyUserToken, "recommendation_pipeline");
    } catch (err) {
      spotifyAccessIssueCode = classifySpotifyValidationIssue(err);
      console.warn(`[Spotify] user token validation failed: ${safeErrorMessage(err)}`);
      console.warn(
        `[Spotify] recommendation pipeline stopped: /me validation failed code=${spotifyAccessIssueCode}`,
      );
      spotifyUserToken = null;
    }
  }
  if (spotifyUserToken && !isFallbackAnalysis) {
    try {
      const generated = await generatePlaylistSummaries(
        input.moodInput,
        spotifyUserToken,
        analyzedParams,
        input.spotifyBootstrap,
        emitProgress,
        {
          requestId,
          allowResultCache: false,
          hardTimeoutMs: Math.min(40_000, Math.max(20_000, maxDurationMs + 15_000)),
          minimumPlayableTracks: 15,
          earlyFinalizeThreshold: 30,
          targetTracks: 40,
          abortSignal,
        },
      );
      const filtered = dedupeWithDiversity({
        tracks: generated.tracks,
        userHistory: new Set<string>(),
        maxPerArtist: 2,
        limit: 30,
      });
      if (filtered.length) {
        console.warn(`[FastEngine] parameter-first return tracks=${filtered.length}`);
        return withSpotifyAccessIssue({
          status: "success",
          tracks: filtered.map(toTrack),
          playlistName: buildAutoPlaylistNameFromTracks(filtered, effectiveMoodInput),
          reasoning:
            `Gemini 파라미터 기반(genres=${generated.profile.genres.join("|") || "k-pop"}, energy=${generated.profile.energy.toFixed(2)}, valence=${generated.profile.valence.toFixed(2)})로 추천했어요.`,
          meta: { requestId, reason: "fast_parameter_first" },
        });
      }
      console.warn("[FastEngine] parameter-first produced 0 tracks; legacy fallback disabled");
      console.warn("[BLOCKED] legacy fallback disabled");
      const fallbackTracks = buildImmediateFallbackTracksSync({
        prompt: effectiveMoodInput || input.moodInput,
        requestId,
        spotifyBootstrap: input.spotifyBootstrap,
      });
      return withSpotifyAccessIssue({
        status: fallbackTracks.length ? "partial" : "failed",
        tracks: fallbackTracks,
        playlistName: buildFallbackPlaylistName(effectiveMoodInput || input.moodInput),
        reasoning: "검색 결과가 없어 복구 가능한 결과를 찾지 못했어요.",
        fallbackReason: "gemini_error",
        meta: { requestId, reason: "fast_parameter_empty_recovered" },
      });
    } catch (err) {
      if (isCancelledRecommendationError(err)) {
        throw err;
      }
      console.warn(
        `[FastEngine] parameter-first pipeline aborted: ${safeErrorMessage(err)}`,
      );
      console.warn("[BLOCKED] legacy fallback disabled");
      const fallbackTracks = buildImmediateFallbackTracksSync({
        prompt: effectiveMoodInput || input.moodInput,
        requestId,
        spotifyBootstrap: input.spotifyBootstrap,
      });
      return withSpotifyAccessIssue({
        status: fallbackTracks.length ? "partial" : "failed",
        tracks: fallbackTracks,
        playlistName: buildFallbackPlaylistName(effectiveMoodInput || input.moodInput),
        reasoning: "추천 생성 중 오류가 발생해 복구 경로만 시도했지만 결과가 없었어요.",
        fallbackReason: "gemini_error",
        meta: { requestId, reason: "fast_parameter_error_recovered" },
      });
    }
  } else if (!spotifyUserToken) {
    console.warn("[FastEngine] parameter-first skipped: missing spotifyAccessToken (Gemini analysis still applied)");
  } else {
    console.warn("[FastEngine] parameter-first skipped: fallback analysis mode");
    assertNotCancelled(requestId, abortSignal, "fast_fallback_analysis_blocked");
    return analysisFailure("분석 신뢰도가 낮아 추천 생성을 중단했어요.");
  }
  const hardDeadlineAt = fastStartedAt + FAST_HARD_RETURN_MS;
  const remainingMs = () => maxDurationMs - (Date.now() - fastStartedAt);
  const hardRemainingMs = () => hardDeadlineAt - Date.now();
  const canRun = (needMs: number) => remainingMs() >= needMs;
  let localFastIntent = analyzeFastIntent(input.moodInput);
  if (analyzedParams) {
    const mappedEnergy: FastIntent["energy"] =
      analyzedParams.energy >= 0.66
        ? "high"
        : analyzedParams.energy <= 0.4
        ? "low"
        : "mid";
    localFastIntent = {
      ...localFastIntent,
      energy: mappedEnergy,
      genres: Array.from(
        new Set([
          ...localFastIntent.genres,
          ...analyzedParams.genres.map(g => normalizeText(g)).filter(Boolean),
        ]),
      ).slice(0, 6),
      confidence: Math.max(localFastIntent.confidence, 0.86),
    };
  }
  const semanticPlan =
    canRun(900)
      ? await buildFastSemanticTokenPlan({
          moodInput: input.moodInput,
          searchPlan,
          localIntent: localFastIntent,
          bootstrap: input.spotifyBootstrap,
          timeoutMs: Math.min(2200, Math.max(900, remainingMs() - 450)),
          disableGemini: true,
        })
      : null;
  const fastIntent = mergeFastIntentWithSemanticPlan(localFastIntent, semanticPlan);
  const fastStrategy = semanticPlan?.strategy ?? buildFastRecommendationStrategy({ localIntent: fastIntent });
  const fastQueryPlan = buildFastSearchQueries({
    input: effectiveMoodInput,
    intent: fastIntent,
    strategy: fastStrategy,
    semanticPlan,
    timeConstraint,
    bootstrap: input.spotifyBootstrap,
  });
  const quickQueries = fastQueryPlan.queries;
  const baseQueries = fastQueryPlan.baseQueries;
  const tasteExpansionQueries = fastQueryPlan.tasteExpansionQueries;
  const explorationQueries = fastQueryPlan.explorationQueries;
  console.warn(
    `[FastEngine] intent keywords=${fastIntent.moodKeywords.join("|") || "-"} genres=${fastIntent.genres.join("|") || "-"} energy=${fastIntent.energy} confidence=${fastIntent.confidence.toFixed(2)}`,
  );
  if (semanticPlan) {
    console.warn(
      `[FastEngine] semantic source=${semanticPlan.source} mood=${semanticPlan.moodTokens.join("|") || "-"} texture=${semanticPlan.textureTokens.join("|") || "-"} tempo=${semanticPlan.tempoTokens.join("|") || "-"} tokens=${semanticPlan.searchTokens.join("|") || "-"} exclude=${semanticPlan.excludeTokens.join("|") || "-"} energy=${semanticPlan.energy ?? "-"}`,
    );
  }
  console.warn(
    `[FastEngine] strategy mix=${fastStrategy.mixStrategy} novelty=${fastStrategy.noveltyLevel} pool(t=${fastStrategy.poolRatio.taste.toFixed(2)},g=${fastStrategy.poolRatio.general.toFixed(2)},e=${fastStrategy.poolRatio.exploration.toFixed(2)}) weights(t=${fastStrategy.scoring.taste.toFixed(2)},c=${fastStrategy.scoring.context.toFixed(2)},g=${fastStrategy.scoring.genre.toFixed(2)},m=${fastStrategy.scoring.mood.toFixed(2)})`,
  );
  console.warn(`[FastEngine] queries=${quickQueries.join(" || ") || "-"}`);
  const fastQualityGate = computeFastQualityGate({
    fastIntent,
    searchPlan,
    currentSpecificity: currentIntent.specificity,
    timeConstraint,
    targetMinutes,
  });
  console.warn(
    `[FastEngine] quality thresholds intent>=${fastQualityGate.intentMin.toFixed(2)} duration>=${fastQualityGate.durationMin.toFixed(2)} genre>=${fastQualityGate.genreMin.toFixed(2)} fallback(intent>=${fastQualityGate.fallbackIntentMin.toFixed(2)}, genre>=${fastQualityGate.fallbackGenreMin.toFixed(2)}) clarity=${fastQualityGate.clarityScore.toFixed(2)}`,
  );
  const userTopTrackIds = new Set(
    (input.spotifyBootstrap?.topTracks ?? [])
      .map(t => String(t?.id ?? "").trim())
      .filter(Boolean),
  );
  const userTopArtistIds = new Set(
    (input.spotifyBootstrap?.topArtists ?? [])
      .map(a => String(a?.id ?? "").trim())
      .filter(Boolean),
  );
  const userTopArtistNames = new Set(
    (input.spotifyBootstrap?.topArtists ?? [])
      .map(a => normalizeText(a?.name ?? ""))
      .filter(Boolean),
  );
  const recentTrackIds = new Set([
    ...recentAvoidProfile.trackIds,
    ...globalReuseGuard.trackIds,
  ]);
  const recentArtistKeys = new Set([
    ...recentAvoidProfile.artistKeys,
    ...globalReuseGuard.artistKeys,
  ]);
  const tasteProfile = buildUserTasteProfile(input.spotifyBootstrap);
  const variationSeed = stableHash(`${fingerprint}|${Date.now()}|fast`);
  const tasteCandidateIds = new Set<string>();
  let fastTastePool: SpotifyTrackSummary[] = [];
  let fastGeneralPool: SpotifyTrackSummary[] = [];
  let fastExplorationPool: SpotifyTrackSummary[] = [];
  const buildTastePoolFromBootstrap = (): SpotifyTrackSummary[] => {
    if (!input.spotifyBootstrap) return [];
    const expanded = expandTasteGenresFromProfile(tasteProfile);
    const source = mergeUniqueTracks(
      input.spotifyBootstrap.topTracks ?? [],
      input.spotifyBootstrap.recentlyPlayed ?? [],
    );
    const selected = source.filter(track => {
      const key = trackDedupKey(track);
      if (!key) return false;
      const taste = scoreTasteAffinity(track, tasteProfile);
      const artistHit = (track.artists ?? []).some(a => {
        const id = String(a?.id ?? "").trim();
        const name = normalizeText(a?.name ?? "");
        return (id && userTopArtistIds.has(id)) || (name && userTopArtistNames.has(name));
      });
      const genreHit = (track.genres ?? [])
        .map(g => normalizeText(g))
        .some(g => expanded.has(g));
      return taste >= 0.3 || artistHit || genreHit;
    });
    return sampleTracksSeeded(selected, 24, variationSeed + 17);
  };
  const buildTasteGenreQueries = (): string[] => {
    const expanded = [...expandTasteGenresFromProfile(tasteProfile)];
    const preferred = expanded
      .filter(g => /korean|k-pop|kpop|rnb|soul|indie|folk|ballad|melodic/.test(g))
      .slice(0, 6);
    return pickDiverseQueries(
      preferred.map(g => sanitizeFastSearchToken(`${g} ${fastIntent.energy === "high" ? "upbeat" : "soft"}`)).filter(Boolean),
      4,
    );
  };

  const tryBuildFastResult = (
    pool: SpotifyTrackSummary[],
    relaxed: boolean,
  ): PersonalizedPlaylistOutput | null => {
    if (pool.length < 8) return null;
    const targetCount = deriveTargetTrackCount({
      parsedTargetCount: parsed.targetCount,
      targetMinutes,
      timeMode: timeConstraint?.mode,
      averageDurationMs: estimateAverageTrackDurationMs([
        pool,
        input.spotifyBootstrap?.topTracks ?? [],
        input.spotifyBootstrap?.recentlyPlayed ?? [],
      ]),
      maxCount: 60,
    });
    const selected = selectTracksFast({
      tracks: pool,
      intent: fastIntent,
      strategy: fastStrategy,
      targetCount,
      targetMinutes,
      timeConstraint,
      userTopTrackIds,
      userTopArtistIds,
      userTopArtistNames,
      recentAvoidTrackIds: recentTrackIds,
      recentAvoidArtistKeys: recentArtistKeys,
      tasteProfile,
      tasteCandidateIds,
      tasteQuota: Math.max(0.4, fastStrategy.poolRatio.taste),
      variationSeed,
      explorationRatio: fastStrategy.poolRatio.exploration,
    });
    let finalSelected = selected.filter(t => !recentTrackIds.has(String(t.id ?? "").trim()));
    if (fastTastePool.length || fastGeneralPool.length || fastExplorationPool.length) {
      const tasteTarget = Math.max(4, Math.round(targetCount * fastStrategy.poolRatio.taste));
      const explorationTarget = Math.max(2, Math.round(targetCount * fastStrategy.poolRatio.exploration));
      const generalTarget = Math.max(2, targetCount - tasteTarget - explorationTarget);
      const tasteSelected = selectTracksFast({
        tracks: fastTastePool.length ? fastTastePool : pool,
        intent: fastIntent,
        strategy: fastStrategy,
        targetCount: tasteTarget,
        targetMinutes,
        timeConstraint,
        userTopTrackIds,
        userTopArtistIds,
        userTopArtistNames,
        recentAvoidTrackIds: recentTrackIds,
        recentAvoidArtistKeys: recentArtistKeys,
        tasteProfile,
        tasteCandidateIds,
        tasteQuota: Math.max(0.45, fastStrategy.poolRatio.taste + 0.08),
        variationSeed: variationSeed + 13,
        explorationRatio: Math.max(0.08, fastStrategy.poolRatio.exploration * 0.65),
      });
      const explorationSelected = selectTracksFast({
        tracks: fastExplorationPool.length ? fastExplorationPool : pool,
        intent: fastIntent,
        strategy: fastStrategy,
        targetCount: explorationTarget,
        targetMinutes,
        timeConstraint,
        userTopTrackIds,
        userTopArtistIds,
        userTopArtistNames,
        recentAvoidTrackIds: recentTrackIds,
        recentAvoidArtistKeys: recentArtistKeys,
        tasteProfile,
        tasteCandidateIds,
        tasteQuota: Math.max(0.25, fastStrategy.poolRatio.taste - 0.15),
        variationSeed: variationSeed + 29,
        explorationRatio: Math.min(1, Math.max(0.25, fastStrategy.poolRatio.exploration + 0.4)),
      });
      const generalSelected = selectTracksFast({
        tracks: fastGeneralPool.length ? fastGeneralPool : pool,
        intent: fastIntent,
        strategy: fastStrategy,
        targetCount: generalTarget,
        targetMinutes,
        timeConstraint,
        userTopTrackIds,
        userTopArtistIds,
        userTopArtistNames,
        recentAvoidTrackIds: recentTrackIds,
        recentAvoidArtistKeys: recentArtistKeys,
        tasteProfile,
        tasteCandidateIds,
        tasteQuota: Math.max(0.25, fastStrategy.poolRatio.taste - 0.18),
        variationSeed: variationSeed + 43,
        explorationRatio: Math.max(0.1, fastStrategy.poolRatio.exploration),
      });
      finalSelected = interleaveTrackGroups({
        taste: tasteSelected,
        exploration: explorationSelected,
        general: generalSelected,
        targetCount,
        seed: variationSeed + 71,
      });
    }
    if (finalSelected.length < Math.max(6, Math.round(targetCount * 0.5))) {
      const refill = pool.filter(
        t =>
          !recentTrackIds.has(String(t.id ?? "").trim()) &&
          !finalSelected.some(p => String(p.id ?? "") === String(t.id ?? "")),
      );
      finalSelected = [...finalSelected, ...refill].slice(0, Math.max(10, targetCount));
    }
    finalSelected = applyFinalValidationLayer({
      tracks: finalSelected,
      intent: fastIntent,
      strategy: fastStrategy,
      targetCount,
      tasteProfile,
      userTopTrackIds,
      userTopArtistIds,
      userTopArtistNames,
      explorationCandidateIds: new Set(
        fastExplorationPool
          .map(t => trackDedupKey(t))
          .filter((v): v is string => Boolean(v)),
      ),
      maxPerArtist: 2,
    });
    if (finalSelected.length < Math.max(8, Math.round(targetCount * 0.55))) return null;
    const genreCoverage = computeFastGenreCoverage(finalSelected, fastIntent.genres);
    const quality = assessPlaylistQuality({
      tracks: finalSelected,
      moodInput: effectiveMoodInput,
      parsed,
      targetMinutes,
      intentShift: recentAvoidProfile.intentShift,
    });
    const userTasteAffinity = computeFastUserTasteAffinity({
      tracks: finalSelected,
      userTopTrackIds,
      userTopArtistIds,
      userTopArtistNames,
    });
    const effectiveIntentCoverage = computeFastIntentCoverageProxy({
      qualityIntentCoverage: quality.intentCoverage,
      genreCoverage,
      fastIntent,
      tracks: finalSelected,
      userTasteAffinity,
    });
    const intentMin = relaxed ? fastQualityGate.fallbackIntentMin * 0.8 : fastQualityGate.intentMin;
    const genreMin = relaxed ? fastQualityGate.fallbackGenreMin * 0.85 : fastQualityGate.genreMin;
    const durationMin = relaxed ? Math.max(0.5, fastQualityGate.durationMin * 0.85) : fastQualityGate.durationMin;
    const durationOk = !targetMinutes || quality.durationCoverage >= durationMin;
    const genreOk = !fastIntent.genres.length || genreCoverage >= genreMin;
    if (effectiveIntentCoverage < intentMin || !durationOk || !genreOk) return null;
    const shuffledFinal = seededShuffleTracks(finalSelected, variationSeed + 401);
    pushRecommendationSnapshot(fingerprint, effectiveMoodInput, shuffledFinal);
    clearFastWorkingSet(fingerprint, requestId);
    return withSpotifyAccessIssue({
      status: "success",
      tracks: shuffledFinal.map(toTrack),
      playlistName: buildAutoPlaylistNameFromTracks(shuffledFinal, effectiveMoodInput),
      reasoning:
        parsed.reasoning ||
        parsed.moodSummary ||
        (relaxed
          ? "빠른 경로에서 무드·장르·취향 우선으로 선별했어요."
          : "프롬프트 핵심 키워드를 빠르게 분석해 Spotify에서 우선 추천했어요."),
      meta: { requestId, reason: relaxed ? "fast_relaxed_success" : "fast_primary_success" },
    });
  };
  const buildForcedPartialFromPool = (pool: SpotifyTrackSummary[]): PersonalizedPlaylistOutput | null => {
    const merged = mergeUniqueTracks(
      pool,
      readFastWorkingSet(fingerprint, 180_000, requestId),
    );
    if (!merged.length) return null;
    const targetCount = deriveTargetTrackCount({
      parsedTargetCount: parsed.targetCount,
      targetMinutes,
      timeMode: timeConstraint?.mode,
      averageDurationMs: estimateAverageTrackDurationMs([
        merged,
        input.spotifyBootstrap?.topTracks ?? [],
        input.spotifyBootstrap?.recentlyPlayed ?? [],
      ]),
      maxCount: 80,
    });
    const minCountByDuration = targetMinutes
      ? clamp(Math.ceil((targetMinutes * 60 * 1000) / 220000), 12, 80)
      : 0;
    const picked = selectTracksFast({
      tracks: merged,
      intent: fastIntent,
      strategy: fastStrategy,
      targetCount: Math.max(targetCount, minCountByDuration, 12),
      targetMinutes,
      timeConstraint,
      userTopTrackIds,
      userTopArtistIds,
      userTopArtistNames,
      recentAvoidTrackIds: recentTrackIds,
      recentAvoidArtistKeys: recentArtistKeys,
      tasteProfile,
      tasteCandidateIds,
      tasteQuota: Math.max(0.4, fastStrategy.poolRatio.taste),
      variationSeed,
      explorationRatio: fastStrategy.poolRatio.exploration,
    });
    let final = enforceMinimumDuration({
      selected: picked.length ? picked : merged.slice(0, 24),
      targetMinutes,
      timeConstraint,
      candidatePool: mergeUniqueTracks(
        merged,
        input.spotifyBootstrap?.topTracks ?? [],
        input.spotifyBootstrap?.recentlyPlayed ?? [],
      ),
      minCoverage: timeConstraint?.mode === "at_least" ? 0.93 : 0.86,
      maxCount: 90,
    });
    final = applyFinalValidationLayer({
      tracks: final,
      intent: fastIntent,
      strategy: fastStrategy,
      targetCount: Math.max(targetCount, minCountByDuration, 12),
      tasteProfile,
      userTopTrackIds,
      userTopArtistIds,
      userTopArtistNames,
      explorationCandidateIds: new Set(
        fastExplorationPool
          .map(t => trackDedupKey(t))
          .filter((v): v is string => Boolean(v)),
      ),
      maxPerArtist: 2,
    });
    if (!final.length) return null;
    const shuffledFinal = seededShuffleTracks(final, variationSeed + 509);
    pushRecommendationSnapshot(fingerprint, effectiveMoodInput, shuffledFinal);
    clearFastWorkingSet(fingerprint, requestId);
    return withSpotifyAccessIssue({
      status: "partial",
      tracks: shuffledFinal.map(toTrack),
      playlistName: buildAutoPlaylistNameFromTracks(shuffledFinal, effectiveMoodInput),
      reasoning: "타임아웃 전에 현재 검색된 곡으로 즉시 추천했어요.",
      meta: { requestId, reason: "fast_forced_partial_from_pool" },
    });
  };
  const forceReturnNow = (): PersonalizedPlaylistOutput | null => {
    const working = consumeFastWorkingRecommendation({
      moodInput: input.moodInput,
      spotifyBootstrap: input.spotifyBootstrap,
      maxAgeMs: 180_000,
      requestId,
    });
    if (working?.tracks?.length) return working;
    const fallback = pickFallbackTracks(input.spotifyBootstrap, 20);
    if (!fallback.length) return null;
    return withSpotifyAccessIssue({
      status: "partial",
      tracks: fallback.map(toTrack),
      playlistName: buildAutoPlaylistNameFromTracks(fallback, effectiveMoodInput),
      reasoning: "빠른 응답을 위해 현재 확보된 데이터로 즉시 추천했어요.",
      meta: { requestId, reason: "fast_force_return_now_fallback" },
    });
  };

  if (input.spotifyAccessToken && quickQueries.length && canRun(2200)) {
    assertNotCancelled(requestId, input.abortSignal, "fast_search_start");
    const strategyQueryBias = Math.max(0.8, Math.min(1.3, 0.9 + fastStrategy.diversity * 0.4));
    const directQueryCount = Math.max(5, Math.min(10, Math.round(8 * strategyQueryBias)));
    const tasteQueryCount = Math.max(2, Math.min(6, Math.round(3 + fastStrategy.poolRatio.taste * 3)));
    const discoverQueryCount = Math.max(3, Math.min(7, Math.round(3 + fastStrategy.poolRatio.exploration * 6)));
    const perQueryLimit = Math.max(24, Math.min(40, Math.round(30 + fastStrategy.freshness * 6)));
    const mandatoryGeneralQueries = pickDiverseQueries([
      "k-pop playlist",
      "korean rnb",
      "korean indie",
      "soundtrack playlist",
      "korean pop",
      ...fastIntent.genres.flatMap(buildFastGenreSearchVariants),
    ], 6);
    const directQueries = pickDiverseQueries(
      [
        ...(baseQueries.length ? baseQueries : quickQueries),
        ...mandatoryGeneralQueries,
      ],
      directQueryCount,
    );
    const tasteQueries = pickDiverseQueries(tasteExpansionQueries, tasteQueryCount);
    const discoverQueries = pickDiverseQueries(
      explorationQueries.length ? explorationQueries : quickQueries.filter(q => !isFastTagQuery(q)),
      canRun(10_000) ? discoverQueryCount : canRun(7_500) ? Math.max(3, discoverQueryCount - 1) : 3,
    );

    const collector = buildOnTracksCollector(requestId);
    const guaranteedQueries = directQueries.slice(0, 4);
    const optionalQueries = directQueries.slice(4, 12);
    let rawGeneralPool = await searchSpotifyTracksByQueries({
      accessToken: input.spotifyAccessToken!,
      queries: guaranteedQueries,
      requestId,
      abortSignal: undefined,
      perQueryLimit,
      concurrency: 4,
      randomSeed: variationSeed,
      maxDurationMs: Math.min(4000, Math.max(2500, Math.min(remainingMs() - 120, hardRemainingMs() - 120))),
      onTracks: collector,
    }).catch(() => [] as SpotifyTrackSummary[]);
    const partialPoolAfterPhaseA = readPartialPool(requestId);
    if (
      optionalQueries.length &&
      (partialPoolAfterPhaseA.length > 0 || canRun(2500))
    ) {
      const phaseB = await searchSpotifyTracksByQueries({
        accessToken: input.spotifyAccessToken!,
        queries: optionalQueries,
        requestId,
        abortSignal: undefined,
        perQueryLimit,
        concurrency: 2,
        randomSeed: variationSeed + 17,
        maxDurationMs: Math.min(3000, Math.max(2200, Math.min(remainingMs() - 120, hardRemainingMs() - 120))),
        onTracks: collector,
      }).catch(() => [] as SpotifyTrackSummary[]);
      rawGeneralPool = mergeUniqueTracks(rawGeneralPool, phaseB);
    }
    const [rawTasteExpandPool, rawExplorationPool] = await Promise.all([
      tasteQueries.length
        ? searchSpotifyTracksByQueries({
            accessToken: input.spotifyAccessToken!,
            queries: tasteQueries,
            requestId,
            abortSignal: undefined,
            perQueryLimit,
            concurrency: 2,
            randomSeed: variationSeed + 41,
            maxDurationMs: Math.min(2600, Math.max(1600, hardRemainingMs() - 120)),
            onTracks: collector,
          }).catch(() => [] as SpotifyTrackSummary[])
        : Promise.resolve([] as SpotifyTrackSummary[]),
      discoverQueries.length
        ? searchSpotifyTracksByQueries({
            accessToken: input.spotifyAccessToken!,
            queries: discoverQueries.slice(0, 5),
            requestId,
            abortSignal: undefined,
            perQueryLimit,
            concurrency: 2,
            randomSeed: variationSeed + 97,
            maxDurationMs: Math.min(2600, Math.max(1600, hardRemainingMs() - 120)),
            onTracks: collector,
          }).catch(() => [] as SpotifyTrackSummary[])
        : Promise.resolve([] as SpotifyTrackSummary[]),
    ]);
    const tasteExpandPool = injectGenreHintsFromQuery(
      rawTasteExpandPool,
      tasteQueries.join(" "),
      fastIntent,
    );
    let generalPool = injectGenreHintsFromQuery(
      rawGeneralPool,
      directQueries.join(" "),
      fastIntent,
    );
    if (!generalPool.length) {
      const fallbackGeneralPool = await searchSpotifyTracksByQueries({
        accessToken: input.spotifyAccessToken!,
        queries: mandatoryGeneralQueries,
        requestId,
        abortSignal: input.abortSignal,
        perQueryLimit: 30,
        concurrency: 4,
        randomSeed: variationSeed + 31,
        maxDurationMs: Math.min(2600, Math.max(900, hardRemainingMs() - 100)),
        onTracks: event => buildOnTracksCollector(requestId)({
          query: event.query,
          tracks: event.tracks,
        }),
      }).catch(() => []);
      generalPool = injectGenreHintsFromQuery(
        fallbackGeneralPool,
        mandatoryGeneralQueries.join(" "),
        fastIntent,
      );
    }
    const bootstrapTastePool = buildTastePoolFromBootstrap();
    if (!generalPool.length) {
      generalPool = mergeUniqueTracks(bootstrapTastePool).slice(0, 40);
    }
    const seededExplorationPool = injectGenreHintsFromQuery(
      rawExplorationPool,
      discoverQueries.join(" "),
      fastIntent,
    );
    let explorationPool = seededExplorationPool.length
      ? seededExplorationPool
      : sampleTracksSeeded(generalPool, Math.min(18, Math.max(6, generalPool.length)), variationSeed + 119);
    if (!explorationPool.length) {
      explorationPool = sampleTracksSeeded(
        mergeUniqueTracks(generalPool, tasteExpandPool, bootstrapTastePool),
        12,
        variationSeed + 137,
      );
    }
    let quickPool = mergeUniqueTracks(generalPool, tasteExpandPool, explorationPool);
    bootstrapTastePool.forEach(t => {
      const k = trackDedupKey(t);
      if (k) tasteCandidateIds.add(k);
    });
    if (input.spotifyAccessToken && canRun(1100)) {
      const tasteGenreQueries = buildTasteGenreQueries();
      if (tasteGenreQueries.length) {
        const rawTasteGenrePool = await searchSpotifyTracksByQueries({
          accessToken: input.spotifyAccessToken!,
          queries: tasteGenreQueries,
          requestId,
          abortSignal: input.abortSignal,
          perQueryLimit: 5,
          concurrency: 4,
          randomSeed: variationSeed + 73,
          maxDurationMs: Math.min(1800, Math.max(900, hardRemainingMs() - 120)),
          onTracks: event => buildOnTracksCollector(requestId)({
            query: event.query,
            tracks: event.tracks,
          }),
        }).catch(() => []);
        const tasteGenrePool = injectGenreHintsFromQuery(
          rawTasteGenrePool,
          tasteGenreQueries.join(" "),
          fastIntent,
        );
        tasteGenrePool.forEach(t => {
          const k = trackDedupKey(t);
          if (k) tasteCandidateIds.add(k);
        });
        quickPool = mergeUniqueTracks(bootstrapTastePool, tasteGenrePool, quickPool);
        fastTastePool = mergeUniqueTracks(bootstrapTastePool, tasteGenrePool, tasteExpandPool);
      } else {
        quickPool = mergeUniqueTracks(bootstrapTastePool, quickPool);
        fastTastePool = mergeUniqueTracks(bootstrapTastePool, tasteExpandPool);
      }
    } else {
      quickPool = mergeUniqueTracks(bootstrapTastePool, quickPool);
      fastTastePool = mergeUniqueTracks(bootstrapTastePool, tasteExpandPool);
    }
    if (!fastTastePool.length) {
      fastTastePool = mergeUniqueTracks(bootstrapTastePool, tasteExpandPool);
    }
    if (quickPool.length < 100 && canRun(2200)) {
      const retrievalBoost = await discoverSpotifyTracksWithTimeout(
        {
          accessToken: input.spotifyAccessToken!,
          moodInput: [mandatoryGeneralQueries[0], mandatoryGeneralQueries[1], mapFastKeywordToSearchToken(fastIntent.moodKeywords[0] ?? "chill")]
            .filter(Boolean)
            .join(" "),
          bootstrap: input.spotifyBootstrap,
          limit: 120,
          includeAffinityQueries: false,
          maxSearchQueries: 4,
          fastMode: false,
        },
        Math.min(2800, Math.max(1500, hardRemainingMs() - 120)),
      ).catch(() => []);
      quickPool = mergeUniqueTracks(quickPool, retrievalBoost);
      generalPool = mergeUniqueTracks(generalPool, retrievalBoost);
      if (!explorationPool.length) {
        explorationPool = sampleTracksSeeded(generalPool, Math.min(18, generalPool.length), variationSeed + 173);
        quickPool = mergeUniqueTracks(quickPool, explorationPool);
      }
    }
    fastGeneralPool = mergeUniqueTracks(generalPool);
    if (!fastGeneralPool.length) {
      fastGeneralPool = sampleTracksSeeded(mergeUniqueTracks(quickPool, bootstrapTastePool), 24, variationSeed + 191);
    }
    fastExplorationPool = mergeUniqueTracks(explorationPool);
    if (!fastExplorationPool.length) {
      fastExplorationPool = sampleTracksSeeded(
        mergeUniqueTracks(fastGeneralPool, quickPool),
        Math.max(6, Math.round(Math.max(12, quickPool.length) * 0.2)),
        variationSeed + 223,
      );
    }
    quickPool = mergeUniqueTracks(fastTastePool, fastGeneralPool, fastExplorationPool);
    updateFastWorkingSet(fingerprint, quickPool, requestId);
    console.warn(`[FastEngine] taste candidate ids=${tasteCandidateIds.size}`);
    console.warn(
      `[FastEngine] pools taste=${mergeUniqueTracks(bootstrapTastePool, tasteExpandPool).length} exploration=${fastExplorationPool.length} general=${fastGeneralPool.length}`,
    );
    console.warn(`[FastEngine] direct query pool size=${quickPool.length}`);
    const forceCuratedPath = quickPool.length <= 20;
    if (quickPool.length > 0) {
      const forced = !forceCuratedPath ? buildForcedPartialFromPool(quickPool) : null;
      if (forced) return forced;
    }
    if (hardRemainingMs() <= 0) {
      const forced = tryBuildFastResult(quickPool, true) ?? forceReturnNow();
      if (forced) return forced;
    }
    if (discoverQueries.length && canRun(2400)) {
      if (hardRemainingMs() < 1200) {
        const forced = tryBuildFastResult(quickPool, true) ?? forceReturnNow();
        if (forced) return forced;
      }
      const queryBudget = Math.max(
        1800,
        Math.floor(maxDurationMs / Math.max(1, discoverQueries.length)),
      );
      const settled = await Promise.allSettled(
        discoverQueries.map((query, idx) =>
          discoverSpotifyTracksWithTimeout(
            {
              accessToken: input.spotifyAccessToken!,
              moodInput: query,
              bootstrap: input.spotifyBootstrap,
              limit: idx === 0 ? 82 : 56,
              includeAffinityQueries: false,
              maxSearchQueries: 2,
              fastMode: false,
            },
            idx === 0
              ? Math.min(2200, Math.max(900, Math.min(queryBudget + 300, remainingMs() - 180, hardRemainingMs() - 80)))
              : Math.min(1800, Math.max(800, Math.min(queryBudget, remainingMs() - 180, hardRemainingMs() - 80))),
          ),
        ),
      );
      quickPool = mergeUniqueTracks(
        quickPool,
        ...settled
          .filter((r): r is PromiseFulfilledResult<SpotifyTrackSummary[]> => r.status === "fulfilled")
          .map(r => r.value),
      );
      updateFastWorkingSet(fingerprint, quickPool, requestId);
      if (quickPool.length > 0) {
        const forced = buildForcedPartialFromPool(quickPool);
        if (forced) return forced;
      }
    }
    console.warn(`[FastEngine] query pool size=${quickPool.length}`);
    const earlyResult = !forceCuratedPath
      ? tryBuildFastResult(
          quickPool,
          quickPool.length >= 28 || remainingMs() < 3200,
        )
      : null;
    if (earlyResult) return earlyResult;
    if (hardRemainingMs() <= 0) {
      const forced = tryBuildFastResult(quickPool, true) ?? forceReturnNow();
      if (forced) return forced;
    }
    if (quickPool.length < 8 && canRun(2600)) {
      if (hardRemainingMs() < 1000) {
        const forced = tryBuildFastResult(quickPool, true) ?? forceReturnNow();
        if (forced) return forced;
      }
      const rescue = await discoverSpotifyTracksWithTimeout(
        {
          accessToken: input.spotifyAccessToken!,
          moodInput: effectiveMoodInput,
          bootstrap: input.spotifyBootstrap,
          limit: 90,
          includeAffinityQueries: false,
          maxSearchQueries: 4,
          fastMode: false,
        },
        Math.min(6000, Math.max(2200, Math.min(remainingMs() - 180, 6000))),
      ).catch(() => []);
      quickPool = mergeUniqueTracks(quickPool, rescue);
      updateFastWorkingSet(fingerprint, quickPool, requestId);
      console.warn(`[FastEngine] rescue pool merged size=${quickPool.length}`);
      if (quickPool.length > 0) {
        const forced = buildForcedPartialFromPool(quickPool);
        if (forced) return forced;
      }
      const rescueEarly = tryBuildFastResult(quickPool, true);
      if (rescueEarly) return rescueEarly;
      if (hardRemainingMs() <= 0) {
        const forced = tryBuildFastResult(quickPool, true) ?? forceReturnNow();
        if (forced) return forced;
      }
    }
    if (quickPool.length === 0 && input.spotifyAccessToken && canRun(2400)) {
      const genreOnlyQueries = Array.from(
        new Set(
          fastIntent.genres
            .flatMap(buildFastGenreSearchVariants)
            .filter(Boolean),
        ),
      ).slice(0, 6);
      const rawDirectGenre = await searchSpotifyTracksByQueries({
        accessToken: input.spotifyAccessToken,
        queries: genreOnlyQueries,
        requestId,
        abortSignal: input.abortSignal,
        perQueryLimit: 12,
        concurrency: 8,
        randomSeed: variationSeed + 17,
        maxDurationMs: Math.min(5200, Math.max(2200, remainingMs() - 120)),
        onTracks: event => buildOnTracksCollector(requestId)({
          query: event.query,
          tracks: event.tracks,
        }),
      }).catch(() => []);
      const directGenre = injectGenreHintsFromQuery(
        rawDirectGenre,
        genreOnlyQueries.join(" "),
        fastIntent,
      );
      assertNotCancelled(requestId, input.abortSignal, "fast_search_genre_only_end");
      quickPool = mergeUniqueTracks(quickPool, directGenre);
      updateFastWorkingSet(fingerprint, quickPool, requestId);
      console.warn(`[FastEngine] genre-only direct size=${quickPool.length}`);
    }
    if (quickPool.length < 8 && input.spotifyAccessToken && canRun(3000)) {
      const broadQuery = [
        ...(fastIntent.genres.length ? fastIntent.genres : ["k-pop"]),
        ...(fastIntent.moodKeywords.slice(0, 1).map(mapFastKeywordToSearchToken)),
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || input.moodInput;
      const broad = await discoverSpotifyTracksWithTimeout(
        {
          accessToken: input.spotifyAccessToken,
          moodInput: broadQuery,
          bootstrap: input.spotifyBootstrap,
          limit: 95,
          includeAffinityQueries: false,
          maxSearchQueries: 4,
          fastMode: false,
        },
        Math.min(8000, Math.max(2600, Math.min(remainingMs() - 180, 8000))),
      ).catch(() => []);
      quickPool = mergeUniqueTracks(
        quickPool,
        injectGenreHintsFromQuery(broad, broadQuery, fastIntent),
      );
      updateFastWorkingSet(fingerprint, quickPool, requestId);
      console.warn(`[FastEngine] broad pool merged size=${quickPool.length}`);
    }
    if (quickPool.length < 8 && input.spotifyAccessToken && canRun(3200)) {
      const strictKoreanQuery = [
        ...fastIntent.genres.slice(0, 2),
        ...fastIntent.moodKeywords.slice(0, 1),
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || effectiveMoodInput;
      const retryBroad = await discoverSpotifyTracksWithTimeout(
        {
          accessToken: input.spotifyAccessToken,
          moodInput: strictKoreanQuery,
          bootstrap: input.spotifyBootstrap,
          limit: 100,
          includeAffinityQueries: false,
          maxSearchQueries: 4,
          fastMode: false,
        },
        Math.min(9000, Math.max(2800, Math.min(remainingMs() - 180, 9000))),
      ).catch(() => []);
      quickPool = mergeUniqueTracks(
        quickPool,
        injectGenreHintsFromQuery(retryBroad, strictKoreanQuery, fastIntent),
      );
      updateFastWorkingSet(fingerprint, quickPool, requestId);
      console.warn(`[FastEngine] strict broad retry size=${quickPool.length}`);
    }
    if (quickPool.length >= 8) {
      const strictResult = tryBuildFastResult(quickPool, false);
      if (strictResult) return strictResult;
      const targetCount = deriveTargetTrackCount({
        parsedTargetCount: parsed.targetCount,
        targetMinutes,
        timeMode: timeConstraint?.mode,
        averageDurationMs: estimateAverageTrackDurationMs([
          quickPool,
          input.spotifyBootstrap?.topTracks ?? [],
          input.spotifyBootstrap?.recentlyPlayed ?? [],
        ]),
        maxCount: 60,
      });
      const selected = selectTracksFast({
        tracks: quickPool,
        intent: fastIntent,
        strategy: fastStrategy,
        targetCount,
        targetMinutes,
        timeConstraint,
        userTopTrackIds,
        userTopArtistIds,
        userTopArtistNames,
        recentAvoidTrackIds: new Set([
          ...recentAvoidProfile.trackIds,
          ...globalReuseGuard.trackIds,
        ]),
        recentAvoidArtistKeys: new Set([
          ...recentAvoidProfile.artistKeys,
          ...globalReuseGuard.artistKeys,
        ]),
        tasteProfile,
        tasteCandidateIds,
        tasteQuota: Math.max(0.4, fastStrategy.poolRatio.taste),
        variationSeed,
        explorationRatio: fastStrategy.poolRatio.exploration,
      });
      let finalSelected = selected.filter(t => !recentTrackIds.has(String(t.id ?? "").trim()));
      if (finalSelected.length < Math.max(6, Math.round(targetCount * 0.5))) {
        const refill = quickPool.filter(
          t =>
            !recentTrackIds.has(String(t.id ?? "").trim()) &&
            !finalSelected.some(p => String(p.id ?? "") === String(t.id ?? "")),
        );
        finalSelected = [...finalSelected, ...refill].slice(0, Math.max(10, targetCount));
      }
      if (finalSelected.length >= Math.max(8, Math.round(targetCount * 0.6))) {
        finalSelected = applyFinalValidationLayer({
          tracks: finalSelected,
          intent: fastIntent,
          strategy: fastStrategy,
          targetCount,
          tasteProfile,
          userTopTrackIds,
          userTopArtistIds,
          userTopArtistNames,
          explorationCandidateIds: new Set(
            fastExplorationPool
              .map(t => trackDedupKey(t))
              .filter((v): v is string => Boolean(v)),
          ),
          maxPerArtist: 2,
        });
      }
      if (finalSelected.length >= Math.max(8, Math.round(targetCount * 0.6))) {
        const genreCoverage = computeFastGenreCoverage(finalSelected, fastIntent.genres);
        const quality = assessPlaylistQuality({
          tracks: finalSelected,
          moodInput: effectiveMoodInput,
          parsed,
          targetMinutes,
          intentShift: recentAvoidProfile.intentShift,
        });
        const userTasteAffinity = computeFastUserTasteAffinity({
          tracks: finalSelected,
          userTopTrackIds,
          userTopArtistIds,
          userTopArtistNames,
        });
        const effectiveIntentCoverage = computeFastIntentCoverageProxy({
          qualityIntentCoverage: quality.intentCoverage,
          genreCoverage,
          fastIntent,
          tracks: finalSelected,
          userTasteAffinity,
        });
        const minIntentCoverage = fastQualityGate.intentMin;
        const durationOk = !targetMinutes || quality.durationCoverage >= fastQualityGate.durationMin;
        const genreOk = fastIntent.genres.length ? genreCoverage >= fastQualityGate.genreMin : true;
        if (effectiveIntentCoverage < minIntentCoverage || !durationOk || !genreOk) {
          console.warn(
            `[FastEngine] quality gate blocked fast return: intent=${quality.intentCoverage.toFixed(2)} effectiveIntent=${effectiveIntentCoverage.toFixed(2)} duration=${quality.durationCoverage.toFixed(2)} genre=${genreCoverage.toFixed(2)}`,
          );
        } else {
    pushRecommendationSnapshot(fingerprint, effectiveMoodInput, finalSelected);
    clearFastWorkingSet(fingerprint, requestId);
    return withSpotifyAccessIssue({
          status: "success",
          tracks: finalSelected.map(toTrack),
          playlistName: buildAutoPlaylistNameFromTracks(finalSelected, effectiveMoodInput),
          reasoning:
            parsed.reasoning ||
            parsed.moodSummary ||
            "프롬프트 핵심 키워드를 빠르게 분석해 Spotify에서 우선 추천했어요.",
          meta: { requestId, reason: "fast_quality_gate_success" },
        });
        }
      }
      if (finalSelected.length >= 6) {
        const genreCoverage = computeFastGenreCoverage(finalSelected, fastIntent.genres);
        const quality = assessPlaylistQuality({
          tracks: finalSelected,
          moodInput: effectiveMoodInput,
          parsed,
          targetMinutes,
          intentShift: recentAvoidProfile.intentShift,
        });
        const userTasteAffinity = computeFastUserTasteAffinity({
          tracks: finalSelected,
          userTopTrackIds,
          userTopArtistIds,
          userTopArtistNames,
        });
        const effectiveIntentCoverage = computeFastIntentCoverageProxy({
          qualityIntentCoverage: quality.intentCoverage,
          genreCoverage,
          fastIntent,
          tracks: finalSelected,
          userTasteAffinity,
        });
        const genreOk = fastIntent.genres.length
          ? genreCoverage >= fastQualityGate.fallbackGenreMin
          : true;
        if (effectiveIntentCoverage < fastQualityGate.fallbackIntentMin || !genreOk) {
          console.warn(
            `[FastEngine] low coverage fallback blocked: intent=${quality.intentCoverage.toFixed(2)} effectiveIntent=${effectiveIntentCoverage.toFixed(2)} genre=${genreCoverage.toFixed(2)}`,
          );
        } else {
        pushRecommendationSnapshot(fingerprint, effectiveMoodInput, finalSelected);
        return withSpotifyAccessIssue({
          status: "partial",
          tracks: finalSelected.map(toTrack),
          playlistName: buildAutoPlaylistNameFromTracks(finalSelected, effectiveMoodInput),
          reasoning: "프롬프트 핵심 기반 빠른 검색 결과를 우선 추천했어요.",
          meta: { requestId, reason: "fast_low_coverage_partial" },
        });
        }
      }
    }
  }

  if (!canRun(2800)) {
    const partial = forceReturnNow();
    if (partial?.tracks?.length) return partial;
    throw new Error("[FastEngine] budget exhausted before prompt-first fallback");
  }
  if (hardRemainingMs() <= 0) {
    const partial = forceReturnNow();
    if (partial?.tracks?.length) return partial;
  }
  const promptFirst = await tryPromptFirstRecommendation({
    input,
    effectiveMoodInput,
    timeConstraint,
    targetMinutes,
    searchPlan,
    parsed,
    fingerprint,
    currentIntent,
    recentAvoidProfile,
    globalReuseGuard,
    maxDurationMs: Math.max(3000, remainingMs()),
  });
  if (promptFirst) {
    clearFastWorkingSet(fingerprint, requestId);
    return promptFirst;
  }
  const partial = forceReturnNow();
  if (partial?.tracks?.length) return partial;
  throw new Error("[Gemini] prompt-first fast recommendation unavailable");
  })();
  const guardedTimeoutMs = Math.max(20_000, Math.min(65_000, maxDurationMs + 25_000));
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutGuard = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`[FastEngine] fast analysis timeout (${guardedTimeoutMs}ms)`));
    }, guardedTimeoutMs);
  });
  void request.catch(() => undefined);
  const guardedRequest = Promise.race([request, timeoutGuard]);
  fastPlaylistInFlight.set(singleFlightKey, guardedRequest);
  try {
    const out = await guardedRequest;
    return finalizePipelineResult(requestId, out);
  } catch (err) {
    const msg = safeErrorMessage(err);
    if (/fast analysis timeout/i.test(msg)) {
      console.warn(
        `[FastEngine] timeout guard hit requestId=${requestId || "-"} mode=analyze_timeout action=no_fallback_override`,
      );
      if (requestId) fastTimeoutBlockedRequestIds.add(requestId);
      console.warn("[BLOCKED] full pipeline re-entry disabled");
      assertNotCancelled(requestId, abortSignal, "fast_timeout_guarded");
      console.warn("[TimeoutCatch] before fallback");

      // Round 1: read immediately
      let partialPool = mergeUniqueTracks(
        readPartialPool(requestId),
        candidateCacheByRequestId.get(requestId) ?? [],
      );

      // Round 2: poll every 1 second for up to 12 seconds.
      // The fire-and-forget dispatchQueries is still running in the background,
      // so onTracks callbacks will keep filling partialSearchResultsByRequestId.
      if (partialPool.length < 10) {
        for (let _poll = 0; _poll < 12; _poll++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          partialPool = mergeUniqueTracks(
            readPartialPool(requestId),
            candidateCacheByRequestId.get(requestId) ?? [],
          );
          console.warn(
            `[TimeoutCatch] poll=${_poll + 1} poolSize=${partialPool.length}`,
          );
          if (partialPool.length >= 10) break;
        }
      }

      // Round 3: fall back to querySearchCache if still empty
      if (!partialPool.length) {
        const _base = buildBasePromptFeatures(input.moodInput);
        const _intent = buildStructuredIntent(input.moodInput, _base);
        const _qPlan = buildQueryStrategy(_intent);
        const _fromCache = _qPlan.finalQueries
          .slice(0, 8)
          .flatMap(q => querySearchCache.get(normalizeQueryKey(q)) ?? []);
        if (_fromCache.length) {
          partialPool = mergeUniqueTracks(_fromCache);
          console.warn(
            `[TimeoutCatch] recovered from querySearchCache size=${partialPool.length}`,
          );
        }
        if (!partialPool.length && input.spotifyAccessToken) {
          const liveSalvageQueries = _qPlan.finalQueries.slice(0, 4);
          if (liveSalvageQueries.length) {
            try {
              console.warn(
                `[TimeoutCatch] live salvage start count=${liveSalvageQueries.length}`,
              );
              const liveSalvagePromise = searchSpotifyTracksByQueries({
                accessToken: input.spotifyAccessToken,
                queries: liveSalvageQueries,
                perQueryLimit: 12,
                concurrency: 2,
                maxDurationMs: 9000,
                requestId,
                abortSignal: undefined,
                onTracks: event => buildOnTracksCollector(requestId)({
                  requestId,
                  query: event.query,
                  tracks: event.tracks,
                }),
              });
              const liveSalvageTimeout = new Promise<SpotifyTrackSummary[]>(resolve => {
                setTimeout(() => resolve([]), 10000);
              });
              const liveTracks = await Promise.race([
                liveSalvagePromise,
                liveSalvageTimeout,
              ]);
              if (liveTracks.length) {
                partialPool = mergeUniqueTracks(
                  partialPool,
                  liveTracks,
                  readPartialPool(requestId),
                  candidateCacheByRequestId.get(requestId) ?? [],
                );
                console.warn(
                  `[TimeoutCatch] live salvage recovered size=${partialPool.length}`,
                );
              } else {
                console.warn("[TimeoutCatch] live salvage timeout_or_empty");
              }
            } catch (liveErr) {
              console.warn(`[TimeoutCatch] live salvage failed: ${safeErrorMessage(liveErr)}`);
            }
          }
        }
      }
      console.warn("[PartialPool] requestId=", requestId, "size=", partialPool.length);
      const fallbackTracks =
        partialPool.length > 0
          ? buildPartialResultFromSpotifyPool({
              pool: partialPool,
              prompt: input.moodInput,
              spotifyBootstrap: null,
              requestId,
              targetMinutes: extractTimeConstraint(input.moodInput)?.minutes ?? 60,
            })
          : buildImmediateFallbackTracksSync({
              prompt: input.moodInput,
              requestId,
              spotifyBootstrap: input.spotifyBootstrap,
            });
      console.warn("[TimeoutCatch] after fallback");
      console.warn("[TimeoutCatch] fallback tracks:", fallbackTracks.length);
      const timeoutResult: PersonalizedPlaylistOutput = {
        status: fallbackTracks.length ? "partial" : "failed",
        tracks: fallbackTracks,
        playlistName: buildFallbackPlaylistName(input.moodInput),
        reasoning:
          partialPool.length > 0
            ? "timeout → partial Spotify results salvaged"
            : "timeout → bootstrap fallback used",
        fallbackReason: "gemini_error",
        meta: {
          requestId,
          reason:
            partialPool.length > 0
              ? "fast_timeout_partial_spotify_pool"
              : "fast_timeout_bootstrap_fallback",
        },
      };
      return finalizePipelineResult(requestId, timeoutResult);
    }
    if (isCancelledRecommendationError(err)) {
      console.warn(`[Playlist] pipeline aborted requestId=${requestId || "-"} source=fast`);
    }
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    fastPlaylistInFlight.delete(singleFlightKey);
  }
}

export async function analyzeMoodAndRecommend(
  input: PersonalizedPlaylistInput,
): Promise<PersonalizedPlaylistOutput> {
  const requestId = String(input.requestId ?? "").trim();
  if (hasFinishedRequest(requestId)) {
    console.warn("[Pipeline] duplicate invocation skipped", requestId);
    const skipped: PersonalizedPlaylistOutput = {
      status: "failed",
      tracks: [],
      playlistName: "",
      meta: { requestId, reason: "duplicate_invocation_skipped" },
    };
    logPipelineResult(skipped);
    return skipped;
  }
  if (requestId && fastTimeoutBlockedRequestIds.has(requestId)) {
    fastTimeoutBlockedRequestIds.delete(requestId);
    console.warn("[BLOCKED] full pipeline re-entry disabled");
    console.warn("[TimeoutCatch] before fallback");
    const fallbackTracks = buildImmediateFallbackTracksSync({
      prompt: input.moodInput,
      requestId,
      spotifyBootstrap: input.spotifyBootstrap,
    });
    console.warn("[TimeoutCatch] after fallback");
    console.warn("[TimeoutCatch] fallback tracks:", fallbackTracks.length);
    const blockedResult: PersonalizedPlaylistOutput = {
      status: fallbackTracks.length ? "partial" : "failed",
      tracks: fallbackTracks,
      playlistName: buildFallbackPlaylistName(input.moodInput),
      reasoning: "timeout → immediate fallback",
      fallbackReason: fallbackTracks.length ? undefined : "gemini_error",
      meta: {
        requestId,
        reason: fallbackTracks.length
          ? "blocked_reentry"
          : "blocked_reentry_empty",
      },
    };
    return finalizePipelineResult(requestId, blockedResult);
  }
  console.warn(`[Playlist] full pipeline start requestId=${requestId || "-"}`);
  assertNotCancelled(requestId, input.abortSignal, "full_pipeline_start");
  if (input.spotifyAccessToken) {
    try {
      await validateSpotifyUserToken(input.spotifyAccessToken, "primary_pipeline");
      assertNotCancelled(requestId, input.abortSignal, "full_after_me_probe");
    } catch (err) {
      if (isCancelledRecommendationError(err)) throw err;
      const code = classifySpotifyValidationIssue(err);
      const issueText = spotifyIssueReasonText(code);
      console.warn(
        `[Spotify] primary pipeline stopped: /me validation failed code=${code} msg=${safeErrorMessage(err)}`,
      );
      const fallbackTracks = pickFallbackTracks(input.spotifyBootstrap, 20).map(toTrack);
      const spotifyIssueResult: PersonalizedPlaylistOutput = {
        status: fallbackTracks.length ? "partial" : "failed",
        tracks: fallbackTracks,
        playlistName: buildFallbackPlaylistName(input.moodInput),
        reasoning: issueText || "Spotify 인증 또는 권한 확인이 필요해요.",
        fallbackReason: code,
        meta: { requestId, reason: "spotify_access_validation_failed" },
      };
      return finalizePipelineResult(requestId, spotifyIssueResult);
    }
  }
  const pipelineStartedAt = Date.now();
  const remainingPipelineMs = () =>
    PLAYLIST_PIPELINE_BUDGET_MS - (Date.now() - pipelineStartedAt);
  const canSpendPipelineMs = (needMs: number) => remainingPipelineMs() >= needMs;
  const getBudgetedDuration = (
    preferredMs: number,
    minMs: number,
    maxMs: number,
    reserveMs: number,
  ): number | null => {
    const remaining = remainingPipelineMs() - reserveMs;
    if (remaining < minMs) return null;
    return clamp(Math.min(preferredMs, remaining), minMs, maxMs);
  };

  const searchPlan = extractPromptSearchPlan(input.moodInput);
  const effectiveMoodInput = searchPlan.brief;
  const timeConstraint = searchPlan.timeConstraint;
  const targetMinutes = timeConstraint?.minutes ?? null;
  const fingerprint = promptFingerprint(effectiveMoodInput);
  const currentIntent = buildUserIntentProfile(effectiveMoodInput);
  const recentAvoidProfile = buildRecentAvoidProfile({
    currentFingerprint: fingerprint,
    currentIntent,
  });
  const globalReuseGuard = buildGlobalReuseGuard(fingerprint);
  if (effectiveMoodInput && effectiveMoodInput !== String(input.moodInput ?? "").trim()) {
    console.warn(
      `[Gemini] prompt search-plan extracted: ${effectiveMoodInput}`,
    );
  }

  try {
    assertNotCancelled(requestId, input.abortSignal, "full_before_model");
    const prompt = buildPrompt({
      ...input,
      moodInput: effectiveMoodInput,
    });
    let parsed: GeminiPlaylistJson;
    let usedLocalPlan = false;
    try {
      parsed = await callGeminiWithTimeout(
        prompt,
        GEMINI_MODEL_TIMEOUT_MS,
        input.spotifyAccessToken,
      );
    } catch (modelErr) {
      const msg = String((modelErr as Error)?.message ?? modelErr);
      const canFallbackToLocal =
        msg.includes("Missing EXPO_PUBLIC_GEMINI_PROXY_URL") ||
        msg.includes("Missing Gemini proxy URL env") ||
        msg.includes("[GeminiProxy]") ||
        msg.includes("invalid response shape");
      if (!canFallbackToLocal) throw modelErr;
      parsed = buildLocalParsedPlan({
        moodInput: effectiveMoodInput,
        timeConstraint,
        bootstrap: input.spotifyBootstrap,
      });
      usedLocalPlan = true;
      console.warn(`[Gemini] model unavailable, using local prompt plan: ${msg}`);
    }
    const tasteSeedProfile = buildTasteSeedProfile({
      bootstrap: input.spotifyBootstrap,
      moodInput: effectiveMoodInput,
      parsed,
    });
    const fallbackBase = pickFallbackTracks(input.spotifyBootstrap, 12);
    let fallback = fallbackBase;
    let catalogPool: SpotifyTrackSummary[] = [];
    if (input.spotifyAccessToken && canSpendPipelineMs(3500)) {
      const quickPathTimeout = Math.max(
        3500,
        Math.min(PROMPT_FIRST_TIMEOUT_MS, Math.max(4500, remainingPipelineMs() - 20000)),
      );
      try {
        const promptFirst = await tryPromptFirstRecommendation({
          input,
          effectiveMoodInput,
          timeConstraint,
          targetMinutes,
          searchPlan,
          parsed,
          fingerprint,
          currentIntent,
          recentAvoidProfile,
          globalReuseGuard,
          maxDurationMs: quickPathTimeout,
        });
        if (promptFirst) {
          assertNotCancelled(requestId, input.abortSignal, "full_after_prompt_first");
          return promptFirst;
        }
      } catch (quickErr) {
        console.warn(`[Spotify] prompt-first quick path failed: ${safeErrorMessage(quickErr)}`);
      }
    }
    if (input.spotifyAccessToken) {
      try {
        const catalogBudgetMs = getBudgetedDuration(22000, 9000, 32000, 15000);
        if (!catalogBudgetMs) {
          throw new Error("pipeline_budget_exhausted_before_catalog_discovery");
        }
        const queryInputs = buildCatalogSearchInputs({
          moodInput: effectiveMoodInput,
          parsed,
          intentShift: recentAvoidProfile.intentShift,
          searchPlan,
        });
        const mergedInputs = Array.from(
          new Set([
            ...queryInputs,
            ...(queryInputs.length < 3 ? tasteSeedProfile.queryHints : tasteSeedProfile.queryHints.slice(0, 1)),
          ]),
        ).slice(0, 6);
        catalogPool = await discoverCatalogPoolFromQueries({
          accessToken: input.spotifyAccessToken!,
          bootstrap: input.spotifyBootstrap,
          queries: mergedInputs,
          seedTrackIds: tasteSeedProfile.seedTrackIds,
          seedArtistIds: tasteSeedProfile.seedArtistIds,
          primaryLimit: 95,
          secondaryLimit: 58,
          primaryTimeoutMs: SPOTIFY_CATALOG_TIMEOUT_PRIMARY_MS,
          secondaryTimeoutMs: SPOTIFY_CATALOG_TIMEOUT_SECONDARY_MS,
          maxQueries: recentAvoidProfile.intentShift >= 0.55 ? 3 : 3,
          stopAt: 70,
          maxDurationMs: catalogBudgetMs,
          discoverMaxSearchQueriesPrimary: 2,
          discoverMaxSearchQueriesSecondary: 1,
        });
        if (catalogPool.length < 12 && input.spotifyAccessToken && currentIntent.specificity >= 7) {
          const strictSeedQueries = buildStrictIntentQueries({
            moodInput: effectiveMoodInput,
            parsed,
          }).slice(0, 2);
          if (strictSeedQueries.length) {
            const quickPool = await discoverCatalogPoolFromQueries({
              accessToken: input.spotifyAccessToken,
              bootstrap: input.spotifyBootstrap,
              queries: strictSeedQueries,
              seedTrackIds: [],
              seedArtistIds: [],
              primaryLimit: 58,
              secondaryLimit: 42,
              primaryTimeoutMs: Math.min(9000, SPOTIFY_CATALOG_TIMEOUT_PRIMARY_MS),
              secondaryTimeoutMs: Math.min(7500, SPOTIFY_CATALOG_TIMEOUT_SECONDARY_MS),
              maxQueries: 2,
              stopAt: 32,
              maxDurationMs: 10000,
              discoverMaxSearchQueriesPrimary: 1,
              discoverMaxSearchQueriesSecondary: 1,
            });
            if (quickPool.length) catalogPool = mergeUniqueTracks(catalogPool, quickPool);
          }
        }
      } catch (err) {
        console.warn(
          `[Spotify] catalog discovery fallback: ${safeErrorMessage(err)}`,
        );
      }
    }
    let localPicks = localPersonalizedPick(
      input.spotifyBootstrap,
      parsed.mixStrategy,
      parsed.targetCount,
      targetMinutes,
      {
        avoidTrackIds: new Set([
          ...recentAvoidProfile.trackIds,
          ...globalReuseGuard.trackIds,
        ]),
        avoidArtistKeys: new Set([
          ...recentAvoidProfile.artistKeys,
          ...globalReuseGuard.artistKeys,
        ]),
      },
    );
    if (
      recentAvoidProfile.intentShift >= 0.55 ||
      parsed.noveltyLevel === "adventurous" ||
      parsed.mixStrategy === "discovery"
    ) {
      const keepRatio = recentAvoidProfile.intentShift >= 0.75 ? 0.2 : 0.4;
      localPicks = localPicks.slice(
        0,
        Math.max(2, Math.round(localPicks.length * keepRatio)),
      );
      fallback = fallback.slice(0, Math.max(3, Math.round(fallback.length * 0.4)));
    }
    if (catalogPool.length >= 80) {
      localPicks = localPicks.slice(0, Math.max(2, Math.round(localPicks.length * 0.25)));
      fallback = fallback.slice(0, Math.max(2, Math.round(fallback.length * 0.2)));
    } else if (catalogPool.length >= 45) {
      localPicks = localPicks.slice(0, Math.max(3, Math.round(localPicks.length * 0.4)));
      fallback = fallback.slice(0, Math.max(3, Math.round(fallback.length * 0.3)));
    } else if (catalogPool.length >= 14 && currentIntent.specificity >= 7) {
      localPicks = localPicks.slice(0, Math.max(2, Math.round(localPicks.length * 0.3)));
      fallback = fallback.slice(0, Math.max(2, Math.round(fallback.length * 0.25)));
    } else if (currentIntent.specificity >= 8) {
      localPicks = localPicks.slice(0, Math.max(1, Math.round(localPicks.length * 0.15)));
      fallback = fallback.slice(0, Math.max(1, Math.round(fallback.length * 0.15)));
    }
    const avgDurationMs = estimateAverageTrackDurationMs([
      catalogPool,
      localPicks,
      fallback,
      input.spotifyBootstrap?.topTracks ?? [],
      input.spotifyBootstrap?.recentlyPlayed ?? [],
    ]);
    const targetCount = deriveTargetTrackCount({
      parsedTargetCount: parsed.targetCount,
      targetMinutes,
      timeMode: timeConstraint?.mode,
      averageDurationMs: avgDurationMs,
      maxCount: 60,
    });
    let finalSummaries = chooseCuratedTracks({
      catalogPool,
      localPicks,
      fallback,
      bootstrap: input.spotifyBootstrap,
      moodInput: effectiveMoodInput,
      parsed,
      targetCount,
      targetMinutes,
      timeConstraint,
      recentAvoidTrackIds: recentAvoidProfile.trackIds,
      recentAvoidArtistKeys: recentAvoidProfile.artistKeys,
      hardAvoidTrackIds: globalReuseGuard.trackIds,
      hardAvoidArtistKeys: globalReuseGuard.artistKeys,
      intentShift: recentAvoidProfile.intentShift,
    });
    if (targetMinutes && targetMinutes > 0) {
      let durationCoverage = sumDurationMs(finalSummaries) / (targetMinutes * 60 * 1000);
      if (
        durationCoverage < 0.9 &&
        catalogPool.length >= 10 &&
        input.spotifyAccessToken &&
        finalSummaries.length < Math.max(12, Math.round(targetMinutes / 6)) &&
        canSpendPipelineMs(14_000)
      ) {
        const rescueQueries = buildDurationRescueQueries({
          moodInput: effectiveMoodInput,
          parsed,
          bootstrap: input.spotifyBootstrap,
        });
        const rescueQueryCap = canSpendPipelineMs(26_000) ? 4 : 2;
        const rescueTimeoutPrimary = getBudgetedDuration(
          SPOTIFY_CATALOG_TIMEOUT_RESCUE_MS,
          8000,
          22000,
          9000,
        );
        const rescueTimeoutSecondary = getBudgetedDuration(
          Math.max(9000, SPOTIFY_CATALOG_TIMEOUT_RESCUE_MS - 2500),
          7000,
          18000,
          7000,
        );
        if (!rescueTimeoutPrimary || !rescueTimeoutSecondary) {
          console.warn("[Spotify] skip duration rescue due to remaining pipeline budget.");
        } else {
          const settled = await Promise.allSettled(
            rescueQueries.slice(0, rescueQueryCap).map((query, idx) =>
              discoverSpotifyTracksWithTimeout(
                {
                  accessToken: input.spotifyAccessToken!,
                  moodInput: query,
                  bootstrap: input.spotifyBootstrap,
                  limit: idx === 0 ? 120 : 85,
                  includeAffinityQueries: false,
                  maxSearchQueries: 3,
                },
                idx === 0 ? rescueTimeoutPrimary : rescueTimeoutSecondary,
              ),
            ),
          );
        const rescuePool = mergeUniqueTracks(
          ...settled
            .filter((r): r is PromiseFulfilledResult<SpotifyTrackSummary[]> => r.status === "fulfilled")
            .map(r => r.value),
        );
        if (rescuePool.length) {
          catalogPool = mergeUniqueTracks(catalogPool, rescuePool);
          const avgDurationMsRescue = estimateAverageTrackDurationMs([
            catalogPool,
            localPicks,
            fallback,
          ]);
          const rescueTargetCount = deriveTargetTrackCount({
            parsedTargetCount: Math.max(targetCount, parsed.targetCount ?? 0),
            targetMinutes,
            timeMode: timeConstraint?.mode,
            averageDurationMs: avgDurationMsRescue,
            maxCount: 80,
          });
          const retriedDuration = chooseCuratedTracks({
            catalogPool,
            localPicks: localPicks.slice(0, Math.max(2, Math.round(localPicks.length * 0.25))),
            fallback: fallback.slice(0, Math.max(2, Math.round(fallback.length * 0.2))),
            bootstrap: input.spotifyBootstrap,
            moodInput: effectiveMoodInput,
            parsed,
            targetCount: rescueTargetCount,
            targetMinutes,
            timeConstraint,
            recentAvoidTrackIds: new Set([
              ...recentAvoidProfile.trackIds,
              ...finalSummaries.map(t => String(t?.id ?? "").trim()),
            ]),
            recentAvoidArtistKeys: new Set([
              ...recentAvoidProfile.artistKeys,
              ...finalSummaries.flatMap(t => trackArtistKeys(t)),
            ]),
            hardAvoidTrackIds: globalReuseGuard.trackIds,
            hardAvoidArtistKeys: globalReuseGuard.artistKeys,
            intentShift: Math.min(0.95, recentAvoidProfile.intentShift + 0.25),
          });
          const retriedCoverage =
            sumDurationMs(retriedDuration) / (targetMinutes * 60 * 1000);
          if (retriedCoverage > durationCoverage || retriedDuration.length > finalSummaries.length) {
            finalSummaries = retriedDuration;
            durationCoverage = retriedCoverage;
          }
        }
        }
      }
    }
    finalSummaries = enforceMinimumDuration({
      selected: finalSummaries,
      targetMinutes,
      timeConstraint,
      candidatePool: mergeUniqueTracks(
        catalogPool,
        localPicks,
        fallback,
        buildEmergencyTrackPool({
          catalogPool,
          localPicks,
          fallback,
          bootstrap: input.spotifyBootstrap,
        }),
      ),
      minCoverage: timeConstraint?.mode === "at_least" ? 0.98 : 0.93,
      maxCount: 90,
    });
    const quality = assessPlaylistQuality({
      tracks: finalSummaries,
      moodInput: effectiveMoodInput,
      parsed,
      targetMinutes,
      intentShift: recentAvoidProfile.intentShift,
    });
    if (!quality.isAcceptable) {
      const hardPromptMode = quality.intentCoverage < 0.5;
      if (
        input.spotifyAccessToken &&
        quality.intentCoverage < 0.55 &&
        canSpendPipelineMs(11_000)
      ) {
        try {
          const strictQueries = buildStrictIntentQueries({
            moodInput: effectiveMoodInput,
            parsed,
          });
          if (strictQueries.length) {
            const strictBudgetMs = getBudgetedDuration(18000, 8000, 26000, 9000);
            if (strictBudgetMs) {
              const strictPool = await discoverCatalogPoolFromQueries({
                accessToken: input.spotifyAccessToken,
                bootstrap: input.spotifyBootstrap,
                queries: strictQueries,
                seedTrackIds: [],
                seedArtistIds: [],
                primaryLimit: 88,
                secondaryLimit: 54,
                primaryTimeoutMs: Math.min(30000, SPOTIFY_CATALOG_TIMEOUT_PRIMARY_MS + 5000),
                secondaryTimeoutMs: Math.min(25000, SPOTIFY_CATALOG_TIMEOUT_SECONDARY_MS + 3500),
                maxQueries: 2,
                stopAt: 60,
                maxDurationMs: strictBudgetMs,
                discoverMaxSearchQueriesPrimary: 2,
                discoverMaxSearchQueriesSecondary: 1,
              });
              if (strictPool.length) {
                catalogPool = mergeUniqueTracks(catalogPool, strictPool);
              }
            } else {
              const quickStrict = await discoverSpotifyTracksWithTimeout(
                {
                  accessToken: input.spotifyAccessToken,
                  moodInput: strictQueries[0],
                  bootstrap: input.spotifyBootstrap,
                  limit: 48,
                  includeAffinityQueries: false,
                  maxSearchQueries: 1,
                },
                Math.min(7000, SPOTIFY_CATALOG_TIMEOUT_SECONDARY_MS),
              );
              if (quickStrict.length) {
                catalogPool = mergeUniqueTracks(catalogPool, quickStrict);
              }
            }
          }
        } catch (strictErr) {
          console.warn(`[Spotify] strict intent rescue failed: ${safeErrorMessage(strictErr)}`);
        }
      }
      const extraHardAvoidTracks = new Set([
        ...globalReuseGuard.trackIds,
        ...finalSummaries.map(t => String(t?.id ?? "").trim()).filter(Boolean),
      ]);
      const extraHardAvoidArtists = new Set([
        ...globalReuseGuard.artistKeys,
        ...finalSummaries.flatMap(t => trackArtistKeys(t)),
      ]);
      const stricterTarget = targetMinutes
        ? Math.max(targetCount, deriveTargetTrackCount({
            parsedTargetCount: targetCount,
            targetMinutes,
            timeMode: timeConstraint?.mode,
            averageDurationMs: estimateAverageTrackDurationMs([catalogPool, localPicks, fallback]),
            maxCount: 70,
          }))
        : targetCount;
      const retried = chooseCuratedTracks({
        catalogPool,
        localPicks: hardPromptMode
          ? []
          : localPicks.slice(0, Math.max(2, Math.round(localPicks.length * 0.25))),
        fallback: hardPromptMode
          ? []
          : fallback.slice(0, Math.max(2, Math.round(fallback.length * 0.25))),
        bootstrap: input.spotifyBootstrap,
        moodInput: effectiveMoodInput,
        parsed: {
          ...parsed,
          mixStrategy: parsed.mixStrategy === "familiar" ? "balanced" : parsed.mixStrategy,
          noveltyLevel:
            parsed.noveltyLevel === "safe" ? "balanced" : (parsed.noveltyLevel ?? "balanced"),
        },
        targetCount: stricterTarget,
        targetMinutes,
        timeConstraint,
        recentAvoidTrackIds: new Set([...recentAvoidProfile.trackIds, ...extraHardAvoidTracks]),
        recentAvoidArtistKeys: new Set([...recentAvoidProfile.artistKeys, ...extraHardAvoidArtists]),
        hardAvoidTrackIds: extraHardAvoidTracks,
        hardAvoidArtistKeys: extraHardAvoidArtists,
        intentShift: Math.min(0.95, recentAvoidProfile.intentShift + 0.2),
      });
      const retriedQuality = assessPlaylistQuality({
        tracks: retried,
        moodInput: effectiveMoodInput,
        parsed,
        targetMinutes,
        intentShift: Math.min(0.95, recentAvoidProfile.intentShift + 0.2),
      });
      if (
        retriedQuality.intentCoverage > quality.intentCoverage ||
        retriedQuality.durationCoverage > quality.durationCoverage
      ) {
        finalSummaries = retried;
      }
    }
    if (!finalSummaries.length) {
      const emergencyPool = buildEmergencyTrackPool({
        catalogPool,
        localPicks,
        fallback,
        bootstrap: input.spotifyBootstrap,
      });
      finalSummaries = emergencyPool.slice(0, Math.max(12, Math.min(40, targetCount)));
    }
    if (!finalSummaries.length && input.spotifyAccessToken) {
      try {
        const lastResort = await discoverSpotifyTracksWithTimeout(
          {
            accessToken: input.spotifyAccessToken,
            moodInput: effectiveMoodInput,
            bootstrap: input.spotifyBootstrap,
            limit: 35,
            includeAffinityQueries: false,
            maxSearchQueries: 3,
          },
          SPOTIFY_CATALOG_TIMEOUT_LAST_RESORT_MS,
        );
        finalSummaries = mergeUniqueTracks(finalSummaries, lastResort).slice(
          0,
          Math.max(12, Math.min(40, targetCount)),
        );
      } catch {
        // noop: final check below handles empty list
      }
    }
    if (!finalSummaries.length) {
      throw new Error("[Gemini] no usable tracks from model/fallback");
    }
    assertNotCancelled(requestId, input.abortSignal, "full_before_finalize");
    logSpotifyApiHealthIfNeeded("primary");
    logPromptMismatchDiagnostics({
      moodInput: effectiveMoodInput,
      parsed,
      tracks: finalSummaries,
      context: "primary",
    });
    pushRecommendationSnapshot(fingerprint, effectiveMoodInput, finalSummaries);

    return {
      status: "success",
      tracks: finalSummaries.map(toTrack),
      playlistName: buildAutoPlaylistNameFromTracks(
        finalSummaries,
        effectiveMoodInput,
      ),
      reasoning:
        parsed.reasoning ||
        parsed.moodSummary ||
        (usedLocalPlan
          ? "Gemini 연결이 없어 로컬 프롬프트 분석 기반으로 추천했어요."
          : undefined),
      meta: { requestId, reason: usedLocalPlan ? "full_local_plan_success" : "full_primary_success" },
    };
  } catch (err) {
    if (isCancelledRecommendationError(err)) {
      console.warn(`[Playlist] pipeline aborted requestId=${requestId || "-"}`);
      throw err;
    }
    const geminiErr = err as GeminiError | undefined;
    const isGeminiQuotaExceeded = geminiErr?.status === 429;
    if (geminiErr?.status === 429) {
      console.warn(
        "[Gemini] quota exceeded (429). Switching to Spotify-only local recommendation.",
      );
    } else {
      console.warn(
        `[Gemini] personalized recommendation fallback: ${safeErrorMessage(err)}`,
      );
    }

    const fallbackBase = pickFallbackTracks(input.spotifyBootstrap, 12);
    let localFallback = localPersonalizedPick(
      input.spotifyBootstrap,
      "balanced",
      12,
      targetMinutes,
      {
        avoidTrackIds: new Set([
          ...recentAvoidProfile.trackIds,
          ...globalReuseGuard.trackIds,
        ]),
        avoidArtistKeys: new Set([
          ...recentAvoidProfile.artistKeys,
          ...globalReuseGuard.artistKeys,
        ]),
      },
    );
    let fallback = fallbackBase;
    if (recentAvoidProfile.intentShift >= 0.6) {
      localFallback = localFallback.slice(
        0,
        Math.max(2, Math.round(localFallback.length * 0.35)),
      );
      fallback = fallback.slice(0, Math.max(3, Math.round(fallback.length * 0.4)));
    }
    let catalogPool: SpotifyTrackSummary[] = [];
    if (!isGeminiQuotaExceeded && input.spotifyAccessToken) {
      try {
        const catalogBudgetMs = getBudgetedDuration(18000, 8000, 30000, 14000);
        if (!catalogBudgetMs) {
          throw new Error("pipeline_budget_exhausted_before_fallback_catalog");
        }
        const tasteSeedProfile = buildTasteSeedProfile({
          bootstrap: input.spotifyBootstrap,
          moodInput: effectiveMoodInput,
        });
        const queryInputs = buildCatalogSearchInputs({
          moodInput: effectiveMoodInput,
          intentShift: recentAvoidProfile.intentShift,
          searchPlan,
        });
        const mergedInputs = Array.from(
          new Set([
            ...queryInputs,
            ...(queryInputs.length < 3 ? tasteSeedProfile.queryHints : tasteSeedProfile.queryHints.slice(0, 1)),
          ]),
        ).slice(0, 6);
        catalogPool = await discoverCatalogPoolFromQueries({
          accessToken: input.spotifyAccessToken!,
          bootstrap: input.spotifyBootstrap,
          queries: mergedInputs,
          seedTrackIds: tasteSeedProfile.seedTrackIds,
          seedArtistIds: tasteSeedProfile.seedArtistIds,
          primaryLimit: 88,
          secondaryLimit: 52,
          primaryTimeoutMs: Math.max(15000, SPOTIFY_CATALOG_TIMEOUT_PRIMARY_MS - 2000),
          secondaryTimeoutMs: Math.max(11000, SPOTIFY_CATALOG_TIMEOUT_SECONDARY_MS - 1500),
          maxQueries: 3,
          stopAt: 62,
          maxDurationMs: catalogBudgetMs,
          discoverMaxSearchQueriesPrimary: 2,
          discoverMaxSearchQueriesSecondary: 1,
        });
        if (catalogPool.length < 10 && input.spotifyAccessToken && currentIntent.specificity >= 7) {
          const strictSeedQueries = buildStrictIntentQueries({
            moodInput: effectiveMoodInput,
          }).slice(0, 2);
          if (strictSeedQueries.length) {
            const quickPool = await discoverCatalogPoolFromQueries({
              accessToken: input.spotifyAccessToken,
              bootstrap: input.spotifyBootstrap,
              queries: strictSeedQueries,
              seedTrackIds: [],
              seedArtistIds: [],
              primaryLimit: 52,
              secondaryLimit: 38,
              primaryTimeoutMs: Math.min(9000, SPOTIFY_CATALOG_TIMEOUT_PRIMARY_MS),
              secondaryTimeoutMs: Math.min(7000, SPOTIFY_CATALOG_TIMEOUT_SECONDARY_MS),
              maxQueries: 2,
              stopAt: 28,
              maxDurationMs: 9000,
              discoverMaxSearchQueriesPrimary: 1,
              discoverMaxSearchQueriesSecondary: 1,
            });
            if (quickPool.length) catalogPool = mergeUniqueTracks(catalogPool, quickPool);
          }
        }
      } catch (catalogErr) {
        console.warn(
          `[Spotify] catalog discovery fallback: ${safeErrorMessage(catalogErr)}`,
        );
      }
    }
    if (catalogPool.length >= 70) {
      localFallback = localFallback.slice(
        0,
        Math.max(2, Math.round(localFallback.length * 0.25)),
      );
      fallback = fallback.slice(0, Math.max(2, Math.round(fallback.length * 0.2)));
    } else if (catalogPool.length >= 12 && currentIntent.specificity >= 7) {
      localFallback = localFallback.slice(
        0,
        Math.max(2, Math.round(localFallback.length * 0.3)),
      );
      fallback = fallback.slice(0, Math.max(2, Math.round(fallback.length * 0.25)));
    } else if (currentIntent.specificity >= 8) {
      localFallback = localFallback.slice(
        0,
        Math.max(1, Math.round(localFallback.length * 0.15)),
      );
      fallback = fallback.slice(0, Math.max(1, Math.round(fallback.length * 0.15)));
    }
    const avgDurationMs = estimateAverageTrackDurationMs([
      catalogPool,
      localFallback,
      fallback,
      input.spotifyBootstrap?.topTracks ?? [],
      input.spotifyBootstrap?.recentlyPlayed ?? [],
    ]);
    const fallbackTarget = deriveTargetTrackCount({
      targetMinutes,
      timeMode: timeConstraint?.mode,
      averageDurationMs: avgDurationMs,
      maxCount: 60,
    });
    let finalSummaries = chooseCuratedTracks({
      catalogPool,
      localPicks: localFallback,
      fallback,
      bootstrap: input.spotifyBootstrap,
      moodInput: effectiveMoodInput,
      targetCount: fallbackTarget,
      targetMinutes,
      timeConstraint,
      recentAvoidTrackIds: recentAvoidProfile.trackIds,
      recentAvoidArtistKeys: recentAvoidProfile.artistKeys,
      hardAvoidTrackIds: globalReuseGuard.trackIds,
      hardAvoidArtistKeys: globalReuseGuard.artistKeys,
      intentShift: recentAvoidProfile.intentShift,
    });
    if (targetMinutes && targetMinutes > 0) {
      const durationCoverage = sumDurationMs(finalSummaries) / (targetMinutes * 60 * 1000);
      if (
        durationCoverage < 0.9 &&
        catalogPool.length >= 8 &&
        input.spotifyAccessToken &&
        finalSummaries.length < Math.max(12, Math.round(targetMinutes / 6)) &&
        canSpendPipelineMs(12_000)
      ) {
        const rescueQueries = buildDurationRescueQueries({
          moodInput: effectiveMoodInput,
          bootstrap: input.spotifyBootstrap,
        });
        const rescueQueryCap = canSpendPipelineMs(24_000) ? 4 : 2;
        const rescueTimeoutPrimary = getBudgetedDuration(
          Math.max(12000, SPOTIFY_CATALOG_TIMEOUT_RESCUE_MS - 1500),
          8000,
          22000,
          8000,
        );
        const rescueTimeoutSecondary = getBudgetedDuration(
          Math.max(9000, SPOTIFY_CATALOG_TIMEOUT_RESCUE_MS - 4000),
          7000,
          18000,
          6500,
        );
        if (!rescueTimeoutPrimary || !rescueTimeoutSecondary) {
          console.warn("[Spotify] skip fallback duration rescue due to remaining pipeline budget.");
        } else {
        const settled = await Promise.allSettled(
          rescueQueries.slice(0, rescueQueryCap).map((query, idx) =>
            discoverSpotifyTracksWithTimeout(
              {
                accessToken: input.spotifyAccessToken!,
                moodInput: query,
                bootstrap: input.spotifyBootstrap,
                limit: idx === 0 ? 120 : 85,
                includeAffinityQueries: false,
                maxSearchQueries: 4,
              },
              idx === 0 ? rescueTimeoutPrimary : rescueTimeoutSecondary,
            ),
          ),
        );
        const rescuePool = mergeUniqueTracks(
          ...settled
            .filter((r): r is PromiseFulfilledResult<SpotifyTrackSummary[]> => r.status === "fulfilled")
            .map(r => r.value),
        );
        if (rescuePool.length) {
          catalogPool = mergeUniqueTracks(catalogPool, rescuePool);
          const retrySummaries = chooseCuratedTracks({
            catalogPool,
            localPicks: localFallback.slice(0, Math.max(2, Math.round(localFallback.length * 0.2))),
            fallback: fallback.slice(0, Math.max(2, Math.round(fallback.length * 0.2))),
            bootstrap: input.spotifyBootstrap,
            moodInput: effectiveMoodInput,
            targetCount: Math.max(fallbackTarget, Math.round((targetMinutes * 60 * 1000) / 210000)),
            targetMinutes,
            timeConstraint,
            recentAvoidTrackIds: recentAvoidProfile.trackIds,
            recentAvoidArtistKeys: recentAvoidProfile.artistKeys,
            hardAvoidTrackIds: globalReuseGuard.trackIds,
            hardAvoidArtistKeys: globalReuseGuard.artistKeys,
            intentShift: Math.min(0.95, recentAvoidProfile.intentShift + 0.2),
          });
          if (sumDurationMs(retrySummaries) > sumDurationMs(finalSummaries)) {
            finalSummaries = retrySummaries;
          }
        }
        }
      }
    }
    finalSummaries = enforceMinimumDuration({
      selected: finalSummaries,
      targetMinutes,
      timeConstraint,
      candidatePool: mergeUniqueTracks(
        catalogPool,
        localFallback,
        fallback,
        buildEmergencyTrackPool({
          catalogPool,
          localPicks: localFallback,
          fallback,
          bootstrap: input.spotifyBootstrap,
        }),
      ),
      minCoverage: timeConstraint?.mode === "at_least" ? 0.98 : 0.93,
      maxCount: 90,
    });
    const fallbackQuality = assessPlaylistQuality({
      tracks: finalSummaries,
      moodInput: effectiveMoodInput,
      targetMinutes,
      intentShift: recentAvoidProfile.intentShift,
    });
    if (!fallbackQuality.isAcceptable) {
      const hardPromptMode = fallbackQuality.intentCoverage < 0.5;
      if (
        input.spotifyAccessToken &&
        fallbackQuality.intentCoverage < 0.55 &&
        canSpendPipelineMs(10_000)
      ) {
        try {
          const strictQueries = buildStrictIntentQueries({
            moodInput: effectiveMoodInput,
          });
          if (strictQueries.length) {
            const strictBudgetMs = getBudgetedDuration(16000, 7000, 24000, 8500);
            if (strictBudgetMs) {
              const strictPool = await discoverCatalogPoolFromQueries({
                accessToken: input.spotifyAccessToken,
                bootstrap: input.spotifyBootstrap,
                queries: strictQueries,
                seedTrackIds: [],
                seedArtistIds: [],
                primaryLimit: 82,
                secondaryLimit: 50,
                primaryTimeoutMs: Math.min(28000, SPOTIFY_CATALOG_TIMEOUT_PRIMARY_MS + 4000),
                secondaryTimeoutMs: Math.min(23000, SPOTIFY_CATALOG_TIMEOUT_SECONDARY_MS + 3000),
                maxQueries: 3,
                stopAt: 68,
                maxDurationMs: strictBudgetMs,
                discoverMaxSearchQueriesPrimary: 2,
                discoverMaxSearchQueriesSecondary: 1,
              });
              if (strictPool.length) {
                catalogPool = mergeUniqueTracks(catalogPool, strictPool);
              }
            } else {
              const quickStrict = await discoverSpotifyTracksWithTimeout(
                {
                  accessToken: input.spotifyAccessToken,
                  moodInput: strictQueries[0],
                  bootstrap: input.spotifyBootstrap,
                  limit: 42,
                  includeAffinityQueries: false,
                  maxSearchQueries: 1,
                },
                Math.min(6500, SPOTIFY_CATALOG_TIMEOUT_SECONDARY_MS),
              );
              if (quickStrict.length) {
                catalogPool = mergeUniqueTracks(catalogPool, quickStrict);
              }
            }
          }
        } catch (strictErr) {
          console.warn(`[Spotify] strict fallback rescue failed: ${safeErrorMessage(strictErr)}`);
        }
      }
      const extraHardAvoidTracks = new Set([
        ...globalReuseGuard.trackIds,
        ...finalSummaries.map(t => String(t?.id ?? "").trim()).filter(Boolean),
      ]);
      const extraHardAvoidArtists = new Set([
        ...globalReuseGuard.artistKeys,
        ...finalSummaries.flatMap(t => trackArtistKeys(t)),
      ]);
      const retried = chooseCuratedTracks({
        catalogPool,
        localPicks: hardPromptMode
          ? []
          : localFallback.slice(0, Math.max(2, Math.round(localFallback.length * 0.2))),
        fallback: hardPromptMode
          ? []
          : fallback.slice(0, Math.max(2, Math.round(fallback.length * 0.2))),
        bootstrap: input.spotifyBootstrap,
        moodInput: effectiveMoodInput,
        targetCount: Math.max(fallbackTarget, targetMinutes ? 22 : fallbackTarget),
        targetMinutes,
        timeConstraint,
        recentAvoidTrackIds: new Set([...recentAvoidProfile.trackIds, ...extraHardAvoidTracks]),
        recentAvoidArtistKeys: new Set([...recentAvoidProfile.artistKeys, ...extraHardAvoidArtists]),
        hardAvoidTrackIds: extraHardAvoidTracks,
        hardAvoidArtistKeys: extraHardAvoidArtists,
        intentShift: Math.min(0.95, recentAvoidProfile.intentShift + 0.25),
      });
      const retriedQuality = assessPlaylistQuality({
        tracks: retried,
        moodInput: effectiveMoodInput,
        targetMinutes,
        intentShift: Math.min(0.95, recentAvoidProfile.intentShift + 0.25),
      });
      if (
        retriedQuality.intentCoverage > fallbackQuality.intentCoverage ||
        retriedQuality.durationCoverage > fallbackQuality.durationCoverage
      ) {
        finalSummaries = retried;
      }
    }
    if (!finalSummaries.length) {
      const emergencyPool = buildEmergencyTrackPool({
        catalogPool,
        localPicks: localFallback,
        fallback,
        bootstrap: input.spotifyBootstrap,
      });
      finalSummaries = emergencyPool.slice(0, Math.max(10, Math.min(32, fallbackTarget)));
    }
    if (!finalSummaries.length && input.spotifyAccessToken) {
      try {
        const lastResort = await discoverSpotifyTracksWithTimeout(
          {
            accessToken: input.spotifyAccessToken,
            moodInput: effectiveMoodInput,
            bootstrap: input.spotifyBootstrap,
            limit: 28,
            includeAffinityQueries: false,
            maxSearchQueries: 4,
          },
          Math.max(20000, SPOTIFY_CATALOG_TIMEOUT_LAST_RESORT_MS - 3000),
        );
        finalSummaries = mergeUniqueTracks(finalSummaries, lastResort).slice(
          0,
          Math.max(10, Math.min(32, fallbackTarget)),
        );
      } catch {
        // noop
      }
    }
    if (!finalSummaries.length) {
      const emptyResult: PersonalizedPlaylistOutput = {
        status: "failed",
        tracks: [],
        playlistName: buildFallbackPlaylistName(effectiveMoodInput),
        fallbackReason: isGeminiQuotaExceeded
          ? "gemini_quota_exceeded"
          : "gemini_error",
        meta: { requestId, reason: "full_pipeline_empty" },
      };
      return finalizePipelineResult(requestId, emptyResult);
    }
    logSpotifyApiHealthIfNeeded("fallback");
    logPromptMismatchDiagnostics({
      moodInput: effectiveMoodInput,
      tracks: finalSummaries,
      context: "fallback",
    });
    pushRecommendationSnapshot(fingerprint, effectiveMoodInput, finalSummaries);
    const successResult: PersonalizedPlaylistOutput = {
      status: "success",
      tracks: finalSummaries.map(toTrack),
      playlistName: buildAutoPlaylistNameFromTracks(
        finalSummaries,
        effectiveMoodInput,
      ),
      reasoning:
        geminiErr?.status === 429
          ? "Gemini 쿼터가 초과되어 Spotify 데이터 기반으로 플레이리스트를 생성했어요."
          : "Spotify 데이터 기반으로 플레이리스트를 생성했어요.",
      fallbackReason: isGeminiQuotaExceeded
        ? "gemini_quota_exceeded"
        : "gemini_error",
      meta: {
        requestId,
        reason: isGeminiQuotaExceeded ? "full_pipeline_quota_fallback" : "full_pipeline_error_fallback",
      },
    };
    return finalizePipelineResult(requestId, successResult);
  }
}
