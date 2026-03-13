// app/(tabs)/index.tsx
// ─────────────────────────────────────────────────────────
//  메인 홈 화면 (s2 Syncing → s3 Input → s4 Loading → s5 Preview)
//  실제 앱에서는 각 화면이 별도 스택으로 분리되나
//  현재는 animated 전환으로 구현 (API 연동 전 UI 우선)
// ─────────────────────────────────────────────────────────
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Waveform from "../../src/components/ai/waveform";
import { PrimaryButton } from "../../src/components/common/Button";
import GlassCard from "../../src/components/common/GlassCard";
import LogoIcon from "../../src/components/common/LogoIcon";
import ScreenBackground from "../../src/components/common/ScreenBackground";
import TrackDetailModal from "../../src/components/music/TrackDetailModal";
import TrackItem from "../../src/components/music/TrackItem";
import { Colors } from "../../src/constants/colors";
import { FontSize, Radius } from "../../src/constants/layout";
import {
  MOCK_TRACKS,
  MOCK_USER,
  MOOD_PILLS,
} from "../../src/constants/mockData";
import { useAppStore } from "../../src/store/useAppStore";
import { Track } from "../../src/types";

const { width: W } = Dimensions.get("window");

const GENRE_TOGGLES = [
  { id: "genre", icon: "💿", label: "장르 선택" },
  { id: "length", icon: "⏱", label: "길이" },
  { id: "mood", icon: "🎚", label: "분위기" },
  { id: "pop", icon: "🌟", label: "인기도" },
];

const LOADING_STEPS = ["무드 분석 중", "음악 매칭 중", "플레이리스트 생성 중"];

