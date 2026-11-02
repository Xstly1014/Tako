import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SearchFlow } from "./flow";
import { ReaderError, errorMessage } from "../api/reader";
import { WorkRow } from "../components/WorkRow";
import { Action, Status } from "../components/Ui";
import { Icon } from "../components/PrototypeUi";
import { theme as t } from "../theme";
function message(error: unknown) {
  if (error instanceof ReaderError && error.kind === "unavailable")
    return "搜索服务暂不可用，请稍后重试。";
  return errorMessage(error);
}
export default function SearchScreen() {
  const [flow] = useState(() => new SearchFlow());
  const state = useSyncExternalStore(flow.subscribe, flow.snapshot);
  useEffect(() => () => flow.dispose(), [flow]);
  const submittingSame = state.loading && state.input.trim() === state.query;
  const submit = () => {
    Keyboard.dismiss();
    void flow.submit();
  };
  return (
    <SafeAreaView style={s.screen} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回社区"
          style={({ pressed }) => [s.back, pressed && { opacity: 0.6 }]}
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/community")
          }
        >
          <Icon name="back" size={24} color={t.ink} />
        </Pressable>
        <View style={s.field}>
          <Icon name="search" size={16} />
          <TextInput
            accessibilityLabel="搜索关键词"
            placeholder="搜索内容或作者"
            placeholderTextColor={t.muted}
            value={state.input}
            onChangeText={(value) => flow.input(value)}
            onSubmitEditing={submit}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            style={s.input}
          />
          {state.input ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清除搜索"
              onPress={() => flow.clear()}
              style={({ pressed }) => [s.clear, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.clearText}>×</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={submit}
          style={({ pressed }) => [
            s.submit,
            (pressed || submittingSame) && { opacity: 0.5 },
          ]}
          disabled={submittingSame}
          accessibilityState={{ disabled: submittingSame }}
        >
          <Text style={s.submitText}>搜索</Text>
        </Pressable>
      </View>
      {state.inputError ? (
        <Text accessibilityRole="alert" style={s.error}>
          {state.inputError}
        </Text>
      ) : null}
      {state.query ? (
        <Text style={s.caption} numberOfLines={2}>
          “{state.query}”的中篇作品 · 最新发布
        </Text>
      ) : null}
      <View style={s.results}>
        {!state.query ? (
          <Status
            title="搜索中篇作品"
            message="输入作品名、作者或简介关键词。"
          />
        ) : state.loading ? (
          <Status loading title="正在搜索" />
        ) : state.error ? (
          <Status
            title="搜索未完成"
            message={message(state.error)}
            requestId={
              state.error instanceof ReaderError ? state.error.requestId : ""
            }
            onRetry={submit}
            actionLabel="重试搜索"
          />
        ) : (
          <FlatList
            key={state.searchId}
            data={state.items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <WorkRow item={item} />}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Status
                title="没有找到匹配作品"
                message="试试更短的关键词，或换个作品名、作者名。"
              />
            }
            ListFooterComponent={
              <View style={s.footer}>
                {state.moreError ? (
                  <Text accessibilityRole="alert" style={s.error}>
                    {message(state.moreError)}
                  </Text>
                ) : null}
                {state.moreLoading ? (
                  <ActivityIndicator color={t.brand} />
                ) : state.cursor ? (
                  <Action
                    label={state.moreError ? "重试加载更多" : "加载更多"}
                    disabled={!flow.canMore()}
                    onPress={() => {
                      void flow.more();
                    }}
                  />
                ) : state.items.length ? (
                  <Text style={s.note}>已显示本次搜索的全部作品</Text>
                ) : null}
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 24,
    minHeight: 44,
  },
  input: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 14,
    color: t.ink,
    minWidth: 0,
  },
  clear: {
    width: 40,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: { fontSize: 20, color: t.muted },
  submit: {
    minWidth: 48,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { fontSize: 14, color: t.brand, fontWeight: "600" },
  results: { flex: 1, backgroundColor: t.background },
  caption: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    fontSize: 12,
    lineHeight: 20,
    color: t.muted,
  },
  error: {
    color: t.danger,
    fontSize: 14,
    lineHeight: 22,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  footer: { padding: 24, gap: 16, alignItems: "center" },
  note: { color: t.muted, fontSize: 12 },
});
