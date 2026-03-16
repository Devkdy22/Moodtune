// src/components/music/PlaylistCard.tsx
// ─────────────────────────────────────────────────────────
//  라이브러리 화면의 플레이리스트 카드
// ─────────────────────────────────────────────────────────
import React from 'react';
import {
  TouchableOpacity, View, Text, StyleSheet, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Music2, Trash2 } from "lucide-react-native";
import { Playlist } from '../../types';
import { Colors } from '../../constants/colors';
import { FontSize, Radius } from '../../constants/layout';
import { getPlaylistArtworkUrl, pickDominantMood } from "../../utils/playlistArtwork";

interface Props {
  playlist: Playlist;
  onPress: (id: string) => void;
  onLike?: (id: string) => void;
  onDelete?: (id: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export default function PlaylistCard({
  playlist,
  onPress,
  onLike,
  onDelete,
  selectable = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const artworkUrl = playlist.coverImageUrl || getPlaylistArtworkUrl(playlist.tracks ?? []);
  const mood = pickDominantMood(
    playlist.tracks ?? [],
    `${playlist.name} ${playlist.moodInput ?? ""}`,
  );

  return (
    <TouchableOpacity
      onPress={() =>
        selectable ? onToggleSelect?.(playlist.id) : onPress(playlist.id)
      }
      activeOpacity={0.85}
      style={[styles.card, selectable && selected && styles.cardSelected]}
    >
      {selectable ? (
        <View style={[styles.selectBadge, selected && styles.selectBadgeActive]}>
          <Text style={styles.selectBadgeText}>{selected ? "✓" : ""}</Text>
        </View>
      ) : null}
      {/* 커버 */}
      {artworkUrl ? (
        <Image source={{ uri: artworkUrl }} style={styles.cover} />
      ) : (
        <LinearGradient
          colors={mood.colors}
          style={styles.cover}
        >
          <Music2 size={21} color="#f2fff8" strokeWidth={2.1} />
        </LinearGradient>
      )}

      {/* 정보 */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{playlist.name}</Text>
        <Text style={styles.meta}>{playlist.trackCount}곡 · {playlist.duration}</Text>
        {playlist.tracks?.length ? (
          <View style={styles.previewWrap}>
            {playlist.tracks.slice(0, 2).map((t, i) => (
              <Text key={`${t.id}-${i}`} style={styles.previewText} numberOfLines={1}>
                {`${i + 1}. ${t.name} · ${t.duration}`}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      {/* 좋아요 */}
      <View style={styles.actions}>
        <TouchableOpacity
          disabled={selectable}
          onPress={() => onLike?.(playlist.id)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={selectable ? { opacity: 0.35 } : undefined}
        >
          <Text style={[styles.likeIcon, playlist.liked && styles.likeIconActive]}>
            {playlist.liked ? '♥' : '♡'}
          </Text>
        </TouchableOpacity>
        {onDelete ? (
          <TouchableOpacity
            disabled={selectable}
            onPress={() => onDelete(playlist.id)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={[styles.deleteBtn, selectable ? { opacity: 0.35 } : undefined]}
          >
            <Trash2 size={16} color="rgba(255,132,132,0.92)" strokeWidth={2.1} />
          </TouchableOpacity>
        ) : null}
      </View>
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
    position: "relative",
  },
  cardSelected: {
    borderColor: Colors.green,
    backgroundColor: "rgba(61,220,132,0.14)",
  },
  selectBadge: {
    position: "absolute",
    left: 8,
    top: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    backgroundColor: "rgba(0,0,0,0.2)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
  },
  selectBadgeActive: {
    borderColor: Colors.green,
    backgroundColor: "rgba(61,220,132,0.24)",
  },
  selectBadgeText: {
    color: Colors.greenL,
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 12,
  },
  cover: {
    width: 54,
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: Colors.glassBd,
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
  previewWrap: {
    marginTop: 1,
    gap: 2,
  },
  previewText: {
    fontSize: FontSize.xs,
    color: Colors.t3,
  },
  likeIcon: {
    fontSize: 18,
    color: Colors.t3,
  },
  likeIconActive: {
    color: Colors.green,
  },
  actions: {
    alignItems: "center",
    gap: 10,
  },
  deleteBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,80,80,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,80,80,0.22)",
  },
});
