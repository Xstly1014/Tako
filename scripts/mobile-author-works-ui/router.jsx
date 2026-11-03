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
  useEffect(() => {
    let cleanup = callback();
    const blur = () => { cleanup?.(); cleanup = undefined; };
    const focus = () => { blur(); cleanup = callback(); };
    window.addEventListener('author-blur', blur);
    window.addEventListener('author-focus', focus);
    return () => { blur(); window.removeEventListener('author-blur', blur); window.removeEventListener('author-focus', focus); };
  }, [callback]);
}
export function usePreventRemove(blocked) {
  useEffect(() => {
    window.authorUi.blocked = blocked;
  }, [blocked]);
}
