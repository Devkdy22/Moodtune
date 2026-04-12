import React, { useCallback, useRef, useState } from "react";
import {
  Animated,
  Easing,
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "../../constants/colors";

const GREEN_RGB = "61,220,132";
const MAX_RIPPLES = 5;
const USE_NATIVE_DRIVER = Platform.OS !== "web";

type BackgroundIntensity = "subtle" | "normal" | "strong";

const INTENSITY_PRESET: Record<BackgroundIntensity, { textureOpacity: number }> = {
  subtle: { textureOpacity: 0.4 },
  normal: { textureOpacity: 0.55 },
  strong: { textureOpacity: 0.68 },
};

function alpha(a: number) {
  return `rgba(${GREEN_RGB},${Math.max(0, Math.min(1, a))})`;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

type Ripple = {
  id: number;
  x: number;
  y: number;
  scale: Animated.Value;
  opacity: Animated.Value;
  size: number;
  duration: number;
  maxScale: number;
  baseOpacity: number;
  ringCount: 2 | 3;
  coreSize: number;
};

interface Props {
  children: React.ReactNode;
  intensity?: BackgroundIntensity;
}

export default function ScreenBackground({
  children,
  intensity = "normal",
}: Props) {
  const preset = INTENSITY_PRESET[intensity];
  const rootRef = useRef<View>(null);
  const rootOffsetRef = useRef({ x: 0, y: 0 });
  const nextIdRef = useRef(1);
  const [rootSize, setRootSize] = useState({ width: 0, height: 0 });
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const removeRipple = useCallback((id: number) => {
    setRipples(prev => prev.filter(r => r.id !== id));
  }, []);

  const syncRootOffset = useCallback(() => {
    rootRef.current?.measureInWindow?.((x, y) => {
      rootOffsetRef.current = { x, y };
    });
  }, []);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setRootSize({ width, height });
      syncRootOffset();
    },
    [syncRootOffset],
  );

  const handleTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      const { pageX, pageY } = event.nativeEvent;
      const x = pageX - rootOffsetRef.current.x;
      const y = pageY - rootOffsetRef.current.y;
      const clampedX = Math.max(0, Math.min(rootSize.width, x));
      const clampedY = Math.max(0, Math.min(rootSize.height, y));
      const id = nextIdRef.current++;
      const duration = Math.round(randomBetween(700, 1000));
      const maxScale = randomBetween(1.45, 1.9);
      const ringCount: 2 | 3 = Math.random() < 0.55 ? 3 : 2;
      const ripple: Ripple = {
        id,
        x: clampedX,
        y: clampedY,
        scale: new Animated.Value(0.2),
        opacity: new Animated.Value(randomBetween(0.4, 0.8)),
        size: randomBetween(56, 82),
        duration,
        maxScale,
        baseOpacity: randomBetween(0.4, 0.8),
        ringCount,
        coreSize: randomBetween(40, 60),
      };

      setRipples(prev => {
        const next = [...prev, ripple];
        return next.length > MAX_RIPPLES
          ? next.slice(next.length - MAX_RIPPLES)
          : next;
      });

      Animated.parallel([
        Animated.timing(ripple.scale, {
          toValue: maxScale,
          duration,
          easing: Easing.out(Easing.ease),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(ripple.opacity, {
          toValue: 0,
          duration,
          easing: Easing.out(Easing.ease),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start(() => removeRipple(id));
    },
    [removeRipple, rootSize.height, rootSize.width],
  );

  return (
    <View
      ref={rootRef}
      style={styles.root}
      onLayout={handleLayout}
      onTouchStart={handleTouchStart}
    >
      <LinearGradient
        colors={["#020904", "#071b12", "#04110b"]}
        start={{ x: 0.16, y: 0.02 }}
        end={{ x: 0.84, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <LinearGradient
        pointerEvents="none"
        colors={[alpha(0.14), alpha(0.06), "rgba(0,0,0,0)"]}
        start={{ x: 0.03, y: 0.08 }}
        end={{ x: 0.9, y: 0.95 }}
        style={[StyleSheet.absoluteFill, { opacity: preset.textureOpacity }]}
      />

      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {ripples.map(ripple => {
          const ring1Opacity = Animated.multiply(
            ripple.opacity,
            ripple.baseOpacity,
          );
          const ring2Opacity = Animated.multiply(
            ripple.opacity,
            ripple.baseOpacity * 0.75,
          );
          const ring3Opacity = Animated.multiply(
            ripple.opacity,
            ripple.baseOpacity * 0.55,
          );
          const ring2Scale = ripple.scale.interpolate({
            inputRange: [0.2, 0.9, ripple.maxScale],
            outputRange: [0.46, 0.88, 1.06],
            extrapolate: "clamp",
          });
          const ring3Scale = ripple.scale.interpolate({
            inputRange: [0.2, 1.2, ripple.maxScale],
            outputRange: [0.34, 0.78, 0.98],
            extrapolate: "clamp",
          });

          return (
            <View
              key={ripple.id}
              style={[
                styles.rippleAnchor,
                {
                  left: ripple.x - ripple.size / 2,
                  top: ripple.y - ripple.size / 2,
                  width: ripple.size,
                  height: ripple.size,
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.outerBloom,
                  {
                    width: ripple.coreSize * 2.8,
                    height: ripple.coreSize * 2.8,
                    borderRadius: (ripple.coreSize * 2.8) / 2,
                    left: (ripple.size - ripple.coreSize * 2.8) / 2,
                    top: (ripple.size - ripple.coreSize * 2.8) / 2,
                    opacity: Animated.multiply(ripple.opacity, 0.34),
                    transform: [{ scale: ripple.scale }],
                  },
                ]}
              />

              <Animated.View
                style={[
                  styles.coreHalo,
                  {
                    width: ripple.coreSize * 1.9,
                    height: ripple.coreSize * 1.9,
                    borderRadius: (ripple.coreSize * 1.9) / 2,
                    left: (ripple.size - ripple.coreSize * 1.9) / 2,
                    top: (ripple.size - ripple.coreSize * 1.9) / 2,
                    opacity: Animated.multiply(ripple.opacity, 0.55),
                    transform: [{ scale: ripple.scale }],
                  },
                ]}
              />

              <Animated.View
                style={[
                  styles.coreGlow,
                  {
                    width: ripple.coreSize,
                    height: ripple.coreSize,
                    borderRadius: ripple.coreSize / 2,
                    left: (ripple.size - ripple.coreSize) / 2,
                    top: (ripple.size - ripple.coreSize) / 2,
                    opacity: Animated.multiply(ripple.opacity, 0.9),
                    transform: [{ scale: ripple.scale }],
                  },
                ]}
              />

              <Animated.View
                style={[
                  styles.ring,
                  {
                    opacity: ring1Opacity,
                    transform: [{ scale: ripple.scale }],
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.ring,
                  {
                    opacity: ring2Opacity,
                    transform: [{ scale: ring2Scale }],
                  },
                ]}
              />
              {ripple.ringCount === 3 ? (
                <Animated.View
                  style={[
                    styles.ring,
                    {
                      opacity: ring3Opacity,
                      transform: [{ scale: ring3Scale }],
                    },
                  ]}
                />
              ) : null}
            </View>
          );
        })}
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
    overflow: "hidden",
  },
  rippleAnchor: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  coreGlow: {
    position: "absolute",
    backgroundColor: "#3DDC84",
    shadowColor: "#3DDC84",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.76,
    shadowRadius: 30,
    elevation: 5,
  },
  coreHalo: {
    position: "absolute",
    backgroundColor: "rgba(61,220,132,0.32)",
    shadowColor: "#3DDC84",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 46,
    elevation: 6,
  },
  outerBloom: {
    position: "absolute",
    backgroundColor: "rgba(61,220,132,0.22)",
    shadowColor: "#3DDC84",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.72,
    shadowRadius: 58,
    elevation: 7,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: "rgba(61,220,132,0.68)",
    backgroundColor: "rgba(61,220,132,0.04)",
    borderRadius: 999,
  },
});
