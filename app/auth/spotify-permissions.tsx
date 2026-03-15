// app/auth/spotify-permissions.tsx
// ─────────────────────────────────────────────────────────
//  Spotify Permissions (Post-login consent summary)
//  - Shown after OAuth completes
//  - "동의하고 MoodTune 시작하기" triggers bootstrap fetch
// ─────────────────────────────────────────────────────────
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { getSpotifyUser } from "../../src/api/spotify.service";
import { useAppStore } from "../../src/store/useAppStore";
import type { SpotifyUser } from "../../src/types";

const C = {
  bg: "#030e07",
  green: "#3ddc84",
  greenL: "#5ce891",
  t1: "#ffffff",
  t2: "rgba(255,255,255,0.60)",
  t3: "rgba(255,255,255,0.30)",
  cardBd: "rgba(255,255,255,0.12)",
  cardBg1: "rgba(255,255,255,0.07)",
  cardBg2: "rgba(255,255,255,0.03)",
  warnBg1: "rgba(255,208,77,0.08)",
  warnBg2: "rgba(255,208,77,0.03)",
  warnBd: "rgba(255,208,77,0.22)",
};

const PERMS = [
  {
    icon: "👤",
    title: "프로필 정보 읽기",
    sub: "이름, 프로필 사진, Premium 구독 여부",
  },
  {
    icon: "🎵",
    title: "최근 재생 기록 읽기",
    sub: "Top 트랙, 아티스트, 장르 분석",
  },
  {
    icon: "📋",
    title: "플레이리스트 생성 및 수정",
    sub: "새 플레이리스트 추가 및 트랙 관리",
  },
  {
    icon: "❤️",
    title: "저장된 트랙 읽기",
    sub: "좋아요 트랙으로 취향 파악",
  },
];

