// app/(auth)/spotify-connect.tsx
// ═══════════════════════════════════════════════════════════════════════
//  MoodTune · Spotify 웹 브라우저 로그인 화면
//  이미지 픽셀 퍼펙트 구현
//
//  디자인 스펙:
//  ─ 헤더: 반투명 다크, 뒤로가기 원형 버튼, Spotify 아이콘 + "웹 브라우저 로그인"
//  ─ 배경: 깊은 다크 그린 (#030d06 계열), 상단 미세한 세퍼레이터
//  ─ 로고 원: 다크 원형 + Moodtune 로고 + 네온 glow
//  ─ 타이틀: "계정으로 로그인" — 큰 Bold
//  ─ 서브: "Spotify 이메일과 비밀번호를 입력하세요"
//  ─ 이메일 필드: 자물쇠 이모지 prefix + 입력값, 다크 둥근 테두리
//  ─ 비밀번호 필드: 자물쇠 prefix + 눈 아이콘 suffix (토글)
//  ─ "비밀번호를 잊으셨나요?" — 오른쪽 정렬, 초록 텍스트
//  ─ 로그인 버튼: 초록 그라디언트 + Spotify 원형 아이콘 + 네온 glow
//  ─ "계정이 없으신가요? 무료 가입" — "무료 가입" 초록 bold
//  ─ 하단 면책: 2줄 작은 텍스트
//  ─ 포커스 시 필드 테두리 초록 네온 glow
//  ─ 로그인 버튼 shimmer + 성공 시 체크 애니메이션
// ═══════════════════════════════════════════════════════════════════════

import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

const { width: W, height: H } = Dimensions.get("window");

/* ─── 디자인 토큰 (이미지 정밀 추출) ──────────────────────────── */
const C = {
  // 배경: 아주 어두운 그린 블랙
  bg: "#030e07",
  bgHeader: "#040f08",
  bgSep: "rgba(255,255,255,0.09)",
  // 인풋 배경
  inputBg: "#0a1c0e",
  inputBd: "rgba(255,255,255,0.14)",
  inputBdFocus: "#3ddc84",
  // 초록 계열
  green: "#3ddc84",
  greenL: "#5ee89a",
  greenD: "#28c46e",
  greenBtn1: "#44ea8e",
  greenBtn2: "#1aae5c",
  // 텍스트
  t1: "#ffffff",
  t2: "rgba(255,255,255,0.58)",
  t3: "rgba(255,255,255,0.30)",
  t4: "rgba(255,255,255,0.16)",
  // 로고 원
  logoBg: "#0d1f12",
  logoBd: "rgba(61,220,132,0.40)",
};

/* ─── 헤더 높이 ───────────────────────────────────────────────── */
const HEADER_H = 56;

