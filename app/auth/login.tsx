// ─────────────────────────────────────────────────────────
//  [s-landing] 랜딩 화면 → [s-login] Spotify 로그인 화면
//  두 화면을 하나의 파일에서 animated 전환으로 구현
// ─────────────────────────────────────────────────────────
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EqBars from "../../src/components/ai/EqBars";
import { GlassButton, PrimaryButton } from "../../src/components/common/Button";
import LogoIcon from "../../src/components/common/LogoIcon";
import PulseRings from "../../src/components/common/PulseRings";
import ScreenBackground from "../../src/components/common/ScreenBackground";
import { Colors } from "../../src/constants/colors";
import { FontSize, Radius } from "../../src/constants/layout";
import { useAppStore } from "../../src/store/useAppStore";

const { width: W } = Dimensions.get("window");

// ── 피처 알약 데이터 ─────────────────────────────────────
const FEATURE_PILLS = [
  { icon: "🤖", label: "AI 취향 분석" },
  { icon: "⚡", label: "3초 생성" },
  { icon: "🎵", label: "Spotify 연동" },
  { icon: "✨", label: "무드 기반 추천" },
];

// ── OAuth 연결 dots 데이터 ────────────────────────────────
const DOT_DELAYS = [0, 150, 300, 450, 600];

type Screen = "landing" | "login" | "loginManual" | "oauth" | "perm";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>("landing");
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const oauthProgress = useRef(new Animated.Value(0)).current;
  const oauthStep = useRef(0);
  const [oauthStepState, setOauthStepState] = useState(0);

  // OAuth 자동 진행 시뮬레이션
  useEffect(() => {
    if (screen !== "oauth") return;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setOauthStepState(step);
      if (step >= 3) {
        clearInterval(timer);
        setTimeout(() => goTo("perm"), 600);
      }
    }, 800);
    return () => clearInterval(timer);
  }, [screen]);

  // 권한 허용 후 앱 진입
  useEffect(() => {
    if (screen !== "perm") return;
  }, [screen]);

  function goTo(next: Screen) {
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setScreen(next);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    });
  }

  // 개발 중 - 실제 auth 없이 바로 탭으로 이동
  function doLogin() {
    useAppStore.getState().setTokens({
      accessToken: "mock_token",
      refreshToken: "mock_refresh",
      expiresAt: Date.now() + 3600 * 1000,
    });
    goTo("oauth");
  }

  function allowPerm() {
    router.replace("/(tabs)");
  }

  return (
    <ScreenBackground>
      <StatusBar barStyle="light-content" />
      <Animated.View style={[{ flex: 1 }, { opacity: fadeAnim }]}>
        {screen === "landing" && (
          <LandingView
            insets={insets}
            onSpotify={() => goTo("login")}
            onDemo={() => router.replace("/(tabs)")}
          />
        )}
        {screen === "login" && (
          <LoginView
            insets={insets}
            onBack={() => goTo("landing")}
            onLogin={doLogin}
            onManual={() => goTo("loginManual")}
          />
        )}
        {screen === "oauth" && (
          <OAuthView insets={insets} step={oauthStepState} />
        )}
        {screen === "perm" && (
          <PermView
            insets={insets}
            onAllow={allowPerm}
            onDeny={() => goTo("login")}
          />
        )}
      </Animated.View>
    </ScreenBackground>
  );
}

