// app/result/[id].tsx
// ─────────────────────────────────────────────────────────
//  [s6] 저장 완료 화면 (Success)
//  - 펄싱 링 + 로고
//  - 플레이리스트 정보
//  - Spotify 바로 듣기 CTA
// ─────────────────────────────────────────────────────────
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GlassButton,
  IconButton,
  PrimaryButton,
} from "../../src/components/common/Button";
import GlassCard from "../../src/components/common/GlassCard";
import LogoIcon from "../../src/components/common/LogoIcon";
import PulseRings from "../../src/components/common/PulseRings";
import ScreenBackground from "../../src/components/common/ScreenBackground";
import { Colors } from "../../src/constants/colors";
import { FontSize } from "../../src/constants/layout";
import { MOCK_TRACKS } from "../../src/constants/mockData";
import { useAppStore } from "../../src/store/useAppStore";

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentPlaylist = useAppStore(s => s.currentPlaylist);
  const playlist = currentPlaylist ?? {
    id: id,
    name: "AI 추천 플레이리스트",
    coverEmoji: "🎷",
    gradientStart: "#1a2535",
    gradientEnd: "#0e1822",
    trackCount: 9,
    duration: "65분",
    liked: false,
    tracks: MOCK_TRACKS,
    createdAt: new Date(),
  };

  // 입장 애니메이션
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 60,
        friction: 10,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  function handleListen() {
    // TODO: Spotify 딥링크 열기
    // Linking.openURL(`spotify:playlist:${playlist.spotifyId}`);
  }

  function handleNew() {
    router.replace("/(tabs)");
  }

  return (
    <ScreenBackground>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* 뒤로 가기 */}
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
          <Text style={styles.backText}>← 목록으로</Text>
        </TouchableOpacity>

        {/* 성공 로고 섹션 */}
        <Animated.View
          style={[
            styles.heroSection,
            { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
          ]}
        >
          <PulseRings
            rings={[
              {
                size: 220,
                borderWidth: 1,
                opacity: 0.05,
                delay: 0,
                color: Colors.green,
              },
              {
                size: 185,
                borderWidth: 1,
                opacity: 0.09,
                delay: 300,
                color: Colors.green,
              },
              {
                size: 155,
                borderWidth: 1.5,
                opacity: 0.15,
                delay: 600,
                color: Colors.green,
              },
              {
                size: 128,
                borderWidth: 2,
                opacity: 0.22,
                delay: 900,
                color: Colors.green,
              },
            ]}
          />
          <LogoIcon size={120} circular animated />

          {/* 체크 뱃지 */}
          <View style={styles.checkBadge}>
            <Text style={styles.checkBadgeText}>✓</Text>
          </View>
        </Animated.View>

        {/* 완료 텍스트 */}
        <Animated.View
          style={{ opacity: opacityAnim, alignItems: "center", gap: 8 }}
        >
          <Text style={styles.successTitle}>저장 완료!</Text>
          <Text style={styles.successSub}>
            플레이리스트가 Spotify에 저장됐어요
          </Text>
          <Text style={styles.playlistName}>"{playlist.name}"</Text>
          <Text style={styles.playlistMeta}>
            {playlist.trackCount}곡 · {playlist.duration}
          </Text>
        </Animated.View>

        {/* 액션 아이콘 버튼 행 */}
        <View style={styles.iconActions}>
          <View style={styles.iconActionItem}>
            <IconButton icon="♡" onPress={() => {}} size={48} />
            <Text style={styles.iconActionLabel}>좋아요</Text>
          </View>
          <View style={styles.iconActionItem}>
            <IconButton icon="↗" onPress={() => {}} size={48} />
            <Text style={styles.iconActionLabel}>공유하기</Text>
          </View>
          <View style={styles.iconActionItem}>
            <IconButton icon="⋯" onPress={() => {}} size={48} />
            <Text style={styles.iconActionLabel}>더보기</Text>
          </View>
        </View>

        {/* 플레이리스트 미리보기 */}
        <GlassCard style={styles.trackPreview} padding={16}>
          <Text style={styles.previewLabel}>수록곡 미리보기</Text>
          {playlist.tracks.slice(0, 4).map((t, i) => (
            <View key={t.id} style={styles.previewTrack}>
              <LinearGradient
                colors={[t.gradientStart, t.gradientEnd]}
                style={styles.previewArtwork}
              >
                <Text style={{ fontSize: 14 }}>{t.emoji}</Text>
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTrackName} numberOfLines={1}>
                  {t.name}
                </Text>
                <Text style={styles.previewTrackArtist} numberOfLines={1}>
                  {t.artist}
                </Text>
              </View>
              <Text style={styles.previewDuration}>{t.duration}</Text>
            </View>
          ))}
          {playlist.tracks.length > 4 && (
            <Text style={styles.moreText}>
              +{playlist.tracks.length - 4}곡 더보기
            </Text>
          )}
        </GlassCard>

        {/* 메인 CTA 버튼 */}
        <PrimaryButton
          label="▶  Spotify에서 바로 듣기"
          onPress={handleListen}
          style={{ width: "100%" }}
        />
        <GlassButton
          label="+ 새 플레이리스트 만들기"
          onPress={handleNew}
          style={{ width: "100%", marginTop: 10 }}
        />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 24,
  },
  backRow: {
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: FontSize.md,
    color: Colors.t2,
  },

  heroSection: {
    width: 230,
    height: 230,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  checkBadge: {
    position: "absolute",
    top: 22,
    right: 22,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBadgeText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "800",
  },

  successTitle: {
    fontSize: FontSize["7xl"],
    fontWeight: "900",
    color: Colors.t1,
    letterSpacing: -0.8,
  },
  successSub: {
    fontSize: FontSize.md,
    color: Colors.t2,
    textAlign: "center",
    lineHeight: 22,
  },
  playlistName: {
    fontSize: FontSize["2xl"],
    fontWeight: "700",
    color: Colors.green,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  playlistMeta: {
    fontSize: FontSize.base,
    color: Colors.t3,
  },

  iconActions: {
    flexDirection: "row",
    gap: 32,
  },
  iconActionItem: {
    alignItems: "center",
    gap: 6,
  },
  iconActionLabel: {
    fontSize: FontSize.xs,
    color: Colors.t3,
  },

  trackPreview: {
    width: "100%",
    gap: 0,
  },
  previewLabel: {
    fontSize: FontSize.sm,
    color: Colors.t3,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  previewTrack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassBd,
  },
  previewArtwork: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  previewTrackName: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.t1,
  },
  previewTrackArtist: {
    fontSize: FontSize.sm,
    color: Colors.t2,
  },
  previewDuration: {
    fontSize: FontSize.xs,
    color: Colors.t3,
  },
  moreText: {
    fontSize: FontSize.sm,
    color: Colors.green,
    textAlign: "center",
    paddingTop: 10,
    fontWeight: "600",
  },
});
