import { Track } from "../types";

export type MoodProfile = {
  id: string;
  label: string;
  colors: [string, string, string];
  tokens: string[];
};

export const MOOD_PROFILES: MoodProfile[] = [
  {
    id: "calm",
    label: "차분한 무드",
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

export function pickDominantMood(tracks: Track[], seedText: string): MoodProfile {
  const bag = tracks
    .flatMap(t => t.genre ?? [])
    .map(v => String(v).toLowerCase())
    .concat(String(seedText || "").toLowerCase().split(/[\s,./!?;:()]+/).filter(Boolean));

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
  const deterministic = tracks.length ? tracks[0].name.length + tracks.length : 0;
  return MOOD_PROFILES[deterministic % MOOD_PROFILES.length];
}

export function getPlaylistArtworkUrl(tracks: Track[]): string | undefined {
  return tracks.find(t => t.albumImageUrl)?.albumImageUrl;
}

