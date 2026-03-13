// ─────────────────────────────────────────────────────────
//  MoodTune · Design Tokens (HTML 프로토타입 1:1 매핑)
//  src/constants/colors.ts
// ─────────────────────────────────────────────────────────

export const Colors = {
  // ── Primary Green (--green 계열) ──
  green:    '#3ddc84',
  greenL:   '#6fffb8',
  greenD:   '#1db864',

  // ── Background (--bg 계열) ──
  bgDeep:   '#060d0a',   // 최하단 배경
  bgMid:    '#0b1a13',   // 중간 배경
  bgCard:   '#0f2018',   // 카드 배경

  // ── Text ──
  t1:       'rgba(255,255,255,0.93)',
  t2:       'rgba(255,255,255,0.62)',
  t3:       'rgba(255,255,255,0.34)',

  // ── Glass Morphism ──
  glass:    'rgba(255,255,255,0.07)',
  glassBd:  'rgba(255,255,255,0.13)',

  // ── Glow ──
  glow:     'rgba(61,220,132,0.18)',
  glowGreen:'rgba(61,220,132,0.35)',

  // ── Brand ──
  spotify:  '#1DB954',
  error:    '#ff4f6a',
  white:    '#ffffff',
  black:    '#000000',
} as const;

export type ColorKey = keyof typeof Colors;
