// src/components/music/PlaylistCard.tsx
// ─────────────────────────────────────────────────────────
//  라이브러리 화면의 플레이리스트 카드
// ─────────────────────────────────────────────────────────
import React from 'react';
import {
  TouchableOpacity, View, Text, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Playlist } from '../../types';
import { Colors } from '../../constants/colors';
import { FontSize, Radius } from '../../constants/layout';

interface Props {
  playlist: Playlist;
  onPress: (id: string) => void;
  onLike?: (id: string) => void;
}

export default function PlaylistCard({ playlist, onPress, onLike }: Props) {
  return (
    <TouchableOpacity
      onPress={() => onPress(playlist.id)}
      activeOpacity={0.85}
      style={styles.card}
    >
      {/* 커버 */}
      <LinearGradient
        colors={[playlist.gradientStart, playlist.gradientEnd]}
        style={styles.cover}
      >
        <Text style={styles.coverEmoji}>{playlist.coverEmoji}</Text>
      </LinearGradient>

      {/* 정보 */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{playlist.name}</Text>
        <Text style={styles.meta}>{playlist.trackCount}곡 · {playlist.duration}</Text>
      </View>

      {/* 좋아요 */}
      <TouchableOpacity
        onPress={() => onLike?.(playlist.id)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={[styles.likeIcon, playlist.liked && styles.likeIconActive]}>
          {playlist.liked ? '♥' : '♡'}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    borderRadius: Radius.md,
    marginBottom: 8,
  },
  cover: {
    width: 54,
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  coverEmoji: {
    fontSize: 24,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.t1,
    letterSpacing: -0.2,
  },
  meta: {
    fontSize: FontSize.sm,
    color: Colors.t2,
  },
  likeIcon: {
    fontSize: 18,
    color: Colors.t3,
  },
  likeIconActive: {
    color: Colors.green,
  },
});
