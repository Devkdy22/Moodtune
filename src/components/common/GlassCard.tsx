// src/components/common/GlassCard.tsx
// ─────────────────────────────────────────────────────────
//  글래스모피즘 카드 (HTML .gc 클래스 재현)
//  backdrop-filter는 RN 기본 미지원 → 반투명 배경 + 테두리로 대체
// ─────────────────────────────────────────────────────────
import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Colors } from '../../constants/colors';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  padding?: number;
}

export default function GlassCard({ children, style, padding = 16 }: Props) {
  return (
    <View style={[styles.card, { padding }, style]}>
      {children}
    </View>
  );
}

export const glassStyle: ViewStyle = {
  backgroundColor: Colors.glass,
  borderWidth: 1,
  borderColor: Colors.glassBd,
  borderRadius: 18,
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    borderRadius: 18,
  },
});
