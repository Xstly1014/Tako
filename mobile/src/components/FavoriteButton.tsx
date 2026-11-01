import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import { useSession } from "../auth/context";
import { ApiError, apiMessage } from "../api/client";
import {
  checkedState,
  type FavoriteState,
  type FavoriteChange,
} from "../api/favorites";
import { AuthSheet } from "./AuthSheet";
import { Icon } from "./PrototypeUi";
import { theme as t } from "../theme";
export function FavoriteButton({
  workId,
  disabled = false,
  cancelOnly = false,
  onChanged,
}: {
  workId: string;
  disabled?: boolean;
  cancelOnly?: boolean;
  onChanged?: () => void;
}) {
  const auth = useSession();
  return (
    <FavoriteControl
      key={`${auth.generation}:${workId}`}
      workId={workId}
      disabled={disabled}
      cancelOnly={cancelOnly}
      onChanged={onChanged}
    />
  );
}
function FavoriteControl({
  workId,
  disabled,
  cancelOnly,
  onChanged,
}: {
  workId: string;
  disabled: boolean;
  cancelOnly: boolean;
  onChanged?: () => void;
}) {
  const { session, phase, account, busy: sessionBusy } = useSession();
  const [state, setState] = useState<FavoriteState>(),
    [busy, setBusy] = useState(false),
    [sheet, setSheet] = useState(false),
    [error, setError] = useState<unknown>();
  const pending = useRef<FavoriteChange | null>(null),
    alive = useRef(true),
    lock = useRef(false);
  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      const controller = new AbortController();
      if (phase === "ready")
        session
          .authorized<FavoriteState>(`/my/favorites/${workId}`, {
            signal: controller.signal,
          })
          .then(checkedState)
          .then((value) => {
            if (!controller.signal.aborted) {
              setState(value);
              setError(undefined);
            }
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e);
          });
      return () => {
        alive.current = false;
        controller.abort();
      };
    }, [phase, session, workId]),
  );
  const change = async () => {
    if (disabled || lock.current || sessionBusy) return;
    if (phase !== "ready") {
      setSheet(true);
      return;
    }
    lock.current = true;
    setBusy(true);
    const refreshOnly = !!error && !pending.current;
    setError(undefined);
    let confirmed = false;
    try {
      if (refreshOnly) {
        const current = checkedState(
          await session.authorized<FavoriteState>(`/my/favorites/${workId}`),
        );
        if (alive.current) setState(current);
        return;
      }
      const current =
        state ??
        checkedState(
          await session.authorized<FavoriteState>(`/my/favorites/${workId}`),
        );
      if (!account) throw new ApiError("stale_session");
      if (cancelOnly && !current.favorite && !pending.current) {
        onChanged?.();
        return;
      }
      pending.current ??= {
        mutation_id: Crypto.randomUUID(),
        expected_account_id: account.id,
        expected_revision: current.revision,
        favorite: cancelOnly ? false : !current.favorite,
      };
      checkedState(
        await session.authorized<FavoriteState>(`/my/favorites/${workId}`, {
          method: "POST",
          body: pending.current,
        }),
      );
      confirmed = true;
      pending.current = null;
      const currentState = checkedState(
        await session.authorized<FavoriteState>(`/my/favorites/${workId}`),
      );
      if (alive.current) {
        setState(currentState);
        onChanged?.();
      }
    } catch (e) {
      if (
        e instanceof ApiError &&
        [400, 401, 403, 404, 409].includes(e.status)
      ) {
        pending.current = null;
        if (e.status === 409)
          session
            .authorized<FavoriteState>(`/my/favorites/${workId}`)
            .then(checkedState)
            .then((value) => {
              if (alive.current) setState(value);
            })
            .catch(() => undefined);
      }
      if (alive.current) {
        if (confirmed) setState(undefined);
        setError(e);
        Alert.alert(
          confirmed ? "操作已确认" : "收藏未确认",
          (confirmed ? "当前收藏状态未能刷新。" : "") +
            apiMessage(e) +
            " 可再次点击检查或重试。",
          [{ text: "关闭" }],
        );
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          error
            ? "检查收藏状态"
            : state?.favorite || cancelOnly
              ? "取消收藏"
              : "收藏作品"
        }
        accessibilityState={{
          disabled: disabled || busy || sessionBusy,
          selected: state?.favorite,
        }}
        disabled={disabled || busy || sessionBusy}
        onPress={() => void change()}
        style={({ pressed }) => ({
          width: 36,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.35 : pressed ? 0.5 : 1,
        })}
      >
        {busy ? (
          <ActivityIndicator size="small" color={t.brand} />
        ) : (
          <Icon
            name="star"
            size={20}
            color={state?.favorite ? t.brand : t.muted}
          />
        )}
      </Pressable>
      <AuthSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        onComplete={() => setSheet(false)}
      />
    </>
  );
}
