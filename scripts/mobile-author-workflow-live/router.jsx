// Navigation observation adapter: preserve stack entries and dispatch focus.
// It is deliberately not evidence of Expo's native navigator implementation.
import { createContext, useContext, useEffect } from "react";
export const PageScope = createContext({ key: "", focused: false, params: {} });
export const guards = new Map();
export const router = {
  push: (target) => window.authorWorkflow.navigate("push", target),
  replace: (target) => window.authorWorkflow.navigate("replace", target),
  dismissTo: (target) => window.authorWorkflow.navigate("dismissTo", target),
  back: () => window.authorWorkflow.navigate("back"),
  canGoBack: () => window.authorWorkflow.stack.length > 1,
};
export const useLocalSearchParams = () => useContext(PageScope).params;
export function useFocusEffect(callback) {
  const { focused } = useContext(PageScope);
  useEffect(() => (focused ? callback() : undefined), [callback, focused]);
}
export function usePreventRemove(blocked, callback) {
  const { key } = useContext(PageScope);
  useEffect(() => {
    if (blocked) guards.set(key, callback);
    else guards.delete(key);
    return () => guards.delete(key);
  }, [key, blocked, callback]);
}
