// src/components/common/ScreenBackground.tsx
// ─────────────────────────────────────────────────────────
//  앱 전체 공통 배경 (로그인 배경과 동일한 애니메이션 오브)
// ─────────────────────────────────────────────────────────
import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "../../constants/colors";

const { width: W, height: H } = Dimensions.get("window");
const GREEN_RGB = "61,220,132";

type BackgroundIntensity = "subtle" | "normal" | "strong";

const INTENSITY_PRESET: Record<
  BackgroundIntensity,
  {
    amplitudeMul: number;
    durationMul: number;
    overlayOpacity: number;
    orbAlphaMul: number;
  }
> = {
  subtle: {
    amplitudeMul: 0.72,
    durationMul: 1.2,
    overlayOpacity: 0.5,
    orbAlphaMul: 0.7,
  },
  normal: {
    amplitudeMul: 1,
    durationMul: 1,
    overlayOpacity: 0.75,
    orbAlphaMul: 1,
  },
  strong: {
    amplitudeMul: 1.28,
    durationMul: 0.78,
    overlayOpacity: 0.94,
    orbAlphaMul: 1.35,
  },
};

function alpha(a: number) {
  return `rgba(${GREEN_RGB},${Math.max(0, Math.min(1, a))})`;
}

interface Props {
  children: React.ReactNode;
  intensity?: BackgroundIntensity;
}

function FloatingOrb({
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
    outputRange: [0.55, 0.86],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.orb,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity,
          transform: [{ translateX }, { translateY }, { scale }],
          shadowColor: color,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.5,
          shadowRadius: 70,
          elevation: 2,
        },
        style,
      ]}
    />
  );
}

export default function ScreenBackground({
  children,
  intensity = "normal",
}: Props) {
  const preset = INTENSITY_PRESET[intensity];
  const move = (v: number) => Math.round(v * preset.amplitudeMul);
  const dur = (v: number) => Math.round(v * preset.durationMul);
  const tone = (v: number) => v * preset.orbAlphaMul;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#030e07", "#0a1f16", "#07140f"]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <LinearGradient
        pointerEvents="none"
        colors={[
          alpha(tone(0.16)),
          alpha(tone(0.06)),
          "rgba(0,0,0,0)",
        ]}
        start={{ x: 0.05, y: 0.05 }}
        end={{ x: 0.85, y: 0.95 }}
        style={[StyleSheet.absoluteFill, { opacity: preset.overlayOpacity }]}
      />

      <FloatingOrb
        size={W * 0.92}
        color={alpha(tone(0.09))}
        amplitude={move(22)}
        duration={dur(10500)}
        style={{ top: -W * 0.42, left: -W * 0.28 }}
      />
      <FloatingOrb
        size={W * 1.02}
        color={alpha(tone(0.08))}
        amplitude={move(24)}
        duration={dur(12500)}
        style={{ bottom: -W * 0.5, right: -W * 0.35 }}
      />
      <FloatingOrb
        size={W * 0.62}
        color={alpha(tone(0.06))}
        amplitude={move(16)}
        duration={dur(9200)}
        style={{ top: H * 0.34, left: W * 0.2 }}
      />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
    overflow: "hidden",
  },
  orb: {
    position: "absolute",
  },
});
