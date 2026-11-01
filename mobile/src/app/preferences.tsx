import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { unavailable } from "../components/PrototypeUi";
import { theme as t } from "../theme";
export default function Preferences() {
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Image
          accessible={false}
          source={require("../../assets/tako-chibi.png")}
          resizeMode="contain"
          style={s.art}
        />
        <Text style={s.title}>先选一个，你最想读的文字形态</Text>
        <Text style={s.subtitle}>
          当前已开放中篇阅读，短内容与长文稍后接入。
        </Text>
        <View style={s.options}>
          {[
            {
              title: "短内容",
              subtitle: "快节奏的脑洞、日常与分享。",
              ready: false,
            },
            {
              title: "中篇",
              subtitle: "一个完整的故事、一段真实的经历。",
              ready: true,
            },
            {
              title: "长文",
              subtitle: "让角色和世界继续生长的连载。",
              ready: false,
            },
          ].map((item) => (
            <Pressable
              key={item.title}
              accessibilityRole="radio"
              accessibilityState={{ checked: item.ready }}
              onPress={() => {
                if (!item.ready) unavailable(`${item.title}频道`);
              }}
              style={[s.option, item.ready && s.selected]}
            >
              <Text style={[s.optionTitle, item.ready && { color: t.brand }]}>
                {item.title}
              </Text>
              <Text style={s.optionSubtitle}>{item.subtitle}</Text>
              <Text style={s.optionNote}>
                {item.ready ? "当前可阅读" : "频道尚未接入"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/community")}
          style={({ pressed }) => [s.enter, pressed && { opacity: 0.75 }]}
        >
          <Text style={s.enterText}>进入中篇首页</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 30,
    alignItems: "center",
  },
  art: { width: 130, height: (130 * 2) / 3 },
  title: {
    fontSize: 20,
    lineHeight: 30,
    color: t.ink,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 14,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 20,
    color: t.muted,
    textAlign: "center",
  },
  options: { marginTop: 26, gap: 12, width: "100%" },
  option: {
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: t.line,
    borderRadius: 14,
  },
  selected: { borderColor: t.brand, backgroundColor: "#f2f6ff" },
  optionTitle: { fontSize: 16, fontWeight: "600", color: t.ink },
  optionSubtitle: { fontSize: 13, color: "#4a5162", marginTop: 4 },
  optionNote: { fontSize: 11, color: t.muted, marginTop: 6 },
  enter: {
    backgroundColor: t.brand,
    paddingVertical: 14,
    width: "100%",
    borderRadius: 12,
    marginTop: "auto",
    alignItems: "center",
    minHeight: 48,
  },
  enterText: { fontSize: 16, fontWeight: "600", color: "white" },
});
