import React from "react";
import FluidAuroraWave, { FluidAuroraMode } from "./FluidAuroraWave";

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
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
  const resolvedMode: FluidAuroraMode =
    mode ?? (active && safeIntensity > 0.45 ? "analyzing" : "loading");

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
