// src/components/music/TrackItem.tsx
// ─────────────────────────────────────────────────────────
//  트랙 아이템 (HTML .tc 클래스 재현)
//  - 스와이프 삭제 (react-native-swipeable 또는 Gesture Handler)
//  - 탭 → 상세 팝업
// ─────────────────────────────────────────────────────────
import React, { useRef } from 'react';
import {
  Animated, Image, TouchableOpacity, View, Text,
  StyleSheet, PanResponder, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Track } from '../../types';
import { Colors } from '../../constants/colors';
import { FontSize, Radius } from '../../constants/layout';

const { width: W } = Dimensions.get('window');
const SWIPE_THRESHOLD = -W * 0.18;

interface Props {
  track: Track;
  index: number;
  onPress: (track: Track) => void;
  onDelete?: (id: string) => void;
  onLike?: (id: string) => void;
}

export default function TrackItem({ track, index, onPress, onDelete, onLike }: Props) {
  const translateX = useRef(new Animated.Value(0)).current;
  const deleteOpacity = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        dx < -4 && Math.abs(dx) > Math.abs(dy),
      onPanResponderMove: (_, { dx }) => {
        if (dx < 0) {
          translateX.setValue(Math.max(dx, -100));
          deleteOpacity.setValue(Math.min(Math.abs(dx) / 80, 1));
        }
      },
      onPanResponderRelease: (_, { dx, vx }) => {
        if (dx < SWIPE_THRESHOLD || vx < -0.35) {
          // 삭제 실행
          Animated.timing(translateX, {
            toValue: -W,
            duration: 250,
            useNativeDriver: true,
          }).start(() => onDelete?.(track.id));
        } else {
          // 원위치
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
          Animated.timing(deleteOpacity, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  return (
    <View style={styles.wrapper}>
      {/* 삭제 배경 */}
      <Animated.View style={[styles.deleteBg, { opacity: deleteOpacity }]}>
        <Text style={styles.deleteIcon}>🗑</Text>
      </Animated.View>

      {/* 트랙 카드 */}
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onPress(track)}
          style={styles.card}
        >
          {/* 앨범 아트 */}
          {track.albumImageUrl ? (
            <Image source={{ uri: track.albumImageUrl }} style={styles.artworkImage} />
          ) : (
            <LinearGradient
              colors={[track.gradientStart, track.gradientEnd]}
              style={styles.artwork}
            >
              <Text style={styles.artworkEmoji}>{track.emoji}</Text>
            </LinearGradient>
          )}

          {/* 트랙 정보 */}
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>{track.name}</Text>
            <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
          </View>

          {/* 우측: 재생 시간 + 좋아요 */}
          <View style={styles.right}>
            <Text style={styles.duration}>{track.duration}</Text>
            <TouchableOpacity onPress={() => onLike?.(track.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.likeIcon, track.liked && styles.likeIconActive]}>
                {track.liked ? '♥' : '♡'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    marginBottom: 7,
  },
  deleteBg: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: '#ff4f6a',
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteIcon: {
    fontSize: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 11,
    paddingHorizontal: 12,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    borderRadius: 16,
  },
  artwork: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  artworkImage: {
    width: 46,
    height: 46,
    borderRadius: 12,
    flexShrink: 0,
    backgroundColor: '#101a16',
  },
  artworkEmoji: {
    fontSize: 20,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.t1,
    letterSpacing: -0.2,
  },
  artist: {
    fontSize: FontSize.sm,
    color: Colors.t2,
  },
  right: {
    alignItems: 'flex-end',
    gap: 4,
    flexShrink: 0,
  },
  duration: {
    fontSize: FontSize.xs,
    color: Colors.t3,
  },
  likeIcon: {
    fontSize: 16,
    color: Colors.t3,
  },
  likeIconActive: {
    color: Colors.green,
  },
});
