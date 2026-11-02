import { useEffect } from "react";
const path = value => typeof value === "string" ? value : value.pathname.replace("[id]",value.params.id);
export const router = {
 canGoBack:()=>window.readerTest.history.length>0,
 back(){const next=window.readerTest.history.pop();if(next)window.readerTest.navigate(next);},
 replace(value){window.readerTest.navigate(path(value));},
 push(value){window.readerTest.history.push(window.readerTest.route);window.readerTest.navigate(path(value));}
};
export const useFocusEffect = callback => useEffect(callback,[callback]);
export const useLocalSearchParams = () => ({ id: window.readerTest.route.split("/").pop() });
export const usePreventRemove = () => {};
