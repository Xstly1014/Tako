import { useEffect } from "react";
export const router = { canGoBack: () => false, back() {}, replace() {}, push() {} };
export const useFocusEffect = (callback) => useEffect(callback, [callback]);
export const useLocalSearchParams = () => ({ id: "11111111-1111-4111-8111-111111111111" });
export const usePreventRemove = () => {};
