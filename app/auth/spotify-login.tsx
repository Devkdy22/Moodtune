// app/(auth)/spotify-login.tsx
// ═══════════════════════════════════════════════════════════════════════
//  MoodTune · Spotify 연동 화면 (OAuth 2.0)
//
//  ┌─ 디자인 스펙 (이미지 픽셀 퍼펙트) ──────────────────────────────┐
//  │  헤더: ← 뒤로가기 | Spotify 그린 아이콘 | "Spotify 연동"        │
//  │  커넥션 다이어그램:                                              │
//  │    [Spotify 앱 원형] ···OAuth 2.0··· [MoodTune 원형]            │
//  │    Spotify 원에 상단 ❶ 알림 뱃지 (주황)                         │
//  │    점선 3개 중간 레이블, 양쪽 라벨                               │
//  │  메인 타이틀: "Spotify 앱으로 바로 연동" Bold Black              │
//  │  서브: 2줄 설명                                                  │
//  │  메인 CTA: 초록 그라디언트 버튼 + Spotify 아이콘 + shimmer       │
//  │  (Removed) 감지 상태 카드                                        │
//  │  구분 "앱이 없으신가요?" 텍스트 divider                          │
//  │  웹 브라우저 로그인 버튼: 🌐 + 텍스트 (다크 glass)               │
//  │  Spotify 앱 설치하기 버튼: Spotify 아이콘 + 텍스트               │
//  │  "계정이 없으신가요? 무료로 가입하기" 하단 링크                  │
//  │  면책 2줄 텍스트 최하단                                          │
//  └──────────────────────────────────────────────────────────────────┘
//
//  애니메이션:
//  ① 입장: 로고 다이어그램 fade-scale → 텍스트 fade-up → 버튼 fade-up
//  ② 커넥션 점 3개: 왼→오 순서로 pulse (연결 흐름 표현)
//  ③ Spotify 원 상단 뱃지: 위아래 bounce
//  ④ 메인 버튼 shimmer 슬라이드
//  ⑤ MoodTune 원: 네온 테두리 glow pulse
// ═══════════════════════════════════════════════════════════════════════

import * as AuthSession from "expo-auth-session";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import {
  exchangeSpotifyCodeForTokens,
  SPOTIFY_DISCOVERY,
  SPOTIFY_SCOPES,
} from "../../src/api/spotify.service";
import { useAppStore } from "../../src/store/useAppStore";

const { width: W } = Dimensions.get("window");

WebBrowser.maybeCompleteAuthSession();

/* ─── 디자인 토큰 ─────────────────────────────────────────────── */
const C = {
  // 배경
  bg: "#030e07",
  bgHeader: "rgba(3,12,6,0.97)",
  bgCard: "#081a0c",
  bgCardBd: "rgba(255,255,255,0.10)",
  bgBtn2: "#0d1e11", // 웹/설치 버튼 배경
  bgBtn2Bd: "rgba(255,255,255,0.12)",
  // 초록
  green: "#3ddc84",
  greenL: "#5ce891",
  greenD: "#1aae5c",
  greenBtn1: "#44ea8e",
  greenBtn2: "#1db85e",
  greenDot: "#22e870",
  // 텍스트
  t1: "#ffffff",
  t2: "rgba(255,255,255,0.58)",
  t3: "rgba(255,255,255,0.30)",
  // Spotify 로고 원 배경
  spBg: "#121212",
  spBd: "rgba(255,255,255,0.15)",
  // MoodTune 원
  mtBg: "#0e2415",
  mtBd: "rgba(61,220,132,0.45)",
  // 구분선
  sep: "rgba(255,255,255,0.09)",
  // 뱃지
  badgeBg: "#e85c0d",
};

