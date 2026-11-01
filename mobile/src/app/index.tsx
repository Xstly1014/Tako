import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Brand } from "../components/Ui";
export default function Splash() {
  const [shift] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let alive = true;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shift, {
          toValue: -12,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(shift, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const apply = (reduce: boolean) => {
      loop.stop();
      shift.setValue(0);
      if (!reduce && alive) loop.start();
    };
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (alive) apply(reduce);
    });
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      apply,
    );
    return () => {
      alive = false;
      listener.remove();
      loop.stop();
    };
  }, [shift]);
  return (
    <SafeAreaView style={s.screen}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="splash" x1="0" y1="0" x2="0.6" y2="1">
              <Stop offset="0" stopColor="#0d1b3f" />
              <Stop offset="0.7" stopColor="#17307c" />
              <Stop offset="1" stopColor="#254bc1" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#splash)" />
        </Svg>
      </View>
      <View style={s.content}>
        <Animated.Image
          source={require("../../assets/tako-hero.png")}
          resizeMode="contain"
          style={[s.art, { transform: [{ translateY: shift }] }]}
          accessible={false}
        />
        <Brand size={34} markSize={40} color="white" />
        <Text style={s.slogan}>有脑洞，就开写。</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/welcome")}
          style={({ pressed }) => [
            s.enter,
            pressed && { backgroundColor: "#ffffff20" },
          ]}
        >
          <Text style={s.enterText}>轻触进入</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0d1b3f" },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 24,
  },
  art: { width: 300, height: 300, maxHeight: "53%", marginTop: -40 },
  slogan: { marginTop: 10, fontSize: 15, letterSpacing: 4, color: "#cdd9ff" },
  enter: {
    marginTop: 34,
    paddingVertical: 12,
    paddingHorizontal: 46,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "#ffffffa6",
    minHeight: 48,
  },
  enterText: { color: "white", fontSize: 15, letterSpacing: 3 },
});
