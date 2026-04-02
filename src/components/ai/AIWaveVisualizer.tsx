import React, { useMemo, useState } from "react";
import { LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import {
  BlurMask,
  Canvas,
  LinearGradient,
  Path,
  Skia,
  vec,
} from "@shopify/react-native-skia";
import {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";

type WaveMode = "loading" | "analyzing";

export type AIWaveVisualizerProps = {
  height?: number;
  active?: boolean;
  intensity?: number;
  mode?: WaveMode;
  pointCount?: number;
  style?: StyleProp<ViewStyle>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function AIWaveVisualizer({
  height = 72,
  active = true,
  intensity = 0.3,
  mode = "loading",
  pointCount = 36,
  style,
}: AIWaveVisualizerProps) {
  const [width, setWidth] = useState(320);
  const points = clamp(Math.round(pointCount), 30, 40);
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);

  const time = useSharedValue(0);
  const complexity = useSharedValue(1.0);
  const targetComplexity = useSharedValue(1.0);
  const nextComplexityShiftAt = useSharedValue(0.8);
  const activeSV = useSharedValue(active ? 1 : 0);
  const modeSV = useSharedValue(mode === "analyzing" ? 1 : 0);
  const intensitySV = useSharedValue(safeIntensity);

  useMemo(() => {
    activeSV.value = active ? 1 : 0;
    modeSV.value = mode === "analyzing" ? 1 : 0;
    intensitySV.value = safeIntensity;
  }, [active, activeSV, intensitySV, mode, modeSV, safeIntensity]);

  useFrameCallback(frame => {
    "worklet";
    if (activeSV.value < 0.5) return;

    const dt = (frame.timeSincePreviousFrame ?? 16) / 1000;
    const baseSpeed = modeSV.value > 0.5 ? 2.1 : 0.95;
    time.value += dt * baseSpeed;

    if (modeSV.value > 0.5 && time.value >= nextComplexityShiftAt.value) {
      const pseudoRandom = Math.abs(Math.sin(time.value * 2.173 + 3.91));
      targetComplexity.value = 0.85 + pseudoRandom * 1.35;
      nextComplexityShiftAt.value = time.value + 0.35 + pseudoRandom * 0.65;
    } else if (modeSV.value <= 0.5) {
      targetComplexity.value = 0.95;
    }

    const lerp = modeSV.value > 0.5 ? 0.09 : 0.035;
    complexity.value += (targetComplexity.value - complexity.value) * lerp;
  });

  const path = useDerivedValue(() => {
    const p = Skia.Path.Make();
    if (!p || width <= 2) return Skia.Path.Make();

    const centerY = height / 2;
    const step = width / (points - 1);
    const amp = 6 + intensitySV.value * 40;
    const localTime = time.value;
    const localComplexity = complexity.value;
    const modeBoost = modeSV.value > 0.5 ? 1.22 : 0.82;
    const mid = (points - 1) / 2;

    let prevX = 0;
    let prevY = centerY;

    for (let i = 0; i < points; i += 1) {
      const x = i * step;
      const nx = i / (points - 1);
      const edgeEnvelope = Math.pow(Math.sin(Math.PI * nx), 1.8);
      const centerBoost = Math.exp(-((i - mid) ** 2) / 52);
      const t = localTime + i * 0.09 * localComplexity;

      const waveA = Math.sin(t * (1.6 + localComplexity * 0.12) + i * 0.44) * 0.52;
      const waveB = Math.sin(t * (2.7 + localComplexity * 0.24) + i * 0.95) * 0.36;
      const waveC = Math.sin(t * (4.1 + localComplexity * 0.31) + i * 1.57) * 0.2;
      const noise = Math.sin((i + 11.3) * 7.13 + localTime * 1.23) * 0.045;

      const y =
        centerY +
        (waveA + waveB + waveC + noise) *
          amp *
          edgeEnvelope *
          modeBoost *
          (0.8 + centerBoost * 0.7);

      if (i === 0) {
        p.moveTo(x, y);
      } else {
        const cx = (prevX + x) * 0.5;
        p.cubicTo(cx, prevY, cx, y, x, y);
      }

      prevX = x;
      prevY = y;
    }

    return p;
  }, [height, points, width]);

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.max(40, Math.round(event.nativeEvent.layout.width));
    if (nextWidth !== width) setWidth(nextWidth);
  };

  return (
    <View style={[styles.container, { height }, style]} onLayout={onLayout}>
      <Canvas style={styles.canvas}>
        <Path path={path} style="stroke" strokeWidth={18} color="rgba(29,206,147,0.28)">
          <BlurMask blur={12} style="solid" />
        </Path>

        <Path path={path} style="stroke" strokeWidth={4.5}>
          <LinearGradient
            start={vec(0, height * 0.4)}
            end={vec(width, height * 0.6)}
            colors={["#1DCE93", "#6CFFBF"]}
          />
          <BlurMask blur={2} style="solid" />
        </Path>

        <Path path={path} style="stroke" strokeWidth={1.25} color="#E8FFF8" />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    justifyContent: "center",
  },
  canvas: {
    flex: 1,
  },
});

