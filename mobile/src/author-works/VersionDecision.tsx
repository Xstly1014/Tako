import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError } from "../api/client";
import {
  authorWorkMessage,
  type AuthorWorksApi,
  type WorkState,
} from "../api/author-works";
import { Status } from "../components/Ui";
import { theme as t } from "../theme";
import { readVersionPair, type VersionPair } from "./version-decision";

function Button({
  label,
  disabled = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
}
type Props = {
  api: AuthorWorksApi;
  state: WorkState;
  candidate: number;
  valid: () => boolean;
  disabled: boolean;
  canChoose: boolean;
  onChoose: () => void;
  onClose: () => void;
};
export default function VersionDecision(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return (
    <VersionDecisionRead
      key={attempt}
      {...props}
      onRetry={() => setAttempt((x) => x + 1)}
    />
  );
}
function VersionDecisionRead({
  api,
  state,
  candidate,
  valid,
  disabled,
  canChoose,
  onChoose,
  onClose,
  onRetry,
}: Props & { onRetry: () => void }) {
  const [pair, setPair] = useState<VersionPair | null>(null),
    [error, setError] = useState<unknown>();
  const [currentOpen, setCurrentOpen] = useState(false),
    [candidateOpen, setCandidateOpen] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      void readVersionPair(api, state, candidate, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted && valid()) setPair(result);
        })
        .catch((e) => {
          if (!controller.signal.aborted && valid()) setError(e);
        });
      return () => controller.abort();
    }, [api, state, candidate, valid]),
  );
  const stale =
    error instanceof ApiError && error.code === "comparison_state_changed";
  return (
    <View style={s.panel}>
      <Text style={s.heading}>
        核对当前展示指针 V{state.display_version} 与候选 V{candidate}
      </Text>
      <Text style={s.note}>
        这是本人固定正式版本，不是工作稿；隐藏或平台受限时，展示指针不代表读者可访问。核对期间不发布、不切换。
      </Text>
      {!pair ? (
        <Status
          loading={!error}
          title={error ? "版本核对未完成" : "正在读取两份固定正式版本"}
          message={
            stale
              ? "核对期间作品状态已变化。请先刷新管理状态，再重新选择候选版本。"
              : error
                ? authorWorkMessage(error)
                : undefined
          }
          {...(error && !stale
            ? {
                actionLabel: "重试核对读取",
                onRetry,
              }
            : {})}
        />
      ) : (
        <>
          <Text style={s.note}>
            标题{pair.changed.title ? "有变化" : "一致"} · 简介
            {pair.changed.introduction ? "有变化" : "一致"} · 标签
            {pair.changed.tags ? "有变化" : "一致"} · 正文
            {pair.changed.content ? "有变化" : "一致"}（精确比较，含换行与空白）
          </Text>
          <Text style={s.heading}>
            当前展示指针 V{pair.current.version} · {pair.current.title}
          </Text>
          <Text selectable style={s.body}>
            简介：{pair.current.introduction || "未填写"}
          </Text>
          <Text style={s.note}>
            标签：{pair.current.tags.join("、")} · 正文{" "}
            {[...pair.current.content].length} 字
          </Text>
          <Button
            label={currentOpen ? "收起当前指针版全文" : "展开当前指针版全文"}
            onPress={() => setCurrentOpen(!currentOpen)}
          />
          {currentOpen ? (
            <Text selectable style={s.body}>
              {pair.current.content}
            </Text>
          ) : null}
          <Text style={s.heading}>
            候选正式 V{pair.candidate.version} · {pair.candidate.title}
          </Text>
          <Text selectable style={s.body}>
            简介：{pair.candidate.introduction || "未填写"}
          </Text>
          <Text style={s.note}>
            标签：{pair.candidate.tags.join("、")} · 正文{" "}
            {[...pair.candidate.content].length} 字
          </Text>
          <Button
            label={candidateOpen ? "收起候选版全文" : "展开候选版全文"}
            onPress={() => setCandidateOpen(!candidateOpen)}
          />
          {candidateOpen ? (
            <Text selectable style={s.body}>
              {pair.candidate.content}
            </Text>
          ) : null}
          <Text style={s.note}>
            核对完成于本次状态读取。执行时服务端仍会检查竞争和限制；下一步需要再次明确确认，不会自动公开。
          </Text>
          {canChoose ? (
            <Button
              label={
                state.author_hidden
                  ? `按候选 V${candidate} 确认恢复公开`
                  : `按候选 V${candidate} 确认展示切换`
              }
              disabled={disabled}
              onPress={onChoose}
            />
          ) : (
            <Text style={s.note}>
              候选或作品存在限制，或当前状态未确认；可核对本人内容，不能据此变更展示。
            </Text>
          )}
        </>
      )}
      <Button label="结束本次版本核对" disabled={disabled} onPress={onClose} />
    </View>
  );
}
const s = StyleSheet.create({
  panel: {
    padding: 16,
    gap: 16,
    borderRadius: 8,
    backgroundColor: t.background,
  },
  heading: { color: t.ink, fontSize: 16, fontWeight: "600", lineHeight: 24 },
  note: { color: t.secondary, fontSize: 14, lineHeight: 22 },
  body: { color: t.ink, fontSize: 16, lineHeight: 24 },
  button: { minHeight: 44, padding: 8, justifyContent: "center" },
  link: { color: t.brand, fontSize: 14 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
