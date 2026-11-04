import {useEffect} from 'react';
const path=v=>typeof v==='string'?v:v.pathname==='/novel-chapter'?'/novel-chapter?'+new URLSearchParams(v.params):v.pathname.replace('[id]',v.params.id);
export const router={push:v=>window.readLive.open(path(v)),replace:v=>window.readLive.open(path(v)),dismissTo:v=>window.readLive.open(path(v))};
export function useLocalSearchParams(){const u=new URL(window.readLive.route,'http://fixture');return {id:u.pathname.split('/').pop(),...Object.fromEntries(u.searchParams)}};
export function useFocusEffect(fn){useEffect(()=>fn(),[fn]);}
