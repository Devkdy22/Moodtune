// app/auth/spotify-linking.tsx
// ─────────────────────────────────────────────────────────
//  Spotify Connecting / Loading Screen
//  - Shows while fetching Spotify user data after login
// ─────────────────────────────────────────────────────────
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import {
  bootstrapSpotifyData,
  getSpotifyUser,
  refreshSpotifyAccessToken,
} from "../../src/api/spotify.service";
import { useAppStore } from "../../src/store/useAppStore";
import { SpotifyBootstrapData, SpotifyUser } from "../../src/types";

function isHardRefreshTokenInvalid(message: string): boolean {
  const msg = String(message ?? "").toLowerCase();
  return (
    msg.includes("invalid_grant") ||
    msg.includes("invalid refresh token") ||
    msg.includes("refresh token revoked") ||
    msg.includes("refresh token expired")
  );
}

const { width: W } = Dimensions.get("window");

const C = {
  bg: "#030e07",
  green: "#3ddc84",
  green2: "#1aae5c",
  t1: "#ffffff",
  t2: "rgba(255,255,255,0.60)",
  t3: "rgba(255,255,255,0.26)",
  cardBd: "rgba(255,255,255,0.12)",
  cardBg1: "rgba(255,255,255,0.07)",
  cardBg2: "rgba(255,255,255,0.03)",
};

type Step = 1 | 2 | 3;

