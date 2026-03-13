// app/auth/spotify.tsx
// ─────────────────────────────────────────────────────────
//  Spotify Login (Placeholder)
//  - 실제 OAuth/연동 화면은 이후 구현 예정
// ─────────────────────────────────────────────────────────
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassButton } from "../../src/components/common/Button";
import ScreenBackground from "../../src/components/common/ScreenBackground";
import { Colors } from "../../src/constants/colors";

export default function SpotifyLoginPlaceholder() {
  const insets = useSafeAreaInsets();

  return (
    <ScreenBackground>
      <View style={[styles.root, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 22 }]}>
        <View style={styles.center}>
          <Text style={styles.title}>Spotify 로그인</Text>
          <Text style={styles.sub}>이 화면은 다음 단계에서 구현할게요.</Text>
        </View>

        <GlassButton label="뒤로가기" onPress={() => router.back()} style={{ width: "100%" }} />
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 22, justifyContent: "space-between" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  title: { fontSize: 22, color: Colors.t1, fontFamily: "Outfit-ExtraBold", letterSpacing: -0.4 },
  sub: { fontSize: 13, color: Colors.t2, fontFamily: "DMSans-Regular" },
});

