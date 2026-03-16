// app/auth/login.tsx
// ─────────────────────────────────────────────────────────
//  Landing (Neon) — 앱 첫 진입 화면
//  - 로고 주변 빛 번짐 + 파동(이퀄라이저) 애니메이션
//  - Spotify 로그인 버튼 → /auth/spotify (추후 구현)
// ─────────────────────────────────────────────────────────
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { AudioWaveform, Bot, Sparkles, Zap } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Defs,
  Path,
  Stop,
  LinearGradient as SvgLinearGradient,
  Text as SvgText,
} from "react-native-svg";
import ScreenBackground from "../../src/components/common/ScreenBackground";
import { Colors } from "../../src/constants/colors";

const FEATURE_PILLS = [
  { Icon: Bot, label: "AI 취향 분석" },
  { Icon: Sparkles, label: "무드 기반 추천" },
  { Icon: Zap, label: "빠른 생성" },
  { Icon: AudioWaveform, label: "Spotify 연동" },
];

function clamp(n: number, min: number, max: number) {
  "worklet";
  return Math.max(min, Math.min(max, n));
}

function SoftOrb({
  size,
  color,
  style,
  duration = 9000,
  amplitude = 18,
}: {
  size: number;
  color: string;
  style?: any;
  duration?: number;
  amplitude?: number;
}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [duration, t]);

  const translateX = t.interpolate({
    inputRange: [0, 1],
    outputRange: [-amplitude, amplitude],
  });
  const translateY = t.interpolate({
    inputRange: [0, 1],
    outputRange: [amplitude, -amplitude],
  });
  const scale = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1.04],
  });
  const opacity = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 0.85],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity,
          transform: [{ translateX }, { translateY }, { scale }],
          shadowColor: color,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.55,
          shadowRadius: 60,
          elevation: 1,
        },
        style,
      ]}
    />
  );
}

function GlowBloom({
  size,
  intensity = 1,
}: {
  size: number;
  intensity?: number;
}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 2100,
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: 2100,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  const opacity = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0.16 * intensity, 0.34 * intensity],
  });
  const scale = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.06],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bloom,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity,
          transform: [{ scale }],
        },
      ]}
    />
  );
}

