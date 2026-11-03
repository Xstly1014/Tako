import { useEffect } from "react";
export const router = {
  push: (path) => {
    window.authorUi.lastPush = path;
    if (!window.authorUi.holdNavigation)
      window.authorUi.navigate(typeof path === "string" ? path : path.pathname);
  },
  replace: (path) => window.authorUi.navigate(path),
  dismissTo: (path) => window.authorUi.navigate(path),
  canGoBack: () => true,
  back: () => window.authorUi.navigate("/account"),
};
export function useFocusEffect(callback) {
  useEffect(callback, [callback]);
}
export function usePreventRemove(blocked) {
  useEffect(() => {
    window.authorUi.blocked = blocked;
  }, [blocked]);
}
