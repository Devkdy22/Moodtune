import React, { useEffect, useMemo, useState } from "react";
import {
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import {
  BlurMask,
  Canvas,
  Group,
  LinearGradient,
  Path,
  Skia,
  useClock,
  vec,
} from "@shopify/react-native-skia";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";

export type FluidAuroraMode = "loading" | "analyzing" | "completed";

export type FluidAuroraWaveProps = {
  height?: number;
  active?: boolean;
  intensity?: number;
  mode?: FluidAuroraMode;
  pointCount?: number;
  style?: StyleProp<ViewStyle>;
};

type RibbonLayer = {
  speed: number;
  phase: number;
  amplitude: number;
  thickness: number;
  freqA: number;
  freqB: number;
  freqC: number;
  opacity: number;
  blur: number;
  fromColor: string;
  toColor: string;
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function buildRibbonPath(args: {
  width: number;
  height: number;
  points: number;
  t: number;
  layer: RibbonLayer;
  intensity: number;
  modeScale: number;
  activeScale: number;
}): ReturnType<typeof Skia.Path.Make> {
  "worklet";
  const { width, height, points, t, layer, intensity, modeScale, activeScale } =
    args;
  const p = Skia.Path.Make();
  const centerY = height * 0.52;
  const step = width / Math.max(1, points - 1);

  const topPts: { x: number; y: number }[] = [];
  const botPts: { x: number; y: number }[] = [];

  const amp = layer.amplitude * (0.86 + intensity * 0.28) * modeScale * activeScale;
  const thickness =
    layer.thickness * (0.9 + intensity * 0.16) * (0.96 + modeScale * 0.06);
  const safeAmp = Math.min(amp, height * 0.26);
  const safeThickness = Math.min(thickness, height * 0.2);
  let prevWave = 0;
  let prevThickness = safeThickness;

  for (let i = 0; i < points; i += 1) {
    const x = i * step;
    const nx = i / Math.max(1, points - 1);
    const edgeDamp = Math.pow(Math.sin(Math.PI * nx), 1.55);
    const centerWeight = Math.exp(-((nx - 0.5) ** 2) / 0.085);

    const sA =
      Math.sin((nx * layer.freqA + t * 0.72 + layer.phase) * Math.PI * 2) *
      0.64;
    const sB =
      Math.sin((nx * layer.freqB - t * 0.46 + layer.phase * 0.7) * Math.PI * 2) *
      0.46;
    const sC =
      Math.sin((nx * layer.freqC + t * 0.26 + layer.phase * 1.22) * Math.PI * 2) *
      0.28;
    const rawWave = sA + sB + sC;
    const smoothedWave = i === 0 ? rawWave : prevWave * 0.88 + rawWave * 0.12;
    const softWave = Math.tanh(smoothedWave * 0.62);
    prevWave = smoothedWave;

    const waveGain = softWave < 0 ? 1.14 : 1;
    const y =
      centerY +
      softWave * safeAmp * waveGain * edgeDamp * (0.66 + centerWeight * 0.44);
    const localThickness =
      safeThickness *
      (0.58 + edgeDamp * 0.78) *
      (0.92 + centerWeight * 0.22) *
      (0.96 + Math.abs(softWave) * 0.03);
    const smoothThickness =
      i === 0
        ? localThickness
        : prevThickness * 0.9 + localThickness * 0.1;
    prevThickness = smoothThickness;

    topPts.push({ x, y: y - smoothThickness * 0.5 });
    botPts.push({ x, y: y + smoothThickness * 0.5 });
  }

  if (!topPts.length) return p;

  p.moveTo(topPts[0].x, topPts[0].y);
  for (let i = 1; i < topPts.length; i += 1) {
    const prev = topPts[i - 1];
    const cur = topPts[i];
    const cx = (prev.x + cur.x) * 0.5;
    p.cubicTo(cx, prev.y, cx, cur.y, cur.x, cur.y);
  }

  p.lineTo(botPts[botPts.length - 1].x, botPts[botPts.length - 1].y);
  for (let i = botPts.length - 2; i >= 0; i -= 1) {
    const cur = botPts[i];
    const next = botPts[i + 1];
    const cx = (cur.x + next.x) * 0.5;
    p.cubicTo(cx, next.y, cx, cur.y, cur.x, cur.y);
  }

  p.close();
  return p;
}

export default function FluidAuroraWave({
  height = 380,
  active = true,
  intensity = 0.5,
  mode = "loading",
  pointCount = 180,
  style,
}: FluidAuroraWaveProps) {
  const [width, setWidth] = useState(320);
  const points = clamp(Math.round(pointCount), 140, 260);
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
  const clock = useClock();

  const activeSV = useSharedValue(active ? 1 : 0);
  const intensitySV = useSharedValue(safeIntensity);
  const modeSV = useSharedValue(mode === "completed" ? 2 : mode === "analyzing" ? 1 : 0);

  useEffect(() => {
    activeSV.value = active ? 1 : 0;
    intensitySV.value = safeIntensity;
    modeSV.value = mode === "completed" ? 2 : mode === "analyzing" ? 1 : 0;
  }, [active, activeSV, intensitySV, mode, modeSV, safeIntensity]);

  const layers = useMemo<RibbonLayer[]>(
    () => [
      {
        speed: 0.56,
        phase: 0.24,
        amplitude: 150,
        thickness: 62,
        freqA: 0.88,
        freqB: 0.42,
        freqC: 1.28,
        opacity: 0.22,
        blur: 8,
        fromColor: "rgba(11,59,46,0.92)",
        toColor: "rgba(29,206,147,0.9)",
      },
      {
        speed: 0.74,
        phase: 1.35,
        amplitude: 108,
        thickness: 46,
        freqA: 1.02,
        freqB: 0.5,
        freqC: 1.46,
        opacity: 0.35,
        blur: 5,
        fromColor: "rgba(29,206,147,0.96)",
        toColor: "rgba(108,255,191,0.95)",
      },
      {
        speed: 0.92,
        phase: 2.18,
        amplitude: 78,
        thickness: 30,
        freqA: 1.12,
        freqB: 0.58,
        freqC: 1.58,
        opacity: 0.58,
        blur: 2,
        fromColor: "rgba(108,255,191,0.98)",
        toColor: "rgba(232,255,246,0.96)",
      },
    ],
    [],
  );

  const layerAPath = useDerivedValue(() => {
    if (width < 2) return Skia.Path.Make();
    const modeScale = modeSV.value === 2 ? 1.12 : modeSV.value === 1 ? 1 : 0.88;
    const activeScale = activeSV.value > 0.5 ? 1 : 0.22;
    const t = clock.value * 0.001 * layers[0].speed;
    return buildRibbonPath({
      width,
      height,
      points,
      t,
      layer: layers[0],
      intensity: intensitySV.value,
      modeScale,
      activeScale,
    });
  }, [clock, height, intensitySV, layers, modeSV, points, activeSV, width]);

  const layerBPath = useDerivedValue(() => {
    if (width < 2) return Skia.Path.Make();
    const modeScale = modeSV.value === 2 ? 1.1 : modeSV.value === 1 ? 1 : 0.9;
    const activeScale = activeSV.value > 0.5 ? 1 : 0.22;
    const t = clock.value * 0.001 * layers[1].speed;
    return buildRibbonPath({
      width,
      height,
      points,
      t,
      layer: layers[1],
      intensity: intensitySV.value,
      modeScale,
      activeScale,
    });
  }, [clock, height, intensitySV, layers, modeSV, points, activeSV, width]);

  const layerCPath = useDerivedValue(() => {
    if (width < 2) return Skia.Path.Make();
    const modeScale = modeSV.value === 2 ? 1.08 : modeSV.value === 1 ? 1 : 0.92;
    const activeScale = activeSV.value > 0.5 ? 1 : 0.22;
    const t = clock.value * 0.001 * layers[2].speed;
    return buildRibbonPath({
      width,
      height,
      points,
      t,
      layer: layers[2],
      intensity: intensitySV.value,
      modeScale,
      activeScale,
    });
  }, [clock, height, intensitySV, layers, modeSV, points, activeSV, width]);

  const onLayout = (e: LayoutChangeEvent) => {
    const nextW = Math.max(40, Math.round(e.nativeEvent.layout.width));
    if (nextW !== width) setWidth(nextW);
  };

  return (
    <View style={[styles.container, { height }, style]} onLayout={onLayout}>
      <Canvas style={styles.canvas}>
        <Group clip={{ x: 0, y: 0, width, height }}>
          <Path path={layerAPath} style="fill" color={`rgba(29,206,147,${layers[0].opacity})`}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(width, height)}
              colors={[layers[0].fromColor, layers[0].toColor]}
            />
            <BlurMask blur={layers[0].blur} style="solid" />
          </Path>

          <Path path={layerBPath} style="fill" color={`rgba(108,255,191,${layers[1].opacity})`}>
            <LinearGradient
              start={vec(width * 0.12, 0)}
              end={vec(width * 0.92, height)}
              colors={[layers[1].fromColor, layers[1].toColor]}
            />
            <BlurMask blur={layers[1].blur} style="solid" />
          </Path>

          <Path path={layerCPath} style="fill" color={`rgba(232,255,246,${layers[2].opacity})`}>
            <LinearGradient
              start={vec(width * 0.2, 0)}
              end={vec(width * 0.86, height)}
              colors={[layers[2].fromColor, layers[2].toColor]}
            />
            <BlurMask blur={layers[2].blur} style="solid" />
          </Path>
        </Group>
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
