import { useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CatalogPage } from "../api/author-works";
import { authorWorkMessage } from "../api/author-works";
import {
  emptyCatalogQuery,
  sameCatalogQuery,
  type CatalogQuery,
} from "./catalog";
import { theme as t } from "../theme";

type Props = {
  page: CatalogPage;
  query: CatalogQuery;
  draftQuery: CatalogQuery;
  busy: boolean;
  loaded: boolean;
  error: unknown;
  onDraftQuery: (query: CatalogQuery) => void;
  onApply: (query: CatalogQuery) => void;
  onRefresh: () => void;
  onMore: () => void;
  onSelect: (id: string) => void;
  onBack: () => void;
  onPublish: () => void;
  onFeedback: () => void;
  onModeration: () => void;
  onSubmissions?: () => void;
};
function Link({
  label,
  name = label,
  onPress,
  disabled = false,
}: {
  label: string;
  name?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.linkButton,
        pressed && s.pressed,
        disabled && s.disabled,
      ]}
    >
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
}
export default function AuthorCatalogView(p: Props) {
  const [filters, setFilters] = useState<CatalogQuery | null>(null);
  const dirty = !sameCatalogQuery(p.draftQuery, p.query);
  const filtered =
    p.query.q || p.query.visibility !== "all" || p.query.restriction !== "all";
  const apply = (q: CatalogQuery) => {
    p.onApply(q);
    setFilters(null);
  };
  const restriction = p.query.restriction === "restricted" ? "受限" : "未受限";
  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Link label="‹ 我的" name="返回我的" onPress={p.onBack} />
        <Text style={s.heading}>中篇作品</Text>
        <Link label="发布" name="发布服务器已保存稿件" onPress={p.onPublish} />
      </View>
      <View style={s.searchRow}>
        <View style={s.search}>
          <TextInput
            accessibilityLabel="作品标题关键词"
            placeholder="搜索作品标题"
            value={p.draftQuery.q}
            onChangeText={(q) => p.onDraftQuery({ ...p.draftQuery, q })}
            onSubmitEditing={() => apply(p.draftQuery)}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            style={s.input}
          />
          <Link
            label="搜索"
            name="查找作品"
            onPress={() => apply(p.draftQuery)}
          />
        </View>
        <Link label="筛选" onPress={() => setFilters({ ...p.draftQuery })} />
      </View>
      <View style={s.shortcuts}>
        {p.onSubmissions ? (
          <Link label="先审记录" onPress={p.onSubmissions} />
        ) : null}
        <Link label="读者反馈" name="读者反馈收件箱" onPress={p.onFeedback} />
        <Link
          label="处置 ›"
          name="查看本人处置与复核"
          onPress={p.onModeration}
        />
      </View>
      {filtered ? (
        <View style={s.applied}>
          <Text style={s.meta} numberOfLines={2}>
            {[
              p.query.q ? `“${p.query.q}”` : "",
              p.query.visibility === "all"
                ? ""
                : p.query.visibility === "hidden"
                  ? "已隐藏"
                  : "未隐藏",
              p.query.restriction === "all" ? "" : restriction,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Link
            label="清除"
            name="清空条件"
            onPress={() => apply(emptyCatalogQuery())}
          />
        </View>
      ) : null}
      {p.error && p.page.items.length ? (
        <View style={s.notice}>
          <Text accessibilityLiveRegion="polite" style={s.error}>
            {authorWorkMessage(p.error)}
          </Text>
        </View>
      ) : null}
      <FlatList
        data={p.page.items}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={p.busy && !p.page.items.length}
            onRefresh={p.onRefresh}
            tintColor={t.brand}
          />
        }
        contentContainerStyle={s.list}
        renderItem={({ item }) => {
          const restricted = item.platform_limited || item.display_limited;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`管理作品 ${item.title}`}
              onPress={() => p.onSelect(item.id)}
              style={({ pressed }) => [s.row, pressed && s.pressed]}
            >
              <View style={s.titleRow}>
                <Text numberOfLines={2} style={[s.title, { flex: 1 }]}>
                  {item.title}
                </Text>
                <Text style={s.chevron} accessible={false}>
                  ›
                </Text>
              </View>
              <Text style={[s.meta, restricted && s.error]}>
                {item.author_hidden
                  ? `已隐藏${restricted ? " · 受限" : ""}`
                  : restricted
                    ? "受限"
                    : "公开中"}
              </Text>
              <Text style={s.metrics}>
                {`评论 ${item.comment_count} · 收藏 ${item.favorite_count}`}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text accessibilityLiveRegion="polite" style={s.title}>
              {p.busy || (!p.loaded && !p.error)
                ? "正在读取作品"
                : p.error
                  ? "作品未能加载"
                  : filtered
                    ? "没有符合条件的作品"
                    : "还没有正式作品"}
            </Text>
            {p.error ? (
              <>
                <Text style={s.error}>{authorWorkMessage(p.error)}</Text>
                <Link label="重试" onPress={p.onRefresh} />
              </>
            ) : !p.busy && p.loaded ? (
              filtered ? (
                <Link
                  label="清除条件"
                  onPress={() => apply(emptyCatalogQuery())}
                />
              ) : (
                <Link label="发布稿件" onPress={p.onPublish} />
              )
            ) : null}
          </View>
        }
        ListFooterComponent={
          p.page.items.length ? (
            <View style={s.footer}>
              {p.page.next_cursor ? (
                <Link
                  label={p.error ? "重试加载更多作品" : "加载更多作品"}
                  disabled={p.busy || dirty}
                  onPress={p.onMore}
                />
              ) : null}
              <View style={s.footerRow}>
                <Text style={s.meta}>已读取 {p.page.items.length} 件</Text>
                <Link
                  label="刷新"
                  name="刷新作品"
                  disabled={p.busy}
                  onPress={p.onRefresh}
                />
              </View>
            </View>
          ) : undefined
        }
      />
      <Modal
        visible={filters !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setFilters(null)}
      >
        <View style={s.overlay}>
          <Pressable
            accessibilityLabel="关闭筛选"
            accessibilityRole="button"
            style={s.backdrop}
            onPress={() => setFilters(null)}
          />
          <SafeAreaView edges={["bottom"]} style={s.sheet}>
            <View style={s.header}>
              <Text style={s.heading}>筛选作品</Text>
              <Link label="取消" onPress={() => setFilters(null)} />
            </View>
            <ScrollView contentContainerStyle={s.sheetContent}>
              <Text style={s.title}>作者状态</Text>
              <View style={s.options}>
                {(
                  [
                    ["all", "全部作者状态"],
                    ["shown", "作者未隐藏"],
                    ["hidden", "作者已隐藏"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{
                      checked: filters?.visibility === value,
                    }}
                    onPress={() =>
                      setFilters((old) => old && { ...old, visibility: value })
                    }
                    style={[
                      s.option,
                      filters?.visibility === value && s.selected,
                    ]}
                  >
                    <Text style={s.optionText}>{value === "all" ? "全部" : label.replace("作者", "")}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.title}>平台状态</Text>
              <View style={s.options}>
                {(
                  [
                    ["all", "全部平台状态"],
                    ["unrestricted", "未受限"],
                    ["restricted", "受限"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{
                      checked: filters?.restriction === value,
                    }}
                    onPress={() =>
                      setFilters((old) => old && { ...old, restriction: value })
                    }
                    style={[
                      s.option,
                      filters?.restriction === value && s.selected,
                    ]}
                  >
                    <Text style={s.optionText}>{value === "all" ? "全部" : label.replace("作者", "")}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={s.sheetActions}>
                <Link
                  label="重置"
                  onPress={() =>
                    setFilters({ ...emptyCatalogQuery(), q: filters?.q ?? "" })
                  }
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="应用筛选"
                  onPress={() => filters && apply(filters)}
                  style={s.primary}
                >
                  <Text style={s.primaryText}>应用筛选</Text>
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  screen: {
    flex: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    backgroundColor: t.surface,
  },
  header: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heading: { fontSize: 18, lineHeight: 26, fontWeight: "600", color: t.ink },
  linkButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  link: { color: t.brand, fontSize: 14, lineHeight: 22 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 8,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    backgroundColor: t.background,
    borderRadius: 12,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: t.ink,
    fontSize: 14,
    lineHeight: 22,
  },
  shortcuts: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  applied: {
    paddingLeft: 24,
    paddingRight: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  meta: { color: t.muted, fontSize: 12, lineHeight: 20, flexShrink: 1 },
  list: { flexGrow: 1, paddingBottom: 24 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 104,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  titleRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  title: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    color: t.ink,
  },
  chevron: { color: t.muted, fontSize: 18, lineHeight: 26 },
  metrics: { color: t.secondary, fontSize: 12, lineHeight: 20 },
  pressed: { backgroundColor: t.background },
  disabled: { opacity: 0.4 },
  empty: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 16,
    alignItems: "center",
  },
  notice: { paddingHorizontal: 24, paddingVertical: 8 },
  error: { color: t.danger, fontSize: 12, lineHeight: 20 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#00000050",
  },
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "80%",
  },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 16 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: t.background,
    borderWidth: 1,
    borderColor: t.line,
  },
  selected: { backgroundColor: t.selected, borderColor: t.brand },
  optionText: { fontSize: 14, lineHeight: 22, color: t.ink },
  sheetActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  primary: {
    flex: 1,
    minHeight: 44,
    padding: 12,
    alignItems: "center",
    backgroundColor: t.brand,
    borderRadius: 8,
  },
  primaryText: {
    fontSize: 16,
    lineHeight: 24,
    color: "white",
    fontWeight: "600",
  },
});