const HEADER_H = 56;
const USE_NATIVE_DRIVER = Platform.OS !== "web";
const DEFAULT_WEB_BASE_URL = "https://moodtune-web.vercel.app";

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function SpotifyLoginScreen() {
  const insets = useSafeAreaInsets();
  const setTokens = useAppStore(s => s.setTokens);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const clientId = (process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? "").trim();
  const devWebBaseUrl = (process.env.EXPO_PUBLIC_WEB_BASE_URL_DEV ?? "").trim();
  const prodWebBaseUrl = (
    process.env.EXPO_PUBLIC_WEB_BASE_URL_PROD ?? ""
  ).trim();
  const devWebRedirectUri = (
    process.env.EXPO_PUBLIC_SPOTIFY_WEB_REDIRECT_URI_DEV ?? ""
  ).trim();
  const prodWebRedirectUri = (
    process.env.EXPO_PUBLIC_SPOTIFY_WEB_REDIRECT_URI_PROD ?? ""
  ).trim();
  const devProxyReturnUrl = (
    process.env.EXPO_PUBLIC_PROXY_RETURN_URL_DEV ?? ""
  ).trim();
  const prodProxyReturnUrl = (
    process.env.EXPO_PUBLIC_PROXY_RETURN_URL_PROD ?? ""
  ).trim();
  const webOrigin = useMemo(() => {
    if (Platform.OS !== "web") return null;
    if (typeof window === "undefined") return null;
    return window.location.origin;
  }, []);
  const isInsecureWebContext = useMemo(() => {
    if (Platform.OS !== "web") return false;
    if (typeof window === "undefined") return false;
    return !window.isSecureContext;
  }, []);
  const shouldUseProxy = useMemo(() => {
    if (!__DEV__) return false;
    // Web은 proxy를 쓰면 returnUrl이 http(로컬 IP/localhost)인 경우가 많아
    // auth.expo.io에서 앱/웹으로 복귀를 못 하며 에러 화면이 뜰 수 있어요.
    if (Platform.OS === "web") return false;
    return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  }, []);

  const projectFullName =
    Constants.expoConfig?.originalFullName ||
    (Constants.expoConfig?.owner && Constants.expoConfig?.slug
      ? `@${Constants.expoConfig.owner}/${Constants.expoConfig.slug}`
      : null);
  const proxyRedirectUri = useMemo(() => {
    if (!projectFullName) return null;
    return `https://auth.expo.io/${projectFullName}`;
  }, [projectFullName]);

  const nativeRedirectUri = useMemo(() => {
    if (Platform.OS !== "web") {
      return AuthSession.makeRedirectUri({
        scheme: "moodtune",
        path: "auth/spotify-login",
      });
    }

    const configuredRedirectUri = __DEV__
      ? devWebRedirectUri
      : prodWebRedirectUri;
    if (configuredRedirectUri) return configuredRedirectUri;

    const baseUrl = (
      (__DEV__ ? devWebBaseUrl : prodWebBaseUrl) ||
      webOrigin ||
      DEFAULT_WEB_BASE_URL
    ).replace(/\/+$/, "");
    return `${baseUrl}/auth/spotify-login`;
  }, [
    devWebBaseUrl,
    devWebRedirectUri,
    prodWebBaseUrl,
    prodWebRedirectUri,
    webOrigin,
  ]);

  const redirectUri =
    shouldUseProxy && proxyRedirectUri ? proxyRedirectUri : nativeRedirectUri;
  const proxyReturnUrl = useMemo(() => {
    const envReturnUrl = __DEV__ ? devProxyReturnUrl : prodProxyReturnUrl;
    if (envReturnUrl) return envReturnUrl;
    return AuthSession.getDefaultReturnUrl("auth/spotify-login");
  }, [devProxyReturnUrl, prodProxyReturnUrl]);

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      scopes: SPOTIFY_SCOPES,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: !isInsecureWebContext,
    },
    SPOTIFY_DISCOVERY,
  );
  const isOAuthReady = Boolean(request);

  useEffect(() => {
    if (!__DEV__) return;
    console.log("[spotify-login] shouldUseProxy:", shouldUseProxy);
    console.log("[spotify-login] proxyRedirectUri:", proxyRedirectUri);
    console.log("[spotify-login] nativeRedirectUri:", nativeRedirectUri);
    console.log("[spotify-login] redirectUri:", redirectUri);
    console.log("[spotify-login] proxyReturnUrl:", proxyReturnUrl);
    console.log("[spotify-login] webOrigin:", webOrigin);
    console.log("[spotify-login] isInsecureWebContext:", isInsecureWebContext);
    console.log("[spotify-login] devWebBaseUrl:", devWebBaseUrl);
    console.log("[spotify-login] prodWebBaseUrl:", prodWebBaseUrl);
    console.log("[spotify-login] devWebRedirectUri:", devWebRedirectUri);
    console.log("[spotify-login] prodWebRedirectUri:", prodWebRedirectUri);
    console.log("[spotify-login] devProxyReturnUrl:", devProxyReturnUrl);
    console.log("[spotify-login] prodProxyReturnUrl:", prodProxyReturnUrl);
    if (request?.url) {
      try {
        const u = new URL(request.url);
        console.log("[spotify-login] authUrl:", request.url);
        console.log(
          "[spotify-login] authUrl.client_id:",
          JSON.stringify(u.searchParams.get("client_id")),
        );
        console.log(
          "[spotify-login] authUrl.redirect_uri:",
          JSON.stringify(u.searchParams.get("redirect_uri")),
        );
      } catch {
        console.log("[spotify-login] authUrl: (parse failed)");
      }
    }
  }, [
    devProxyReturnUrl,
    devWebBaseUrl,
    devWebRedirectUri,
    isInsecureWebContext,
    nativeRedirectUri,
    prodProxyReturnUrl,
    prodWebBaseUrl,
    prodWebRedirectUri,
    proxyRedirectUri,
    proxyReturnUrl,
    redirectUri,
    request?.url,
    shouldUseProxy,
    webOrigin,
  ]);

  /* ── Animated Values ── */
  // 입장 시퀀스
  const diagOp = useRef(new Animated.Value(0)).current;
  const diagScale = useRef(new Animated.Value(0.88)).current;
  const textOp = useRef(new Animated.Value(0)).current;
  const textY = useRef(new Animated.Value(20)).current;
  const btnsOp = useRef(new Animated.Value(0)).current;
  const btnsY = useRef(new Animated.Value(18)).current;

  // 연결 점 3개 (왼→오 순차 pulse)
  const dot1Op = useRef(new Animated.Value(0.25)).current;
  const dot2Op = useRef(new Animated.Value(0.25)).current;
  const dot3Op = useRef(new Animated.Value(0.25)).current;

  // Spotify 뱃지 bounce
  const badgeY = useRef(new Animated.Value(0)).current;

  // 버튼 shimmer
  const shimX = useRef(new Animated.Value(-W)).current;

  // MoodTune 원 glow
  const mtGlowR = useRef(new Animated.Value(10)).current;
  const mtGlowOp = useRef(new Animated.Value(0.5)).current;

  // 배경 글로우 drift (천천히 이동)
  const bgGlowTopT = useRef(new Animated.Value(0)).current;
  const bgGlowBottomT = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    /* 1. 입장 시퀀스 ──────────────────────────────────────── */
    Animated.sequence([
      Animated.delay(120),
      Animated.parallel([
        Animated.timing(diagOp, {
          toValue: 1,
          duration: 560,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.spring(diagScale, {
          toValue: 1,
          tension: 52,
          friction: 9,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(320),
      Animated.parallel([
        Animated.timing(textOp, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(textY, {
          toValue: 0,
          duration: 480,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(500),
      Animated.parallel([
        Animated.timing(btnsOp, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(btnsY, {
          toValue: 0,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    ]).start();

    /* 2. 연결 점 순차 pulse (왼→오 흐름) ──────────────────── */
    const runDots = () => {
      const STEP = 320;
      const FADE_DUR = 280;
      const HOLD = 180;

      Animated.loop(
        Animated.sequence([
          // dot1 켜짐
          Animated.timing(dot1Op, {
            toValue: 1,
            duration: FADE_DUR,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.delay(HOLD),
          // dot2 켜짐
          Animated.timing(dot2Op, {
            toValue: 1,
            duration: FADE_DUR,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.delay(HOLD),
          // dot3 켜짐
          Animated.timing(dot3Op, {
            toValue: 1,
            duration: FADE_DUR,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.delay(400),
          // 모두 꺼짐
          Animated.parallel([
            Animated.timing(dot1Op, {
              toValue: 0.25,
              duration: FADE_DUR,
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
            Animated.timing(dot2Op, {
              toValue: 0.25,
              duration: FADE_DUR,
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
            Animated.timing(dot3Op, {
              toValue: 0.25,
              duration: FADE_DUR,
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
          ]),
          Animated.delay(300),
        ]),
      ).start();
    };
    setTimeout(runDots, 800);

    /* 3. 뱃지 bounce ──────────────────────────────────────── */
    Animated.loop(
      Animated.sequence([
        Animated.timing(badgeY, {
          toValue: -4,
          duration: 600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(badgeY, {
          toValue: 0,
          duration: 600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    ).start();

    /* 4. 버튼 shimmer ─────────────────────────────────────── */
    Animated.loop(
      Animated.sequence([
        Animated.delay(2000),
        Animated.timing(shimX, {
          toValue: W * 1.3,
          duration: 720,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(shimX, {
          toValue: -W,
          duration: 0,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    ).start();

    /* 5. MoodTune 원 glow pulse ───────────────────────────── */
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(mtGlowR, {
            toValue: 22,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
          Animated.timing(mtGlowOp, {
            toValue: 0.88,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
        ]),
        Animated.parallel([
          Animated.timing(mtGlowR, {
            toValue: 8,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
          Animated.timing(mtGlowOp, {
            toValue: 0.38,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
        ]),
      ]),
    ).start();

    /* 6. 배경 글로우 drift ─────────────────────────────────── */
    Animated.loop(
      Animated.sequence([
        Animated.timing(bgGlowTopT, {
          toValue: 1,
          duration: 12000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(bgGlowTopT, {
          toValue: 0,
          duration: 12000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(bgGlowBottomT, {
          toValue: 1,
          duration: 12000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(bgGlowBottomT, {
          toValue: 0,
          duration: 12000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    ).start();
  }, []);

  const completeOAuth = async (code: string) => {
    const codeVerifier = (request as any)?.codeVerifier as string | undefined;
    if (!codeVerifier) throw new Error("Missing OAuth codeVerifier");
    const tokens = await exchangeSpotifyCodeForTokens({
      code,
      codeVerifier,
      redirectUri,
    });
    setTokens(tokens);
    router.replace("/auth/spotify-permissions" as any);
  };

  /* ── 핸들러 ── */
  const handleSpotifyApp = async () => {
    if (!clientId) {
      Alert.alert(
        "환경변수 필요",
        "EXPO_PUBLIC_SPOTIFY_CLIENT_ID가 설정되지 않았어요.",
      );
      return;
    }
    if (!request) {
      const msg =
        "OAuth 요청이 아직 준비되지 않았어요. 잠시 후 다시 시도하거나 페이지를 새로고침해 주세요.";
      setOauthError(msg);
      Alert.alert("Spotify 로그인 준비 중", msg);
      return;
    }
    if (Platform.OS === "web" && isInsecureWebContext) {
      Alert.alert(
        "보안 연결 필요",
        "현재 주소가 HTTP(로컬 IP)라서 브라우저가 Spotify 로그인용 보안 암호화(PKCE/WebCrypto)를 차단합니다. HTTPS 주소(터널/배포)에서 접속하거나, 같은 기기에서 localhost로 실행해 주세요.",
      );
      return;
    }
    setOauthError(null);
    try {
      setOauthLoading(true);

      if (shouldUseProxy) {
        if (!proxyRedirectUri) {
          throw new Error(
            "Expo AuthSession proxy URL을 만들 수 없어요. (Constants.expoConfig.originalFullName 없음)",
          );
        }
        if (!request.url) {
          throw new Error(
            "OAuth 요청이 아직 준비되지 않았어요. 잠시 후 다시 시도해주세요.",
          );
        }

        const startUrl =
          `${proxyRedirectUri}/start` +
          `?authUrl=${encodeURIComponent(request.url)}` +
          `&returnUrl=${encodeURIComponent(proxyReturnUrl)}`;

        const wb = await WebBrowser.openAuthSessionAsync(
          startUrl,
          proxyReturnUrl,
        );
        if (wb.type !== "success") return;

        const parsed = request.parseReturnUrl(wb.url);
        if (parsed.type !== "success") {
          throw new Error(
            parsed.type === "error" ? "OAuth error" : "OAuth canceled",
          );
        }
        const code = (parsed as any).params?.code as string | undefined;
        if (!code) throw new Error("Missing OAuth code");
        await completeOAuth(code);
        return;
      }

      const res = await promptAsync();
      if (res.type !== "success") return;
      const code = (res as any).params?.code as string | undefined;
      if (!code) throw new Error("Missing OAuth code");
      await completeOAuth(code);
    } catch (e: any) {
      console.error("[spotify-login] OAuth failed:", e);
      setOauthError(String(e?.message ?? "OAuth failed"));
      Alert.alert("Spotify 로그인 실패", "다시 시도해주세요.");
    } finally {
      setOauthLoading(false);
    }
  };

  const handleWebLogin = () => {
    // 동일 OAuth 플로우 사용 (웹/앱 공통)
    handleSpotifyApp();
  };

  const handleInstall = async () => {
    const iosAppStoreWeb = "https://apps.apple.com/app/spotify/id324684580";
    const androidPlayWeb =
      "https://play.google.com/store/apps/details?id=com.spotify.music";

    if (Platform.OS === "web") {
      // iPhone/iPad Safari uses web build; route to App Store instead of Play Store.
      const ua =
        typeof navigator !== "undefined" ? (navigator.userAgent ?? "") : "";
      const isIOSWeb = /iPad|iPhone|iPod/i.test(ua);
      await Linking.openURL(isIOSWeb ? iosAppStoreWeb : androidPlayWeb);
      return;
    }

    if (Platform.OS === "ios") {
      // Prefer opening App Store app, fallback to web.
      const appStoreScheme = "itms-apps://itunes.apple.com/app/id324684580";
      try {
        await Linking.openURL(appStoreScheme);
      } catch {
        await Linking.openURL(iosAppStoreWeb);
      }
      return;
    }

    if (Platform.OS === "android") {
      // Prefer opening Play Store app, fallback to web.
      const playStoreScheme = "market://details?id=com.spotify.music";
      try {
        await Linking.openURL(playStoreScheme);
      } catch {
        await Linking.openURL(androidPlayWeb);
      }
      return;
    }

    // Web/other platforms
    await Linking.openURL(androidPlayWeb);
  };

  const handleSignUp = () => {
    Linking.openURL("https://www.spotify.com/signup");
  };

  return (
    <View style={s.root}>
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />

      {/* 배경 그라디언트 */}
      <LinearGradient
        colors={["#020a06", "#062015", "#010603"]}
        locations={[0, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* 초록빛 오버레이(은은한 무드) */}
      <LinearGradient
        colors={[
          "rgba(61,220,132,0.16)",
          "rgba(61,220,132,0.06)",
          "rgba(0,0,0,0)",
        ]}
        start={{ x: 0.05, y: 0.05 }}
        end={{ x: 0.85, y: 0.95 }}
        style={[
          StyleSheet.absoluteFill,
          { opacity: 0.75, pointerEvents: "none" },
        ]}
      />
      <Animated.View
        style={[
          s.bgGlowTop,
          {
            opacity: bgGlowTopT.interpolate({
              inputRange: [0, 1],
              outputRange: [0.9, 0.65],
            }),
            transform: [
              {
                translateX: bgGlowTopT.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-14, 14],
                }),
              },
              {
                translateY: bgGlowTopT.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, -10],
                }),
              },
              {
                scale: bgGlowTopT.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.05],
                }),
              },
            ],
          },
          { pointerEvents: "none" },
        ]}
      />
      <Animated.View
        style={[
          s.bgGlowBottom,
          {
            opacity: bgGlowBottomT.interpolate({
              inputRange: [0, 1],
              outputRange: [0.85, 0.6],
            }),
            transform: [
              {
                translateX: bgGlowBottomT.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, -12],
                }),
              },
              {
                translateY: bgGlowBottomT.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-10, 14],
                }),
              },
              {
                scale: bgGlowBottomT.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.04],
                }),
              },
            ],
          },
          { pointerEvents: "none" },
        ]}
      />

      {/* ══════════════════════════════
          헤더
          ══════════════════════════════ */}
      <View style={[s.header, { paddingTop: insets.top }]}>
        <LinearGradient
          colors={["rgba(3,12,6,0.98)", "rgba(3,11,5,0.92)"]}
          style={StyleSheet.absoluteFill}
        />
        <View style={s.headerSep} />
        <View style={s.headerRow}>
          {/* 뒤로가기 */}
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              s.backBtn,
              pressed ? { opacity: 0.72, transform: [{ scale: 0.96 }] } : null,
            ]}
            hitSlop={10}
          >
            <Text style={s.backArrow}>←</Text>
          </Pressable>

          {/* 아이콘 + 타이틀 */}
          <View style={s.headerTitleRow}>
            <SpotifyMark size={30} />
            <Text style={s.headerTitle}>Spotify 연동</Text>
          </View>

          <View style={{ width: 38 }} />
        </View>
      </View>

      {/* ══════════════════════════════
          본문 스크롤
          ══════════════════════════════ */}
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          {
            paddingTop: insets.top + HEADER_H + 44,
            paddingBottom: insets.bottom + 28,
          },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── 커넥션 다이어그램 ── */}
        <Animated.View
          style={[
            s.diagram,
            { opacity: diagOp, transform: [{ scale: diagScale }] },
          ]}
        >
          {/* Spotify 앱 원 */}
          <View style={s.diagItem}>
            <View style={s.spCircleWrap}>
              {/* 알림 뱃지 */}
              <Animated.View
                style={[s.badge, { transform: [{ translateY: badgeY }] }]}
              >
                <Text style={s.badgeText}>!</Text>
              </Animated.View>

              {/* Spotify 원 본체 */}
              <View style={s.spCircle}>
                <LinearGradient
                  colors={["#1a1a1a", "#111111", "#0d0d0d"]}
                  style={[
                    StyleSheet.absoluteFill,
                    { zIndex: 0, pointerEvents: "none" },
                  ]}
                />
                <View style={{ zIndex: 1 }}>
                  <SpotifyMark size={60} />
                </View>
              </View>
            </View>
            <Text style={s.diagLabel}>Spotify 앱</Text>
          </View>

          {/* 중간 연결 점 + OAuth 레이블 */}
          <View style={s.diagMiddle}>
            <View style={s.dotsRow}>
              <Animated.View style={[s.dot, { opacity: dot1Op }]} />
              <Animated.View style={[s.dot, { opacity: dot2Op }]} />
              <Animated.View style={[s.dot, { opacity: dot3Op }]} />
            </View>
            <Text style={s.oauthLabel}>OAuth 2.0</Text>
          </View>

          {/* MoodTune 원 */}
          <View style={s.diagItem}>
            <View style={s.mtCircleWrap}>
              {/* 로고 뒤 번짐(블룸) */}
              <Animated.View
                style={[
                  s.mtBloom,
                  { opacity: mtGlowOp, pointerEvents: "none" },
                ]}
              />
              {/* 네온 glow 링 */}
              <Animated.View
                style={[
                  s.mtGlowRing,
                  {
                    shadowRadius: mtGlowR,
                    shadowOpacity: mtGlowOp,
                    pointerEvents: "none",
                  },
                ]}
              />
              {/* MoodTune 원 본체 */}
              <View style={s.mtCircle}>
                <LinearGradient
                  colors={["#142418", "#0a1c10", "#060e08"]}
                  style={[
                    StyleSheet.absoluteFill,
                    { zIndex: 0, pointerEvents: "none" },
                  ]}
                />
                {/* Moodtune 로고 */}
                {/* 실제 앱: <Image source={require('../../assets/logo.png')} /> */}
                <Image
                  source={require("../../assets/images/moodtune-logo.png")}
                  resizeMode="contain"
                  style={{ width: "100%", height: "100%", zIndex: 1 }}
                />
              </View>
            </View>
            <Text style={s.diagLabel}>MoodTune</Text>
          </View>
        </Animated.View>

        {/* ── 타이틀 + 서브 ── */}
        <Animated.View
          style={[
            s.titleBlock,
            { opacity: textOp, transform: [{ translateY: textY }] },
          ]}
        >
          <Text style={s.titleMain}>Spotify 앱으로 바로 연동</Text>
          <Text style={s.titleSub}>
            {
              "이미 로그인된 Spotify 앱으로\n비밀번호 입력 없이 빠르게 시작하세요"
            }
          </Text>
          {oauthError ? <Text style={s.oauthErr}>{oauthError}</Text> : null}
        </Animated.View>

        {/* ── 버튼 영역 ── */}
        <Animated.View
          style={[
            s.btnsBlock,
            { opacity: btnsOp, transform: [{ translateY: btnsY }] },
          ]}
        >
          {/* ① 메인 CTA: Spotify 앱으로 로그인 */}
          <Pressable
            onPress={handleSpotifyApp}
            disabled={oauthLoading || !isOAuthReady}
            style={({ pressed }) => [
              s.mainBtnWrap,
              oauthLoading || !isOAuthReady ? { opacity: 0.8 } : null,
              pressed
                ? { transform: [{ scale: 0.985 }, { translateY: 1 }] }
                : null,
            ]}
          >
            {({ pressed }) => (
              <LinearGradient
                colors={[C.greenBtn1, "#2acf72", C.greenBtn2]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.mainBtn}
              >
                {/* shimmer */}
                <Animated.View
                  style={[
                    s.shimmer,
                    {
                      transform: [{ translateX: shimX }, { skewX: "-22deg" }],
                      pointerEvents: "none",
                    },
                  ]}
                />
                {pressed ? (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      s.pressOverlayDark,
                      { pointerEvents: "none" },
                    ]}
                  />
                ) : null}
                <View style={s.mainBtnIconWrap}>
                  {oauthLoading ? (
                    <ActivityIndicator size="small" color={C.green} />
                  ) : (
                    <SpotifyIcon size={20} color={C.green} />
                  )}
                </View>
                <Text style={s.mainBtnText}>
                  {oauthLoading
                    ? "Spotify 로그인 여는 중..."
                    : !isOAuthReady
                      ? "Spotify 로그인 준비 중..."
                      : "Spotify 앱으로 로그인"}
                </Text>
              </LinearGradient>
            )}
          </Pressable>

          {/* ② 구분 텍스트 divider */}
          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>앱이 없으신가요?</Text>
            <View style={s.dividerLine} />
          </View>

          {/* ③ 웹 브라우저로 로그인 */}
          <Pressable
            onPress={handleWebLogin}
            disabled={oauthLoading || !isOAuthReady}
            style={({ pressed }) => [
              s.subBtn,
              oauthLoading || !isOAuthReady ? { opacity: 0.6 } : null,
              pressed ? { transform: [{ scale: 0.99 }], opacity: 0.92 } : null,
            ]}
            android_ripple={{ color: "rgba(255,255,255,0.10)" }}
          >
            {({ pressed }) => (
              <>
                <LinearGradient
                  colors={["rgba(255,255,255,0.07)", "rgba(255,255,255,0.04)"]}
                  style={StyleSheet.absoluteFill}
                />
                {pressed ? (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      s.pressOverlayLight,
                      { pointerEvents: "none" },
                    ]}
                  />
                ) : null}
                <Text style={s.subBtnIcon}>🌐</Text>
                <Text style={s.subBtnText}>웹 브라우저로 로그인</Text>
              </>
            )}
          </Pressable>

          {/* ④ Spotify 앱 설치하기 */}
          <Pressable
            onPress={handleInstall}
            style={({ pressed }) => [
              s.subBtn,
              pressed ? { transform: [{ scale: 0.99 }], opacity: 0.92 } : null,
            ]}
            android_ripple={{ color: "rgba(255,255,255,0.10)" }}
          >
            {({ pressed }) => (
              <>
                <LinearGradient
                  colors={["rgba(255,255,255,0.07)", "rgba(255,255,255,0.04)"]}
                  style={StyleSheet.absoluteFill}
                />
                {pressed ? (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      s.pressOverlayLight,
                      { pointerEvents: "none" },
                    ]}
                  />
                ) : null}
                <View style={s.subBtnSpIcon}>
                  <SpotifyMark size={18} />
                </View>
                <Text style={s.subBtnText}>Spotify 앱 설치하기</Text>
              </>
            )}
          </Pressable>

          {/* ⑤ 무료 가입하기 */}
          <View style={s.signupRow}>
            <Text style={s.signupText}>계정이 없으신가요? </Text>
            <Pressable
              onPress={handleSignUp}
              style={({ pressed }) => (pressed ? { opacity: 0.75 } : null)}
              hitSlop={8}
            >
              <Text style={s.signupLink}>무료로 가입하기</Text>
            </Pressable>
          </View>
        </Animated.View>

        {/* 하단 면책 */}
        <View style={s.disclaimer}>
          <Text style={s.disclaimerText}>
            {
              "MoodTune은 Spotify의 공식 OAuth 2.0 방식으로\n안전하게 연동됩니다. 비밀번호는 저장되지 않습니다."
            }
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SUB COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

/* Spotify 아이콘 (login.tsx와 동일한 SVG) */
function SpotifyIcon({
  size = 22,
  color = "#000",
}: {
  size?: number;
  color?: string;
}) {
  // spotify glyph (simplified) path
  // source: hand-tuned for RN-SVG viewBox 0 0 24 24
  const d1 =
    "M5.2 9.4c4.4-1.2 9.4-.9 13.5 1.1.4.2.6.7.4 1.1-.2.4-.7.6-1.1.4-3.7-1.8-8.3-2.1-12.3-1-.4.1-.9-.1-1-.6-.1-.4.1-.9.5-1z";
  const d2 =
    "M6.2 12.8c3.6-1 7.6-.7 10.9.9.4.2.5.6.3 1-.2.4-.6.5-1 .3-3-1.4-6.6-1.7-9.8-.8-.4.1-.8-.1-.9-.5-.1-.4.1-.8.5-.9z";
  const d3 =
    "M7.1 16c2.9-.8 6-.6 8.6.7.3.2.4.5.2.9-.2.3-.5.4-.9.2-2.3-1.2-5.1-1.4-7.7-.6-.3.1-.7-.1-.8-.4-.1-.4.1-.7.6-.8z";

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10" fill={color} opacity={0.08} />
      <Path d={d1} fill={color} />
      <Path d={d2} fill={color} />
      <Path d={d3} fill={color} />
    </Svg>
  );
}

function SpotifyMark({ size = 22 }: { size?: number }) {
  // green circle + dark glyph (matches the provided mark image)
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
/* ═══════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════ */
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    overflow: "hidden",
  },

  /* ── 헤더 ── */
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  headerSep: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: C.sep,
  },
  headerRow: {
    height: HEADER_H,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.09)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    alignItems: "center",
    justifyContent: "center",
  },
  backArrow: {
    color: C.t1,
    fontSize: 18,
    lineHeight: 22,
    includeFontPadding: false,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: C.t1,
    letterSpacing: -0.3,
  },

  /* ── 스크롤 ── */
  scroll: {
    alignItems: "center",
    paddingHorizontal: 22,
  },

  /* ── 커넥션 다이어그램 ── */
  diagram: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    marginBottom: 32,
    width: "100%",
  },
  diagItem: {
    alignItems: "center",
    gap: 10,
  },

  /* Spotify 원 */
  spCircleWrap: {
    position: "relative",
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
  },
  spCircle: {
    position: "relative",
    width: 84,
    height: 84,
    borderRadius: 42,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: C.spBd,
    alignItems: "center",
    justifyContent: "center",
  },

  /* 알림 뱃지 */
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    zIndex: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.badgeBg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.bg,
    shadowColor: C.badgeBg,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
    elevation: 6,
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 15,
    includeFontPadding: false,
  },

  /* 중간 점 + 레이블 */
  diagMiddle: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 4,
    marginTop: -16, // 원 중앙에 맞춤
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.green,
    shadowColor: C.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 4,
  },
  oauthLabel: {
    fontSize: 11,
    color: C.t3,
    fontWeight: "500",
    letterSpacing: 0.2,
  },

  /* MoodTune 원 */
  mtCircleWrap: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  mtGlowRing: {
    position: "absolute",
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 2,
    borderColor: C.green,
    backgroundColor: "transparent",
    shadowColor: C.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 14,
    elevation: 8,
  },
  mtCircle: {
    position: "relative",
    width: 84,
    height: 84,
    borderRadius: 42,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: C.mtBd,
    alignItems: "center",
    justifyContent: "center",
  },

  /* 다이어그램 하단 라벨 */
  diagLabel: {
    fontSize: 12.5,
    color: C.t2,
    fontWeight: "500",
    letterSpacing: -0.1,
  },

  /* ── 배경 초록빛 ── */
  bgGlowTop: {
    position: "absolute",
    top: -130,
    left: -230,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: "rgba(61,220,132,0.08)",
    shadowColor: "rgba(61,220,132,0.75)",
    shadowOpacity: 0.2,
    shadowRadius: 50,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  bgGlowBottom: {
    position: "absolute",
    bottom: -220,
    right: -180,
    width: 500,
    height: 500,
    borderRadius: 260,
    backgroundColor: "rgba(61,220,132,0.07)",
    shadowColor: "rgba(61,220,132,0.65)",
    shadowOpacity: 0.18,
    shadowRadius: 46,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  /* ── MoodTune 로고 블룸 ── */
  mtBloom: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 61,
    backgroundColor: "rgba(61,220,132,0.16)",
    shadowColor: C.green,
    shadowOpacity: 0.48,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
    zIndex: 0,
  },

  /* ── 타이틀 블록 ── */
  titleBlock: {
    width: "100%",
    alignItems: "center",
    gap: 12,
    marginBottom: 30,
  },
  titleMain: {
    fontSize: 26,
    fontWeight: "900",
    color: C.t1,
    letterSpacing: -0.8,
    textAlign: "center",
    lineHeight: 34,
  },
  titleSub: {
    fontSize: 15,
    color: C.t2,
    textAlign: "center",
    lineHeight: 23,
    letterSpacing: -0.15,
  },
  oauthErr: {
    marginTop: -4,
    fontSize: 12.5,
    color: "rgba(255,90,90,0.85)",
    textAlign: "center",
  },

  /* ── 버튼 영역 ── */
  btnsBlock: {
    width: "100%",
    gap: 10,
  },

  /* 메인 버튼 */
  mainBtnWrap: {
    width: "100%",
    borderRadius: 50,
    overflow: "hidden",
    shadowColor: C.green,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.52,
    shadowRadius: 26,
    elevation: 12,
    marginBottom: 2,
  },
  mainBtn: {
    width: "100%",
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    overflow: "hidden",
  },
  shimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: 68,
    backgroundColor: "rgba(255,255,255,0.26)",
  },
  mainBtnIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  mainBtnText: {
    fontSize: 17,
    fontWeight: "800",
    color: "#000",
    letterSpacing: -0.4,
  },
  pressOverlayDark: {
    backgroundColor: "rgba(0,0,0,0.10)",
  },
  pressOverlayLight: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  /* 구분 divider */
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  dividerText: {
    fontSize: 12.5,
    color: C.t3,
    fontWeight: "500",
  },

  /* 서브 버튼 (웹로그인 / 앱설치) */
  subBtn: {
    width: "100%",
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.11)",
    position: "relative",
  },
  subBtnIcon: { fontSize: 18 },
  subBtnSpIcon: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  subBtnText: {
    fontSize: 15.5,
    fontWeight: "600",
    color: C.t1,
    letterSpacing: -0.2,
  },

  /* 가입 링크 */
  signupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  signupText: { fontSize: 14, color: C.t2 },
  signupLink: {
    fontSize: 14,
    color: C.green,
    fontWeight: "700",
    letterSpacing: -0.1,
  },

  /* 면책 */
  disclaimer: {
    marginTop: "auto",
    paddingTop: 52,
    alignItems: "center",
  },
  disclaimerText: {
    fontSize: 11.5,
    color: C.t3,
    textAlign: "center",
    lineHeight: 18,
    letterSpacing: -0.1,
  },

  // ── TypeScript용 gap 대응 (RN 0.71 이하) ──
  bgSep: undefined as any,
});