// ════════════════════════════════════════════════════════
//  LANDING VIEW
// ════════════════════════════════════════════════════════
function LandingView({ insets, onSpotify, onDemo }: any) {
  const titleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(titleAnim, {
      toValue: 1,
      duration: 700,
      delay: 200,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {/* 이퀄라이저 배경 바 */}
      <EqBars barCount={28} />

      <View style={[styles.landingContent, { paddingTop: insets.top + 20 }]}>
        {/* 로고 + 펄스 링 */}
        <View style={styles.logoSection}>
          <PulseRings
            rings={[
              {
                size: 190,
                borderWidth: 1,
                opacity: 0.06,
                delay: 0,
                color: Colors.green,
              },
              {
                size: 160,
                borderWidth: 1,
                opacity: 0.12,
                delay: 300,
                color: Colors.green,
              },
              {
                size: 134,
                borderWidth: 1.5,
                opacity: 0.22,
                delay: 600,
                color: Colors.green,
              },
            ]}
          />
          <LogoIcon size={120} radius={28} animated />
        </View>

        {/* 타이틀 */}
        <Animated.View
          style={{ opacity: titleAnim, alignItems: "center", gap: 8 }}
        >
          <Text style={styles.landTitle}>기분을 음악으로</Text>
          <Text style={styles.landSub}>AI가 지금 이 순간 당신에게 딱 맞는</Text>
          <Text style={styles.landSub}>플레이리스트를 만들어드려요</Text>
        </Animated.View>

        {/* 피처 알약 */}
        <View style={styles.pillsRow}>
          {FEATURE_PILLS.map((p, i) => (
            <View key={i} style={styles.featurePill}>
              <Text style={styles.featurePillText}>
                {p.icon} {p.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* 하단 버튼 영역 */}
      <View
        style={[styles.landingBottom, { paddingBottom: insets.bottom + 24 }]}
      >
        <PrimaryButton
          label="Spotify로 로그인"
          onPress={onSpotify}
          style={{ width: "100%" }}
        />
        <GlassButton
          label="데모로 체험해보기"
          onPress={onDemo}
          style={{ width: "100%", marginTop: 10 }}
        />
        <Text style={styles.terms}>
          계속하면 <Text style={{ color: Colors.green }}>서비스 이용약관</Text>{" "}
          및 <Text style={{ color: Colors.green }}>개인정보처리방침</Text>에
          동의하게 됩니다
        </Text>
      </View>
    </View>
  );
}

// ════════════════════════════════════════════════════════
//  LOGIN VIEW (Spotify 앱 연동)
// ════════════════════════════════════════════════════════
function LoginView({ insets, onBack, onLogin, onManual }: any) {
  const dotAnims = useRef(
    DOT_DELAYS.map(() => new Animated.Value(0.22)),
  ).current;

  useEffect(() => {
    const anims = dotAnims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(DOT_DELAYS[i]),
          Animated.timing(a, {
            toValue: 1,
            duration: 400,
            useNativeDriver: false,
          }),
          Animated.timing(a, {
            toValue: 0.22,
            duration: 400,
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    Animated.parallel(anims).start();
    return () => anims.forEach(a => a.stop());
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {/* 헤더 */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={styles.spBrand}>
          <View style={styles.spLogo}>
            <Text style={{ fontSize: 14, color: "#fff" }}>♪</Text>
          </View>
          <Text style={styles.spBrandText}>Spotify 계정으로 시작</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.loginBody,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* 연동 다이어그램 */}
        <View style={styles.connectDiagram}>
          {/* Spotify */}
          <View style={[styles.iconBox, { backgroundColor: Colors.spotify }]}>
            <Text style={{ fontSize: 28, color: "#fff" }}>♪</Text>
          </View>

          {/* 연결 dots */}
          <View style={styles.dotsRow}>
            {dotAnims.map((anim, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: anim.interpolate({
                      inputRange: [0.22, 1],
                      outputRange: ["rgba(61,220,132,0.22)", Colors.green],
                    }),
                    transform: [
                      {
                        scale: anim.interpolate({
                          inputRange: [0.22, 1],
                          outputRange: [0.8, 1.2],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ))}
          </View>

          {/* MoodTune */}
          <LogoIcon size={72} radius={18} animated />
        </View>

        <Text style={styles.loginTitle}>Spotify 앱으로 바로 연동</Text>
        <Text style={styles.loginSub}>비밀번호 없이 안전하게 연결해요</Text>

        {/* 앱 감지 배너 */}
        <View style={styles.detectBanner}>
          <View style={styles.detectDot} />
          <Text style={styles.detectText}>
            Spotify 앱 감지됨 · 바로 연동 가능
          </Text>
        </View>

        {/* 메인 CTA */}
        <PrimaryButton
          label="Spotify 앱으로 로그인"
          onPress={onLogin}
          style={{ width: "100%", marginBottom: 12 }}
        />

        {/* 구분선 */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>또는</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* 대체 옵션 */}
        <TouchableOpacity style={styles.socialBtn} onPress={onManual}>
          <Text style={styles.socialBtnText}>웹 브라우저로 로그인</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.socialBtn, { marginTop: 8 }]}>
          <Text style={styles.socialBtnText}>Spotify 앱 설치하기</Text>
        </TouchableOpacity>

        <Text style={[styles.terms, { marginTop: 20 }]}>
          🔒 OAuth 2.0으로 안전하게 보호됩니다
        </Text>
      </ScrollView>
    </View>
  );
}

// ════════════════════════════════════════════════════════
//  OAUTH LOADING VIEW
// ════════════════════════════════════════════════════════
const OAUTH_STEPS = ["Spotify 앱 연결", "계정 인증 중", "MoodTune 연동"];

function OAuthView({ insets, step }: { insets: any; step: number }) {
  const dotAnims = useRef(
    DOT_DELAYS.map(() => new Animated.Value(0.22)),
  ).current;

  useEffect(() => {
    const anims = dotAnims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(DOT_DELAYS[i] * 0.8),
          Animated.timing(a, {
            toValue: 1,
            duration: 350,
            useNativeDriver: false,
          }),
          Animated.timing(a, {
            toValue: 0.22,
            duration: 350,
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    Animated.parallel(anims).start();
    return () => anims.forEach(a => a.stop());
  }, []);

  return (
    <View style={[styles.oauthContainer, { paddingTop: insets.top + 20 }]}>
      <Text style={styles.oauthTitle}>Spotify 연결 중...</Text>
      <Text style={styles.oauthSub}>잠시만 기다려주세요</Text>

      {/* 큰 연결 다이어그램 */}
      <View style={styles.oauthDiagram}>
        <View style={[styles.iconBoxLg, { backgroundColor: Colors.spotify }]}>
          <Text style={{ fontSize: 36, color: "#fff" }}>♪</Text>
        </View>
        <View style={styles.dotsRow}>
          {dotAnims.map((anim, i) => (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: anim.interpolate({
                    inputRange: [0.22, 1],
                    outputRange: ["rgba(61,220,132,0.22)", Colors.green],
                  }),
                },
              ]}
            />
          ))}
        </View>
        <LogoIcon size={88} radius={22} animated />
      </View>

      {/* 진행 단계 */}
      <View style={styles.oauthSteps}>
        {OAUTH_STEPS.map((s, i) => (
          <View key={i} style={styles.oauthStep}>
            <View
              style={[
                styles.stepDot,
                i < step && styles.stepDotDone,
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
            {i < OAUTH_STEPS.length - 1 && (
              <View
                style={[styles.stepLine, i < step && styles.stepLineDone]}
              />
            )}
            <Text style={[styles.stepText, i <= step && { color: Colors.t1 }]}>
              {s}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ════════════════════════════════════════════════════════
//  PERMISSION VIEW
// ════════════════════════════════════════════════════════
const PERMISSIONS = [
  {
    icon: "🎵",
    title: "재생 목록 읽기 및 쓰기",
    desc: "플레이리스트 생성/저장",
  },
  { icon: "👤", title: "프로필 정보 접근", desc: "이름, 사진 등 기본 정보" },
  { icon: "⭐", title: "라이브러리 접근", desc: "좋아요 및 저장 기능" },
  { icon: "▶️", title: "현재 재생 상태", desc: "재생 제어 및 상태 확인" },
];

function PermView({ insets, onAllow, onDeny }: any) {
  return (
    <View style={{ flex: 1 }}>
      {/* Spotify 헤더 */}
      <LinearGradient
        colors={["rgba(29,185,84,0.15)", "transparent"]}
        style={[styles.permHeader, { paddingTop: insets.top + 12 }]}
      >
        <View
          style={[
            styles.iconBox,
            { backgroundColor: Colors.spotify, alignSelf: "center" },
          ]}
        >
          <Text style={{ fontSize: 24, color: "#fff" }}>♪</Text>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[
          styles.permBody,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* 앱 아이콘 */}
        <LogoIcon
          size={52}
          radius={14}
          animated={false}
          style={{ alignSelf: "center" }}
        />
        <Text
          style={[styles.loginTitle, { textAlign: "center", marginTop: 10 }]}
        >
          MoodTune이 권한을 요청합니다
        </Text>

        {/* 권한 항목 */}
        <View style={{ gap: 8, marginTop: 20, marginBottom: 16 }}>
          {PERMISSIONS.map((p, i) => (
            <View key={i} style={styles.permItem}>
              <Text style={styles.permItemIcon}>{p.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.permItemTitle}>{p.title}</Text>
                <Text style={styles.permItemDesc}>{p.desc}</Text>
              </View>
              <View style={styles.permCheck}>
                <Text
                  style={{ fontSize: 11, color: "#000", fontWeight: "700" }}
                >
                  ✓
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* 경고 배너 */}
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            ⚠️ Spotify 공식 인증 페이지입니다
          </Text>
        </View>

        {/* 버튼 */}
        <PrimaryButton
          label="동의하고 MoodTune 시작하기"
          onPress={onAllow}
          style={{ width: "100%", marginBottom: 10 }}
          fontSize={14}
        />
        <GlassButton label="취소" onPress={onDeny} style={{ width: "100%" }} />
      </ScrollView>
    </View>
  );
}

// ════════════════════════════════════════════════════════
//  STYLES
// ════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  // ── Landing ──────────────────────────────────────────
  landingContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 22,
  },
  logoSection: {
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  landTitle: {
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.8,
    color: Colors.white,
    textAlign: "center",
    // 그라디언트 텍스트는 RN 기본 미지원 → 흰색으로 대체
    // 실제 구현: react-native-linear-gradient + MaskedView
  },
  landSub: {
    fontSize: FontSize.md,
    color: Colors.t2,
    textAlign: "center",
    lineHeight: 20,
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 7,
  },
  featurePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: Colors.glass,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.glassBd,
  },
  featurePillText: {
    fontSize: FontSize.sm,
    color: Colors.t1,
  },
  landingBottom: {
    paddingHorizontal: 24,
    gap: 0,
  },
  terms: {
    fontSize: FontSize.xs,
    color: Colors.t3,
    textAlign: "center",
    marginTop: 14,
    lineHeight: 16,
  },

  // ── Login ─────────────────────────────────────────────
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingBottom: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
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
  spBrand: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  spLogo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.spotify,
    alignItems: "center",
    justifyContent: "center",
  },
  spBrandText: {
    fontSize: FontSize.md,
    color: Colors.t1,
    fontWeight: "600",
  },
  loginBody: {
    paddingHorizontal: 24,
    paddingTop: 28,
    gap: 0,
  },
  connectDiagram: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginBottom: 24,
  },
  iconBox: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBoxLg: {
    width: 88,
    height: 88,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  loginTitle: {
    fontSize: FontSize["5xl"],
    fontWeight: "700",
    color: Colors.t1,
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  loginSub: {
    fontSize: FontSize.md,
    color: Colors.t2,
    lineHeight: 20,
    marginBottom: 16,
  },
  detectBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(61,220,132,0.1)",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.3)",
    marginBottom: 20,
  },
  detectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.green,
  },
  detectText: {
    fontSize: FontSize.base,
    color: Colors.green,
    fontWeight: "600",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.glassBd,
  },
  dividerText: {
    fontSize: FontSize.sm,
    color: Colors.t3,
  },
  socialBtn: {
    height: 46,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.11)",
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  socialBtnText: {
    fontSize: FontSize.md,
    color: Colors.t2,
    fontWeight: "500",
  },

  // ── OAuth ─────────────────────────────────────────────
  oauthContainer: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 12,
  },
  oauthTitle: {
    fontSize: FontSize["4xl"],
    fontWeight: "700",
    color: Colors.t1,
    letterSpacing: -0.4,
    marginTop: 8,
  },
  oauthSub: {
    fontSize: FontSize.md,
    color: Colors.t2,
    marginBottom: 32,
  },
  oauthDiagram: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginBottom: 40,
  },
  oauthSteps: {
    width: "100%",
    gap: 0,
    backgroundColor: Colors.glass,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    padding: 20,
  },
  oauthStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingVertical: 2,
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.t3,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  stepDotDone: {
    backgroundColor: Colors.green,
    borderColor: Colors.green,
  },
  stepDotActive: {
    borderColor: Colors.green,
  },
  stepLine: {
    position: "absolute",
    left: 11,
    top: 28,
    width: 2,
    height: 30,
    backgroundColor: Colors.glassBd,
  },
  stepLineDone: {
    backgroundColor: Colors.green,
    opacity: 0.5,
  },
  stepText: {
    fontSize: FontSize.md,
    color: Colors.t3,
    paddingVertical: 4,
  },

  // ── Permission ────────────────────────────────────────
  permHeader: {
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  permBody: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  permItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    borderRadius: Radius.md,
  },
  permItemIcon: {
    fontSize: 22,
    width: 32,
    textAlign: "center",
  },
  permItemTitle: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.t1,
  },
  permItemDesc: {
    fontSize: FontSize.sm,
    color: Colors.t2,
    marginTop: 2,
  },
  permCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.green,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  warningBanner: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255,193,7,0.1)",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,193,7,0.3)",
    marginBottom: 20,
  },
  warningText: {
    fontSize: FontSize.sm,
    color: "rgba(255,193,7,0.9)",
  },
});
