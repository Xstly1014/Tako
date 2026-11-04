import {useEffect} from "react";
export const router={replace:value=>window.novelLive.target=value,push:value=>window.novelLive.target=value,dismissTo:value=>window.novelLive.target=value};
export const useLocalSearchParams=()=>window.novelLive.source;

export const usePreventRemove=()=>{};

export function useFocusEffect(callback){useEffect(()=>callback(),[callback]);}
