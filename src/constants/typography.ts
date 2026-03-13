// ────────────────────────────────────────────────────────────
//  MoodTune Design System · Typography
//  Outfit (display) + DM Sans (body)
// ────────────────────────────────────────────────────────────

import { Platform } from 'react-native';

export const Fonts = {
  display:  'Outfit',        // --fd : 타이틀, 브랜드명
  body:     'DMSans',        // --fb : 본문, 버튼, 라벨
  // fallback
  sys:      Platform.OS === 'ios' ? 'SF Pro Display' : 'Roboto',
} as const;

export const FontSize = {
  xs:   10,   // 날짜, 부제
  sm:   11,   // 힌트, 태그
  base: 12,   // 보조 본문
  md:   13,   // 일반 본문
  lg:   14,   // 강조 본문, 버튼
  xl:   15,   // 버튼 (primary)
  '2xl': 16,
  '3xl': 18,
  '4xl': 20,
  '5xl': 22,
  '6xl': 24,
  '7xl': 28,
  '8xl': 30,
  '9xl': 34,
} as const;

export const FontWeight = {
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,
  extrabold:'800' as const,
  black:    '900' as const,
} as const;

export const LineHeight = {
  tight:   1.2,
  normal:  1.5,
  relaxed: 1.7,
} as const;

export const LetterSpacing = {
  tight:  -0.8,
  normal:  0,
  wide:    0.5,
} as const;
