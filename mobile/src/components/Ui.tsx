import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { theme as t } from "../theme";

export function Brand({
  size = 15,
  markSize = 20,
  color = t.brand,
}: {
  size?: number;
  markSize?: number;
  color?: string;
}) {
  return (
    <View style={s.brand} accessible accessibilityLabel="Tako">
      <Svg width={markSize} height={markSize} viewBox="0 0 40 40">
        <Path
          d="M8 24V17a12 12 0 0 1 24 0v7c5 4 0 10-5 5-4 7-10 7-14 0-5 5-10-1-5-5Z"
          fill={color}
        />
        <Circle
          cx={15}
          cy={18}
          r={2}
          fill={color === "white" ? "#0d1b3f" : "white"}
        />
        <Circle
          cx={25}
          cy={18}
          r={2}
          fill={color === "white" ? "#0d1b3f" : "white"}
        />
      </Svg>
      <Text style={[s.wordmark, { fontSize: size, color }]}>tako</Text>
    </View>
  );
}
export function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        pressed && s.pressed,
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text style={s.actionText}>{label}</Text>
    </Pressable>
  );
}
export function Status({
  loading,
  title,
  message,
  onRetry,
  requestId,
  actionLabel = "重新加载",
}: {
  loading?: boolean;
  title: string;
  message?: string;
  onRetry?: () => void;
  requestId?: string;
  actionLabel?: string;
}) {
  return (
    <View style={s.status} accessibilityLiveRegion="polite">
      {loading ? (
        <ActivityIndicator color={t.brand} size="large" />
      ) : (
        <Image
          source={require("../../assets/tako-chibi.png")}
          style={s.chibi}
          resizeMode="contain"
          accessible={false}
        />
      )}
      <Text style={s.statusTitle}>{title}</Text>
      {message ? <Text style={s.message}>{message}</Text> : null}
      {onRetry ? <Action label={actionLabel} onPress={onRetry} /> : null}
      {requestId ? (
        <Text selectable style={s.trace}>
          请求编号 {requestId}
        </Text>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 4 },
  wordmark: { color: t.brand, fontSize: 24, fontWeight: "600" },
  action: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: t.brand,
    alignItems: "center",
  },
  pressed: { opacity: 0.75 },
  actionText: { color: "white", fontWeight: "600", fontSize: 14 },
  status: { alignItems: "center", padding: 32, gap: 16 },
  chibi: { width: 120, height: 120 },
  statusTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: t.ink,
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    lineHeight: 24,
    color: t.secondary,
    textAlign: "center",
  },
  trace: { color: t.muted, fontSize: 12 },
});
