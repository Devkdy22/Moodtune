// src/components/music/TrackDetailModal.tsx
// ─────────────────────────────────────────────────────────
//  트랙 상세 팝업 (HTML .tpop / .pop-ov 재현)
//  하단에서 슬라이드업, 오버레이 탭 시 닫힘
// ─────────────────────────────────────────────────────────
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Colors } from "../../constants/colors";
import { FontSize, Radius } from "../../constants/layout";
import { Track } from "../../types";
import Waveform from "../ai/waveform";

const { height: H } = Dimensions.get("window");
const SHEET_H = H * 0.72;

interface Props {
  track: Track | null;
  visible: boolean;
  onClose: () => void;
  onLike?: (id: string) => void;
}

export default function TrackDetailModal({
  track,
  visible,
  onClose,
  onLike,
}: Props) {
  const slideAnim = useRef(new Animated.Value(SHEET_H)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SHEET_H,
        duration: 280,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  if (!track) return null;

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={onClose}
    >
      {/* 오버레이 */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      {/* 슬라이드업 시트 */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
      >
        {/* 핸들 */}
        <View style={styles.handle} />

        {/* 닫기 버튼 */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          {/* 앨범 아트 + 기본 정보 */}
          <View style={styles.topRow}>
            <LinearGradient
              colors={[track.gradientStart, track.gradientEnd]}
              style={styles.bigArtwork}
            >
              <Text style={styles.bigArtworkEmoji}>{track.emoji}</Text>
            </LinearGradient>

            <View style={styles.trackMeta}>
              <Text style={styles.trackName}>{track.name}</Text>
              <Text style={styles.trackArtist}>{track.artist}</Text>
              <Text style={styles.trackAlbum}>
                {track.album} · {track.year}
              </Text>

              {/* 장르 태그 */}
              <View style={styles.genreTags}>
                {track.genre.map(g => (
                  <View key={g} style={styles.genreTag}>
                    <Text style={styles.genreTagText}>{g}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* 스탯 그리드 */}
          <View style={styles.statsGrid}>
            {[
              { label: "길이", value: track.duration },
              { label: "BPM", value: String(track.bpm) },
              { label: "연도", value: String(track.year) },
            ].map(({ label, value }) => (
              <View key={label} style={styles.statCell}>
                <Text style={styles.statValue}>{value}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </View>
            ))}
          </View>

          {/* 웨이브폼 */}
          <View style={styles.waveformSection}>
            <Waveform
              barCount={20}
              height={56}
              color={Colors.green}
              active={visible}
            />
          </View>

          {/* 액션 버튼 */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.spotifyBtn} activeOpacity={0.85}>
              <LinearGradient
                colors={["#3ddc84", "#1db864"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.spotifyBtnGrad}
              >
                <Text style={styles.spotifyBtnText}>▶ Spotify에서 듣기</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.likeBtn}
              onPress={() => onLike?.(track.id)}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.likeBtnText,
                  track.liked && { color: Colors.green },
                ]}
              >
                {track.liked ? "♥  저장됨" : "♡  저장하기"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_H,
    backgroundColor: "#0d1e14",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: Colors.glassBd,
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.glassBd,
    alignSelf: "center",
    marginBottom: 16,
  },
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 18,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    color: Colors.t2,
    fontSize: 14,
  },

  topRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 20,
    marginTop: 8,
  },
  bigArtwork: {
    width: 100,
    height: 100,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bigArtworkEmoji: {
    fontSize: 38,
  },
  trackMeta: {
    flex: 1,
    justifyContent: "center",
    gap: 4,
  },
  trackName: {
    fontSize: FontSize["3xl"],
    fontWeight: "700",
    color: Colors.t1,
    letterSpacing: -0.4,
  },
  trackArtist: {
    fontSize: FontSize.md,
    color: Colors.t2,
  },
  trackAlbum: {
    fontSize: FontSize.sm,
    color: Colors.t3,
  },
  genreTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 6,
  },
  genreTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(61,220,132,0.12)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.25)",
  },
  genreTagText: {
    fontSize: FontSize.xs,
    color: Colors.green,
    fontWeight: "500",
  },

  statsGrid: {
    flexDirection: "row",
    backgroundColor: Colors.glass,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    marginBottom: 20,
    overflow: "hidden",
  },
  statCell: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: Colors.glassBd,
  },
  statValue: {
    fontSize: FontSize["2xl"],
    fontWeight: "700",
    color: Colors.t1,
    letterSpacing: -0.3,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.t3,
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  waveformSection: {
    backgroundColor: Colors.glass,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 20,
  },

  actions: {
    gap: 10,
  },
  spotifyBtn: {
    borderRadius: 50,
    overflow: "hidden",
  },
  spotifyBtnGrad: {
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  spotifyBtnText: {
    color: "#000",
    fontWeight: "800",
    fontSize: FontSize.xl,
  },
  likeBtn: {
    height: 46,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBd,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  likeBtnText: {
    fontSize: FontSize.lg,
    color: Colors.t2,
    fontWeight: "500",
  },
});
