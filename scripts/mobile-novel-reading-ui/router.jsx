import {useEffect} from "react";
const path = value => typeof value === "string" ? value : value.pathname === "/novel-chapter" ? "/novel-chapter?" + new URLSearchParams(value.params) : value.pathname.replace("[id]",value.params.id);
export const router={replace:value=>window.novelTest.navigate(path(value)),push:value=>window.novelTest.navigate(path(value)),dismissTo:value=>window.novelTest.navigate(path(value)),navigate:value=>window.novelTest.navigate(path(value))};
export function useLocalSearchParams(){const url=new URL(window.novelTest.route,"http://fixture");return {id:url.pathname.split("/").pop(),...Object.fromEntries(url.searchParams)}};

export function useFocusEffect(fn){useEffect(()=>fn(),[fn]);}

// Navigation blocking is a native-device gate; these reading fixtures do not certify it.
export function usePreventRemove(){return ()=>{}}
