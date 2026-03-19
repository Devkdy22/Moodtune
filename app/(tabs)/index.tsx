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
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
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
import { analyzeMoodAndRecommend } from "../../src/api/gemini.service";
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
import { Track } from "../../src/types";

const { width: W } = Dimensions.get("window");
const HOME_SCROLL_BOTTOM_SPACER = Platform.OS === "ios" ? 188 : 198;
const HOME_CTA_BOTTOM_OFFSET = Platform.OS === "ios" ? 92 : 98;
const PREVIEW_BAR_BOTTOM_OFFSET = Platform.OS === "ios" ? 94 : 86;

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
  { id: "pop", Icon: Sparkles, label: "인기도", desc: "대중성 또는 숨은 곡" },
] as const;

type SettingId = (typeof GENRE_TOGGLES)[number]["id"];
type SettingOption = { label: string; prompt: string };
type SettingSelection = Record<SettingId, SettingOption | null>;

const SETTING_OPTIONS: Record<SettingId, SettingOption[]> = {
  genre: [
    { label: "팝/인디 중심", prompt: "장르는 팝과 인디 위주로 구성해줘." },
    { label: "재즈/소울 중심", prompt: "장르는 재즈와 소울 위주로 구성해줘." },
    { label: "힙합/R&B 중심", prompt: "장르는 힙합과 R&B 위주로 구성해줘." },
    {
      label: "EDM/일렉 중심",
      prompt: "장르는 EDM과 일렉트로닉 위주로 구성해줘.",
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

const LOADING_STEPS = ["무드 분석 중", "음악 매칭 중", "플레이리스트 생성 중"];
const MOOD_SUGGESTION_COUNT = 5;

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
  const selectedPrompts = Object.values(selections)
    .filter((v): v is SettingOption => Boolean(v))
    .map(v => v.prompt.trim().replace(/[.!?]$/, ""));

  if (!selectedPrompts.length) return base;

  return `${base}\n\n추가 요청: ${selectedPrompts.join(" 그리고 ")}.`;
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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const spotifyUser = useAppStore(s => s.spotifyUser);
  const spotifyTokens = useAppStore(s => s.spotifyTokens);
  const spotifyBootstrap = useAppStore(s => s.spotifyBootstrap);
  const setMoodInput = useAppStore(s => s.setMoodInput);
  const addPlaylist = useAppStore(s => s.addPlaylist);
  const setCurrentPlaylist = useAppStore(s => s.setCurrentPlaylist);
  const setTokens = useAppStore(s => s.setTokens);
  const params = useLocalSearchParams<{ skipSync?: string }>();
  const skipSync = params.skipSync === "1" || params.skipSync === "true";
  const [phase, setPhase] = useState<Phase>(skipSync ? "home" : "syncing");
  const [moodText, setMoodText] = useState("");
  const [moodSuggestions, setMoodSuggestions] = useState<MoodSuggestionItem[]>(
    () => pickMoodSuggestions(MOOD_SUGGESTION_COUNT),
  );
  const [selections, setSelections] = useState<SettingSelection>({
    genre: null,
    length: null,
    mood: null,
    pop: null,
  });
  const [settingPickerTarget, setSettingPickerTarget] =
    useState<SettingId | null>(null);
  const [tracks, setTracks] = useState<Track[]>(MOCK_TRACKS);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [toastQueue, setToastQueue] = useState<ToastItem[]>([]);
  const toastDedupRef = useRef<Record<string, number>>({});
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const userFirstName =
    spotifyUser?.display_name?.trim().split(/\s+/)[0] ||
    spotifyUser?.id ||
    "사용자";

  useEffect(() => {
    const topTracks = spotifyBootstrap?.topTracks ?? [];
    if (!topTracks.length) return;
    const mapped: Track[] = topTracks
      .filter(t => t.id && t.name)
      .map((t, i) => ({
        id: t.id,
        emoji: ["♬", "♫", "♪", "♩", "♭"][i % 5],
        name: t.name,
        artist:
          t.artists
            .map(a => a.name)
            .filter(Boolean)
            .join(", ") || "Unknown Artist",
        duration: formatDurationMs(Number(t.duration_ms ?? 0)),
        albumImageUrl: t.album?.images?.[0]?.url || undefined,
        gradientStart: ["#1a2535", "#22323f", "#2a2138", "#163026", "#2f2420"][
          i % 5
        ],
        gradientEnd: ["#0e1822", "#162730", "#171728", "#0b1d17", "#1f1612"][
          i % 5
        ],
        album: t.album?.name || "Spotify",
        year: parseReleaseYear(t.album?.release_date),
        bpm: Math.round(Number(t.tempo ?? 0)),
        genre: t.genres ?? [],
        liked: Boolean(t.is_saved),
        spotifyUri: t.uri,
        previewUrl: t.preview_url ?? undefined,
      }));
    if (mapped.length) setTracks(mapped);
  }, [spotifyBootstrap?.topTracks]);

  // s2 Syncing → s3 Home 자동 전환
  useEffect(() => {
    if (phase !== "syncing") return;
    const t = setTimeout(() => goTo("home"), 3500);
    return () => clearTimeout(t);
  }, [phase]);

  function enqueueToast(message: string, dedupeKey: string, tone: ToastItem["tone"] = "info") {
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
    setLoadingStep(0);
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const run = async () => {
      try {
        timers.push(setTimeout(() => !cancelled && setLoadingStep(1), 700));
        timers.push(setTimeout(() => !cancelled && setLoadingStep(2), 1500));

        const finalPrompt = composePrompt(moodText, selections);
        const result = await Promise.race([
          analyzeMoodAndRecommend({
            moodInput: finalPrompt,
            spotifyUser,
            spotifyBootstrap,
            spotifyAccessToken: spotifyTokens?.accessToken,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("playlist generation timeout")),
              22_000,
            ),
          ),
        ]);
        const { tracks: generatedTracks, playlistName, fallbackReason } = result;

        if (cancelled) return;
        if (fallbackReason === "gemini_quota_exceeded") {
          enqueueToast(
            "Gemini 쿼터가 초과되어 Spotify 기반 추천으로 생성했어요.",
            "gemini_quota_exceeded",
            "warning",
          );
        }

        const fallbackTracks = tracks.length ? tracks : MOCK_TRACKS;
        const finalTracks = generatedTracks.length ? generatedTracks : fallbackTracks;
        const totalMins = finalTracks.reduce((sum: number, t: Track) => {
          const [m, s] = t.duration.split(":").map(Number);
          return sum + m + s / 60;
        }, 0);

        setCurrentPlaylist({
          id: "gen_1",
          name: playlistName || "AI 추천 플레이리스트",
          coverEmoji: "♬",
          gradientStart: "#1a2535",
          gradientEnd: "#0e1822",
          trackCount: finalTracks.length,
          duration: `${Math.max(1, Math.round(totalMins))}분`,
          liked: false,
          tracks: finalTracks,
          createdAt: new Date(),
          moodInput: finalPrompt,
        });
        setTracks(finalTracks);
        timers.push(setTimeout(() => !cancelled && goTo("preview"), 450));
      } catch (error) {
        console.warn("[home] playlist generation failed.");
        if (cancelled) return;
        const msg = String((error as Error)?.message ?? error);
        if (msg.includes("(429)") || msg.toLowerCase().includes("quota")) {
          enqueueToast(
            "Gemini 쿼터가 초과되어 Spotify 기반 추천으로 생성했어요.",
            "gemini_quota_exceeded_error",
            "warning",
          );
        }
        const fallbackPrompt = composePrompt(moodText, selections);
        const fallbackTracks = tracks.length ? tracks : MOCK_TRACKS;
        const fallbackTotalMins = fallbackTracks.reduce((sum: number, t: Track) => {
          const [m, s] = t.duration.split(":").map(Number);
          return sum + m + s / 60;
        }, 0);
        setCurrentPlaylist({
          id: "gen_1",
          name: "AI 추천 플레이리스트",
          coverEmoji: "♬",
          gradientStart: "#1a2535",
          gradientEnd: "#0e1822",
          trackCount: fallbackTracks.length,
          duration: `${Math.max(1, Math.round(fallbackTotalMins || 65))}분`,
          liked: false,
          tracks: fallbackTracks,
          createdAt: new Date(),
          moodInput: fallbackPrompt,
        });
        goTo("preview");
      }
    };

    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [
    phase,
    moodText,
    selections,
    setCurrentPlaylist,
    spotifyBootstrap,
    spotifyTokens?.accessToken,
    spotifyUser,
  ]);

  function goTo(next: Phase) {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setPhase(next);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    });
  }

  function startGeneration() {
    if (!moodText.trim()) return;
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
      genre: null,
      length: null,
      mood: null,
      pop: null,
    });
  }

  function openSettingPicker(id: SettingId) {
    setSettingPickerTarget(id);
  }

  function selectSettingOption(id: SettingId, option: SettingOption) {
    setSelections(prev => ({ ...prev, [id]: option }));
    setSettingPickerTarget(null);
  }

  function clearSettingOption(id: SettingId) {
    setSelections(prev => ({ ...prev, [id]: null }));
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
        const refreshed = await refreshSpotifyAccessToken({
          refreshToken: spotifyTokens.refreshToken,
        });
        setTokens(refreshed);
        accessToken = refreshed.accessToken;
      }

      const saved = await Promise.race([
        savePlaylistToSpotify(
          accessToken,
          spotifyUser.id,
          basePlaylist.name,
          uris,
          basePlaylist.spotifyId,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("spotify save timeout")),
            25_000,
          ),
        ),
      ]);
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
      console.warn("[home] save playlist failed.");
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
  const canResetSettings = Object.values(selections).some(Boolean);
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
          <LoadingView insets={insets} step={loadingStep} />
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
  { label: "Spotify 연결", done: true },
  { label: "음악 취향 분석", done: true },
  { label: "플레이리스트 준비", done: false },
];

