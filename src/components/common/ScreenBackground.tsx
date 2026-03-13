// src/components/common/ScreenBackground.tsx
// ─────────────────────────────────────────────────────────
//  앱 전체 공통 배경 (딥 그린 그라디언트 + 글로우 오브)
//  HTML: body background + .orb 요소들 재현
// ─────────────────────────────────────────────────────────
import React from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/colors';

const { width: W, height: H } = Dimensions.get('window');

interface Props {
  children: React.ReactNode;
}

export default function ScreenBackground({ children }: Props) {
  return (
    <View style={styles.root}>
      {/* 기본 딥 배경 */}
      <LinearGradient
        colors={['#060d0a', '#0b1a13', '#061009']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Orb 1 — 좌상단 */}
      <View style={[styles.orb, styles.orb1]} />
      {/* Orb 2 — 우하단 */}
      <View style={[styles.orb, styles.orb2]} />
      {/* Orb 3 — 중앙 */}
      <View style={[styles.orb, styles.orb3]} />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
  },
  orb: {
    position: 'absolute',
    borderRadius: 9999,
  },
  orb1: {
    width:  W * 0.85,
    height: W * 0.85,
    top:    -W * 0.3,
    left:   -W * 0.2,
    backgroundColor: 'rgba(20,80,45,0.45)',
    // RN에서 blur는 기본 지원 안 됨 → 투명도로 대체
    // 실제 blur 필요 시 @react-native-community/blur 사용
  },
  orb2: {
    width:  W * 0.75,
    height: W * 0.75,
    bottom: -W * 0.25,
    right:  -W * 0.25,
    backgroundColor: 'rgba(10,55,28,0.35)',
  },
  orb3: {
    width:  W * 0.55,
    height: W * 0.55,
    top:    H * 0.38,
    left:   W * 0.22,
    backgroundColor: 'rgba(15,40,22,0.25)',
  },
});
