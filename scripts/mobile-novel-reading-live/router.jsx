import {useEffect} from 'react';
const path=v=>{if(typeof v==='string')return v;const params={...v.params};const raw=v.pathname.replace('[id]',params.id??'');if(v.pathname.includes('[id]'))delete params.id;const query=new URLSearchParams(params).toString();return raw+(query?'?'+query:'')};
const history=[];
export const router={push:v=>{history.push(window.readLive.route);window.readLive.open(path(v))},replace:v=>window.readLive.open(path(v)),dismissTo:v=>window.readLive.open(path(v)),canGoBack:()=>history.length>0,back:()=>window.readLive.open(history.pop()??'/account')};
export function useLocalSearchParams(){const u=new URL(window.readLive.route,'http://fixture');return {id:u.pathname.split('/').pop(),...Object.fromEntries(u.searchParams)}};
export function useFocusEffect(fn){useEffect(()=>fn(),[fn]);}

// Navigation blocking is a native-device gate; these reading fixtures do not certify it.
export function usePreventRemove(){return ()=>{}}
