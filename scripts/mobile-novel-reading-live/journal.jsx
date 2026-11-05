import {ApiError} from '../../mobile/src/api/client.ts';
export function nativeReadingJournal(session,book){
 const initial=session.snapshot(),owner=initial.account?.id??(initial.phase==='offline'?initial.localOwner:null),key=owner+':'+book;
 const current=()=>(session.snapshot().account?.id??(session.snapshot().phase==='offline'?session.snapshot().localOwner:null))===owner&&session.snapshot().generation===initial.generation&&!session.snapshot().busy;
 return {async load(){if(!current())throw new ApiError('stale_session');return structuredClone(window.readLive.records.get(key)??null)},async save(v,token){if(!current())throw new ApiError('stale_session');const old=window.readLive.records.get(key);if((old?.token??null)!==token)throw new ApiError('reading_local_conflict');if(v===null)window.readLive.records.delete(key);else window.readLive.records.set(key,structuredClone(v))}};
}

export function nativeShelfJournal(session){const initial=session.snapshot(),owner=initial.account.id,key="shelf:"+owner;const current=()=>{const now=session.snapshot();if(now.account?.id!==owner||now.generation!==initial.generation||now.phase!=="ready"||now.busy)throw new ApiError("stale_session")};return {async load(){current();return structuredClone(window.readLive.records.get(key)??null)},async save(v,token){current();const old=window.readLive.records.get(key);if((old?.token??null)!==token)throw new ApiError("novel_request_pending");if(v===null)window.readLive.records.delete(key);else window.readLive.records.set(key,structuredClone(v))}};}