type Phase = "syncing" | "home" | "loading" | "preview";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("syncing");
  const [moodText, setMoodText] = useState("");
  const [activeToggles, setActiveToggles] = useState<Set<string>>(new Set());
  const [tracks, setTracks] = useState(MOCK_TRACKS);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // s2 Syncing → s3 Home 자동 전환
  useEffect(() => {
    if (phase !== "syncing") return;
    const t = setTimeout(() => goTo("home"), 3500);
    return () => clearTimeout(t);
  }, [phase]);

  // 로딩 단계 시뮬레이션
  useEffect(() => {
    if (phase !== "loading") return;
    setLoadingStep(0);
    const timers = [
      setTimeout(() => setLoadingStep(1), 1000),
      setTimeout(() => setLoadingStep(2), 2200),
      setTimeout(() => {
        useAppStore.getState().setCurrentPlaylist({
          id: "gen_1",
          name: "AI 추천 플레이리스트",
          coverEmoji: "🎷",
          gradientStart: "#1a2535",
          gradientEnd: "#0e1822",
          trackCount: tracks.length,
          duration: "65분",
          liked: false,
          tracks,
          createdAt: new Date(),
          moodInput: moodText,
        });
        goTo("preview");
      }, 3600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [phase]);

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
    goTo("loading");
  }

  function toggleGenre(id: string) {
    setActiveToggles(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function deleteTrack(id: string) {
    setTracks(prev => prev.filter(t => t.id !== id));
  }

  function toggleLike(id: string) {
    setTracks(prev =>
      prev.map(t => (t.id === id ? { ...t, liked: !t.liked } : t)),
    );
  }

  function openTrack(track: Track) {
    setSelectedTrack(track);
    setShowModal(true);
  }

  function saveToSpotify() {
    router.push("/result/gen_1" as any);
  }

  return (
    <ScreenBackground>
      <StatusBar barStyle="light-content" />
      <Animated.View style={[{ flex: 1 }, { opacity: fadeAnim }]}>
        {phase === "syncing" && <SyncingView insets={insets} />}
        {phase === "home" && (
          <HomeInputView
            insets={insets}
            moodText={moodText}
            setMoodText={setMoodText}
            activeToggles={activeToggles}
            onToggle={toggleGenre}
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
          />
        )}
      </Animated.View>

      <TrackDetailModal
        track={selectedTrack}
        visible={showModal}
        onClose={() => setShowModal(false)}
        onLike={toggleLike}
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

function SyncingView({ insets }: any) {
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
          <Text style={styles.syncTitle}>안녕하세요, {MOCK_USER.name}님!</Text>
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
  moodText,
  setMoodText,
  activeToggles,
  onToggle,
  onGenerate,
}: any) {
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
          { paddingBottom: insets.bottom + 90 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 인사말 */}
        <Text style={styles.greetTitle}>
          안녕하세요 {MOCK_USER.name.split(" ")[0]}님 👋
        </Text>
        <Text style={styles.greetSub}>오늘 어떤 기분인가요?</Text>

        {/* 무드 텍스트 입력 */}
        <View style={styles.inputWrapper}>
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

        {/* 무드 추천 알약 */}
        <Text style={styles.sectionLabel}>추천 무드</Text>
        <View style={styles.pillsGrid}>
          {MOOD_PILLS.map(p => (
            <TouchableOpacity
              key={p.id}
              style={styles.moodPill}
              onPress={() => setMoodText(p.text)}
              activeOpacity={0.75}
            >
              <Text style={styles.moodPillText}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 옵션 토글 */}
        <Text style={styles.sectionLabel}>설정</Text>
        <View style={styles.toggleGrid}>
          {GENRE_TOGGLES.map(g => (
            <TouchableOpacity
              key={g.id}
              style={[
                styles.toggle,
                activeToggles.has(g.id) && styles.toggleActive,
              ]}
              onPress={() => onToggle(g.id)}
              activeOpacity={0.75}
            >
              <Text style={styles.toggleIcon}>{g.icon}</Text>
              <Text
                style={[
                  styles.toggleLabel,
                  activeToggles.has(g.id) && styles.toggleLabelActive,
                ]}
              >
                {g.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* CTA 버튼 */}
      <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 90 }]}>
        <PrimaryButton
          label="✨  플레이리스트 생성하기"
          onPress={onGenerate}
          disabled={!moodText.trim()}
          style={{ width: "100%" }}
        />
      </View>
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
        contentContainerStyle={[styles.trackList, { paddingBottom: 130 }]}
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
      <View style={[styles.pvBar, { paddingBottom: insets.bottom + 16 }]}>
        <GlassCard style={styles.pvBarInfo} padding={10}>
          <Text style={{ fontSize: FontSize.sm, color: Colors.t2 }}>🎵</Text>
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
          <Text style={{ fontSize: FontSize.sm, color: Colors.t2 }}>
            ⏱ {Math.round(totalMins)}분
          </Text>
          <View style={styles.pvBarSep} />
          <Text style={{ fontSize: FontSize.xs, color: Colors.t3 }}>
            ← 밀어서 삭제
          </Text>
        </GlassCard>
        <PrimaryButton
          label="💚 Spotify에 저장하기"
          onPress={onSave}
          style={{ flex: 1 }}
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
    marginBottom: 4,
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
    marginBottom: 9,
  },
  pillsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 20,
  },
  moodPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  moodPillText: {
    fontSize: FontSize.sm,
    color: Colors.t2,
  },
  toggleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 24,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
  toggleIcon: {
    fontSize: 16,
  },
  toggleLabel: {
    fontSize: FontSize.base,
    color: Colors.t2,
    fontWeight: "500",
  },
  toggleLabelActive: {
    color: Colors.green,
    fontWeight: "600",
  },
  ctaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: "rgba(6,13,10,0.95)",
    borderTopWidth: 1,
    borderTopColor: Colors.glassBd,
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
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    backgroundColor: "rgba(6,13,9,0.98)",
    borderTopWidth: 1,
    borderTopColor: Colors.glassBd,
    flexDirection: "row",
    gap: 10,
  },
  pvBarInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    borderRadius: Radius.md,
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