function NeonRings({ size }: { size: number }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 2600,
          useNativeDriver: true,
        }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  const rings = [
    { s: size, w: 3, o: 0.48, d: 0 },
    { s: size * 1.04, w: 4, o: 0.44, d: 0.18 },
    { s: size * 0.96, w: 3, o: 0.4, d: 0.36 },
  ];

  return (
    <View style={styles.rings} pointerEvents="none">
      {rings.map((r, i) => {
        const local = Animated.modulo(Animated.add(t, r.d), 1);
        const scale = local.interpolate({
          inputRange: [0, 1],
          outputRange: [0.98, 1.07],
        });
        const opacity = local.interpolate({
          inputRange: [0, 1],
          outputRange: [r.o, 0.06],
        });
        return (
          <Animated.View
            key={i}
            style={[
              styles.ringGlow,
              {
                width: r.s,
                height: r.s,
                borderRadius: r.s / 2,
                opacity,
                transform: [{ scale }],
              },
            ]}
          >
            <View
              style={[
                styles.ringSoft,
                {
                  width: "100%",
                  height: "100%",
                  borderRadius: r.s / 2,
                  borderWidth: r.w * 6,
                },
              ]}
            />
            <View
              style={[
                styles.ringLine,
                {
                  width: "100%",
                  height: "100%",
                  borderRadius: r.s / 2,
                  borderWidth: r.w,
                },
              ]}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}

function GradientText({
  text,
  colors,
  style,
  width,
  height,
  align = "left",
}: {
  text: string;
  colors: [string, string, string];
  style: any;
  width?: number;
  height?: number;
  align?: "left" | "center";
}) {
  const [layout, setLayout] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const gradientId = useMemo(
    () => `g-${Math.random().toString(36).slice(2, 9)}`,
    [],
  );
  const flat = StyleSheet.flatten(style) ?? {};
  const fontSize = Number(flat.fontSize ?? 36);
  const fontFamily = flat.fontFamily;
  const letterSpacing = flat.letterSpacing;
  const fontWeight = flat.fontWeight;
  const strokeWidth = 8;
  const padX = Math.ceil(strokeWidth / 2) + 6;
  const targetW = Math.ceil(width ?? layout.w);
  const targetH = Math.ceil((height ?? layout.h) || fontSize * 1.2);
  const isCenter = align === "center";

  return (
    <View
      style={[
        styles.gradWrap,
        width ? { width } : null,
        height ? { height } : null,
        isCenter ? { alignItems: "center" } : null,
      ]}
    >
      <Text
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout;
          if (width !== layout.w || height !== layout.h)
            setLayout({ w: width, h: height });
        }}
        style={[style, { opacity: 0, paddingHorizontal: padX, width }]}
      >
        {text}
      </Text>

      {targetW > 0 && targetH > 0 ? (
        <Svg width={targetW} height={targetH} style={StyleSheet.absoluteFill}>
          <Defs>
            <SvgLinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors[0]} />
              <Stop offset="0.55" stopColor={colors[1]} />
              <Stop offset="1" stopColor={colors[2]} />
            </SvgLinearGradient>
          </Defs>
          <SvgText
            x={isCenter ? targetW / 2 : padX}
            y={fontSize}
            fill={colors[1]}
            opacity={0.08}
            stroke={colors[1]}
            strokeWidth={strokeWidth}
            strokeOpacity={0.06}
            fontSize={fontSize}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
            letterSpacing={letterSpacing}
            textAnchor={isCenter ? "middle" : undefined}
          >
            {text}
          </SvgText>
          <SvgText
            x={isCenter ? targetW / 2 : padX}
            y={fontSize}
            fill={`url(#${gradientId})`}
            fontSize={fontSize}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
            letterSpacing={letterSpacing}
            textAnchor={isCenter ? "middle" : undefined}
          >
            {text}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}

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

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const titleT = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(titleT, {
      toValue: 1,
      duration: 800,
      delay: 200,
      useNativeDriver: true,
    }).start();
  }, [titleT]);

  const titleStyle = useMemo(() => {
    const opacity = titleT.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });
    const translateY = titleT.interpolate({
      inputRange: [0, 1],
      outputRange: [10, 0],
    });
    return { opacity, transform: [{ translateY }] };
  }, [titleT]);

  const usableH = H - insets.top - insets.bottom;
  const uiScale = clamp(usableH / 780, 0.82, 1);
  const stage = Math.min(W * 0.92, 360, usableH * 0.34) * uiScale;
  const ring = stage * 0.88;
  const circle = stage * 0.65;
  const heroSize = clamp(W * 0.48, 28, 36) * uiScale;
  const subSize = clamp(W * 0.048, 16, 17.5) * uiScale;
  const pillSize = clamp(W * 0.036, 12, 15) * uiScale;
  const logoGap = clamp(usableH * 0.03, 14, 22) * uiScale;
  const spotifyBtnH = Math.round(clamp(usableH * 0.095, 54, 64));
  const demoBtnH = Math.round(clamp(usableH * 0.078, 46, 52));
  const spotifyFont = Math.round(clamp(22 * uiScale, 18, 22));
  const demoFont = Math.round(clamp(20 * uiScale, 16, 20));
  const containerPadding = {
    paddingTop: insets.top + 18,
    paddingBottom: insets.bottom + 20,
  };
  const pageMinH = Math.max(
    0,
    H - containerPadding.paddingTop - containerPadding.paddingBottom,
  );

  const content = (
    <View style={[styles.page, { minHeight: pageMinH }]}>
      <View style={styles.main}>
        {/* Top: Logo + rings */}
        <View
          style={[
            styles.logoStage,
            { width: stage, height: stage, marginBottom: logoGap },
          ]}
        >
          <GlowBloom size={stage * 1.16} intensity={0.9} />
          <NeonRings size={ring} />

          <View
            style={[
              styles.logoCircle,
              { width: circle, height: circle, borderRadius: circle / 2 },
            ]}
          >
            <GlowBloom size={circle * 1.18} intensity={0.65} />
            <LinearGradient
              colors={[
                "rgba(255,255,255,0.06)",
                "rgba(255,255,255,0.00)",
                "rgba(0,0,0,0.10)",
              ]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Image
              source={require("../../assets/images/moodtune-logo.png")}
              resizeMode="contain"
              style={{ width: circle * 0.98, height: circle * 0.98 }}
            />
          </View>
        </View>

        {/* Middle: Copy + pills */}
        <Animated.View
          style={[
            styles.copy,
            titleStyle,
            { gap: 10 * uiScale, marginBottom: 20 * uiScale },
          ]}
        >
          <GradientText
            text="기분을 음악으로"
            colors={["#effff7", Colors.greenL, Colors.green]}
            width={Math.min(420, W - 44)}
            height={heroSize * 1.4}
            align="center"
            style={[
              styles.heroAll,
              { fontSize: heroSize, lineHeight: Math.ceil(heroSize * 1.02) },
            ]}
          />
          <Text
            style={[
              styles.sub,
              {
                fontSize: subSize,
                lineHeight: Math.ceil(subSize * 1.4),
                marginTop: 4 * uiScale,
              },
            ]}
          >
            AI가 지금 이 순간 당신에게 딱 맞는
          </Text>
          <Text
            style={[
              styles.sub,
              { fontSize: subSize, lineHeight: Math.ceil(subSize * 1) },
            ]}
          >
            플레이리스트를 만들어드려요
          </Text>
        </Animated.View>

        <View
          style={[
            styles.pills,
            { maxWidth: Math.min(420, W - 44), marginTop: 2 },
          ]}
        >
          {FEATURE_PILLS.map(p => (
            <View
              key={p.label}
              style={[
                styles.pill,
                { minWidth: Math.min(148, (W - 60 - 22) / 2) },
              ]}
            >
              <View style={styles.pillInner}>
                <p.Icon size={14} color="rgba(180,255,226,0.95)" strokeWidth={2.2} />
                <Text style={[styles.pillText, { fontSize: pillSize }]}>{p.label}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Bottom: Buttons + terms */}
      <View style={styles.bottom}>
        <Pressable
          onPress={() => router.push("/auth/spotify-login" as any)}
          style={({ pressed }) => [
            styles.spotifyOuter,
            pressed ? { transform: [{ scale: 0.985 }, { translateY: 1 }] } : null,
          ]}
        >
          {({ pressed }) => (
            <LinearGradient
              colors={[Colors.greenL, Colors.green]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.spotifyBtn, { height: spotifyBtnH }]}
            >
              {pressed ? (
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, styles.pressOverlayDark]}
                />
              ) : null}
              <SpotifyIcon size={24} color="#07110c" />
              <Text style={[styles.spotifyText, { fontSize: spotifyFont }]}>
                Spotify로 로그인
              </Text>
            </LinearGradient>
          )}
        </Pressable>

        <Pressable
          onPress={() => router.replace("/(tabs)" as any)}
          style={({ pressed }) => [
            styles.demoOuter,
            pressed ? { transform: [{ scale: 0.99 }], opacity: 0.92 } : null,
          ]}
          android_ripple={{ color: "rgba(255,255,255,0.10)" }}
        >
          {({ pressed }) => (
            <LinearGradient
              colors={["rgba(255,255,255,0.08)", "rgba(255,255,255,0.04)"]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={[styles.demoBtn, { height: demoBtnH }]}
            >
              {pressed ? (
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, styles.pressOverlayLight]}
                />
              ) : null}
              <Text style={[styles.demoText, { fontSize: demoFont }]}>
                데모로 체험해보기
              </Text>
            </LinearGradient>
          )}
        </Pressable>

        <Text style={styles.terms}>
          로그인하면 <Text style={styles.termsAccent}>이용약관</Text> 및{" "}
          <Text style={styles.termsAccent}>개인정보처리방침</Text>에 동의합니다
        </Text>
      </View>
    </View>
  );

  return (
    <ScreenBackground intensity="strong">
      <ScrollView
        style={styles.scroll}
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.root,
          {
            ...containerPadding,
          },
        ]}
      >
        {content}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  scroll: {
    flex: 1,
    alignSelf: "stretch",
  },
  page: {
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  main: {
    flexGrow: 1,
    width: "100%",
    alignItems: "center",
    paddingTop: 18,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logoStage: {
    alignItems: "center",
    justifyContent: "center",
  },
  bloom: {
    position: "absolute",
    backgroundColor: "rgba(61,220,132,0.14)",
    shadowColor: Colors.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 60,
    elevation: 18,
  },
  rings: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  ringGlow: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 22,
    elevation: 10,
  },
  ringLine: {
    borderColor: "rgba(61,220,132,0.65)",
    backgroundColor: "transparent",
  },
  ringSoft: {
    position: "absolute",
    borderColor: "rgba(61,220,132,0.12)",
    backgroundColor: "transparent",
  },
  logoCircle: {
    backgroundColor: "rgba(8,18,14,0.92)",
    borderWidth: 2,
    borderColor: "rgba(61,220,132,0.55)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.green,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.25,
    shadowRadius: 28,
    elevation: 12,
    overflow: "hidden",
  },
  copy: {
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    marginBottom: 26,
    paddingHorizontal: 10,
  },
  heroAll: {
    fontFamily: "Outfit-Black",
    letterSpacing: -1.0,
  },
  gradWrap: {
    // 측정용 래퍼 (Svg로 텍스트를 다시 그리기 위해 필요)
    alignItems: "flex-start",
    justifyContent: "flex-end",
    position: "relative",
  },
  sub: {
    color: "rgba(255,255,255,0.52)",
    fontFamily: "DMSans-Regular",
    textAlign: "center",
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
  },
  pill: {
    paddingHorizontal: 5,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(10,30,22,0.85)",
    borderWidth: 2,
    borderColor: "rgba(61,220,132,0.30)",
  },
  pillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pillText: {
    color: "rgba(180,255,226,0.95)",
    fontFamily: "DMSans-Medium",
    letterSpacing: -0.3,
  },
  bottom: {
    gap: 10,
    width: "100%",
    marginTop: 16,
  },
  spotifyOuter: {
    borderRadius: 999,
    overflow: "hidden",
    shadowColor: Colors.green,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.32,
    shadowRadius: 26,
    elevation: 14,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.25)",
  },
  spotifyBtn: {
    height: 64,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  spotifyText: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#07110c",
    fontFamily: "Outfit-Black",
    letterSpacing: -0.6,
  },
  demoOuter: {
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  demoBtn: {
    height: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  pressOverlayDark: {
    backgroundColor: "rgba(0,0,0,0.10)",
  },
  pressOverlayLight: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  demoText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.75)",
    fontFamily: "DMSans-Bold",
    letterSpacing: -0.3,
  },
  terms: {
    marginTop: 6,
    fontSize: 14,
    color: "rgba(255,255,255,0.24)",
    textAlign: "center",
    fontFamily: "DMSans-Medium",
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  termsAccent: {
    color: "rgba(255,255,255,0.34)",
  },
});
