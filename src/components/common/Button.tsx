// src/components/common/Button.tsx
// ─────────────────────────────────────────────────────────
//  Primary (.btn) & Glass (.btn-g) 버튼
//  HTML 원본: border-radius:50px, gradient background
// ─────────────────────────────────────────────────────────
import React from 'react';
import {
  TouchableOpacity, Text, StyleSheet,
  ViewStyle, TextStyle, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/colors';
import { FontSize } from '../../constants/layout';

// ── Primary Button (그린 그라디언트) ─────────────────────
interface PrimaryProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  fontSize?: number;
}

export function PrimaryButton({
  label, onPress, loading, disabled, style, fontSize = 15,
}: PrimaryProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[styles.primaryWrap, style]}
    >
      <LinearGradient
        colors={['#3ddc84', '#1db864']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.primaryGradient}
      >
        {loading ? (
          <ActivityIndicator color="#000" size="small" />
        ) : (
          <Text style={[styles.primaryText, { fontSize }]}>{label}</Text>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ── Glass Button (반투명) ─────────────────────────────────
interface GlassProps {
  label: string;
  onPress: () => void;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fontSize?: number;
}

export function GlassButton({ label, onPress, style, textStyle, fontSize = 13 }: GlassProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.glassBtn, style]}
    >
      <Text style={[styles.glassText, { fontSize }, textStyle]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Icon Button (원형) ────────────────────────────────────
interface IconProps {
  icon: string;
  onPress: () => void;
  size?: number;
  style?: ViewStyle;
}

export function IconButton({ icon, onPress, size = 38, style }: IconProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.iconBtn, { width: size, height: size, borderRadius: size / 2 }, style]}
    >
      <Text style={styles.iconText}>{icon}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Primary
  primaryWrap: {
    borderRadius: 50,
    overflow: 'hidden',
    shadowColor: '#3ddc84',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  primaryGradient: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  primaryText: {
    color: '#000',
    fontWeight: '800',
    letterSpacing: -0.2,
  },

  // Glass
  glassBtn: {
    height: 44,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  glassText: {
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },

  // Icon
  iconBtn: {
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
  },
});