export default function SpotifyConnectScreen() {
  const insets = useSafeAreaInsets();

  /* ── 상태 ── */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [emailFocus, setEmailFocus] = useState(false);
  const [pwFocus, setPwFocus] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginDone, setLoginDone] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [pwError, setPwError] = useState("");

  /* ── 애니메이션 refs ── */
  // 입장 시퀀스
  const logoScale = useRef(new Animated.Value(0.85)).current;
  const logoOp = useRef(new Animated.Value(0)).current;
  const titleOp = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(18)).current;
  const formOp = useRef(new Animated.Value(0)).current;
  const formY = useRef(new Animated.Value(22)).current;

  // 로고 glow 펄스
  const logoGlowR = useRef(new Animated.Value(14)).current;
  const logoGlowOp = useRef(new Animated.Value(0.5)).current;

  // 버튼 shimmer
  const shimX = useRef(new Animated.Value(-W)).current;

  // 포커스 glow (이메일 / 비번)
  const emailGlowOp = useRef(new Animated.Value(0)).current;
  const pwGlowOp = useRef(new Animated.Value(0)).current;

  // 로그인 성공 체크
  const checkScale = useRef(new Animated.Value(0)).current;
  const checkOp = useRef(new Animated.Value(0)).current;
  const btnSuccessOp = useRef(new Animated.Value(1)).current;

  /* ── 입장 애니메이션 ── */
  useEffect(() => {
    // 로고
    Animated.sequence([
      Animated.delay(100),
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 55,
          friction: 9,
          useNativeDriver: true,
        }),
        Animated.timing(logoOp, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // 타이틀
    Animated.sequence([
      Animated.delay(250),
      Animated.parallel([
        Animated.timing(titleOp, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(titleY, {
          toValue: 0,
          duration: 480,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // 폼
    Animated.sequence([
      Animated.delay(400),
      Animated.parallel([
        Animated.timing(formOp, {
          toValue: 1,
          duration: 550,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(formY, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // 로고 glow 펄스
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(logoGlowR, {
            toValue: 28,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
          Animated.timing(logoGlowOp, {
            toValue: 0.9,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
        ]),
        Animated.parallel([
          Animated.timing(logoGlowR, {
            toValue: 12,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
          Animated.timing(logoGlowOp, {
            toValue: 0.42,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
        ]),
      ]),
    ).start();

    // 버튼 shimmer
    Animated.loop(
      Animated.sequence([
        Animated.delay(2200),
        Animated.timing(shimX, {
          toValue: W * 1.3,
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shimX, {
          toValue: -W,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, []);

  /* ── 포커스 glow 토글 ── */
  useEffect(() => {
    Animated.timing(emailGlowOp, {
      toValue: emailFocus ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [emailFocus]);

  useEffect(() => {
    Animated.timing(pwGlowOp, {
      toValue: pwFocus ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [pwFocus]);

  /* ── 유효성 검사 ── */
  const validate = () => {
    let ok = true;
    if (!email.trim()) {
      setEmailError("이메일 주소를 입력해주세요");
      ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("올바른 이메일 형식이 아닙니다");
      ok = false;
    } else {
      setEmailError("");
    }
    if (!password) {
      setPwError("비밀번호를 입력해주세요");
      ok = false;
    } else if (password.length < 6) {
      setPwError("비밀번호는 최소 6자 이상이어야 합니다");
      ok = false;
    } else {
      setPwError("");
    }
    return ok;
  };

  /* ── 로그인 핸들러 ── */
  const handleLogin = async () => {
    if (!validate()) return;

    // 웹에서는 Spotify 로그인 페이지로 이동
    if (Platform.OS === "web") {
      const url = "https://accounts.spotify.com/login";
      if (typeof window !== "undefined") {
        window.location.href = url;
      } else {
        Linking.openURL(url);
      }
      return;
    }

    setLoading(true);

    // TODO: 실제 Spotify OAuth PKCE 플로우 구현
    // 현재는 UI/UX 데모용 시뮬레이션: 인증 → 사용자 데이터 fetch 로딩 화면
    await new Promise(r => setTimeout(r, 900));
    setLoading(false);
    setLoginDone(true);

    // "사용자 데이터 가져오는 동안" 연결 화면으로 이동
    router.replace({
      pathname: "/auth/spotify-linking",
      params: { next: "/(tabs)", mode: "ready" },
    } as any);
  };

  const canSubmit = email.trim() && password.length >= 1 && !loading;

  return (
    <View style={st.root}>
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />

      {/* 전체 배경 */}
      <LinearGradient
        colors={["#020b05", "#040f07", "#030c06"]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* ══════════════════════════════════
          헤더
          ══════════════════════════════════ */}
      <View style={[st.header, { paddingTop: insets.top }]}>
        {/* 헤더 배경 */}
        <LinearGradient
          colors={["rgba(4,15,8,0.98)", "rgba(3,12,6,0.92)"]}
          style={StyleSheet.absoluteFill}
        />
        {/* 하단 구분선 */}
        <View style={st.headerSep} />

        <View style={st.headerInner}>
          {/* 뒤로가기 버튼 */}
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              st.backBtn,
              pressed ? { opacity: 0.72, transform: [{ scale: 0.96 }] } : null,
            ]}
            hitSlop={10}
          >
            <Text style={st.backArrow}>←</Text>
          </Pressable>

          {/* Spotify 아이콘 + 타이틀 */}
          <View style={st.headerCenter}>
            <SpotifyIcon size={22} color={C.green} />
            <Text style={st.headerTitle}>웹 브라우저 로그인</Text>
          </View>

          {/* 우측 여백 (대칭) */}
          <View style={{ width: 38 }} />
        </View>
      </View>

      {/* ══════════════════════════════════
          본문
          ══════════════════════════════════ */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[
            st.scroll,
            { paddingBottom: insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* ── 로고 ── */}
          <Animated.View
            style={[
              st.logoWrap,
              { opacity: logoOp, transform: [{ scale: logoScale }] },
            ]}
          >
            {/* glow 링 (pulse) */}
            <Animated.View
              pointerEvents="none"
              style={[
                st.logoGlowRing,
                {
                  shadowRadius: logoGlowR,
                  shadowOpacity: logoGlowOp,
                },
              ]}
            />
            {/* 로고 원 */}
            <View style={st.logoCircle}>
              <LinearGradient
                colors={["#142418", "#0a1c10", "#060e08"]}
                style={st.logoCircleGrad}
              >
                {/* Moodtune 로고 아이콘 */}
                {/* 실제 앱: <Image source={require('../../assets/logo.png')} style={st.logoImg} /> */}
                <Image
                  source={require("../../assets/images/moodtune-logo.png")}
                  resizeMode="cover"
                  style={st.logoImg}
                />
                <Text style={st.logoLabel}>Moodtune</Text>
              </LinearGradient>
            </View>
          </Animated.View>

          {/* ── 타이틀 ── */}
          <Animated.View
            style={[
              st.titleBlock,
              { opacity: titleOp, transform: [{ translateY: titleY }] },
            ]}
          >
            <Text style={st.titleMain}>계정으로 로그인</Text>
            <Text style={st.titleSub}>
              Spotify 이메일과 비밀번호를 입력하세요
            </Text>
          </Animated.View>

          {/* ── 폼 ── */}
          <Animated.View
            style={[
              st.formBlock,
              { opacity: formOp, transform: [{ translateY: formY }] },
            ]}
          >
            {/* 이메일 */}
            <View style={st.fieldGroup}>
              <Text style={st.fieldLabel}>이메일 주소</Text>

              {/* 포커스 glow 테두리 */}
              <Animated.View
                style={[st.fieldGlowBorder, { opacity: emailGlowOp }]}
                pointerEvents="none"
              />

              <View
                style={[
                  st.fieldWrap,
                  emailFocus && st.fieldWrapFocus,
                  !!emailError && st.fieldWrapError,
                ]}
              >
                {/* Prefix 아이콘: 이메일 자물쇠 */}
                <View style={st.fieldPrefixIcon}>
                  <Text style={st.fieldPrefixEmoji}>🔐</Text>
                </View>

                <TextInput
                  style={st.fieldInput}
                  value={email}
                  onChangeText={t => {
                    setEmail(t);
                    setEmailError("");
                  }}
                  onFocus={() => setEmailFocus(true)}
                  onBlur={() => setEmailFocus(false)}
                  placeholder="alex.johnson@gmail.com"
                  placeholderTextColor={C.t3}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>

              {!!emailError && <Text style={st.fieldError}>{emailError}</Text>}
            </View>

            {/* 비밀번호 */}
            <View style={st.fieldGroup}>
              <Text style={st.fieldLabel}>비밀번호</Text>

              <Animated.View
                style={[st.fieldGlowBorder, { opacity: pwGlowOp }]}
                pointerEvents="none"
              />

              <View
                style={[
                  st.fieldWrap,
                  pwFocus && st.fieldWrapFocus,
                  !!pwError && st.fieldWrapError,
                ]}
              >
                {/* Prefix 아이콘: 자물쇠 */}
                <View style={st.fieldPrefixIcon}>
                  <Text style={st.fieldPrefixEmoji}>🔒</Text>
                </View>

                <TextInput
                  style={st.fieldInput}
                  value={password}
                  onChangeText={t => {
                    setPassword(t);
                    setPwError("");
                  }}
                  onFocus={() => setPwFocus(true)}
                  onBlur={() => setPwFocus(false)}
                  placeholder="password123"
                  placeholderTextColor={C.t3}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />

                {/* Suffix 아이콘: 눈 토글 */}
                <Pressable
                  onPress={() => setShowPw(!showPw)}
                  style={({ pressed }) => [
                    st.eyeBtn,
                    pressed
                      ? { opacity: 0.7, transform: [{ scale: 0.96 }] }
                      : null,
                  ]}
                  hitSlop={10}
                >
                  <Text style={st.eyeEmoji}>{showPw ? "👁️" : "🙈"}</Text>
                </Pressable>
              </View>

              {!!pwError && <Text style={st.fieldError}>{pwError}</Text>}
            </View>

            {/* 비밀번호 찾기 */}
            <Pressable
              onPress={() => {
                /* TODO: 비밀번호 찾기 */
              }}
              style={({ pressed }) => [
                st.forgotWrap,
                pressed ? { opacity: 0.7 } : null,
              ]}
              hitSlop={8}
            >
              <Text style={st.forgotText}>비밀번호를 잊으셨나요?</Text>
            </Pressable>

            {/* 로그인 버튼 */}
            <Pressable
              onPress={handleLogin}
              disabled={!canSubmit}
              style={({ pressed }) => [
                st.loginBtnWrap,
                !canSubmit && st.loginBtnWrapDisabled,
                pressed && canSubmit
                  ? { transform: [{ scale: 0.985 }, { translateY: 1 }] }
                  : null,
              ]}
            >
              {({ pressed }) => (
                <LinearGradient
                  colors={
                    canSubmit
                      ? [C.greenBtn1, C.greenD, C.greenBtn2]
                      : ["#2a3d2e", "#1e2e24", "#192619"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={st.loginBtn}
                >
                  {pressed && canSubmit ? (
                    <View
                      pointerEvents="none"
                      style={[StyleSheet.absoluteFill, st.pressOverlayDark]}
                    />
                  ) : null}
                  {/* shimmer (활성 상태에서만) */}
                  {canSubmit && !loginDone && (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        st.shimmer,
                        {
                          transform: [
                            { translateX: shimX },
                            { skewX: "-22deg" },
                          ],
                        },
                      ]}
                    />
                  )}

                  {loginDone ? (
                    /* 성공 체크 아이콘 */
                    <Animated.View
                      style={{
                        transform: [{ scale: checkScale }],
                        opacity: checkOp,
                      }}
                    >
                      <Text style={{ fontSize: 22 }}>✓</Text>
                    </Animated.View>
                  ) : loading ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <>
                      <Animated.View
                        style={{
                          opacity: btnSuccessOp,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <SpotifyIcon size={20} color="#07110c" />
                        <Text
                          style={[
                            st.loginBtnText,
                            !canSubmit && { color: "rgba(255,255,255,0.35)" },
                          ]}
                        >
                          로그인
                        </Text>
                      </Animated.View>
                    </>
                  )}
                </LinearGradient>
              )}
            </Pressable>

            {/* 가입 링크 */}
            <View style={st.signupRow}>
              <Text style={st.signupText}>계정이 없으신가요? </Text>
              <Pressable
                style={({ pressed }) => (pressed ? { opacity: 0.75 } : null)}
                hitSlop={8}
              >
                <Text style={st.signupLink}>무료 가입</Text>
              </Pressable>
            </View>
          </Animated.View>

          {/* 하단 면책 */}
          <View style={st.disclaimerBlock}>
            <Text style={st.disclaimerText}>
              이 서비스는 Spotify AB와 제휴하지 않습니다.{"\n"}
              로그인 정보는 Spotify 서버에서 안전하게 처리됩니다.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SUB COMPONENTS
   ══════════════════════════════════════════════════════════════════ */

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
/* ══════════════════════════════════════════════════════════════════
   STYLES
   ══════════════════════════════════════════════════════════════════ */
const st = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
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
    backgroundColor: C.bgSep,
  },
  headerInner: {
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
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: C.t1,
    letterSpacing: -0.2,
  },

  /* ── 스크롤 본문 ── */
  scroll: {
    alignItems: "center",
    paddingHorizontal: 24,
    // 헤더 높이만큼 패딩
    paddingTop: HEADER_H + 48,
  },

  /* ── 로고 ── */
  logoWrap: {
    width: 88,
    height: 88,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  logoGlowRing: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: "#3ddc84",
    backgroundColor: "transparent",
    shadowColor: "#3ddc84",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 18,
    elevation: 0,
  },
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    overflow: "hidden",
  },
  logoCircleGrad: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(61,220,132,0.30)",
  },
  logoImg: {
    width: 56,
    height: 56,
    borderRadius: 32,
    transform: [{ scale: 1.03 }],
  },
  logoLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.80)",
    letterSpacing: 0.3,
    marginTop: 2,
  },

  /* ── 타이틀 블록 ── */
  titleBlock: {
    width: "100%",
    alignItems: "center",
    gap: 10,
    marginBottom: 32,
  },
  titleMain: {
    fontSize: 28,
    fontWeight: "800",
    color: C.t1,
    letterSpacing: -0.7,
    textAlign: "center",
  },
  titleSub: {
    fontSize: 14.5,
    color: C.t2,
    textAlign: "center",
    lineHeight: 21,
    letterSpacing: -0.1,
  },

  /* ── 폼 블록 ── */
  formBlock: {
    width: "100%",
    gap: 0,
  },

  /* 필드 그룹 */
  fieldGroup: {
    width: "100%",
    marginBottom: 18,
    position: "relative",
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: "500",
    color: C.t2,
    letterSpacing: 0.1,
    marginBottom: 7,
  },

  /* 포커스 glow 테두리 (절대 위치로 fieldWrap 위에 겹침) */
  fieldGlowBorder: {
    position: "absolute",
    top: 22,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: "#3ddc84",
    shadowColor: "#3ddc84",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 0,
    zIndex: 1,
  },

  /* 인풋 래퍼 */
  fieldWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 54,
    backgroundColor: C.inputBg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.inputBd,
    paddingHorizontal: 14,
    gap: 10,
    zIndex: 2,
  },
  fieldWrapFocus: {
    borderColor: "#3ddc84",
    backgroundColor: "#0c2012",
  },
  fieldWrapError: {
    borderColor: "#ff4f6a",
  },

  fieldPrefixIcon: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldPrefixEmoji: {
    fontSize: 15,
  },

  fieldInput: {
    flex: 1,
    fontSize: 15.5,
    color: C.t1,
    letterSpacing: -0.2,
    paddingVertical: 0,
    includeFontPadding: false,
  },

  eyeBtn: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  eyeEmoji: {
    fontSize: 17,
  },

  fieldError: {
    fontSize: 11.5,
    color: "#ff4f6a",
    marginTop: 5,
    marginLeft: 2,
  },

  /* 비밀번호 찾기 */
  forgotWrap: {
    alignSelf: "flex-end",
    marginBottom: 24,
    marginTop: -6,
  },
  forgotText: {
    fontSize: 13.5,
    color: "#3ddc84",
    fontWeight: "500",
  },

  /* 로그인 버튼 */
  loginBtnWrap: {
    width: "100%",
    borderRadius: 50,
    overflow: "hidden",
    shadowColor: "#3ddc84",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
    marginBottom: 20,
  },
  loginBtnWrapDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  loginBtn: {
    width: "100%",
    height: 56,
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
    width: 70,
    backgroundColor: "rgba(255,255,255,0.26)",
  },
  pressOverlayDark: {
    backgroundColor: "rgba(0,0,0,0.10)",
  },
  loginSpIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  loginBtnText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#000",
    letterSpacing: -0.4,
  },

  /* 가입 링크 */
  signupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 0,
  },
  signupText: {
    fontSize: 14,
    color: C.t2,
  },
  signupLink: {
    fontSize: 14,
    color: "#3ddc84",
    fontWeight: "700",
  },

  /* 하단 면책 */
  disclaimerBlock: {
    marginTop: "auto",
    paddingTop: 60,
    paddingBottom: 8,
    alignItems: "center",
  },
  disclaimerText: {
    fontSize: 11.5,
    color: C.t3,
    textAlign: "center",
    lineHeight: 18,
    letterSpacing: -0.1,
  },
});
