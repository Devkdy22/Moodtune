import React, { useEffect, useState } from "react";
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
  const [phase, setPhase] = useState(0);
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
  const resolvedMode: FluidAuroraMode =
    mode ?? (active && safeIntensity > 0.45 ? "analyzing" : "loading");
  useEffect(() => {
    if (Platform.OS !== "web" || !active) return;
    const id = setInterval(() => setPhase((p) => p + 0.045), 33);
    return () => clearInterval(id);
  }, [active]);

  if (Platform.OS === "web") {
    const webBars = Array.from({ length: Math.max(40, barCount) }, (_, i) => {
      const count = Math.max(1, barCount - 1);
      const nx = i / count;
      const envelope = Math.pow(Math.sin(Math.PI * nx), 1.25);
      const speed = 0.8 + (i % 7) * 0.08;
      const wobble =
        0.62 +
        0.22 * Math.sin(phase * speed + i * 0.21) +
        0.14 * Math.sin(phase * 1.6 - i * 0.13);
      const energy = active ? clamp(wobble, 0.2, 1.12) : 0.14;
      const minHeight = 0.08;
      const scaleY = minHeight + envelope * energy;
      const alpha = 0.2 + envelope * 0.72;
      return { i, scaleY: clamp(scaleY, 0.08, 1), alpha };
    });

    return (
      <View style={[styles.webContainer, { height }]}>
        <View style={styles.webBarsWrap}>
          {webBars.map((bar) => (
            <View
              key={bar.i}
              style={[
                styles.webBar,
                {
                  opacity: bar.alpha,
                  transform: [{ scaleY: bar.scaleY }],
                },
              ]}
            />
          ))}
        </View>
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
    overflow: "hidden",
  },
  webBarsWrap: {
    width: "100%",
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    paddingHorizontal: 8,
  },
  webBar: {
    flex: 1,
    height: "100%",
    backgroundColor: "rgba(40,217,161,0.95)",
    borderRadius: 9999,
  },
});
