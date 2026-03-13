// src/components/common/PulseRings.tsx
// ─────────────────────────────────────────────────────────
//  펄싱 링 (landing .land-ring-*, success .sr* 재현)
//  @keyframes pring/spulse: scale + opacity pulse
// ─────────────────────────────────────────────────────────
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors } from '../../constants/colors';

interface RingConfig {
  size: number;
  borderWidth?: number;
  opacity?: number;
  delay?: number;
  color?: string;
}

interface Props {
  rings?: RingConfig[];
  style?: ViewStyle;
}

const DEFAULT_RINGS: RingConfig[] = [
  { size: 190, borderWidth: 1, opacity: 0.06, delay: 0 },
  { size: 160, borderWidth: 1, opacity: 0.12, delay: 200 },
  { size: 134, borderWidth: 1.5, opacity: 0.22, delay: 400 },
];

export default function PulseRings({ rings = DEFAULT_RINGS, style }: Props) {
  const scales = useRef(rings.map(() => new Animated.Value(1))).current;
  const opacities = useRef(rings.map((r) => new Animated.Value(r.opacity ?? 0.1))).current;

  useEffect(() => {
    const anims = rings.map((ring, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(ring.delay ?? 0),
          Animated.parallel([
            Animated.timing(scales[i], {
              toValue: 1.04,
              duration: 2200,
              useNativeDriver: true,
            }),
            Animated.timing(opacities[i], {
              toValue: (ring.opacity ?? 0.1) * 2.5,
              duration: 2200,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(scales[i], {
              toValue: 1,
              duration: 2200,
              useNativeDriver: true,
            }),
            Animated.timing(opacities[i], {
              toValue: ring.opacity ?? 0.1,
              duration: 2200,
              useNativeDriver: true,
            }),
          ]),
        ])
      )
    );

    Animated.parallel(anims).start();
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View style={[styles.container, style]} pointerEvents="none">
      {rings.map((ring, i) => (
        <Animated.View
          key={i}
          style={[
            styles.ring,
            {
              width: ring.size,
              height: ring.size,
              borderRadius: ring.size / 2,
              borderWidth: ring.borderWidth ?? 1,
              borderColor: ring.color ?? Colors.green,
              opacity: opacities[i],
              transform: [{ scale: scales[i] }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
});
