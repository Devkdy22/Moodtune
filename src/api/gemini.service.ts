// src/api/gemini.service.ts
// ─────────────────────────────────────────────────────────
//  Google Gemini AI 서비스 (현재: 스켈레톤)
//  무드 텍스트 → 음악 추천 프롬프트
// ─────────────────────────────────────────────────────────
import { MOCK_TRACKS } from "../constants/mockData";
import { Track } from "../types";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// ── 무드 분석 + 트랙 추천 ─────────────────────────────────
export async function analyzeMoodAndRecommend(
  moodInput: string,
): Promise<{ tracks: Track[]; playlistName: string }> {
  // TODO: 실제 Gemini API 구현
  //
  // const prompt = `
  //   사용자의 무드를 분석하고 Spotify 트랙을 추천해주세요.
  //   무드: "${moodInput}"
  //
  //   다음 JSON 형식으로만 응답하세요:
  //   {
  //     "playlistName": "플레이리스트 이름",
  //     "mood": "분석된 무드",
  //     "genres": ["장르1", "장르2"],
  //     "bpmRange": { "min": 60, "max": 90 },
  //     "energy": "low|medium|high",
  //     "searchQueries": ["검색어1", "검색어2", "검색어3"]
  //   }
  // `;
  //
  // const res = await fetch(GEMINI_URL, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     contents: [{ parts: [{ text: prompt }] }]
  //   }),
  // });
  // const data = await res.json();
  // const text = data.candidates[0].content.parts[0].text;
  // const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  //
  // // parsed.searchQueries로 Spotify 검색 → 트랙 수집
  // const tracks = await searchSpotifyTracks(parsed.searchQueries, accessToken);
  // return { tracks, playlistName: parsed.playlistName };

  // 현재: mock 반환
  console.log("[Gemini] analyzeMoodAndRecommend called (mock):", moodInput);
  await new Promise(resolve => setTimeout(resolve, 1500)); // 로딩 시뮬레이션
  return {
    tracks: MOCK_TRACKS,
    playlistName: `${moodInput.slice(0, 15)}... 플레이리스트`,
  };
}
