// src/constants/layout.ts
import { Dimensions } from 'react-native';

const { width: W, height: H } = Dimensions.get('window');

export const Layout = {
  screenW:       W,
  screenH:       H,
  pagePaddingH:  24,
  pagePaddingV:  20,
  cardRadius:    18,
  btnHeightLg:   52,
  btnHeightMd:   44,
  btnRadius:     16,
  inputHeight:   52,
  inputRadius:   14,
  headerH:       60,
  tabBarH:       80,
} as const;

export const Spacing = {
  xs:   8,
  sm:   12,
  md:   16,
  lg:   20,
  xl:   24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
} as const;

export const Radius = {
  xs:   6,
  sm:   10,
  md:   14,
  lg:   18,
  xl:   24,
  '2xl': 32,
  full: 9999,
} as const;

export const FontSize = {
  xs:   10,
  sm:   11,
  base: 12,
  md:   13,
  lg:   14,
  xl:   15,
  '2xl': 16,
  '3xl': 18,
  '4xl': 20,
  '5xl': 22,
  '6xl': 24,
  '7xl': 28,
  '8xl': 30,
} as const;
