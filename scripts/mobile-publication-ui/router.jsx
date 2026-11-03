import { useEffect } from "react";
export const router = {
  push: (path) =>
    window.publishUi.navigate(typeof path === "string" ? path : path.pathname, "push"),
  replace: (path) => {
    if (typeof path !== "string") window.publishUi.params = path.params ?? {};
    window.publishUi.navigate(typeof path === "string" ? path : path.pathname, "replace");
  },
  dismissTo: (path) => window.publishUi.navigate(path, "dismissTo"),
  canGoBack: () => window.publishUi.history.length > 1,
  back: () => window.publishUi.navigate(null, "back"),
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
