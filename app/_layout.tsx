// app/_layout.tsx
// ─────────────────────────────────────────────────────────
//  Root Layout — 전체 앱 Provider 설정
//  - Expo Router Stack
//  - SafeAreaProvider
//  - 폰트 로딩 (Outfit + DM Sans)
// ─────────────────────────────────────────────────────────
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import {
  Outfit_400Regular,
  Outfit_700Bold,
  Outfit_800ExtraBold,
  Outfit_900Black,
} from "@expo-google-fonts/outfit";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
void SplashScreen.preventAutoHideAsync().catch(() => {
  // no-op: 일부 환경(웹/테스트)에서 실패할 수 있음
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // Google Fonts 다운로드 후 assets/fonts/ 에 배치
    // npx expo install @expo-google-fonts/outfit @expo-google-fonts/dm-sans
    "Outfit-Regular": Outfit_400Regular,
    "Outfit-Bold": Outfit_700Bold,
    "Outfit-ExtraBold": Outfit_800ExtraBold,
    "Outfit-Black": Outfit_900Black,
    "DMSans-Regular": DMSans_400Regular,
    "DMSans-Medium": DMSans_500Medium,
    "DMSans-SemiBold": DMSans_600SemiBold,
    "DMSans-Bold": DMSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (fontError) console.warn("Font loading failed:", fontError);
  }, [fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          initialRouteName="index"
          screenOptions={{ headerShown: false, animation: "fade" }}
        >
          <Stack.Screen name="index" options={{ animation: "none" }} />
          <Stack.Screen name="auth/login" options={{ animation: "none" }} />
          <Stack.Screen name="auth/spotify" options={{ animation: "slide_from_right" }} />
          <Stack.Screen name="auth/spotify-linking" options={{ animation: "none" }} />
          <Stack.Screen name="expo-auth-session/[...segments]" options={{ animation: "none" }} />
          <Stack.Screen name="(tabs)" options={{ animation: "none" }} />
          <Stack.Screen name="playlist/[id]" options={{ animation: "slide_from_right" }} />
          <Stack.Screen
            name="result/[id]"
            options={{ animation: "slide_from_right" }}
          />
          <Stack.Screen name="+not-found" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
