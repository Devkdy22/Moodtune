// src/hooks/useCuration.ts
// ─────────────────────────────────────────────────────────
//  플레이리스트 생성 로직 훅
//  화면과 API 로직 분리
// ─────────────────────────────────────────────────────────
import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { analyzeMoodAndRecommend } from '../api/gemini.service';
import { Playlist } from '../types';

export function useCuration() {
  const {
    moodInput, setMoodInput,
    isGenerating, setGenerating,
    generationStep, setGenerationStep,
    currentPlaylist, setCurrentPlaylist,
    spotifyUser,
    spotifyBootstrap,
    addPlaylist,
    resetCuration,
  } = useAppStore();

  const generate = useCallback(async () => {
    if (!moodInput.trim() || isGenerating) return;

    try {
      setGenerating(true);
      setGenerationStep(1);  // 무드 분석

      // Gemini 호출 (현재 mock)
      const { tracks, playlistName } = await analyzeMoodAndRecommend({
        moodInput,
        spotifyUser,
        spotifyBootstrap,
      });

      setGenerationStep(2);  // 음악 매칭
      await new Promise(r => setTimeout(r, 800));

      setGenerationStep(3);  // 완성

      const totalMins = tracks.reduce((sum, t) => {
        const [m, s] = t.duration.split(':').map(Number);
        return sum + m + s / 60;
      }, 0);

      const playlist: Playlist = {
        id:            `gen_${Date.now()}`,
        name:          playlistName,
        coverEmoji:    '🎵',
        gradientStart: '#1a2535',
        gradientEnd:   '#0e1822',
        trackCount:    tracks.length,
        duration:      `${Math.round(totalMins)}분`,
        liked:         false,
        tracks,
        createdAt:     new Date(),
        moodInput,
      };

      setCurrentPlaylist(playlist);
      return playlist;

    } catch (err) {
      console.warn('[useCuration] generate error.');
      return null;
    } finally {
      setGenerating(false);
    }
  }, [moodInput, isGenerating, spotifyBootstrap, spotifyUser]);

  const saveToLibrary = useCallback((playlist: Playlist) => {
    addPlaylist(playlist);
  }, [addPlaylist]);

  return {
    moodInput,
    setMoodInput,
    isGenerating,
    generationStep,
    currentPlaylist,
    generate,
    saveToLibrary,
    reset: resetCuration,
  };
}
