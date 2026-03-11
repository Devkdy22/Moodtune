// app/+not-found.tsx
import { Link } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import ScreenBackground from "../src/components/common/ScreenBackground";
import { Colors } from "../src/constants/colors";

export default function NotFoundScreen() {
  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Text style={styles.emoji}>🎵</Text>
        <Text style={styles.title}>페이지를 찾을 수 없어요</Text>
        <Text style={styles.sub}>잘못된 경로입니다</Text>
        <Link href="/(tabs)" style={styles.link}>
          <Text style={styles.linkText}>홈으로 돌아가기 →</Text>
        </Link>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emoji: { fontSize: 56 },
  title: { fontSize: 22, fontWeight: "700", color: Colors.t1 },
  sub: { fontSize: 14, color: Colors.t2 },
  link: { marginTop: 16 },
  linkText: { fontSize: 15, color: Colors.green, fontWeight: "600" },
});
