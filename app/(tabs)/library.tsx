// app/(tabs)/library.tsx
// ─────────────────────────────────────────────────────────
//  라이브러리 화면 — 저장된 플레이리스트 목록
// ─────────────────────────────────────────────────────────
import { router } from "expo-router";
import { Music4 } from "lucide-react-native";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import {
  getMoodtuneCreatedPlaylists,
  removeSpotifyPlaylist,
  refreshSpotifyAccessToken,
} from "../../src/api/spotify.service";
import { useAppStore } from "../../src/store/useAppStore";
import { Playlist } from "../../src/types";

const FILTER_TABS = ["전체", "최근", "좋아요"];

function estimateDurationLabel(trackCount: number): string {
  const min = Math.max(12, trackCount * 4);
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}시간 ${m}분` : `${h}시간`;
  }
  return `${min}분`;
}

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const playlists = useAppStore(s => s.playlists);
  const spotifyTokens = useAppStore(s => s.spotifyTokens);
  const setTokens = useAppStore(s => s.setTokens);
  const spotifyUser = useAppStore(s => s.spotifyUser);
  const setCurrentPlaylist = useAppStore(s => s.setCurrentPlaylist);
  const toggleLike = useAppStore(s => s.toggleLike);
  const removePlaylist = useAppStore(s => s.removePlaylist);
  const [remotePlaylists, setRemotePlaylists] = useState<Playlist[]>([]);
  const [activeFilter, setActiveFilter] = useState("전체");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const userName = spotifyUser?.display_name || "사용자";

  useFocusEffect(
    useCallback(() => {
      setReloadTick(v => v + 1);
    }, []),
  );

  useEffect(() => {
    let cancelled = false;
    async function loadRemote() {
      if (!spotifyTokens?.accessToken) {
        if (!cancelled) setRemotePlaylists([]);
        return;
      }

      const mapToPlaylist = (p: any, i: number): Playlist => ({
        id: `remote_${p.id}`,
        spotifyId: p.id,
        ownerId: p.owner_id || undefined,
        spotifyUrl: p.external_url || undefined,
        name: p.name || `Moodtune Playlist ${i + 1}`,
        coverEmoji: "🎵",
        coverImageUrl: p.images?.[0]?.url || undefined,
        gradientStart: "#1a2535",
        gradientEnd: "#0e1822",
        trackCount: Number(p.tracks?.total ?? 0),
        duration: estimateDurationLabel(Number(p.tracks?.total ?? 0)),
        liked: false,
        tracks: [],
        createdAt: new Date(),
        moodInput: "",
      });

      const loadWithAccessToken = async (accessToken: string) => {
        const list = await getMoodtuneCreatedPlaylists(accessToken);
        const ownedList = spotifyUser?.id
          ? list.filter(p => p.owner_id === spotifyUser.id)
          : list;
        if (cancelled) return;
        setRemotePlaylists(ownedList.map(mapToPlaylist));
      };

      try {
        await loadWithAccessToken(spotifyTokens.accessToken);
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        if (msg.includes("(401)") && spotifyTokens?.refreshToken) {
          try {
            const refreshed = await refreshSpotifyAccessToken({
              refreshToken: spotifyTokens.refreshToken,
            });
            if (cancelled) return;
            setTokens(refreshed);
            await loadWithAccessToken(refreshed.accessToken);
            return;
          } catch (refreshErr) {
            console.warn("[library] remote load retry after refresh failed:", refreshErr);
          }
        }
        console.warn("[library] remote moodtune playlists load failed:", err);
      }
    }
    loadRemote();
    return () => {
      cancelled = true;
    };
  }, [
    reloadTick,
    setTokens,
    spotifyTokens?.accessToken,
    spotifyTokens?.refreshToken,
    spotifyUser?.id,
  ]);

  const mergedPlaylists = useMemo(() => remotePlaylists, [remotePlaylists]);

  const filtered = mergedPlaylists.filter(p => {
    if (activeFilter === "좋아요") return p.liked;
    return true;
  });
  const deduped = Array.from(
    new Map(filtered.map(p => [p.id, p])).values(),
  );
  const allSelected = deduped.length > 0 && selectedIds.length === deduped.length;

  function openPlaylist(id: string) {
    const item = deduped.find(p => p.id === id);
    if (!item) {
      router.push(`/playlist/${encodeURIComponent(id)}` as any);
      return;
    }
    setCurrentPlaylist(item);
    router.push({
      pathname: "/playlist/[id]",
      params: {
        id: item.id,
        spotifyId: item.spotifyId ?? "",
        ownerId: item.ownerId ?? "",
        name: item.name ?? "",
        duration: item.duration ?? "",
        trackCount: String(item.trackCount ?? 0),
        coverImageUrl: item.coverImageUrl ?? "",
      },
    } as any);
  }

  function deletePlaylist(id: string) {
    const item = deduped.find(p => p.id === id);
    if (!item) return;
    Alert.alert("플레이리스트 삭제", "이 플레이리스트를 라이브러리에서 삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            if (item.spotifyId && spotifyTokens?.accessToken) {
              await removeSpotifyPlaylist(spotifyTokens.accessToken, item.spotifyId);
            }
          } catch (err) {
            console.warn("[library] spotify playlist remove failed:", err);
          } finally {
            removePlaylist(id);
            const localMatch = playlists.find(p => p.spotifyId === item.spotifyId);
            if (localMatch) removePlaylist(localMatch.id);
            setRemotePlaylists(prev => prev.filter(p => p.id !== id));
          }
        },
      },
    ]);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id],
    );
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(deduped.map(p => p.id));
  }

  function toggleSelectionMode() {
    setSelectionMode(v => !v);
    setSelectedIds([]);
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    const targets = deduped.filter(p => selectedIds.includes(p.id));
    Alert.alert(
      "선택 삭제",
      `${targets.length}개의 플레이리스트를 삭제할까요?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: async () => {
            for (const item of targets) {
              try {
                if (item.spotifyId && spotifyTokens?.accessToken) {
                  await removeSpotifyPlaylist(spotifyTokens.accessToken, item.spotifyId);
                }
              } catch (err) {
                console.warn("[library] bulk spotify remove failed:", err);
              } finally {
                removePlaylist(item.id);
                const localMatch = playlists.find(p => p.spotifyId === item.spotifyId);
                if (localMatch) removePlaylist(localMatch.id);
                setRemotePlaylists(prev => prev.filter(p => p.id !== item.id));
              }
            }
            setSelectedIds([]);
            setSelectionMode(false);
          },
        },
      ],
    );
  }

  function goCreatePlaylist() {
    router.replace("/(tabs)?skipSync=1" as any);
  }

  return (
    <ScreenBackground intensity="normal">
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1 }}>
        {/* 헤더 */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View>
            <Text style={styles.headerTitle}>내 라이브러리</Text>
            <Text style={styles.headerSub}>
              {userName}님을 위한 플레이리스트 {mergedPlaylists.length}개
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
        <View style={styles.bulkRow}>
          <TouchableOpacity
            style={styles.bulkBtn}
            onPress={toggleSelectionMode}
            activeOpacity={0.8}
          >
            <Text style={styles.bulkBtnText}>
              {selectionMode ? "선택 모드 종료" : "플리 선택"}
            </Text>
          </TouchableOpacity>
          {selectionMode ? (
            <>
              <TouchableOpacity
                style={styles.bulkBtn}
                onPress={toggleSelectAll}
                activeOpacity={0.8}
              >
                <Text style={styles.bulkBtnText}>
                  {allSelected ? "전체 해제" : "전체 선택"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, styles.bulkDeleteBtn]}
                onPress={deleteSelected}
                activeOpacity={0.8}
                disabled={!selectedIds.length}
              >
                <Text
                  style={[
                    styles.bulkDeleteText,
                    !selectedIds.length && { opacity: 0.5 },
                  ]}
                >
                  선택 삭제
                </Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        {/* 플레이리스트 목록 */}
        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Music4 size={42} color={Colors.greenL} strokeWidth={2.1} />
            </View>
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
            data={deduped}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            renderItem={({ item }) => (
              <PlaylistCard
                playlist={item}
                onPress={selectionMode ? (() => {}) : openPlaylist}
                onLike={toggleLike}
                onDelete={deletePlaylist}
                selectable={selectionMode}
                selected={selectedIds.includes(item.id)}
                onToggleSelect={toggleSelect}
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
  bulkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 10,
  },
  bulkBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  bulkBtnText: {
    color: Colors.t1,
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  bulkDeleteBtn: {
    borderColor: "rgba(255,80,80,0.32)",
    backgroundColor: "rgba(255,80,80,0.12)",
  },
  bulkDeleteText: {
    color: "rgba(255,145,145,0.96)",
    fontSize: FontSize.sm,
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
  emptyIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(61,220,132,0.12)",
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.28)",
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
