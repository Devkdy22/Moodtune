// src/components/common/MoodtuneMark.tsx
// ─────────────────────────────────────────────────────────
//  Moodtune 네온 로고 마크 (SVG)
//  - 로고 주변 글로우/파동(이퀄라이저) 애니메이션 포함
//  - 이미지 에셋 없이 바로 사용 가능
// ─────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef } from "react";
import { Animated } from "react-native";
import Svg, {
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  ClipPath,
} from "react-native-svg";
import { Colors } from "../../constants/colors";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = {
  width?: number;
  height?: number;
  animated?: boolean;
  glowColor?: string;
  style?: any;
};

const VIEWBOX_W = 400;
const VIEWBOX_H = 260;

// 대략적인 로고 실루엣 (헤드폰/클라우드 느낌)
const BLOB_D =
  "M 66 162 C 26 162 14 132 22 109 C 32 68 66 62 99 70 C 118 30 155 18 200 24 C 245 18 282 30 301 70 C 334 62 368 68 378 109 C 386 132 374 162 334 162 C 310 226 255 244 200 244 C 145 244 90 226 66 162 Z";

// 상단 글로시 하이라이트 (좌/우)
const GLOSS_L_D =
  "M 88 124 C 64 116 66 92 88 82 C 112 72 150 78 156 96 C 162 116 126 130 88 124 Z";
const GLOSS_R_D =
  "M 312 124 C 336 116 334 92 312 82 C 288 72 250 78 244 96 C 238 116 274 130 312 124 Z";

export default function MoodtuneMark({
  width = 320,
  height = 220,
  animated = true,
  glowColor = Colors.greenL,
  style,
}: Props) {
  const phase = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(phase, {
          toValue: 1,
          duration: 2400,
          useNativeDriver: false,
        }),
        Animated.timing(phase, {
          toValue: 0,
          duration: 0,
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, phase]);

  const bars = useMemo(() => {
    const baseHeights = [58, 76, 96, 118, 136, 150, 158, 150, 136, 118, 96, 76, 58];
    const barCount = baseHeights.length;
    const barW = 12;
    const gap = 8;
    const total = barCount * barW + (barCount - 1) * gap;
    const left = (VIEWBOX_W - total) / 2;
    const bottomY = 222;

    return baseHeights.map((baseH, i) => {
      const offset = i / barCount;
      const local = Animated.modulo(Animated.add(phase, offset), 1);
      const scale = local.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.35, 1, 0.35],
      });
      const h = Animated.multiply(scale, baseH);
      const y = Animated.subtract(bottomY, h);
      const x = left + i * (barW + gap);
      return { x, y, w: barW, h };
    });
  }, [phase]);

  const glossOpacity = animated
    ? phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.22, 0.38, 0.22] })
    : 0.28;

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      style={style}
    >
      <Defs>
        <LinearGradient id="strokeGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={Colors.greenL} stopOpacity="0.95" />
          <Stop offset="0.55" stopColor={Colors.green} stopOpacity="0.9" />
          <Stop offset="1" stopColor={Colors.greenD} stopOpacity="0.95" />
        </LinearGradient>

        <LinearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#050907" stopOpacity="0.95" />
          <Stop offset="1" stopColor="#030504" stopOpacity="0.98" />
        </LinearGradient>

        <LinearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={Colors.greenL} stopOpacity="0.46" />
          <Stop offset="0.55" stopColor={Colors.green} stopOpacity="0.22" />
          <Stop offset="1" stopColor={Colors.green} stopOpacity="0.06" />
        </LinearGradient>

        <LinearGradient id="pillGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={Colors.greenL} stopOpacity="0.95" />
          <Stop offset="1" stopColor={Colors.greenD} stopOpacity="0.95" />
        </LinearGradient>

        <LinearGradient id="glossGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.62" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0.06" />
        </LinearGradient>

        <ClipPath id="blobClip">
          <Path d={BLOB_D} />
        </ClipPath>
      </Defs>

      {/* 바깥 글로우(번짐) */}
      <Path
        d={BLOB_D}
        fill="none"
        stroke={glowColor}
        strokeWidth={26}
        strokeOpacity={0.10}
      />
      <Path
        d={BLOB_D}
        fill="none"
        stroke={glowColor}
        strokeWidth={14}
        strokeOpacity={0.14}
      />

      {/* 본체 */}
      <Path d={BLOB_D} fill="url(#fillGrad)" />
      <Path
        d={BLOB_D}
        fill="none"
        stroke="url(#strokeGrad)"
        strokeWidth={4}
        strokeOpacity={0.9}
      />

      {/* 내부 요소는 실루엣 안으로 클립 */}
      <G clipPath="url(#blobClip)">
        {/* 이퀄라이저 바(파동) */}
        {bars.map((b, i) => (
          <AnimatedRect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h as any}
            rx={3}
            fill="url(#barGrad)"
            stroke={Colors.green}
            strokeOpacity={0.22}
            strokeWidth={1}
          />
        ))}

        {/* 중앙 캡슐 */}
        <Rect
          x={200 - 28}
          y={86}
          width={56}
          height={150}
          rx={28}
          fill="url(#pillGrad)"
          opacity={0.92}
        />
        <Rect
          x={200 - 18}
          y={98}
          width={36}
          height={126}
          rx={18}
          fill="#ffffff"
          opacity={0.08}
        />

        {/* 글로시 하이라이트 */}
        <AnimatedPath
          d={GLOSS_L_D}
          fill="url(#glossGrad)"
          opacity={glossOpacity as any}
        />
        <AnimatedPath
          d={GLOSS_R_D}
          fill="url(#glossGrad)"
          opacity={glossOpacity as any}
        />
      </G>
    </Svg>
  );
}

