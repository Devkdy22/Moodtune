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
import Svg, { Circle, Path } from "react-native-svg";
import {
  getSpotifyUser,
  refreshSpotifyAccessToken,
} from "../../src/api/spotify.service";
import { useAppStore } from "../../src/store/useAppStore";

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

type Stage = 0 | 1 | 2;

export default function SpotifyLinkingScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    next?: string;
    ms?: string;
    mode?: string;
  }>();

  const nextPath = typeof params.next === "string" ? params.next : "/(tabs)";
  const mode = typeof params.mode === "string" ? params.mode : "demo";
  const totalMs = useMemo(() => {
    const n = Number(params.ms ?? 3600);
    if (!Number.isFinite(n)) return 3600;
    return Math.max(1200, Math.min(15000, Math.floor(n)));
  }, [params.ms]);

  const [stage, setStage] = useState<Stage>(0);
  const tokens = useAppStore(s => s.spotifyTokens);
  const setTokens = useAppStore(s => s.setTokens);
  const setSpotifyUser = useAppStore(s => s.setSpotifyUser);

  // Dots pulse
  const dotT = useRef(new Animated.Value(0)).current;
  const dotCount = 6;
  const dots = useMemo(() => Array.from({ length: dotCount }, (_, i) => i), []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotT, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(dotT, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [dotT]);

  useEffect(() => {
    if (mode !== "bootstrap") {
      const t1 = setTimeout(() => setStage(1), Math.round(totalMs * 0.28));
      const t2 = setTimeout(() => setStage(2), Math.round(totalMs * 0.62));
      const t3 = setTimeout(() => {
        router.replace(nextPath as any);
      }, totalMs);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

    let cancelled = false;
    const startedAt = Date.now();

    const run = async () => {
      try {
        // Stage 0: secure channel
        setStage(0);
        await new Promise(r => setTimeout(r, 420));

        // Stage 1: credentials check (fetch profile)
        setStage(1);
        if (!tokens?.accessToken || !tokens.refreshToken) {
          router.replace("/auth/spotify-login" as any);
          return;
        }

        let accessToken = tokens.accessToken;
        if (tokens.expiresAt && Date.now() > tokens.expiresAt - 30_000) {
          const refreshed = await refreshSpotifyAccessToken({
            refreshToken: tokens.refreshToken,
          });
          if (cancelled) return;
          setTokens(refreshed);
          accessToken = refreshed.accessToken;
        }

        const me = await getSpotifyUser(accessToken);
        if (cancelled) return;
        if (me) setSpotifyUser(me);

        // Stage 2: permission page / data ready
        setStage(2);

        const minShow = 1500;
        const elapsed = Date.now() - startedAt;
        if (elapsed < minShow) {
          await new Promise(r => setTimeout(r, minShow - elapsed));
        }
        if (!cancelled) router.replace(nextPath as any);
      } catch (e) {
        console.error("[spotify-linking] bootstrap failed:", e);
        if (!cancelled) router.replace("/auth/spotify-login" as any);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [mode, nextPath, totalMs, setSpotifyUser, setTokens, tokens?.accessToken, tokens?.expiresAt, tokens?.refreshToken]);

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Background */}
      <LinearGradient
        colors={["#020a06", "#062015", "#010603"]}
        locations={[0, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(61,220,132,0.15)", "rgba(61,220,132,0.05)", "rgba(0,0,0,0)"]}
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
              const local = Animated.modulo(Animated.add(dotT, i / dotCount), 1);
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
              resizeMode="contain"
              style={{ width: 44, height: 44 }}
            />
          </View>
        </View>

        {/* Title */}
        <View style={s.titleBlock}>
          <Text style={s.title}>
            <Text style={{ fontWeight: "900" }}>Spotify</Text> 계정 연결 중
          </Text>
          <Text style={s.sub}>보안 채널을 통해 인증 중입니다...</Text>
        </View>

        {/* Steps */}
        <View style={s.steps}>
          <StepCard
            state="done"
            label="보안 HTTPS 채널 연결"
            accent={C.green}
          />
          <StepCard
            state={stage >= 1 ? "active" : "pending"}
            label="계정 자격 증명 확인 중..."
            accent={C.green}
          />
          <StepCard
            state={stage >= 2 ? "active" : "pending"}
            label="권한 승인 페이지 로드 대기"
            accent={C.green}
            dim
          />
        </View>

        {/* Bottom note */}
        <View style={s.bottom}>
          <View style={s.progressTrack}>
            <LinearGradient
              colors={["rgba(61,220,132,0.0)", "rgba(61,220,132,0.35)", "rgba(61,220,132,0.0)"]}
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
      </View>
    </View>
  );
}

function StepCard({
  state,
  label,
  accent,
  dim,
}: {
  state: "done" | "active" | "pending";
  label: string;
  accent: string;
  dim?: boolean;
}) {
  const isDone = state === "done";
  const isActive = state === "active";
  const isPending = state === "pending";
  const textColor = isPending ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.80)";
  const dotBg = isPending ? "rgba(255,255,255,0.14)" : accent;

  return (
    <View style={[s.card, dim ? { opacity: 0.72 } : null]}>
      <LinearGradient
        colors={[C.cardBg1, C.cardBg2]}
        style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
      />
      <View style={s.cardLeft}>
        {isDone ? (
          <View style={[s.cardDot, { backgroundColor: dotBg }]}>
            <Text style={s.check}>✓</Text>
          </View>
        ) : isActive ? (
          <View style={[s.cardDot, { backgroundColor: "rgba(61,220,132,0.22)" }]}>
            <ActivityIndicator size="small" color={accent} />
          </View>
        ) : (
          <View style={[s.cardDot, { backgroundColor: "transparent", borderColor: dotBg, borderWidth: 2 }]} />
        )}
      </View>
      <Text style={[s.cardText, { color: textColor }]}>{label}</Text>
    </View>
  );
}

function SpotifyGlyph({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
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
  steps: { width: "100%", gap: 12, marginTop: 4 },
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
  cardText: { flex: 1, fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  bottom: { width: "100%", alignItems: "center", gap: 18, marginTop: 12 },
  progressTrack: {
    width: "88%",
    height: 6,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    overflow: "hidden",
  },
  note: { textAlign: "center", color: "rgba(255,255,255,0.34)", fontSize: 13.5, letterSpacing: -0.1 },
});
