import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Trash2 } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScreenBackground from "../../src/components/common/ScreenBackground";
import LogoIcon from "../../src/components/common/LogoIcon";
import { Colors } from "../../src/constants/colors";
import { FontSize } from "../../src/constants/layout";
import { useAppStore } from "../../src/store/useAppStore";
import { Playlist, Track } from "../../src/types";
import { getPlaylistArtworkUrl, pickDominantMood } from "../../src/utils/playlistArtwork";
import {
  getSpotifyPlaylistTracks,
  refreshSpotifyAccessToken,
} from "../../src/api/spotify.service";

function durationStrToMs(v: string): number {
  const [m, s] = String(v ?? "").split(":").map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(s)) return 0;
  return (m * 60 + s) * 1000;
}

function formatDurationLabel(totalMs: number): string {
  if (!totalMs || totalMs <= 0) return "0분";
  const totalMin = Math.round(totalMs / 60000);
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m ? `${h}시간 ${m}분` : `${h}시간`;
  }
  return `${totalMin}분`;
}

export default function PlaylistDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id: string;
    spotifyId?: string;
    ownerId?: string;
    name?: string;
    duration?: string;
    trackCount?: string;
    coverImageUrl?: string;
  }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const playlists = useAppStore(s => s.playlists);
  const currentPlaylist = useAppStore(s => s.currentPlaylist);
  const spotifyTokens = useAppStore(s => s.spotifyTokens);
  const setTokens = useAppStore(s => s.setTokens);
  const removePlaylist = useAppStore(s => s.removePlaylist);

  const playlist: Playlist | null = useMemo(() => {
    if (
      currentPlaylist &&
      (currentPlaylist.id === id ||
        (params.spotifyId && currentPlaylist.spotifyId === params.spotifyId))
    ) {
      return currentPlaylist;
    }
    return playlists.find(p => p.id === id) ?? null;
  }, [currentPlaylist, id, params.spotifyId, playlists]);

  const fallbackFromParams: Playlist | null = useMemo(
    () =>
      !playlist && (params.spotifyId || params.name)
        ? {
            id: id || `remote_${params.spotifyId || "unknown"}`,
            spotifyId: params.spotifyId || undefined,
            ownerId: params.ownerId || undefined,
            name: params.name || "Moodtune Playlist",
            coverEmoji: "🎵",
            coverImageUrl: params.coverImageUrl || undefined,
            gradientStart: "#1a2535",
            gradientEnd: "#0e1822",
            trackCount: Number(params.trackCount ?? 0),
            duration: params.duration || "40분",
            liked: false,
            tracks: [],
            createdAt: new Date(),
            moodInput: "",
          }
        : null,
    [
      id,
      params.coverImageUrl,
      params.duration,
      params.name,
      params.ownerId,
      params.spotifyId,
      params.trackCount,
      playlist,
    ],
  );

  if (!playlist && !fallbackFromParams) {
    return (
      <ScreenBackground intensity="normal">
        <StatusBar barStyle="light-content" />
        <View style={[styles.notFound, { paddingTop: insets.top + 20 }]}>
          <Text style={styles.notFoundTitle}>플레이리스트를 찾을 수 없어요</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>뒤로 가기</Text>
          </Pressable>
        </View>
      </ScreenBackground>
    );
  }
  const current = playlist ?? fallbackFromParams!;
  const [remoteTracks, setRemoteTracks] = useState<Track[] | null>(null);
  const [loadingRemoteTracks, setLoadingRemoteTracks] = useState(false);
  const [remoteTrackError, setRemoteTrackError] = useState<string | null>(null);
  const fetchedKeyRef = useRef<string | null>(null);
  const tracks =
    current.tracks?.length
      ? current.tracks
      : remoteTracks && remoteTracks.length
        ? remoteTracks
        : [];
  const coverUrl = getPlaylistArtworkUrl(tracks);
  const mood = pickDominantMood(tracks, `${current.name} ${current.moodInput ?? ""}`);
  const displayTrackCount = tracks.length || current.trackCount;
  const displayDuration = useMemo(() => {
    if (!tracks.length) return current.duration;
    const totalMs = tracks.reduce((sum, t) => sum + durationStrToMs(t.duration), 0);
    return totalMs > 0 ? formatDurationLabel(totalMs) : current.duration;
  }, [current.duration, tracks]);

  useEffect(() => {
    let cancelled = false;
    async function loadTracks() {
      if (!current.spotifyId || !spotifyTokens?.accessToken || current.tracks?.length) return;
      const fetchKey = `${current.spotifyId}:${spotifyTokens.accessToken}`;
      if (fetchedKeyRef.current === fetchKey) return;
      try {
        fetchedKeyRef.current = fetchKey;
        setRemoteTrackError(null);
        setLoadingRemoteTracks(true);
        let accessToken = spotifyTokens.accessToken;
        let list: Awaited<ReturnType<typeof getSpotifyPlaylistTracks>> = [];
        try {
          list = await getSpotifyPlaylistTracks({
            accessToken,
            playlistId: current.spotifyId,
            ownerId: current.ownerId ?? undefined,
            limit: 1000,
          });
        } catch (firstErr) {
          const msg = String((firstErr as Error)?.message ?? firstErr);
          const canRefresh =
            msg.includes("(401)") && Boolean(spotifyTokens?.refreshToken);
          if (!canRefresh) throw firstErr;
          const refreshed = await refreshSpotifyAccessToken({
            refreshToken: spotifyTokens!.refreshToken,
          });
          if (cancelled) return;
          setTokens(refreshed);
          accessToken = refreshed.accessToken;
          list = await getSpotifyPlaylistTracks({
            accessToken,
            playlistId: current.spotifyId,
            ownerId: current.ownerId ?? undefined,
            limit: 1000,
          });
        }
        if (cancelled) return;
        const mapped: Track[] = list.map((t, i) => {
          const sec = Math.max(0, Math.floor((t.duration_ms ?? 0) / 1000));
          const min = Math.floor(sec / 60);
          const rem = sec % 60;
          return {
            id: t.id,
            emoji: ["♪", "♫", "♬", "♩"][i % 4],
            name: t.name,
            artist: t.artists.map(a => a.name).join(", "),
            duration: `${min}:${String(rem).padStart(2, "0")}`,
            albumImageUrl: t.album?.images?.[0]?.url || undefined,
            gradientStart: "#1a2535",
            gradientEnd: "#0e1822",
            album: t.album?.name || "Spotify",
            year: Number(String(t.album?.release_date || "").slice(0, 4)) || 0,
            bpm: Number(t.tempo ?? 0) || 0,
            genre: t.genres ?? [],
            liked: Boolean(t.is_saved),
            spotifyUri: t.uri,
            previewUrl: t.preview_url || undefined,
          };
        });
        setRemoteTracks(mapped);
      } catch (err) {
        const message = String((err as Error)?.message ?? err);
        if (message.includes("(403)")) {
          // 403은 토큰/권한 상태가 바뀌면 풀릴 수 있어 영구 차단하지 않는다.
          fetchedKeyRef.current = null;
          setRemoteTrackError(
            "Spotify 읽기 권한 부족으로 트랙을 불러오지 못했어요. Spotify를 다시 로그인해 주세요.",
          );
        }
        if (message.includes("(401)")) {
          setRemoteTrackError("로그인 세션이 만료되어 트랙을 불러오지 못했어요. 다시 로그인해 주세요.");
        }
        fetchedKeyRef.current = null;
        console.warn("[playlist-detail] remote tracks load failed:", err);
      } finally {
        if (!cancelled) setLoadingRemoteTracks(false);
      }
    }
    loadTracks();
    return () => {
      cancelled = true;
    };
  }, [
    current.spotifyId,
    current.tracks?.length,
    setTokens,
    spotifyTokens?.accessToken,
    spotifyTokens?.refreshToken,
  ]);

  function onDelete() {
    Alert.alert("플레이리스트 삭제", "이 플레이리스트를 삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          removePlaylist(current.id);
          router.replace("/(tabs)/library" as any);
        },
      },
    ]);
  }

  return (
    <ScreenBackground intensity="normal">
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={() => router.back()}>
            <ArrowLeft size={18} color={Colors.t1} />
          </Pressable>
          <Text style={styles.headerTitle}>플레이리스트</Text>
          <Pressable style={styles.iconBtn} onPress={onDelete}>
            <Trash2 size={18} color="rgba(255,120,120,0.94)" />
          </Pressable>
        </View>

        <View style={styles.heroCard}>
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={styles.heroCover} />
          ) : (
            <LinearGradient colors={mood.colors} style={styles.heroCover}>
              <LogoIcon size={48} circular animated={false} />
            </LinearGradient>
          )}
          <View style={styles.heroInfo}>
            <Text style={styles.heroName}>{current.name}</Text>
            <Text style={styles.heroMeta}>
            {displayTrackCount}곡 · {displayDuration} · {mood.label}
          </Text>
        </View>
      </View>

        <View style={styles.listWrap}>
          {loadingRemoteTracks ? (
            <View style={styles.emptyTracks}>
              <Text style={styles.emptyTracksText}>실제 트랙 정보를 불러오는 중...</Text>
            </View>
          ) : tracks.length ? (
            tracks.map((track, idx) => (
              <TrackRow key={track.id} track={track} index={idx + 1} />
            ))
          ) : (
            <View style={styles.emptyTracks}>
              <Text style={styles.emptyTracksText}>
                {remoteTrackError ?? "표시할 트랙이 아직 없어요."}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}

function TrackRow({ track, index }: { track: Track; index: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowNum}>{index}</Text>
      {track.albumImageUrl ? (
        <Image source={{ uri: track.albumImageUrl }} style={styles.rowCover} />
      ) : (
        <LinearGradient colors={[track.gradientStart, track.gradientEnd]} style={styles.rowCover}>
          <LogoIcon size={20} circular animated={false} />
        </LinearGradient>
      )}
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {track.name}
        </Text>
        <Text style={styles.rowArtist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
      <Text style={styles.rowDur}>{track.duration}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
  },
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  notFoundTitle: {
    fontSize: FontSize["2xl"],
    color: Colors.t1,
    fontWeight: "700",
  },
  backBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBd,
  },
  backBtnText: {
    color: Colors.t1,
    fontSize: FontSize.base,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  headerTitle: {
    color: Colors.t1,
    fontSize: FontSize.xl,
    fontWeight: "800",
  },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    marginBottom: 12,
  },
  heroCover: {
    width: 72,
    height: 72,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  heroInfo: { flex: 1, gap: 3 },
  heroName: {
    color: Colors.t1,
    fontSize: FontSize.xl,
    fontWeight: "800",
  },
  heroMeta: {
    color: Colors.t2,
    fontSize: FontSize.sm,
  },
  listWrap: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  emptyTracks: {
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTracksText: {
    color: Colors.t2,
    fontSize: FontSize.base,
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  rowNum: {
    width: 18,
    textAlign: "right",
    color: Colors.t3,
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
  rowCover: {
    width: 40,
    height: 40,
    borderRadius: 10,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  rowInfo: { flex: 1 },
  rowTitle: {
    color: Colors.t1,
    fontSize: FontSize.base,
    fontWeight: "700",
  },
  rowArtist: {
    color: Colors.t2,
    fontSize: FontSize.sm,
  },
  rowDur: {
    color: Colors.t3,
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
});