export default function SpotifyPermissionsScreen() {
  const insets = useSafeAreaInsets();
  const tokens = useAppStore(s => s.spotifyTokens);
  const setSpotifyUser = useAppStore(s => s.setSpotifyUser);
  const logout = useAppStore(s => s.logout);

  const [user, setUser] = useState<SpotifyUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);

  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 520,
      useNativeDriver: true,
    }).start();
  }, [enter]);

  useEffect(() => {
    if (!tokens?.accessToken) {
      router.replace("/auth/spotify-login" as any);
      return;
    }
    let cancelled = false;
    setLoadingUser(true);
    getSpotifyUser(tokens.accessToken)
      .then(u => {
        if (!cancelled) setUser(u);
      })
      .finally(() => {
        if (!cancelled) setLoadingUser(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokens?.accessToken]);

  const displayName = user?.display_name ?? "Spotify 사용자";
  const email = user?.email ?? "계정 정보 확인 중…";

  const profileAccent = useMemo(() => {
    if (!user?.product) return C.t3;
    return user.product === "premium" ? C.green : "rgba(255,255,255,0.45)";
  }, [user?.product]);

  const onStart = async () => {
    if (tokens?.accessToken) {
      if (user) setSpotifyUser(user);
      router.replace({
        pathname: "/auth/spotify-linking",
        params: { next: "/(tabs)?skipSync=1", mode: "bootstrap" },
      } as any);
    }
  };

  const onCancel = () => {
    logout();
    router.replace("/auth/login" as any);
  };

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
          "rgba(61,220,132,0.14)",
          "rgba(61,220,132,0.05)",
          "rgba(0,0,0,0)",
        ]}
        start={{ x: 0.05, y: 0.05 }}
        end={{ x: 0.85, y: 0.95 }}
        style={[StyleSheet.absoluteFill, { opacity: 0.72 }]}
      />
      <View pointerEvents="none" style={s.bgGlowTop} />
      <View pointerEvents="none" style={s.bgGlowBottom} />

      {/* Header */}
      <View style={s.header}>
        <SpotifyMark size={22} />
        <Text style={s.headerTitle}>Spotify</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        contentContainerStyle={s.scroll}
      >
        <Animated.View
          style={[
            s.content,
            {
              opacity: enter,
              transform: [
                {
                  translateY: enter.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* App + user card */}
          <View style={s.appCard}>
            <LinearGradient
              colors={[C.cardBg1, C.cardBg2]}
              style={[StyleSheet.absoluteFill, { borderRadius: 22 }]}
            />

            <View style={s.appLeft}>
              <View style={s.logoBox}>
                <Image
                  source={require("../../assets/images/moodtune-logo.png")}
                  resizeMode="contain"
                  style={{ width: 56, height: 56 }}
                />
              </View>
              <View style={{ gap: 2 }}>
                <Text style={s.appName}>MoodTune</Text>
                <Text style={s.appSub}>AI Playlist Generator</Text>
              </View>
            </View>

            <View style={s.appRight}>
              <Text style={[s.userName, { color: C.green }]}>
                {displayName}
              </Text>
              <Text style={s.userEmail}>{email}</Text>
              <Text style={[s.userBadge, { color: profileAccent }]}>
                {loadingUser
                  ? "프로필 확인 중…"
                  : user?.product
                    ? user.product === "premium"
                      ? "Premium"
                      : "Free"
                    : ""}
              </Text>
            </View>
          </View>

          {/* Title */}
          <View style={s.titleBlock}>
            <Text style={s.title}>
              MoodTune에게{"\n"}다음 권한을 허용합니다
            </Text>
            <Text style={s.titleSub}>
              아래 항목에 동의해야 MoodTune 서비스를 이용할 수 있습니다
            </Text>
          </View>

          {/* Permission cards */}
          <View style={s.permList}>
            {PERMS.map(p => (
              <View key={p.title} style={s.permCard}>
                <LinearGradient
                  colors={[C.cardBg1, C.cardBg2]}
                  style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
                />
                <View style={s.permIconBox}>
                  <Text style={s.permIcon}>{p.icon}</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.permTitle}>{p.title}</Text>
                  <Text style={s.permSub}>{p.sub}</Text>
                </View>
                <View style={s.checkCircle}>
                  <Text style={s.checkText}>✓</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Security note */}
          <View style={s.warn}>
            <LinearGradient
              colors={[C.warnBg1, C.warnBg2]}
              style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
            />
            <Text style={s.warnText}>
              🔒 MoodTune은 귀하의 비밀번호에 접근하지 않습니다. Spotify{"\n"}
              계정 설정에서 언제든지 연결을 해제할 수 있습니다.
            </Text>
          </View>

          {/* Actions */}
          <View style={s.actions}>
            <Pressable
              onPress={onStart}
              style={({ pressed }) => [
                s.primaryWrap,
                pressed
                  ? { transform: [{ scale: 0.985 }, { translateY: 1 }] }
                  : null,
              ]}
            >
              {({ pressed }) => (
                <LinearGradient
                  colors={[C.greenL, "#2acf72", C.green]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.primary}
                >
                  {pressed ? (
                    <View
                      pointerEvents="none"
                      style={[StyleSheet.absoluteFill, s.pressOverlayDark]}
                    />
                  ) : null}
                  <Text style={s.primaryText}>동의하고 MoodTune 시작하기</Text>
                </LinearGradient>
              )}
            </Pressable>

            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                s.secondary,
                pressed
                  ? { opacity: 0.75, transform: [{ scale: 0.99 }] }
                  : null,
              ]}
            >
              <Text style={s.secondaryText}>취소</Text>
            </Pressable>

            <Text style={s.terms}>
              권한 허용 시 Spotify 이용약관이 적용됩니다
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function SpotifyMark({ size = 22 }: { size?: number }) {
  const d1 =
    "M5.2 9.4c4.4-1.2 9.4-.9 13.5 1.1.4.2.6.7.4 1.1-.2.4-.7.6-1.1.4-3.7-1.8-8.3-2.1-12.3-1-.4.1-.9-.1-1-.6-.1-.4.1-.9.5-1z";
  const d2 =
    "M6.2 12.8c3.6-1 7.6-.7 10.9.9.4.2.5.6.3 1-.2.4-.6.5-1 .3-3-1.4-6.6-1.7-9.8-.8-.4.1-.8-.1-.9-.5-.1-.4.1-.8.5-.9z";
  const d3 =
    "M7.1 16c2.9-.8 6-.6 8.6.7.3.2.4.5.2.9-.2.3-.5.4-.9.2-2.3-1.2-5.1-1.4-7.7-.6-.3.1-.7-.1-.8-.4-.1-.4.1-.7.6-.8z";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="12" fill="#1DB954" />
      <Path d={d1} fill="#0b0b0b" />
      <Path d={d2} fill="#0b0b0b" />
      <Path d={d3} fill="#0b0b0b" />
    </Svg>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, overflow: "hidden" },
  header: {
    height: 56,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  headerTitle: {
    color: C.t1,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  scroll: { paddingHorizontal: 22, paddingBottom: 28 },
  content: { paddingTop: 18, gap: 18 },

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

  appCard: {
    width: "100%",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.cardBd,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    overflow: "hidden",
  },
  appLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.28)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  appName: {
    color: C.t1,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  appSub: { color: C.t2, fontSize: 13.5, letterSpacing: -0.1 },
  appRight: { alignItems: "flex-end", gap: 2 },
  userName: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  userEmail: { color: C.t3, fontSize: 13, letterSpacing: -0.1 },
  userBadge: { fontSize: 12, fontWeight: "700" },

  titleBlock: { gap: 10, marginTop: 6 },
  title: {
    color: C.t1,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.8,
    lineHeight: 34,
  },
  titleSub: {
    color: C.t2,
    fontSize: 14.5,
    letterSpacing: -0.2,
    lineHeight: 20,
  },

  permList: { gap: 12, marginTop: 6 },
  permCard: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.cardBd,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
  },
  permIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "rgba(61,220,132,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  permIcon: { fontSize: 18 },
  permTitle: {
    color: C.t1,
    fontSize: 16.5,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  permSub: { color: C.t2, fontSize: 13.5, letterSpacing: -0.1 },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: "rgba(61,220,132,0.55)",
    backgroundColor: "rgba(61,220,132,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { color: C.green, fontSize: 14, fontWeight: "900" },

  warn: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.warnBd,
    padding: 14,
    overflow: "hidden",
    marginTop: 4,
  },
  warnText: {
    color: "rgba(255,208,77,0.75)",
    fontSize: 13.5,
    lineHeight: 19,
    letterSpacing: -0.1,
  },

  actions: { gap: 12, marginTop: 8, paddingTop: 8 },
  primaryWrap: { width: "100%", borderRadius: 999, overflow: "hidden" },
  primary: { height: 64, alignItems: "center", justifyContent: "center" },
  primaryText: {
    color: "#000",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  secondary: {
    width: "100%",
    height: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  secondaryText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 16,
    fontWeight: "800",
  },
  terms: {
    textAlign: "center",
    color: "rgba(255,255,255,0.28)",
    fontSize: 12.5,
  },
  pressOverlayDark: { backgroundColor: "rgba(0,0,0,0.10)" },
});
