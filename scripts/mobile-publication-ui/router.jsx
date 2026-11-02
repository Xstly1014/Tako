import { useEffect } from "react";
export const router = {
  push: (path) =>
    window.publishUi.navigate(typeof path === "string" ? path : path.pathname),
  replace: (path) => window.publishUi.navigate(path),
  canGoBack: () => true,
  back: () => window.publishUi.navigate("/my-works"),
};
export function useLocalSearchParams() {
  return window.publishUi.params ?? {};
}
export function useFocusEffect(callback) {
  useEffect(callback, [callback]);
}
export function usePreventRemove(blocked) {
  useEffect(() => {
    window.publishUi.blocked = blocked;
  }, [blocked]);
}