function SettingPickerModal({
  visible,
  target,
  current,
  onClose,
  onSelect,
  onClear,
}: {
  visible: boolean;
  target: SettingId | null;
  current: SettingOption | null;
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
            const selected = current?.label === option.label;
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
            <Text style={styles.settingActionPrimaryText}>확인</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function SyncingView({ insets, userFirstName }: any) {
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 3200,
      useNativeDriver: false,
    }).start();
  }, []);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={[styles.centered, { paddingTop: insets.top }]}>
      {/* 헤더 로고 */}
      <View style={styles.syncHeader}>
        <LogoIcon size={56} radius={16} animated />
        <View>
          <Text style={styles.syncTitle}>안녕하세요, {userFirstName}님!</Text>
          <Text style={styles.syncSub}>데이터를 동기화하고 있어요</Text>
        </View>
      </View>

      {/* 웨이브폼 */}
      <View style={styles.waveSection}>
        <Waveform barCount={15} height={72} active />
      </View>

      {/* 진행 단계 */}
      <View style={{ width: "100%", paddingHorizontal: 24, gap: 8 }}>
        {SYNC_STEPS.map((s, i) => (
          <GlassCard key={i} style={styles.syncStep} padding={14}>
            <View
              style={[styles.syncStepDot, s.done && styles.syncStepDotDone]}
            >
              <Text
                style={{
                  fontSize: 10,
                  color: s.done ? "#000" : Colors.t3,
                  fontWeight: "700",
                }}
              >
                {s.done ? "✓" : i + 1}
              </Text>
            </View>
            <Text style={[styles.syncStepText, s.done && { color: Colors.t1 }]}>
              {s.label}
            </Text>
            <Text
              style={[
                styles.syncStepStatus,
                { color: s.done ? Colors.green : Colors.t3 },
              ]}
            >
              {s.done ? "완료" : "처리중..."}
            </Text>
          </GlassCard>
        ))}
      </View>

      {/* 진행 바 */}
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressBar, { width: progressWidth }]} />
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
              style={[styles.toggle, selections[g.id] && styles.toggleActive]}
              onPress={() => onOpenSetting(g.id)}
              activeOpacity={0.75}
            >
              <View style={styles.toggleIconWrap}>
                <g.Icon
                  size={16}
                  color={selections[g.id] ? Colors.green : Colors.t2}
                  strokeWidth={2.1}
                />
              </View>
              <View style={styles.toggleTextWrap}>
                <Text
                  style={[
                    styles.toggleLabel,
                    selections[g.id] && styles.toggleLabelActive,
                  ]}
                >
                  {g.label}
                </Text>
                <Text
                  style={[
                    styles.toggleSubLabel,
                    selections[g.id] && styles.toggleSubLabelActive,
                  ]}
                >
                  {selections[g.id]?.label ?? g.desc}
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
function LoadingView({ insets, step }: any) {
  const spin1 = useRef(new Animated.Value(0)).current;
  const spin2 = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spin1, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
    ).start();
    Animated.loop(
      Animated.timing(spin2, {
        toValue: -1,
        duration: 1800,
        useNativeDriver: true,
      }),
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.06,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
    Animated.timing(progress, {
      toValue: 1,
      duration: 3600,
      useNativeDriver: false,
    }).start();
  }, []);

  const rotate1 = spin1.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const rotate2 = spin2.interpolate({
    inputRange: [-1, 0],
    outputRange: ["-360deg", "0deg"],
  });
  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={[styles.centered, { paddingTop: insets.top }]}>
      <Text style={styles.loadTitle}>AI가 분석 중이에요</Text>
      <Text style={styles.loadSub}>잠시만 기다려주세요...</Text>

      {/* 이중 회전 링 + 로고 */}
      <View style={styles.loadingRing}>
        {/* 바깥 링 */}
        <Animated.View
          style={[styles.ring1, { transform: [{ rotate: rotate1 }] }]}
        />
        {/* 안쪽 링 */}
        <Animated.View
          style={[styles.ring2, { transform: [{ rotate: rotate2 }] }]}
        />
        {/* 중앙 로고 */}
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          <LogoIcon size={88} circular animated />
        </Animated.View>
      </View>

      {/* 진행 바 */}
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressBar, { width: progressWidth }]} />
      </View>

      {/* 단계 */}
      <View style={{ width: "100%", paddingHorizontal: 24, gap: 6 }}>
        {LOADING_STEPS.map((s, i) => (
          <GlassCard key={i} padding={12} style={styles.loadStep}>
            <View
              style={[
                styles.syncStepDot,
                i < step && styles.syncStepDotDone,
                i === step && styles.stepDotActive,
              ]}
            >
              <Text
                style={{
                  fontSize: 10,
                  color: i < step ? "#000" : Colors.t3,
                  fontWeight: "700",
                }}
              >
                {i < step ? "✓" : i + 1}
              </Text>
            </View>
            <Text
              style={[styles.syncStepText, i <= step && { color: Colors.t1 }]}
            >
              {s}
            </Text>
          </GlassCard>
        ))}
      </View>
    </View>
  );
}

// ════════════════════════════════════════════════════════
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
        <TouchableOpacity style={styles.backBtn2} onPress={onBack}>
          <Text style={styles.backBtnText2}>← 돌아가기</Text>
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
    gap: 24,
  },

  // ── Syncing ───────────────────────────────────────────
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
  waveSection: {
    paddingVertical: 16,
    alignSelf: "stretch",
    alignItems: "center",
    backgroundColor: Colors.glass,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    marginHorizontal: 24,
  },
  syncStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
  loadTitle: {
    fontSize: FontSize["4xl"],
    fontWeight: "700",
    color: Colors.t1,
    letterSpacing: -0.3,
  },
  loadSub: {
    fontSize: FontSize.md,
    color: Colors.t2,
  },
  loadingRing: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 8,
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
  },
  backBtnText2: {
    fontSize: FontSize.md,
    color: Colors.t2,
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
