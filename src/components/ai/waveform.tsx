// src/components/ai/Waveform.tsx
// ─────────────────────────────────────────────────────────
//  애니메이션 웨이브폼 (HTML .wfc .wb 재현)
//  @keyframes wbounce: 0%,100%{scaleY(.35) opacity:.5} 50%{scaleY(1) opacity:1}
// ─────────────────────────────────────────────────────────
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Colors } from "../../constants/colors";

const BAR_HEIGHTS = [
  18, 32, 44, 28, 50, 38, 26, 50, 22, 40, 30, 46, 24, 42, 34,
];
const BAR_DELAYS = [
  0, 0.1, 0.2, 0.15, 0.05, 0.25, 0.1, 0.3, 0.05, 0.2, 0.15, 0.1, 0.25, 0.05,
  0.2,
];

interface Props {
  barCount?: number;
  height?: number;
  color?: string;
  active?: boolean;
}

export default function Waveform({
  barCount = 15,
  height = 72,
  color = Colors.green,
  active = true,
}: Props) {
  const animations = useRef(
    BAR_HEIGHTS.slice(0, barCount).map(() => new Animated.Value(0.35)),
  ).current;

  useEffect(() => {
    if (!active) return;

    const anims = animations.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(BAR_DELAYS[i % BAR_DELAYS.length] * 1000),
          Animated.timing(anim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.35,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      ),
    );

    Animated.parallel(anims).start();
    return () => anims.forEach(a => a.stop());
  }, [active]);

  return (
    <View style={[styles.container, { height }]}>
      {BAR_HEIGHTS.slice(0, barCount).map((barH, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              height: barH,
              backgroundColor: color,
              transform: [{ scaleY: animations[i] }],
              opacity: animations[i].interpolate({
                inputRange: [0.35, 1],
                outputRange: [0.5, 1],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  bar: {
    width: 5,
    borderRadius: 3,
    transformOrigin: "bottom", // RN 0.76+ 지원
  },
});