export default function SpotifyLinkingScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    next?: string;
    ms?: string;
    mode?: string;
  }>();

  const nextPath = typeof params.next === "string" ? params.next : "/(tabs)";
  const mode = typeof params.mode === "string" ? params.mode : "ready";
  const cachedProfile = useAppStore(s => s.spotifyUser);
  const cachedBootstrap = useAppStore(s => s.spotifyBootstrap);

  const [stage, setStage] = useState<Step>(1);
  const [profile, setProfile] = useState<SpotifyUser | null>(cachedProfile);
  const [dataSummary, setDataSummary] = useState<SpotifyBootstrapData | null>(
    cachedBootstrap,
  );
  const [showDone, setShowDone] = useState(false);
  const tokens = useAppStore(s => s.spotifyTokens);
  const setTokens = useAppStore(s => s.setTokens);
  const setSpotifyUser = useAppStore(s => s.setSpotifyUser);
  const setSpotifyBootstrap = useAppStore(s => s.setSpotifyBootstrap);

  // Dots pulse
  const dotT = useRef(new Animated.Value(0)).current;
  const progressT = useRef(new Animated.Value(0)).current;
  const doneOpacity = useRef(new Animated.Value(0)).current;
  const doneScale = useRef(new Animated.Value(0.9)).current;
  const dotCount = 6;
  const dots = useMemo(() => Array.from({ length: dotCount }, (_, i) => i), []);
  const stepTitle = showDone
    ? "연결 완료"
    : stage === 1
      ? "보안 검증"
      : stage === 2
        ? "데이터 동기화"
        : "최종 준비";

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const ensureMinElapsed = async (startedAt: number, minMs: number) => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < minMs) await wait(minMs - elapsed);
  };

  const playDoneMotion = () =>
    new Promise<void>(resolve => {
      Animated.parallel([
        Animated.timing(doneOpacity, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.spring(doneScale, {
          toValue: 1,
          tension: 70,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start(() => resolve());
    });

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotT, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(dotT, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [dotT]);

  useEffect(() => {
    Animated.timing(progressT, {
      toValue: showDone ? 1 : (stage - 1) / 2,
      duration: 340,
      useNativeDriver: false,
    }).start();
  }, [progressT, showDone, stage]);

  useEffect(() => {
    let cancelled = false;
    const runStep = async (
      step: Step,
      worker: () => Promise<void>,
      minMs: number,
    ) => {
      const startedAt = Date.now();
      setStage(step);
      await worker();
      await ensureMinElapsed(startedAt, minMs);
    };

    const run = async () => {
      try {
        if (!tokens?.accessToken || !tokens.refreshToken) {
          router.replace("/auth/spotify-login" as any);
          return;
        }

        let accessToken = tokens.accessToken;
        if (tokens.expiresAt && Date.now() > tokens.expiresAt - 30_000) {
          try {
            const refreshed = await refreshSpotifyAccessToken({
              refreshToken: tokens.refreshToken,
            });
            if (cancelled) return;
            setTokens(refreshed);
            accessToken = refreshed.accessToken;
          } catch (refreshErr) {
            const refreshMsg = String(
              (refreshErr as Error)?.message ?? refreshErr,
            );
            if (isHardRefreshTokenInvalid(refreshMsg)) {
              if (!cancelled) router.replace("/auth/spotify-login" as any);
              return;
            }
          }
        }

        await runStep(
          1,
          async () => {
            if (mode !== "bootstrap" && profile) return;
            const me = await getSpotifyUser(accessToken);
            if (cancelled) return;
            if (me) {
              setSpotifyUser(me);
              setProfile(me);
            }
          },
          760,
        );
        if (cancelled) return;

        await runStep(
          2,
          async () => {
            if (mode !== "bootstrap" && dataSummary) return;
            const bootstrap = await bootstrapSpotifyData(accessToken);
            if (cancelled) return;
            setSpotifyBootstrap(bootstrap);
            setDataSummary(bootstrap);
          },
          960,
        );
        if (cancelled) return;

        await runStep(
          3,
          async () => {
            await wait(420);
          },
          740,
        );
        if (cancelled) return;

        setShowDone(true);
        await playDoneMotion();
        await wait(1000);
        if (!cancelled) router.replace(nextPath as any);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        console.warn(`[spotify-linking] bootstrap failed: ${msg}`);
        if (!cancelled && isHardRefreshTokenInvalid(msg)) {
          router.replace("/auth/spotify-login" as any);
          return;
        }
        if (!cancelled) router.replace(nextPath as any);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    mode,
    nextPath,
    setSpotifyBootstrap,
    setSpotifyUser,
    setTokens,
    tokens?.accessToken,
    tokens?.expiresAt,
    tokens?.refreshToken,
    profile,
    dataSummary,
  ]);

  return (
    <View
      style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />

      {/* Background */}
      <LinearGradient
        colors={["#020a06", "#062015", "#010603"]}
        locations={[0, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[
          "rgba(61,220,132,0.15)",
          "rgba(61,220,132,0.05)",
          "rgba(0,0,0,0)",
        ]}
        start={{ x: 0.05, y: 0.05 }}
        end={{ x: 0.85, y: 0.95 }}
        style={[StyleSheet.absoluteFill, { opacity: 0.75 }]}
      />
      <View pointerEvents="none" style={s.bgGlowTop} />
      <View pointerEvents="none" style={s.bgGlowBottom} />

      <View style={s.wrap}>
        {/* Connection row */}
        <View style={s.connRow}>
          <View style={s.spCircle}>
            <SpotifyGlyph size={34} color="#ffffff" />
          </View>

          <View style={s.dotRow}>
            {dots.map(i => {
              const local = Animated.modulo(
                Animated.add(dotT, i / dotCount),
                1,
              );
              const opacity = local.interpolate({
                inputRange: [0, 0.3, 1],
                outputRange: [0.25, 1, 0.25],
              });
              const scale = local.interpolate({
                inputRange: [0, 0.3, 1],
                outputRange: [1, 1.25, 1],
              });
              return (
                <Animated.View
                  key={i}
                  style={[s.dot, { opacity, transform: [{ scale }] }]}
                />
              );
            })}
          </View>

          <View style={s.mtCircle}>
            <LinearGradient
              colors={["#142418", "#0a1c10", "#060e08"]}
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
            />
            <Image
              source={require("../../assets/images/moodtune-logo.png")}
              resizeMode="cover"
              style={s.mtLogo}
            />
          </View>
        </View>

        {/* Title */}
        <View style={s.titleBlock}>
          <Text style={s.title}>
            <Text style={{ fontWeight: "900" }}>Spotify</Text> 계정 연결 중
          </Text>
          <Text style={s.sub}>
            안전하게 연결하고 맞춤 추천 준비를 진행하고 있어요
          </Text>
          <View style={s.stepHeadlineWrap}>
            <Text style={s.stepHeadlineLeft}>
              {showDone ? "3/3 완료" : `${stage}/3 단계`}
            </Text>
            <Text style={s.stepHeadlineRight}>{stepTitle}</Text>
          </View>
        </View>

        <View style={s.profileCard}>
          <LinearGradient
            colors={[C.cardBg1, C.cardBg2]}
            style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
          />
          <View style={s.profileHeader}>
            <Text style={s.profileTitle}>연결된 계정</Text>
            <Text style={s.profileBadge}>
              {profile?.product === "premium"
                ? "Premium"
                : profile
                  ? "Free"
                  : "확인 중"}
            </Text>
          </View>
          <Text style={s.profileName}>
            {profile?.display_name ?? "Spotify 사용자 확인 중..."}
          </Text>
          <Text style={s.profileEmail}>
            {profile?.email ?? "이메일 확인 중..."}
          </Text>
          <View style={s.summaryRow}>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel} numberOfLines={1}>
                Top Tracks
              </Text>
              <Text style={s.summaryValue} numberOfLines={1}>
                {dataSummary?.topTracks.length ?? 0}
              </Text>
            </View>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel} numberOfLines={1}>
                Top Artists
              </Text>
              <Text style={s.summaryValue} numberOfLines={1}>
                {dataSummary?.topArtists.length ?? 0}
              </Text>
            </View>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel} numberOfLines={1}>
                Playlists
              </Text>
              <Text style={s.summaryValue} numberOfLines={1}>
                {dataSummary?.playlists.length ?? 0}
              </Text>
            </View>
          </View>
        </View>

        {/* Steps */}
        <View style={s.steps}>
          <StepCard
            index={1}
            active={!showDone && stage === 1}
            done={showDone || stage > 1}
            label="계정 인증 및 보안 검증"
          />
          <StepCard
            index={2}
            active={!showDone && stage === 2}
            done={showDone || stage > 2}
            label="취향 데이터 안전 동기화"
          />
          <StepCard
            index={3}
            active={!showDone && stage === 3}
            done={showDone}
            label="맞춤 플레이리스트 준비 완료"
          />
        </View>

        {/* Bottom note */}
        <View style={s.bottom}>
          <View style={s.progressTrack}>
            <Animated.View
              style={[
                s.progressFill,
                {
                  width: progressT.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                },
              ]}
            />
            <LinearGradient
              colors={[
                "rgba(61,220,132,0.0)",
                "rgba(61,220,132,0.35)",
                "rgba(61,220,132,0.0)",
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[StyleSheet.absoluteFill, { opacity: 0.55 }]}
            />
          </View>
          <Text style={s.note}>
            Spotify 공식 OAuth 2.0 방식으로{"\n"}비밀번호는 저장되지 않습니다{" "}
            <Text style={{ color: "rgba(255,255,255,0.55)" }}>🔒</Text>
          </Text>
        </View>

        {showDone ? (
          <Animated.View
            style={[
              s.donePanel,
              { opacity: doneOpacity, transform: [{ scale: doneScale }] },
            ]}
          >
            <View style={s.doneCheckWrap}>
              <Text style={s.doneCheck}>✓</Text>
            </View>
            <Text style={s.doneTitle}>3/3 완료 · 연결이 완료되었습니다</Text>
            <Text style={s.doneSub}>MoodTune 홈으로 안전하게 이동합니다</Text>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

function StepCard({
  index,
  active,
  done,
  label,
}: {
  index: number;
  active: boolean;
  done: boolean;
  label: string;
}) {
  const textColor = done || active
    ? "rgba(255,255,255,0.84)"
    : "rgba(255,255,255,0.30)";

  return (
    <View style={s.card}>
      <LinearGradient
        colors={[C.cardBg1, C.cardBg2]}
        style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
      />
      <View style={s.cardLeft}>
        {done ? (
          <View style={[s.cardDot, { backgroundColor: C.green }]}>
            <Text style={s.check}>✓</Text>
          </View>
        ) : active ? (
          <View
            style={[s.cardDot, { backgroundColor: "rgba(61,220,132,0.22)" }]}
          >
            <ActivityIndicator size="small" color={C.green} />
          </View>
        ) : (
          <View
            style={[
              s.cardDot,
              {
                backgroundColor: "transparent",
                borderColor: "rgba(255,255,255,0.18)",
                borderWidth: 2,
              },
            ]}
          >
            <Text style={s.stepNo}>{index}</Text>
          </View>
        )}
      </View>
      <Text style={[s.cardText, { color: textColor }]}>{label}</Text>
      <Text style={s.cardStatus}>{done ? "완료" : active ? "진행중" : "대기"}</Text>
    </View>
  );
}

function SpotifyGlyph({
  size = 24,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  const d1 =
    "M5.2 9.4c4.4-1.2 9.4-.9 13.5 1.1.4.2.6.7.4 1.1-.2.4-.7.6-1.1.4-3.7-1.8-8.3-2.1-12.3-1-.4.1-.9-.1-1-.6-.1-.4.1-.9.5-1z";
  const d2 =
    "M6.2 12.8c3.6-1 7.6-.7 10.9.9.4.2.5.6.3 1-.2.4-.6.5-1 .3-3-1.4-6.6-1.7-9.8-.8-.4.1-.8-.1-.9-.5-.1-.4.1-.8.5-.9z";
  const d3 =
    "M7.1 16c2.9-.8 6-.6 8.6.7.3.2.4.5.2.9-.2.3-.5.4-.9.2-2.3-1.2-5.1-1.4-7.7-.6-.3.1-.7-.1-.8-.4-.1-.4.1-.7.6-.8z";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={d1} fill={color} />
      <Path d={d2} fill={color} />
      <Path d={d3} fill={color} />
    </Svg>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, overflow: "hidden" },
  bgGlowTop: {
    position: "absolute",
    top: -120,
    left: -180,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: "rgba(61,220,132,0.08)",
    shadowColor: "rgba(61,220,132,0.75)",
    shadowOpacity: 0.18,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  bgGlowBottom: {
    position: "absolute",
    bottom: -230,
    right: -180,
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: "rgba(61,220,132,0.07)",
    shadowColor: "rgba(61,220,132,0.65)",
    shadowOpacity: 0.16,
    shadowRadius: 46,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  wrap: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    justifyContent: "center",
    gap: 26,
  },
  connRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginBottom: 6,
  },
  spCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#1DB954",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1DB954",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  mtCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(61,220,132,0.35)",
    shadowColor: C.green,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  mtLogo: {
    width: "110%",
    height: "110%",
    transform: [{ scale: 1.04 }],
  },
  dotRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 6,
    backgroundColor: "rgba(61,220,132,0.34)",
  },
  titleBlock: { alignItems: "center", gap: 10 },
  title: {
    fontSize: Math.min(30, Math.round(W * 0.09)),
    color: C.t1,
    letterSpacing: -0.6,
    fontWeight: "900",
  },
  sub: {
    fontSize: 15,
    color: C.t2,
    letterSpacing: -0.2,
  },
  stepHeadlineWrap: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.26)",
    backgroundColor: "rgba(61,220,132,0.10)",
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  stepHeadlineLeft: {
    color: C.green,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: -0.1,
  },
  stepHeadlineRight: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 12.5,
    fontWeight: "700",
  },
  steps: { width: "100%", gap: 12, marginTop: 4 },
  profileCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.cardBd,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    overflow: "hidden",
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileTitle: { color: C.t2, fontSize: 12, fontWeight: "700" },
  profileBadge: { color: C.green, fontSize: 12, fontWeight: "800" },
  profileName: {
    color: C.t1,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  profileEmail: { color: C.t2, fontSize: 13.5 },
  summaryRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  summaryItem: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  summaryLabel: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  summaryValue: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
  },
  card: {
    width: "100%",
    minHeight: 62,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.cardBd,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
  },
  cardLeft: { width: 28, alignItems: "center", justifyContent: "center" },
  cardDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  check: { color: "#06120b", fontSize: 14, fontWeight: "900" },
  stepNo: { color: "rgba(255,255,255,0.56)", fontSize: 11, fontWeight: "800" },
  cardText: { flex: 1, fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  cardStatus: { color: "rgba(255,255,255,0.52)", fontSize: 11.5, fontWeight: "700" },
  bottom: { width: "100%", alignItems: "center", gap: 18, marginTop: 12 },
  progressTrack: {
    width: "88%",
    height: 6,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    overflow: "hidden",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 4,
    backgroundColor: "rgba(61,220,132,0.35)",
  },
  note: {
    textAlign: "center",
    color: "rgba(255,255,255,0.34)",
    fontSize: 13.5,
    letterSpacing: -0.1,
  },
  donePanel: {
    marginTop: 8,
    alignSelf: "center",
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.45)",
    backgroundColor: "rgba(61,220,132,0.13)",
  },
  doneCheckWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(61,220,132,0.18)",
  },
  doneCheck: {
    color: "#05200f",
    fontSize: 17,
    fontWeight: "900",
    backgroundColor: C.green,
    borderRadius: 12,
    width: 22,
    height: 22,
    textAlign: "center",
    lineHeight: 22,
  },
  doneTitle: { color: "rgba(255,255,255,0.95)", fontSize: 15, fontWeight: "900" },
  doneSub: { color: "rgba(255,255,255,0.64)", fontSize: 12.5, fontWeight: "600" },
});
