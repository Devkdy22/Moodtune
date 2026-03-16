import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import {
  CloudRain,
  Flame,
  LucideIcon,
  MoonStar,
  Sparkles,
  Sunrise,
  Waves,
} from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import LogoIcon from "../../src/components/common/LogoIcon";
import ScreenBackground from "../../src/components/common/ScreenBackground";
import { MOCK_TRACKS } from "../../src/constants/mockData";
import { useAppStore } from "../../src/store/useAppStore";
import { Playlist, Track } from "../../src/types";

const { width: W } = Dimensions.get("window");

const C = {
  green: "#3ddc84",
  greenL: "#57f09a",
  greenD: "#18a959",
  text: "rgba(255,255,255,0.96)",
  text2: "rgba(255,255,255,0.62)",
  text3: "rgba(255,255,255,0.35)",
  cardBd: "rgba(255,255,255,0.14)",
};

const RINGS = [
  { size: 136, bw: 2.6, op: 0.92, period: 1800, delay: 0 },
  { size: 184, bw: 2.2, op: 0.72, period: 2200, delay: 220 },
  { size: 232, bw: 1.8, op: 0.48, period: 2600, delay: 460 },
  { size: 282, bw: 1.2, op: 0.28, period: 3000, delay: 680 },
];

const DEFAULT_SHOW = 4;
const TRACK_ROW_H = 66;

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentPlaylist = useAppStore(s => s.currentPlaylist);
  const [expanded, setExpanded] = useState(false);

  const playlist: Playlist = currentPlaylist ?? {
    id: id ?? "pl1",
    name: "AI 추천 플레이리스트",
    coverEmoji: "🎵",
    gradientStart: "#1a6622",
    gradientEnd: "#0d3a12",
    trackCount: 9,
    duration: "65분",
    liked: false,
    tracks: MOCK_TRACKS,
    createdAt: new Date(),
  };

  const tracks = playlist.tracks ?? MOCK_TRACKS;
  const hiddenCount = Math.max(0, tracks.length - DEFAULT_SHOW);

  const dominantMood = useMemo(
    () =>
      pickDominantMood(tracks, `${playlist.name} ${playlist.moodInput ?? ""}`),
    [playlist.moodInput, playlist.name, tracks],
  );

  const heroScale = useRef(new Animated.Value(0.85)).current;
  const heroOp = useRef(new Animated.Value(0)).current;
  const textOp = useRef(new Animated.Value(0)).current;
  const textY = useRef(new Animated.Value(18)).current;
  const cardOp = useRef(new Animated.Value(0)).current;
  const cardY = useRef(new Animated.Value(16)).current;
  const btnOp = useRef(new Animated.Value(0)).current;
  const btnY = useRef(new Animated.Value(14)).current;
  const ringScales = useRef(RINGS.map(() => new Animated.Value(1))).current;
  const ringOps = useRef(RINGS.map(r => new Animated.Value(r.op))).current;
  const expandH = useRef(new Animated.Value(0)).current;
  const expandOp = useRef(new Animated.Value(0)).current;
  const shimmerX = useRef(new Animated.Value(-W)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(60),
      Animated.parallel([
        Animated.spring(heroScale, {
          toValue: 1,
          tension: 58,
          friction: 9,
          useNativeDriver: true,
        }),
        Animated.timing(heroOp, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(260),
      Animated.parallel([
        Animated.timing(textOp, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(textY, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(430),
      Animated.parallel([
        Animated.timing(cardOp, {
          toValue: 1,
          duration: 440,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(cardY, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(560),
      Animated.parallel([
        Animated.timing(btnOp, {
          toValue: 1,
          duration: 430,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(btnY, {
          toValue: 0,
          duration: 390,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    RINGS.forEach((ring, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(ring.delay),
          Animated.parallel([
            Animated.timing(ringScales[i], {
              toValue: 1.05,
              duration: ring.period,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(ringOps[i], {
              toValue: ring.op * 1.45,
              duration: ring.period,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(ringScales[i], {
              toValue: 0.965,
              duration: ring.period,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(ringOps[i], {
              toValue: ring.op * 0.5,
              duration: ring.period,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        ]),
      ).start();
    });

    Animated.loop(
      Animated.sequence([
        Animated.delay(2200),
        Animated.timing(shimmerX, {
          toValue: W * 1.25,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerX, {
          toValue: -W,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [
    btnOp,
    btnY,
    cardOp,
    cardY,
    heroOp,
    heroScale,
    ringOps,
    ringScales,
    shimmerX,
    textOp,
    textY,
  ]);

  const toggleExpand = useCallback(() => {
    const toExpand = !expanded;
    setExpanded(toExpand);
    Animated.parallel([
      Animated.timing(expandH, {
        toValue: toExpand ? hiddenCount * TRACK_ROW_H : 0,
        duration: 330,
        easing: toExpand ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(expandOp, {
        toValue: toExpand ? 1 : 0,
        duration: toExpand ? 370 : 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [expandH, expandOp, expanded, hiddenCount]);

  const handleListen = useCallback(async () => {
    const playlistId = playlist.spotifyId?.trim();
    const appUrl = playlistId ? `spotify:playlist:${playlistId}` : "";
    const webUrl =
      playlist.spotifyUrl?.trim() ||
      (playlistId
        ? `https://open.spotify.com/playlist/${playlistId}`
        : "https://open.spotify.com");

    try {
      if (appUrl) {
        const can = await Linking.canOpenURL(appUrl);
        if (can) {
          await Linking.openURL(appUrl);
          return;
        }
      }
      await Linking.openURL(webUrl);
    } catch {
      await Linking.openURL("https://open.spotify.com");
    }
  }, [playlist.spotifyId, playlist.spotifyUrl]);

  const handleNew = useCallback(() => {
    router.replace("/(tabs)");
  }, []);

  return (
    <ScreenBackground intensity="strong">
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 34 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.hero,
            { opacity: heroOp, transform: [{ scale: heroScale }] },
          ]}
        >
          <View pointerEvents="none" style={styles.ringAuraOuter} />
          <View pointerEvents="none" style={styles.ringAuraInner} />
          {RINGS.map((ring, i) => (
            <Animated.View
              key={i}
              style={[
                styles.ring,
                {
                  width: ring.size,
                  height: ring.size,
                  borderRadius: ring.size / 2,
                  borderWidth: ring.bw,
                  opacity: ringOps[i],
                  transform: [{ scale: ringScales[i] }],
                },
              ]}
            />
          ))}

          <View style={styles.logoWrap}>
            <LogoIcon size={128} circular animated />
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.titleBlock,
            { opacity: textOp, transform: [{ translateY: textY }] },
          ]}
        >
          <Text style={styles.title}>{"나만의 Playlist가\n완성되었어요!"}</Text>
          <Text style={styles.subtitle}>
            {"Spotify에 플레이리스트가\n성공적으로 생성되었습니다"}
          </Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.mainCardWrap,
            { opacity: cardOp, transform: [{ translateY: cardY }] },
          ]}
        >
          <View style={styles.playlistCard}>
            <LinearGradient
              colors={["rgba(255,255,255,0.12)", "rgba(255,255,255,0.04)"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.playlistThumbWrap}>
              <LinearGradient
                colors={dominantMood.colors}
                style={styles.playlistThumbImg}
              >
                <dominantMood.Icon
                  size={24}
                  color="rgba(235,255,246,0.96)"
                  strokeWidth={2.2}
                />
                <View style={styles.playlistThumbMiniLogo}>
                  <LogoIcon size={18} circular animated={false} />
                </View>
              </LinearGradient>
            </View>

            <View style={styles.playlistInfo}>
              <Text style={styles.playlistName} numberOfLines={1}>
                {playlist.name}
              </Text>
              <Text style={styles.playlistMeta}>
                {playlist.trackCount}곡 · {playlist.duration} ·{" "}
                {dominantMood.label}
              </Text>
            </View>

            <View style={styles.checkWrap}>
              <Text style={styles.checkText}>✓</Text>
            </View>
          </View>

          <View style={styles.tracksSection}>
            <Text style={styles.sectionTitle}>수록곡</Text>
            <Text style={styles.sectionSub}>
              실제 Spotify 앨범 아트 기준으로 표시됩니다
            </Text>

            {tracks.slice(0, DEFAULT_SHOW).map((track, idx) => (
              <TrackRow key={track.id} track={track} index={idx + 1} />
            ))}

            {hiddenCount > 0 && (
              <>
                <Animated.View
                  style={{
                    height: expandH,
                    opacity: expandOp,
                    overflow: "hidden",
                  }}
                >
                  {tracks.slice(DEFAULT_SHOW).map((track, idx) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      index={DEFAULT_SHOW + idx + 1}
                    />
                  ))}
                </Animated.View>
                <TouchableOpacity
                  style={styles.moreBtn}
                  onPress={toggleExpand}
                  activeOpacity={0.8}
                >
                  <Text style={styles.moreBtnText}>
                    {expanded ? "접기 ↑" : `${hiddenCount}곡 더보기 ↓`}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.buttons,
            { opacity: btnOp, transform: [{ translateY: btnY }] },
          ]}
        >
          <Pressable
            onPress={handleListen}
            style={({ pressed }) => [
              styles.primaryWrap,
              pressed
                ? { transform: [{ scale: 0.986 }, { translateY: 1 }] }
                : null,
            ]}
          >
            {({ pressed }) => (
              <>
                <View style={styles.primaryGlowA} />
                <View style={styles.primaryGlowB} />
                <LinearGradient
                  colors={[C.greenL, "#35de84", C.greenD]}
                  style={styles.primaryBtn}
                >
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.shimmer,
                      {
                        transform: [
                          { translateX: shimmerX },
                          { skewX: "-20deg" },
                        ],
                      },
                    ]}
                  />
                  {pressed ? (
                    <View
                      style={[StyleSheet.absoluteFill, styles.pressOverlayDark]}
                    />
                  ) : null}
                  <View style={styles.mainBtnIconWrap}>
                    <SpotifyIcon size={20} color={C.green} />
                  </View>
                  <Text style={styles.primaryTxt}>Spotify에서 바로 듣기</Text>
                </LinearGradient>
              </>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.secondaryWrap,
              pressed ? { transform: [{ scale: 0.992 }], opacity: 0.92 } : null,
            ]}
            onPress={handleNew}
          >
            {({ pressed }) => (
              <LinearGradient
                colors={[
                  "rgba(255,255,255,0.07)",
                  "rgba(255,255,255,0.04)",
                ]}
                style={styles.secondaryBtn}
              >
                {pressed ? (
                  <View
                    style={[StyleSheet.absoluteFill, styles.pressOverlayLight]}
                  />
                ) : null}
                <View style={styles.secondaryInnerStroke} />
                <Text style={styles.secondaryTxt}>새 플레이리스트 만들기</Text>
              </LinearGradient>
            )}
          </Pressable>
        </Animated.View>
      </ScrollView>
    </ScreenBackground>
  );
}

type MoodProfile = {
  id: string;
  label: string;
  Icon: LucideIcon;
  colors: [string, string, string];
  tokens: string[];
};

const MOOD_PROFILES: MoodProfile[] = [
  {
    id: "calm",
    label: "차분한 무드",
    Icon: MoonStar,
    colors: ["#0f2740", "#123050", "#0a1f36"],
    tokens: [
      "chill",
      "calm",
      "ambient",
      "lofi",
      "acoustic",
      "ballad",
      "jazz",
      "soul",
      "새벽",
      "잔잔",
      "차분",
      "감성",
    ],
  },
  {
    id: "bright",
    label: "밝은 무드",
    Icon: Sunrise,
    colors: ["#25440f", "#356a12", "#1b3f0d"],
    tokens: [
      "pop",
      "funk",
      "dance",
      "disco",
      "happy",
      "upbeat",
      "summer",
      "맑",
      "아침",
      "밝",
      "산뜻",
    ],
  },
  {
    id: "deep",
    label: "몽환 무드",
    Icon: Sparkles,
    colors: ["#2a143b", "#3a1c56", "#1f1130"],
    tokens: [
      "dream",
      "indie",
      "shoegaze",
      "synth",
      "rnb",
      "neo",
      "citypop",
      "몽환",
      "신스",
      "인디",
      "저녁",
    ],
  },
  {
    id: "energy",
    label: "에너지 무드",
    Icon: Flame,
    colors: ["#3d1b10", "#5a2613", "#2f140b"],
    tokens: [
      "edm",
      "electro",
      "house",
      "techno",
      "trap",
      "hiphop",
      "workout",
      "운동",
      "강렬",
      "에너지",
      "힙합",
    ],
  },
  {
    id: "rainy",
    label: "비 오는 무드",
    Icon: CloudRain,
    colors: ["#1c2838", "#24374f", "#142132"],
    tokens: [
      "blues",
      "slow",
      "piano",
      "vocal",
      "sad",
      "melancholy",
      "비",
      "우울",
      "짙",
      "고요",
    ],
  },
  {
    id: "wave",
    label: "드라이브 무드",
    Icon: Waves,
    colors: ["#0f2f2b", "#155347", "#0c2523"],
    tokens: [
      "road",
      "drive",
      "groove",
      "alt",
      "rock",
      "rhythm",
      "드라이브",
      "리듬",
      "여행",
      "바다",
    ],
  },
];

function pickDominantMood(tracks: Track[], seedText: string): MoodProfile {
  const bag = tracks
    .flatMap(t => t.genre ?? [])
    .map(v => String(v).toLowerCase())
    .concat(
      String(seedText || "")
        .toLowerCase()
        .split(/[\s,./!?;:()]+/)
        .filter(Boolean),
    );

  let winner = MOOD_PROFILES[0];
  let best = -1;

  for (const profile of MOOD_PROFILES) {
    const score = bag.reduce((acc, token) => {
      const matched = profile.tokens.some(k => token.includes(k));
      return acc + (matched ? 1 : 0);
    }, 0);
    if (score > best) {
      best = score;
      winner = profile;
    }
  }

  if (best > 0) return winner;
  const deterministic = tracks.length
    ? tracks[0].name.length + tracks.length
    : 0;
  return MOOD_PROFILES[deterministic % MOOD_PROFILES.length];
}

function TrackRow({ track, index }: { track: Track; index: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowNum}>{index}</Text>

      {track.albumImageUrl ? (
        <Image
          source={{ uri: track.albumImageUrl }}
          style={styles.rowArtwork}
        />
      ) : (
        <LinearGradient
          colors={[track.gradientStart, track.gradientEnd]}
          style={styles.rowArtwork}
        >
          <LogoIcon size={22} circular animated={false} />
        </LinearGradient>
      )}

      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>
          {track.name}
        </Text>
        <Text style={styles.rowArtist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>

      <Text style={styles.rowDuration}>{track.duration}</Text>
    </View>
  );
}

function SpotifyMark({ size = 22 }: { size?: number }) {
  const d1 =
    "M5.2 9.4c4.4-1.2 9.4-.9 13.5 1.1.4.2.6.7.4 1.1-.2.4-.7.6-1.1.4-3.7-1.8-8.3-2.1-12.3-1-.4.1-.9-.1-1-.6-.1-.4.1-.9.5-1z";
  const d2 =
    "M6.2 12.8c3.6-1 7.6-.7 10.9.9.4.2.5.6.3 1-.2.4-.6.5-1 .3-3-1.4-6.6-1.7-9.8-.8-.4.1-.8-.1-.9-.5-.1-.4.1-.8.5-.9z";
  const d3 =
    "M7.1 16c2.9-.8 6-.6 8.6.7.3.2.4.5.2.9-.2.3-.5.4-.9.2-2.3-1.2-5.1-1.4-7.7-.6-.3.1-.7-.1-.8-.4-.1-.4.1-.7.6-.8z";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="12" fill="#1DB954" />
      <Path d={d1} fill="#0b0b0b" />
      <Path d={d2} fill="#0b0b0b" />
      <Path d={d3} fill="#0b0b0b" />
    </Svg>
  );
}

function SpotifyIcon({
  size = 22,
  color = "#000",
}: {
  size?: number;
  color?: string;
}) {
  const d1 =
    "M5.2 9.4c4.4-1.2 9.4-.9 13.5 1.1.4.2.6.7.4 1.1-.2.4-.7.6-1.1.4-3.7-1.8-8.3-2.1-12.3-1-.4.1-.9-.1-1-.6-.1-.4.1-.9.5-1z";
  const d2 =
    "M6.2 12.8c3.6-1 7.6-.7 10.9.9.4.2.5.6.3 1-.2.4-.6.5-1 .3-3-1.4-6.6-1.7-9.8-.8-.4.1-.8-.1-.9-.5-.1-.4.1-.8.5-.9z";
  const d3 =
    "M7.1 16c2.9-.8 6-.6 8.6.7.3.2.4.5.2.9-.2.3-.5.4-.9.2-2.3-1.2-5.1-1.4-7.7-.6-.3.1-.7-.1-.8-.4-.1-.4.1-.7.6-.8z";

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10" fill={color} opacity={0.08} />
      <Path d={d1} fill={color} />
      <Path d={d2} fill={color} />
      <Path d={d3} fill={color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 22,
    alignItems: "center",
  },
  hero: {
    width: RINGS[RINGS.length - 1].size + 10,
    height: RINGS[RINGS.length - 1].size + 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 26,
  },
  ringAuraOuter: {
    position: "absolute",
    width: 330,
    height: 330,
    borderRadius: 165,
    backgroundColor: "rgba(61,220,132,0.14)",
    shadowColor: "#49f7a2",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 56,
  },
  ringAuraInner: {
    position: "absolute",
    width: 222,
    height: 222,
    borderRadius: 111,
    backgroundColor: "rgba(61,220,132,0.2)",
    shadowColor: "#49f7a2",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 28,
  },
  ring: {
    position: "absolute",
    borderColor: "#55ffb0",
    shadowColor: "#49f7a2",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 26,
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: {
    alignItems: "center",
    width: "100%",
    gap: 10,
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "900",
    color: C.text,
    textAlign: "center",
    letterSpacing: -0.9,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: C.text2,
    textAlign: "center",
  },
  mainCardWrap: {
    width: "100%",
    marginBottom: 18,
    gap: 12,
  },
  playlistCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.cardBd,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    backgroundColor: "rgba(7,21,12,0.45)",
  },
  playlistThumbWrap: {
    width: 62,
    height: 62,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  playlistThumbImg: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  playlistThumbMiniLogo: {
    position: "absolute",
    right: 5,
    bottom: 5,
    borderRadius: 999,
    overflow: "hidden",
  },
  playlistInfo: { flex: 1, gap: 3 },
  playlistName: {
    fontSize: 18,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.35,
  },
  playlistMeta: {
    fontSize: 13,
    color: C.text2,
  },
  checkWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(61,220,132,0.2)",
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: {
    color: C.greenL,
    fontSize: 15,
    fontWeight: "900",
  },
  tracksSection: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    backgroundColor: "rgba(7,20,12,0.5)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
  },
  sectionSub: {
    marginTop: 2,
    marginBottom: 8,
    fontSize: 12,
    color: C.text3,
  },
  row: {
    minHeight: TRACK_ROW_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    paddingVertical: 8,
  },
  rowNum: {
    width: 16,
    textAlign: "right",
    fontSize: 12,
    color: C.text3,
    fontWeight: "600",
  },
  rowArtwork: {
    width: 42,
    height: 42,
    borderRadius: 10,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
  },
  rowArtist: {
    fontSize: 12,
    color: C.text2,
  },
  rowDuration: {
    fontSize: 12,
    color: C.text3,
    fontWeight: "600",
  },
  moreBtn: {
    marginTop: 8,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(61,220,132,0.28)",
    backgroundColor: "rgba(61,220,132,0.08)",
  },
  moreBtnText: {
    fontSize: 12,
    color: "rgba(150,255,201,0.92)",
    fontWeight: "700",
  },
  buttons: {
    width: "100%",
    marginTop: 6,
    gap: 10,
  },
  primaryWrap: {
    width: "100%",
    borderRadius: 50,
    overflow: "hidden",
    shadowColor: C.green,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.5,
    shadowRadius: 26,
    elevation: 12,
  },
  primaryGlowA: {
    position: "absolute",
    left: 28,
    right: 28,
    top: 8,
    bottom: -2,
    borderRadius: 28,
    backgroundColor: "rgba(61,220,132,0.2)",
    shadowColor: "#41f196",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 22,
    elevation: 10,
  },
  primaryGlowB: {
    position: "absolute",
    left: 40,
    right: 40,
    top: 14,
    bottom: -4,
    borderRadius: 30,
    backgroundColor: "rgba(61,220,132,0.12)",
    shadowColor: "#41f196",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 34,
    elevation: 12,
  },
  primaryBtn: {
    height: 58,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    overflow: "hidden",
  },
  mainBtnIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  shimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: 70,
    backgroundColor: "rgba(255,255,255,0.26)",
  },
  primaryTxt: {
    fontSize: 17,
    fontWeight: "800",
    color: "#000",
    letterSpacing: -0.4,
  },
  pressOverlayDark: {
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  pressOverlayLight: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  secondaryWrap: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.11)",
    backgroundColor: "rgba(255,255,255,0.04)",
    shadowColor: "rgba(255,255,255,0.35)",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  secondaryBtn: {
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryInnerStroke: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  secondaryTxt: {
    fontSize: 18,
    fontWeight: "700",
    color: "rgba(255,255,255,0.92)",
    letterSpacing: -0.1,
  },
});
