// app/(tabs)/_layout.tsx
// ─────────────────────────────────────────────────────────
//  하단 탭 네비게이션 레이아웃
//  커스텀 탭바: 글래스 배경 + 그린 액티브 인디케이터
// ─────────────────────────────────────────────────────────
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Dimensions, Platform, StyleSheet, Text, View } from "react-native";
import { Colors } from "../../src/constants/colors";

const { width: W } = Dimensions.get("window");

interface TabIconProps {
  icon: string;
  label: string;
  focused: boolean;
}

function TabIcon({ icon, label, focused }: TabIconProps) {
  return (
    <View style={[styles.tabItem, focused && styles.tabItemActive]}>
      <Text style={[styles.tabIcon, focused && styles.tabIconActive]}>
        {icon}
      </Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>
        {label}
      </Text>
      {focused && <View style={styles.tabIndicator} />}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarBackground: () => (
          <BlurView
            intensity={40}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "홈",
          tabBarIcon: ({ focused }) => (
            <TabIcon icon="✨" label="홈" focused={focused} />
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "라이브러리",
          tabBarIcon: ({ focused }) => (
            <TabIcon icon="📚" label="라이브러리" focused={focused} />
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "프로필",
          tabBarIcon: ({ focused }) => (
            <TabIcon icon="👤" label="프로필" focused={focused} />
          ),
          tabBarLabel: () => null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: Platform.OS === "ios" ? 88 : 72,
    backgroundColor: "transparent",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    elevation: 0,
  },
  tabItem: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    minWidth: 64,
  },
  tabItemActive: {},
  tabIcon: {
    fontSize: 22,
    marginBottom: 2,
    opacity: 0.45,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    fontSize: 10,
    color: Colors.t3,
    fontWeight: "500",
  },
  tabLabelActive: {
    color: Colors.green,
    fontWeight: "700",
  },
  tabIndicator: {
    position: "absolute",
    top: -2,
    width: 20,
    height: 2,
    borderRadius: 1,
    backgroundColor: Colors.green,
  },
});
