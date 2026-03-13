// src/components/ai/EqBars.tsx
// ─────────────────────────────────────────────────────────
//  랜딩 화면 이퀄라이저 배경 바 (HTML .land-eq-bar 재현)
//  @keyframes land-eq: 0%{scaleY(.08)} 100%{scaleY(1)}
//  각 바마다 다른 높이와 딜레이
// ─────────────────────────────────────────────────────────
import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
import { Colors } from '../../constants/colors';

const { width: W, height: H } = Dimensions.get('window');

// HTML 원본 nth-child 퍼센트 높이 (1~28번)
const BAR_HEIGHTS_PCT = [
  35, 55, 78, 42, 90, 60, 72, 38, 95, 50, 68, 33, 82, 45, 62,
  40, 75, 52, 85, 30, 70, 58, 88, 44, 65, 36, 80, 48,
];
const BAR_DELAYS_MS = [
  0, 120, 240, 80, 160, 320, 200, 60, 280, 140, 100, 220, 180, 300, 40,
  260, 340, 20, 190, 250, 130, 310, 70, 170, 230, 90, 150, 360,
];

const MAX_H = H * 0.62;   // height:65% of screen
const BAR_W = (W - 16) / 28 - 4;  // 28개, gap 4px

interface Props {
  barCount?: number;
}

export default function EqBars({ barCount = 28 }: Props) {
  const scales = useRef(
    BAR_HEIGHTS_PCT.slice(0, barCount).map(() => new Animated.Value(0.08))
  ).current;

  useEffect(() => {
    const anims = scales.map((scale, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(BAR_DELAYS_MS[i % BAR_DELAYS_MS.length]),
          Animated.timing(scale, {
            toValue: 1,
            duration: 900 + (i % 5) * 120,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.08 + Math.random() * 0.15,
            duration: 900 + (i % 4) * 150,
            useNativeDriver: true,
          }),
        ])
      )
    );
    Animated.parallel(anims).start();
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      {BAR_HEIGHTS_PCT.slice(0, barCount).map((pct, i) => {
        const barH = (pct / 100) * MAX_H;
        return (
          <Animated.View
            key={i}
            style={[
              styles.bar,
              {
                width: Math.max(BAR_W, 10),
                height: barH,
                opacity: 0.12 + (pct / 100) * 0.08,
                transform: [{ scaleY: scales[i] }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: MAX_H,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  bar: {
    backgroundColor: Colors.green,
    borderRadius: 3,
    // 하단 고정: transform origin을 bottom으로
    // scaleY는 center 기준이므로 translateY 보정 필요
  },
});
