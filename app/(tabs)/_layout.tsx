// app/(tabs)/_layout.tsx
// ─────────────────────────────────────────────────────────
//  하단 탭 네비게이션 레이아웃
//  커스텀 탭바: 글래스 배경 + 그린 액티브 인디케이터
// ─────────────────────────────────────────────────────────
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { House, Library, UserRound } from "lucide-react-native";
import React, { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { Colors } from "../../src/constants/colors";

const USE_NATIVE_DRIVER = Platform.OS !== "web";

interface TabIconProps {
  Icon: React.ComponentType<{
    size?: number;
    color?: string;
    strokeWidth?: number;
  }>;
  label: string;
  focused: boolean;
  center?: boolean;
}

function TabIcon({ Icon, label, focused, center = false }: TabIconProps) {
  const t = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(t, {
      toValue: focused ? 1 : 0,
      tension: 90,
      friction: 10,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [focused, t]);

  const iconScale = t.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const wrapScale = t.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.02],
  });
  const lift = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0, center ? -7 : -4],
  });
  const glowOpacity = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const labelOpacity = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0.64, 1],
  });

  return (
    <Animated.View
      style={[styles.tabItem, { transform: [{ translateY: lift }] }]}
    >
      <Animated.View style={{ transform: [{ scale: wrapScale }] }}>
        <View style={[styles.iconWrap, center && styles.iconWrapCenter]}>
          <Animated.View
            style={[
              styles.activeGlow,
              center && styles.activeGlowCenter,
              {
                opacity: glowOpacity,
                transform: [{ scale: iconScale }],
                pointerEvents: "none",
              },
            ]}
          />
          <Animated.View style={{ transform: [{ scale: iconScale }] }}>
            <Icon
              size={center ? 24 : 22}
              strokeWidth={focused ? 2.5 : 2.2}
              color={focused ? "#ffffff" : "rgba(255,255,255,0.72)"}
            />
          </Animated.View>
        </View>
      </Animated.View>
      <Animated.Text
        style={[
          styles.tabLabel,
          focused && styles.tabLabelActive,
          { opacity: labelOpacity },
        ]}
      >
        {label}
      </Animated.Text>
    </Animated.View>
  );
}

function RippleTabButton({
  children,
  onPress,
  onLongPress,
  style,
  accessibilityState,
}: BottomTabBarButtonProps) {
  const rippleScale = useRef(new Animated.Value(0.1)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.2)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;

  const runRipple = () => {
    rippleScale.setValue(0.1);
    rippleOpacity.setValue(0.24);
    ringScale.setValue(0.2);
    ringOpacity.setValue(0.55);

    Animated.parallel([
      Animated.timing(rippleScale, {
        toValue: 1.9,
        duration: 520,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(rippleOpacity, {
        toValue: 0,
        duration: 520,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(ringScale, {
        toValue: 2.5,
        duration: 620,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(ringOpacity, {
        toValue: 0,
        duration: 620,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start();
  };

  return (
    <Pressable
      onPressIn={runRipple}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityState={accessibilityState}
      style={style}
    >
      <View style={styles.tabPressWrap}>
        <Animated.View
          style={[
            styles.touchRippleRing,
            {
              opacity: ringOpacity,
              transform: [{ scale: ringScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.touchRipple,
            {
              opacity: rippleOpacity,
              transform: [{ scale: rippleScale }],
            },
          ]}
        />
        {children}
      </View>
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabBarItem,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: Colors.green,
        tabBarInactiveTintColor: "rgba(255,255,255,0.58)",
        tabBarBackground: () => (
          <View style={StyleSheet.absoluteFill}>
            <BlurView
              intensity={22}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.tabBarOverlay} />
          </View>
        ),
      }}
    >
      <Tabs.Screen
        name="library"
        options={{
          title: "라이브러리",
          tabBarButton: props => <RippleTabButton {...props} />,
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={Library} label="라이브러리" focused={focused} />
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: "홈",
          tabBarButton: props => <RippleTabButton {...props} />,
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={House} label="홈" focused={focused} center />
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "설정",
          tabBarButton: props => <RippleTabButton {...props} />,
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={UserRound} label="설정" focused={focused} />
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
    height: Platform.OS === "ios" ? 94 : 88,
    paddingTop: 6,
    paddingBottom: Platform.OS === "ios" ? 14 : 10,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: "rgba(8,20,14,0.90)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    elevation: 12,
  },
  tabBarItem: {
    paddingVertical: 0,
  },
  tabItem: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 88,
    gap: 6,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  iconWrapCenter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -2,
  },
  activeGlow: {
    position: "absolute",
    inset: 0,
    borderRadius: 14,
    backgroundColor: "rgba(61,220,132,0.88)",
  },
  activeGlowCenter: {
    borderRadius: 28,
    backgroundColor: "rgba(61,220,132,0.95)",
  },
  tabPressWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    overflow: "visible",
  },
  touchRipple: {
    position: "absolute",
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(61,220,132,0.30)",
    pointerEvents: "none",
  },
  touchRippleRing: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(111,255,184,0.85)",
    pointerEvents: "none",
  },
  tabBarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7,17,12,0.78)",
    borderRadius: 24,
  },
  tabLabel: {
    fontSize: 13,
    lineHeight: 16,
    color: "rgba(255,255,255,0.68)",
    fontWeight: "600",
    letterSpacing: -0.1,
    includeFontPadding: false,
  },
  tabLabelActive: {
    color: "#ffffff",
    fontWeight: "800",
  },
});
