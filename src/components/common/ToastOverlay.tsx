import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type ToastItem = {
  id: string;
  message: string;
  tone?: "warning" | "info";
};

type ToastOverlayProps = {
  queue: ToastItem[];
  topInset?: number;
  onShift: (id: string) => void;
};

const SHOW_MS = 2600;
const USE_NATIVE_DRIVER = Platform.OS !== "web";

export default function ToastOverlay({
  queue,
  topInset = 16,
  onShift,
}: ToastOverlayProps) {
  const [active, setActive] = useState<ToastItem | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;

  const activeStyle = useMemo(() => {
    if (active?.tone === "warning") {
      return {
        borderColor: "rgba(255,191,92,0.55)",
        backgroundColor: "rgba(61,35,8,0.95)",
        textColor: "#FFD89A",
      };
    }
    return {
      borderColor: "rgba(134,221,255,0.55)",
      backgroundColor: "rgba(10,30,44,0.95)",
      textColor: "#D6F1FF",
    };
  }, [active?.tone]);

  useEffect(() => {
    if (active || !queue.length) return;
    setActive(queue[0]);
  }, [active, queue]);

  useEffect(() => {
    if (!active) return;

    opacity.setValue(0);
    translateY.setValue(-12);

    let done = false;
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
      Animated.delay(SHOW_MS),
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(translateY, {
          toValue: -8,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    ]).start(() => {
      if (done) return;
      onShift(active.id);
      setActive(null);
    });

    return () => {
      done = true;
    };
  }, [active, onShift, opacity, translateY]);

  if (!active) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.root, { top: Math.max(topInset, 20) }]}
    >
      <Animated.View
        style={[
          styles.card,
          {
            opacity,
            transform: [{ translateY }],
            borderColor: activeStyle.borderColor,
            backgroundColor: activeStyle.backgroundColor,
          },
        ]}
      >
        <Text style={[styles.message, { color: activeStyle.textColor }]}>
          {active.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 80,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  message: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
});
