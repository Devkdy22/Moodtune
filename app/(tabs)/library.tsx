// app/(tabs)/library.tsx
// ─────────────────────────────────────────────────────────
//  라이브러리 화면 — 저장된 플레이리스트 목록
// ─────────────────────────────────────────────────────────
import { router } from "expo-router";
import React, { useState } from "react";
import {
  FlatList,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrimaryButton } from "../../src/components/common/Button";
import ScreenBackground from "../../src/components/common/ScreenBackground";
import PlaylistCard from "../../src/components/music/PlaylistCard";
import { Colors } from "../../src/constants/colors";
import { FontSize } from "../../src/constants/layout";
import { useAppStore } from "../../src/store/useAppStore";

const FILTER_TABS = ["전체", "최근", "좋아요"];

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const playlists = useAppStore(s => s.playlists);
  const spotifyUser = useAppStore(s => s.spotifyUser);
  const toggleLike = useAppStore(s => s.toggleLike);
  const [activeFilter, setActiveFilter] = useState("전체");
  const userName = spotifyUser?.display_name || "사용자";

  const filtered = playlists.filter(p => {
    if (activeFilter === "좋아요") return p.liked;
    return true;
  });

  function openPlaylist(id: string) {
    router.push(`/result/${encodeURIComponent(id)}` as any);
  }

  function goCreatePlaylist() {
    router.replace("/(tabs)?skipSync=1" as any);
  }

  return (
    <ScreenBackground>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1 }}>
        {/* 헤더 */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View>
            <Text style={styles.headerTitle}>내 라이브러리</Text>
            <Text style={styles.headerSub}>
              {userName}님을 위한 플레이리스트 {playlists.length}개
            </Text>
          </View>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={goCreatePlaylist}
          >
            <Text style={styles.createBtnText}>+ 생성하러 가기</Text>
          </TouchableOpacity>
        </View>

        {/* 필터 탭 */}
        <View style={styles.filterRow}>
          {FILTER_TABS.map(tab => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.filterTab,
                activeFilter === tab && styles.filterTabActive,
              ]}
              onPress={() => setActiveFilter(tab)}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.filterTabText,
                  activeFilter === tab && styles.filterTabTextActive,
                ]}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 플레이리스트 목록 */}
        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🎵</Text>
            <Text style={styles.emptyTitle}>저장된 라이브러리 목록이 없어요</Text>
            <Text style={styles.emptySub}>
              {userName}님을 위한 플레이리스트를 생성해보세요
            </Text>
            <PrimaryButton
              label="당신을 위한 플레이리스트 생성하기"
              onPress={goCreatePlaylist}
              style={{ marginTop: 20 }}
            />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <PlaylistCard
                playlist={item}
                onPress={openPlaylist}
                onLike={toggleLike}
              />
            )}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: insets.bottom + 90 },
            ]}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingBottom: 16,
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: FontSize["4xl"],
    fontWeight: "800",
    color: Colors.t1,
    letterSpacing: -0.4,
  },
  headerSub: {
    fontSize: FontSize.md,
    color: Colors.t2,
    marginTop: 3,
  },
  createBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(61,220,132,0.12)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.3)",
  },
  createBtnText: {
    fontSize: FontSize.base,
    color: Colors.green,
    fontWeight: "600",
  },

  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 12,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBd,
  },
  filterTabActive: {
    backgroundColor: "rgba(61,220,132,0.15)",
    borderColor: Colors.green,
  },
  filterTabText: {
    fontSize: FontSize.base,
    color: Colors.t2,
    fontWeight: "500",
  },
  filterTabTextActive: {
    color: Colors.green,
    fontWeight: "700",
  },

  listContent: {
    paddingHorizontal: 18,
    paddingTop: 4,
  },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: FontSize["3xl"],
    fontWeight: "700",
    color: Colors.t1,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  emptySub: {
    fontSize: FontSize.md,
    color: Colors.t2,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
  },
});
