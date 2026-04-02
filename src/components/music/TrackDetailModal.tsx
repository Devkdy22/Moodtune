// src/components/music/TrackDetailModal.tsx
// ─────────────────────────────────────────────────────────
//  트랙 상세 팝업 (HTML .tpop / .pop-ov 재현)
//  하단에서 슬라이드업, 오버레이 탭 시 닫힘
// ─────────────────────────────────────────────────────────
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Dimensions,
  Image,
  Linking,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../../constants/colors";
import { FontSize, Radius } from "../../constants/layout";
import { Track } from "../../types";
import Waveform from "../ai/waveform";

const { height: H } = Dimensions.get("window");
const MIN_SHEET_H = 420;
const MAX_SHEET_H = H * 0.82;

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
  const insets = useSafeAreaInsets();
  const [sheetHeight, setSheetHeight] = React.useState(MIN_SHEET_H);
  const slideAnim = useRef(new Animated.Value(MIN_SHEET_H)).current;
  const [rendered, setRendered] = React.useState(visible);
  const renderedRef = useRef(visible);
  const closeThreshold = useMemo(() => Math.max(90, sheetHeight * 0.18), [sheetHeight]);

  const displayYear = track?.year && track.year > 0 ? String(track.year) : "";
  const releaseStatusText = track
    ? track.year > 0
      ? new Date().getFullYear() - track.year <= 1
        ? "최신 발매 앨범"
        : "기존 발매 앨범"
      : "발매 정보 확인 중"
    : "";
  const displayGenre = track?.genre?.length ? track.genre[0] : "장르 분석 중";

  async function openInSpotify() {
    const uri = track?.spotifyUri?.trim();
    if (!uri) return;
    const trackId = uri.startsWith("spotify:track:")
      ? uri.replace("spotify:track:", "")
      : "";
    const appUrl = trackId ? `spotify:track:${trackId}` : uri;
    const webUrl = trackId
      ? `https://open.spotify.com/track/${trackId}`
      : "https://open.spotify.com";

    try {
      const supported = await Linking.canOpenURL(appUrl);
      await Linking.openURL(supported ? appUrl : webUrl);
    } catch {
      await Linking.openURL(webUrl);
    }
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dy) > 2 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) slideAnim.setValue(gesture.dy);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > closeThreshold || gesture.vy > 0.72) {
          onClose();
          return;
        }
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 80,
          friction: 11,
          velocity: Math.max(0, gesture.vy),
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 80,
          friction: 11,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  useEffect(() => {
    if (visible) {
      if (!renderedRef.current) {
        renderedRef.current = true;
        setRendered(true);
      }
      slideAnim.setValue(sheetHeight);
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 75,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else if (renderedRef.current) {
      Animated.timing(slideAnim, {
        toValue: sheetHeight,
        duration: 240,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        renderedRef.current = false;
        setRendered(false);
      });
    }
  }, [sheetHeight, slideAnim, visible]);

  if (!track || !rendered) return null;

  return (
    <Modal
      transparent
      animationType="none"
      visible={rendered}
      onRequestClose={onClose}
    >
      {/* 오버레이 */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      {/* 슬라이드업 시트 */}
      <Animated.View
        style={[
          styles.sheet,
          { height: sheetHeight, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* 핸들 */}
        <View style={styles.dragArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        {/* 닫기 버튼 */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          onContentSizeChange={(_, contentHeight) => {
            const actionArea = 130 + Math.max(10, insets.bottom + 4);
            const next = Math.max(
              MIN_SHEET_H,
              Math.min(MAX_SHEET_H, contentHeight + actionArea + 36),
            );
            if (Math.abs(next - sheetHeight) > 8) {
              setSheetHeight(next);
            }
          }}
          contentContainerStyle={styles.scrollContent}
        >
          {/* 앨범 아트 + 기본 정보 */}
          <View style={styles.topRow}>
            {track.albumImageUrl ? (
              <Image source={{ uri: track.albumImageUrl }} style={styles.bigArtworkImage} />
            ) : (
              <LinearGradient
                colors={[track.gradientStart, track.gradientEnd]}
                style={styles.bigArtwork}
              >
                <Text style={styles.bigArtworkEmoji}>{track.emoji}</Text>
              </LinearGradient>
            )}

            <View style={styles.trackMeta}>
              <Text style={styles.trackName}>{track.name}</Text>
              <Text style={styles.trackArtist}>{track.artist}</Text>
              <Text style={styles.trackAlbum}>
                {track.album}
                {track.year > 0 ? ` · ${track.year}` : ""}
              </Text>

              {/* 발매 정보 */}
              <View style={styles.genreTags}>
                <View style={styles.genreTag}>
                  <Text style={styles.genreTagText}>{releaseStatusText}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 스탯 그리드 */}
          <View style={styles.statsGrid}>
            {[
              { label: "길이", value: track.duration },
              { label: "종류", value: displayGenre },
              { label: "발매", value: displayYear || "최신 정보 기준" },
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
              barCount={18}
              height={70}
              active={visible}
              intensity={visible ? 0.62 : 0}
            />
          </View>

        </ScrollView>

        {/* 액션 버튼: 하단 고정 */}
        <View
          style={[
            styles.actionsContainer,
            { paddingBottom: Math.max(10, insets.bottom + 4) },
          ]}
        >
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.spotifyBtn}
              activeOpacity={0.85}
              onPress={openInSpotify}
            >
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
        </View>
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
    height: MIN_SHEET_H,
    backgroundColor: "#0d1e14",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: Colors.glassBd,
    paddingHorizontal: 22,
    paddingTop: 12,
    overflow: "hidden",
  },
  scrollContent: {
    paddingBottom: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.glassBd,
    alignSelf: "center",
    marginBottom: 8,
  },
  dragArea: {
    paddingTop: 4,
    paddingBottom: 14,
    marginBottom: 2,
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
    marginBottom: 14,
    marginTop: 6,
  },
  bigArtwork: {
    width: 100,
    height: 100,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bigArtworkImage: {
    width: 100,
    height: 100,
    borderRadius: 18,
    flexShrink: 0,
    backgroundColor: "#101a16",
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
    marginBottom: 14,
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
    marginBottom: 8,
  },

  actions: {
    gap: 10,
  },
  actionsContainer: {
    borderTopWidth: 1,
    borderTopColor: Colors.glassBd,
    paddingTop: 10,
    backgroundColor: "rgba(9, 26, 16, 0.96)",
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
