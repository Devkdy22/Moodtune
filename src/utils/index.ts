// src/utils/index.ts

/** "5:32" → 332 (초) */
export function durationToSeconds(dur: string): number {
  const [m, s] = dur.split(':').map(Number);
  return m * 60 + (s || 0);
}

/** 초 → "5:32" */
export function secondsToDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 트랙 배열 총 시간 (분) */
export function totalMinutes(tracks: { duration: string }[]): number {
  const totalSec = tracks.reduce((sum, t) => sum + durationToSeconds(t.duration), 0);
  return Math.round(totalSec / 60);
}

/** 날짜 포맷 "2026년 3월 10일" */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(date);
}

/** 긴 텍스트 자르기 */
export function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}
