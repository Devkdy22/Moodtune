// src/components/common/LogoIcon.tsx
// ─────────────────────────────────────────────────────────
//  MoodTune 로고 아이콘 컴포넌트 (HTML .logo-ic 재현)
//  box-shadow: lglow 애니메이션 (그린 글로우 펄싱)
//  실제 앱에서는 assets/logo.png 사용
// ─────────────────────────────────────────────────────────
import React, { useEffect, useRef } from 'react';
import {
  Animated, View, StyleSheet, ViewStyle,
} from 'react-native';
import { Colors } from '../../constants/colors';
import MoodtuneMark from './MoodtuneMark';

interface Props {
  size?: number;
  radius?: number;
  animated?: boolean;
  style?: ViewStyle;
  circular?: boolean;  // 원형 (아바타/success 화면용)
}

export default function LogoIcon({
  size = 48,
  radius,
  animated = true,
  style,
  circular = false,
}: Props) {
  const glowAnim = useRef(new Animated.Value(0)).current;

  const br = circular ? size / 2 : (radius ?? size * 0.28);

  useEffect(() => {
    if (!animated) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1800, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1800, useNativeDriver: false }),
      ])
    ).start();
  }, [animated]);

  // lglow: shadowOpacity 0.35 → 0.55
  const shadowOpacity = animated
    ? glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.6] })
    : 0.35;

  const shadowRadius = animated
    ? glowAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 32] })
    : 18;

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          width: size,
          height: size,
          borderRadius: br,
          shadowOpacity,
          shadowRadius,
        },
        style,
      ]}
    >
      <View style={styles.inner}>
        <MoodtuneMark
          width={size * 1.55}
          height={size * 1.1}
          animated={animated}
          style={{ opacity: 0.98 }}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
    shadowColor: Colors.green,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 10,
    // 테두리 (box-shadow 1px rgba(61,220,132,.35) 재현)
    borderWidth: 1,
    borderColor: 'rgba(61,220,132,0.40)',
    backgroundColor: Colors.bgCard,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: 2 }],
  },
});
