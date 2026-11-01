import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { theme as t } from "../theme";
import { router } from "expo-router";
export function unavailable(name: string) {
  Alert.alert("尚未开放", `${name}尚未接入手机端。`, [{ text: "关闭" }]);
}
const paths = {
  home: "M12 3 3 10v11h6v-7h6v7h6V10z",
  merch:
    "M12 2 4 6v2h16V6zM4 10h7v4H4zM13 10h7v4h-7zM4 16h7v6H4zM13 16h7v6h-7z",
  message: "M4 4h16v12H8l-4 4z",
  person:
    "M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2c-4.4 0-8 2.4-8 5.4V21h16v-1.6c0-3-3.6-5.4-8-5.4Z",
};
export function Icon({
  name,
  size = 22,
  color = t.muted,
}: {
  name:
    | "home"
    | "merch"
    | "message"
    | "person"
    | "search"
    | "dots"
    | "heart"
    | "star"
    | "back"
    | "more";
  size?: number;
  color?: string;
}) {
  const shape =
    name in paths ? (
      <Path d={paths[name as keyof typeof paths]} fill={color} />
    ) : name === "search" ? (
      <>
        <Circle
          cx={10}
          cy={10}
          r={6.5}
          stroke={color}
          strokeWidth={1.8}
          fill="none"
        />
        <Path
          d="m15 15 5 5"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      </>
    ) : name === "dots" ? (
      <>
        {[5, 12, 19].flatMap((x) =>
          [5, 12, 19].map((y) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.8} fill={color} />
          )),
        )}
      </>
    ) : name === "heart" ? (
      <Path
        d="M20.5 5.8a5.1 5.1 0 0 0-7.2 0L12 7.1l-1.3-1.3a5.1 5.1 0 0 0-7.2 7.2L12 21l8.5-8a5.1 5.1 0 0 0 0-7.2Z"
        fill="none"
        stroke={color}
        strokeWidth={1.5}
      />
    ) : name === "star" ? (
      <Path
        d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z"
        fill="none"
        stroke={color}
        strokeWidth={1.5}
      />
    ) : name === "back" ? (
      <Path
        d="m15 5-7 7 7 7"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
    ) : (
      <>
        {[5, 12, 19].map((x) => (
          <Circle key={x} cx={x} cy={12} r={1.6} fill={color} />
        ))}
      </>
    );
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {shape}
    </Svg>
  );
}
export function FutureAction({
  name,
  icon,
}: {
  name: string;
  icon: "heart" | "message" | "star" | "more";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}，尚未开放`}
      onPress={() => unavailable(name)}
      hitSlop={4}
      style={({ pressed }) => [s.futureAction, pressed && { opacity: 0.5 }]}
    >
      <Icon name={icon} size={18} />
    </Pressable>
  );
}
export function BottomNavigation({
  onHome,
  active = "home",
}: {
  onHome: () => void;
  active?: "home" | "me";
}) {
  return (
    <View style={s.bottom} accessibilityLabel="主导航">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="首页"
        onPress={onHome}
        style={s.nav}
      >
        <Icon name="home" color={active === "home" ? t.brand : t.muted} />
        <Text
          style={[
            s.navText,
            active === "home" && { color: t.brand, fontWeight: "600" },
          ]}
        >
          首页
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="周边，尚未开放"
        onPress={() => unavailable("周边")}
        style={s.nav}
      >
        <Icon name="merch" />
        <Text style={s.navText}>周边</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="发帖，尚未开放"
        onPress={() => unavailable("创作")}
        style={({ pressed }) => [s.fab, pressed && { opacity: 0.7 }]}
      >
        <Svg width={46} height={46} viewBox="0 0 46 46">
          <Defs>
            <LinearGradient id="post" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#ff5f7e" />
              <Stop offset="1" stopColor="#f0413f" />
            </LinearGradient>
          </Defs>
          <Rect width={46} height={46} rx={15} fill="url(#post)" />
          <Path d="M22 14h2v8h8v2h-8v8h-2v-8h-8v-2h8Z" fill="white" />
        </Svg>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="消息，尚未开放"
        onPress={() => unavailable("消息")}
        style={s.nav}
      >
        <Icon name="message" />
        <Text style={s.navText}>消息</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="我的"
        onPress={() => {
          if (active !== "me") router.push("/account");
        }}
        style={s.nav}
      >
        <Icon name="person" color={active === "me" ? t.brand : t.muted} />
        <Text
          style={[
            s.navText,
            active === "me" && { color: t.brand, fontWeight: "600" },
          ]}
        >
          我的
        </Text>
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  bottom: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
    backgroundColor: "white",
  },
  nav: {
    width: 56,
    minHeight: 46,
    gap: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  navText: { fontSize: 10, color: t.muted },
  fab: {
    width: 46,
    height: 46,
    borderRadius: 15,
    elevation: 3,
    shadowColor: "#f0413f",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  futureAction: {
    width: 28,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
