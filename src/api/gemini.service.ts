// src/api/gemini.service.ts
// ─────────────────────────────────────────────────────────
//  Google Gemini AI 서비스
//  사용자 Spotify 데이터 + 무드 입력을 기반으로 개인화 플리 생성
// ─────────────────────────────────────────────────────────
import { discoverSpotifyTracks } from "./spotify.service";
import {
  SpotifyBootstrapData,
  SpotifyTrackSummary,
  SpotifyUser,
  Track,
} from "../types";

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL ?? "gemini-2.0-flash";
const GEMINI_CANDIDATE_MODELS = [
  GEMINI_MODEL,
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash",
].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

type GeminiPlaylistJson = {
  playlistName?: string;
  moodSummary?: string;
  reasoning?: string;
  targetCount?: number;
  mixStrategy?: "familiar" | "balanced" | "discovery";
};

type GeminiError = Error & {
  status?: number;
  bodyText?: string;
};

export type PersonalizedPlaylistInput = {
  moodInput: string;
  spotifyUser: SpotifyUser | null;
  spotifyBootstrap: SpotifyBootstrapData | null;
  spotifyAccessToken?: string | null;
};

export type PersonalizedPlaylistOutput = {
  tracks: Track[];
  playlistName: string;
  reasoning?: string;
};

function toTrack(summary: SpotifyTrackSummary, i: number): Track {
  const artist =
    summary.artists?.map(a => a.name).filter(Boolean).join(", ") ||
    "Unknown Artist";
  const durationMs = Number(summary.duration_ms ?? 0);
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

function stripCodeFence(text: string): string {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function formatDurationMs(durationMs: number): string {
  if (!durationMs || durationMs < 0) return "0:00";
  const totalSec = Math.floor(durationMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function buildGeminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
}

function extractTargetMinutes(text: string): number | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const hourMin = normalized.match(/(\d+)\s*시간\s*(\d+)\s*분/);
  if (hourMin) {
    return Number(hourMin[1]) * 60 + Number(hourMin[2]);
  }
  const hours = normalized.match(/(\d+)\s*시간/);
  if (hours) {
    return Number(hours[1]) * 60;
  }
  const mins = normalized.match(/(\d+)\s*분/);
  if (mins) {
    return Number(mins[1]);
  }
  return null;
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

function buildPrompt(input: PersonalizedPlaylistInput): string {
  // 개인정보 보호: Gemini에는 Spotify 사용자/계정/청취 데이터는 전송하지 않는다.
  // 오직 사용자가 직접 입력한 텍스트만 전송.
  const safeMoodInput = input.moodInput.trim().replace(/\s+/g, " ");

  return [
    "너는 음악 큐레이션 AI다. 답변은 반드시 JSON만 반환해라.",
    `사용자 요청: ${safeMoodInput}`,
    "",
    "아래 JSON 스키마로만 답해라(마크다운/설명 금지).",
    '{"playlistName":"string","moodSummary":"string","reasoning":"string","targetCount":12,"mixStrategy":"familiar|balanced|discovery"}',
    "",
    "제약:",
    "- targetCount는 8~20 정수",
    "- mixStrategy는 familiar, balanced, discovery 중 하나",
  ].join("\n");
}

async function callGemini(prompt: string): Promise<GeminiPlaylistJson> {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing EXPO_PUBLIC_GEMINI_API_KEY");
  }

  let lastErr: GeminiError | null = null;

  for (const model of GEMINI_CANDIDATE_MODELS) {
    const res = await fetch(buildGeminiUrl(model), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
        },
      }),
    });

    const json: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = String(json?.error?.message ?? "");
      const isModelNotFound =
        res.status === 404 &&
        (msg.includes("is not found") || msg.includes("not supported for generateContent"));

      lastErr = new Error(
        `[Gemini] request failed (${res.status}) [${model}]: ${JSON.stringify(json)}`,
      ) as GeminiError;
      lastErr.status = res.status;
      lastErr.bodyText = JSON.stringify(json);
      if (isModelNotFound) {
        continue;
      }
      throw lastErr;
    }

    const text = String(
      json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
    );
    if (!text) throw new Error(`[Gemini] empty response text [${model}]`);

    const parsed = JSON.parse(stripCodeFence(text));
    return parsed as GeminiPlaylistJson;
  }

  throw lastErr ?? new Error("[Gemini] model fallback exhausted");
}

