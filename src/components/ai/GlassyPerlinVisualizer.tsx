import React, { useEffect, useState } from "react";
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

export type GlassyPerlinMode = "loading" | "analyzing" | "completed";

export type GlassyPerlinVisualizerProps = {
  height?: number;
  active?: boolean;
  intensity?: number;
  mode?: GlassyPerlinMode;
  pointCount?: number;
  style?: StyleProp<ViewStyle>;
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function fract(x: number): number {
  "worklet";
  return x - Math.floor(x);
}

function fade(t: number): number {
  "worklet";
  return t * t * (3 - 2 * t);
}

function hash1(n: number): number {
  "worklet";
  return fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
}

function valueNoise1D(x: number): number {
  "worklet";
  const i = Math.floor(x);
  const f = x - i;
  const a = hash1(i);
  const b = hash1(i + 1);
  return (a + (b - a) * fade(f)) * 2 - 1;
}

function fbm1D(x: number): number {
  "worklet";
  let v = 0;
  let amp = 0.6;
  let freq = 1;
  for (let o = 0; o < 4; o += 1) {
    v += valueNoise1D(x * freq) * amp;
    freq *= 2.01;
    amp *= 0.52;
  }
  return v;
}

function waveShapeValue(nx: number, t: number, complexity: number): number {
  "worklet";
  const drift = Math.sin(t * 0.31) * 0.045;
  const peak1Center = 0.46 + drift;
  const peak2Center = 0.58 - drift * 0.7;
  const peak1 =
    Math.exp(-((nx - peak1Center) ** 2) / (0.0034 + complexity * 0.0008)) *
    1.22;
  const peak2 =
    Math.exp(-((nx - peak2Center) ** 2) / (0.0054 + complexity * 0.0012)) *
    0.78;

  const s1 = Math.sin((nx * 2.2 + t * 0.18) * Math.PI * 2) * 0.17;
  const s2 = Math.sin((nx * 1.1 - t * 0.12) * Math.PI * 2) * 0.11;
  const s3 = Math.sin((nx * 0.6 + t * 0.08) * Math.PI * 2) * 0.25;
  const noise = fbm1D(nx * (2.3 + complexity * 0.9) + t * 0.16) * 0.12;

  return s1 + s2 + s3 + (peak1 - peak2) + noise;
}

function buildTubeBandPath(args: {
  width: number;
  height: number;
  pointCount: number;
  t: number;
  amplitude: number;
  baseThickness: number;
  complexity: number;
  from: number;
  to: number;
  thicknessScale?: number;
}): ReturnType<typeof Skia.Path.Make> {
  "worklet";
  const {
    width,
    height,
    pointCount,
    t,
    amplitude,
    baseThickness,
    complexity,
    from,
    to,
    thicknessScale = 1,
  } = args;

  const p = Skia.Path.Make();
  const centerY = height * 0.52;
  const step = width / Math.max(1, pointCount - 1);
  const topPts: { x: number; y: number }[] = [];
  const botPts: { x: number; y: number }[] = [];

  for (let i = 0; i < pointCount; i += 1) {
    const x = i * step;
    const nx = i / Math.max(1, pointCount - 1);
    const edge = Math.pow(Math.sin(Math.PI * nx), 1.95);
    const centerWeight = Math.exp(-((nx - 0.5) ** 2) / 0.028);

    const wave = waveShapeValue(nx, t, complexity);
    const y = centerY + wave * amplitude * edge;

    const thickness =
      Math.max(
        8,
        baseThickness *
          (0.56 + edge * 1.12) *
          (0.9 + centerWeight * 0.48) *
          thicknessScale,
      ) * (0.94 + Math.abs(wave) * 0.2);

    const topY = y - thickness * 0.5;
    const botY = y + thickness * 0.5;
    topPts.push({ x, y: topY + thickness * from });
    botPts.push({ x, y: topY + thickness * to });
  }

  if (!topPts.length) return p;

  p.moveTo(topPts[0].x, topPts[0].y);
  for (let i = 1; i < topPts.length; i += 1) {
    const prev = topPts[i - 1];
    const cur = topPts[i];
    const cx = (prev.x + cur.x) * 0.5;
    p.cubicTo(cx, prev.y, cx, cur.y, cur.x, cur.y);
  }
  for (let i = botPts.length - 1; i >= 0; i -= 1) {
    const cur = botPts[i];
    const prev = botPts[Math.max(0, i - 1)];
    if (i === botPts.length - 1) {
      p.lineTo(cur.x, cur.y);
      continue;
    }
    const cx = (prev.x + cur.x) * 0.5;
    p.cubicTo(cx, cur.y, cx, prev.y, prev.x, prev.y);
  }
  p.close();
  return p;
}

export default function GlassyPerlinVisualizer({
  height = 214,
  active = true,
  intensity = 0.5,
  mode = "loading",
  pointCount = 56,
  style,
}: GlassyPerlinVisualizerProps) {
  const [width, setWidth] = useState(320);
  const points = clamp(Math.round(pointCount), 42, 72);
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);

  const clock = useClock();
  const activeSV = useSharedValue(active ? 1 : 0);
  const intensitySV = useSharedValue(safeIntensity);
  const modeSV = useSharedValue(
    mode === "completed" ? 2 : mode === "analyzing" ? 1 : 0,
  );

  useEffect(() => {
    activeSV.value = active ? 1 : 0;
    intensitySV.value = safeIntensity;
    modeSV.value = mode === "completed" ? 2 : mode === "analyzing" ? 1 : 0;
  }, [active, activeSV, intensitySV, mode, modeSV, safeIntensity]);

  const bloomPath = useDerivedValue(() => {
    if (width < 2) return Skia.Path.Make();
    const activeFactor = activeSV.value > 0.5 ? 1 : 0.28;
    const speed =
      (modeSV.value === 2 ? 0.00068 : modeSV.value === 1 ? 0.0006 : 0.00045) *
      activeFactor;
    const t = clock.value * speed;
    const ampBase = modeSV.value === 2 ? 34 : modeSV.value === 1 ? 28 : 22;
    const thicknessBase =
      modeSV.value === 2 ? 30 : modeSV.value === 1 ? 24 : 20;
    return buildTubeBandPath({
      width,
      height,
      pointCount: points,
      t,
      amplitude: (ampBase + intensitySV.value * 26) * activeFactor,
      baseThickness: thicknessBase + intensitySV.value * 15,
      complexity: modeSV.value === 1 ? 1.08 : modeSV.value === 2 ? 1.2 : 0.92,
      from: 0,
      to: 1,
      thicknessScale: 1.34,
    });
  }, [activeSV, clock, height, intensitySV, modeSV, points, width]);

  const bodyPath = useDerivedValue(() => {
    if (width < 2) return Skia.Path.Make();
    const activeFactor = activeSV.value > 0.5 ? 1 : 0.28;
    const speed =
      (modeSV.value === 2 ? 0.00068 : modeSV.value === 1 ? 0.0006 : 0.00045) *
      activeFactor;
    const t = clock.value * speed;
    const ampBase = modeSV.value === 2 ? 34 : modeSV.value === 1 ? 28 : 22;
    const thicknessBase =
      modeSV.value === 2 ? 30 : modeSV.value === 1 ? 24 : 20;
    return buildTubeBandPath({
      width,
      height,
      pointCount: points,
      t,
      amplitude: (ampBase + intensitySV.value * 26) * activeFactor,
      baseThickness: thicknessBase + intensitySV.value * 15,
      complexity: modeSV.value === 1 ? 1.08 : modeSV.value === 2 ? 1.2 : 0.92,
      from: 0,
      to: 1,
      thicknessScale: 1,
    });
  }, [activeSV, clock, height, intensitySV, modeSV, points, width]);

  const innerPath = useDerivedValue(() => {
    if (width < 2) return Skia.Path.Make();
    const activeFactor = activeSV.value > 0.5 ? 1 : 0.28;
    const speed =
      (modeSV.value === 2 ? 0.00068 : modeSV.value === 1 ? 0.0006 : 0.00045) *
      activeFactor;
    const t = clock.value * speed;
    const ampBase = modeSV.value === 2 ? 34 : modeSV.value === 1 ? 28 : 22;
    const thicknessBase =
      modeSV.value === 2 ? 30 : modeSV.value === 1 ? 24 : 20;
    return buildTubeBandPath({
      width,
      height,
      pointCount: points,
      t,
      amplitude: (ampBase + intensitySV.value * 26) * activeFactor,
      baseThickness: thicknessBase + intensitySV.value * 15,
      complexity: modeSV.value === 1 ? 1.08 : modeSV.value === 2 ? 1.2 : 0.92,
      from: 0.2,
      to: 0.82,
      thicknessScale: 0.74,
    });
  }, [activeSV, clock, height, intensitySV, modeSV, points, width]);

  const specPath = useDerivedValue(() => {
    if (width < 2) return Skia.Path.Make();
    const activeFactor = activeSV.value > 0.5 ? 1 : 0.28;
    const speed =
      (modeSV.value === 2 ? 0.00068 : modeSV.value === 1 ? 0.0006 : 0.00045) *
      activeFactor;
    const t = clock.value * speed;
    const ampBase = modeSV.value === 2 ? 34 : modeSV.value === 1 ? 28 : 22;
    const thicknessBase =
      modeSV.value === 2 ? 30 : modeSV.value === 1 ? 24 : 20;
    return buildTubeBandPath({
      width,
      height,
      pointCount: points,
      t,
      amplitude: (ampBase + intensitySV.value * 26) * activeFactor,
      baseThickness: thicknessBase + intensitySV.value * 15,
      complexity: modeSV.value === 1 ? 1.08 : modeSV.value === 2 ? 1.2 : 0.92,
      from: 0.04,
      to: 0.16,
      thicknessScale: 0.58,
    });
  }, [activeSV, clock, height, intensitySV, modeSV, points, width]);

  const onLayout = (e: LayoutChangeEvent) => {
    const nextW = Math.max(40, Math.round(e.nativeEvent.layout.width));
    if (nextW !== width) setWidth(nextW);
  };

  return (
    <View style={[styles.container, { height }, style]} onLayout={onLayout}>
      <Canvas style={styles.canvas}>
        <Group clip={{ x: 0, y: 0, width, height }}>
          <Path path={bloomPath} style="fill" color="rgba(29,206,147,0.24)">
            <BlurMask blur={14} style="solid" />
          </Path>

          <Path path={bodyPath} style="fill">
            <LinearGradient
              start={vec(width * 0.5, 0)}
              end={vec(width * 0.5, height)}
              colors={[
                "rgba(8,72,53,0.9)",
                "rgba(29,206,147,0.95)",
                "#6CFFBF",
                "rgba(29,206,147,0.95)",
                "rgba(8,72,53,0.9)",
              ]}
            />
          </Path>

          <Path path={innerPath} style="fill" color="rgba(172,255,223,0.5)">
            <BlurMask blur={4} style="solid" />
          </Path>

          <Path path={specPath} style="fill" color="rgba(255,255,255,0.78)" />
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
