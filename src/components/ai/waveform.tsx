import React, { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { FluidAuroraMode } from "./FluidAuroraWave";

export type WaveformProps = {
  barCount?: number;
  height?: number;
  active?: boolean;
  intensity?: number;
  mode?: FluidAuroraMode;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function Waveform({
  barCount = 56,
  height = 72,
  active = true,
  intensity = 0,
  mode,
}: WaveformProps) {
  const [webWaveReady, setWebWaveReady] = useState<React.ComponentType<{
    pointCount?: number;
    height?: number;
    active?: boolean;
    intensity?: number;
    mode?: FluidAuroraMode;
  }> | null>(null);
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
  const resolvedMode: FluidAuroraMode =
    mode ?? (active && safeIntensity > 0.45 ? "analyzing" : "loading");
  const componentProps = useMemo(
    () => ({
      pointCount: clamp(Math.round(barCount * 3.0), 140, 260),
      height,
      active,
      intensity: safeIntensity,
      mode: resolvedMode,
    }),
    [active, barCount, height, resolvedMode, safeIntensity],
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    let alive = true;
    (async () => {
      try {
        const [{ LoadSkiaWeb }, waveMod] = await Promise.all([
          import("@shopify/react-native-skia/lib/module/web"),
          import("./FluidAuroraWave"),
        ]);
        await LoadSkiaWeb();
        if (alive) {
          setWebWaveReady(() => waveMod.default);
        }
      } catch {
        if (alive) setWebWaveReady(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (Platform.OS === "web") {
    if (webWaveReady) {
      const WebWave = webWaveReady;
      return <WebWave {...componentProps} />;
    }

    return (
      <View style={[styles.webContainer, { height }]}>
        <View style={styles.webTrack} />
      </View>
    );
  }

  const FluidAuroraWave = require("./FluidAuroraWave").default as React.ComponentType<{
    pointCount?: number;
    height?: number;
    active?: boolean;
    intensity?: number;
    mode?: FluidAuroraMode;
  }>;

  return (
    <FluidAuroraWave
      pointCount={clamp(Math.round(barCount * 3.0), 140, 260)}
      height={height}
      active={active}
      intensity={safeIntensity}
      mode={resolvedMode}
    />
  );
}

const styles = StyleSheet.create({
  webContainer: {
    width: "100%",
    justifyContent: "center",
  },
  webTrack: {
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(40,217,161,0.08)",
    borderRadius: 999,
  },
});