function buildFallbackPlaylistName(moodInput: string): string {
  const cleaned = moodInput.trim().replace(/\s+/g, " ");
  if (!cleaned) return "AI 맞춤 플레이리스트";
  return `${cleaned.slice(0, 18)}${cleaned.length > 18 ? "…" : ""} 플레이리스트`;
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

function localPersonalizedPick(
  bootstrap: SpotifyBootstrapData | null,
  strategy: GeminiPlaylistJson["mixStrategy"],
  targetCountRaw?: number,
  targetMinutes?: number | null,
): SpotifyTrackSummary[] {
  const top = bootstrap?.topTracks ?? [];
  const recent = bootstrap?.recentlyPlayed ?? [];
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
    Math.min(30, estimatedCountByMinutes ?? baseCount),
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

export async function analyzeMoodAndRecommend(
  input: PersonalizedPlaylistInput,
): Promise<PersonalizedPlaylistOutput> {
  const fallback = pickFallbackTracks(input.spotifyBootstrap, 12);
  const targetMinutes = extractTargetMinutes(input.moodInput);

  try {
    const prompt = buildPrompt(input);
    const parsed = await callGemini(prompt);
    let catalogPool: SpotifyTrackSummary[] = [];
    if (input.spotifyAccessToken) {
      try {
        catalogPool = await discoverSpotifyTracks({
          accessToken: input.spotifyAccessToken,
          moodInput: input.moodInput,
          bootstrap: input.spotifyBootstrap,
          limit: 90,
        });
      } catch (err) {
        console.warn("[Spotify] catalog discovery fallback:", err);
      }
    }
    const localPicks = localPersonalizedPick(
      input.spotifyBootstrap,
      parsed.mixStrategy,
      parsed.targetCount,
      targetMinutes,
    );
    const mixed = [...catalogPool, ...localPicks, ...fallback].sort(
      () => Math.random() - 0.5,
    );
    const dedup = new Map<string, SpotifyTrackSummary>();
    mixed.forEach(t => {
      if (t?.id && !dedup.has(t.id)) dedup.set(t.id, t);
    });
    const finalSummaries = Array.from(dedup.values()).slice(0, 24);
    if (!finalSummaries.length) {
      throw new Error("[Gemini] no usable tracks from model/fallback");
    }

    return {
      tracks: finalSummaries.map(toTrack),
      playlistName: buildAutoPlaylistNameFromTracks(
        finalSummaries,
        input.moodInput,
      ),
      reasoning: parsed.reasoning || parsed.moodSummary,
    };
  } catch (err) {
    const geminiErr = err as GeminiError | undefined;
    if (geminiErr?.status === 429) {
      console.warn(
        "[Gemini] quota exceeded (429). Switching to Spotify-only local recommendation.",
      );
    } else {
      console.warn("[Gemini] personalized recommendation fallback:", err);
    }

    const localFallback = localPersonalizedPick(
      input.spotifyBootstrap,
      "balanced",
      12,
      targetMinutes,
    );
    let catalogPool: SpotifyTrackSummary[] = [];
    if (input.spotifyAccessToken) {
      try {
        catalogPool = await discoverSpotifyTracks({
          accessToken: input.spotifyAccessToken,
          moodInput: input.moodInput,
          bootstrap: input.spotifyBootstrap,
          limit: 90,
        });
      } catch (catalogErr) {
        console.warn("[Spotify] catalog discovery fallback:", catalogErr);
      }
    }
    const finalSummaries = [...catalogPool, ...localFallback, ...fallback]
      .sort(() => Math.random() - 0.5)
      .filter((t, i, arr) => t?.id && arr.findIndex(v => v.id === t.id) === i)
      .slice(0, 24);
    if (!finalSummaries.length) {
      return {
        tracks: [],
        playlistName: buildFallbackPlaylistName(input.moodInput),
      };
    }
    return {
      tracks: finalSummaries.map(toTrack),
      playlistName: buildAutoPlaylistNameFromTracks(
        finalSummaries,
        input.moodInput,
      ),
      reasoning:
        geminiErr?.status === 429
          ? "Gemini 쿼터가 초과되어 Spotify 데이터 기반으로 플레이리스트를 생성했어요."
          : "Spotify 데이터 기반으로 플레이리스트를 생성했어요.",
    };
  }
}
