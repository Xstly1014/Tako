// Browser adapter for actual chapter routes. Real SQLite/AES is covered in models.
import { session } from "./context.jsx";
import { cipher,fixtureHttp } from "./tools.jsx";
import { ChapterStorage } from "../../mobile/src/novels/chapters/storage.ts";
import { chapterDraftsApi } from "../../mobile/src/novels/chapters/api.ts";
import { AuthorizedDrafts } from "../../mobile/src/drafts/authorized.ts";
import { DraftSynchronizer } from "../../mobile/src/drafts/sync.ts";
const records=new Map();let chain=Promise.resolve();
const rows={read:async(o,k)=>records.get(o+"/"+k)??null,ids:async o=>[...records.keys()].filter(k=>k.startsWith(o+"/")).map(k=>k.slice(o.length+1)),update(o,k,fn){const task=chain.then(async()=>{records.set(o+"/"+k,await fn(records.get(o+"/"+k)??null));});chain=task.catch(()=>undefined);return task;}};
const db=new ChapterStorage(rows,cipher);
export const localChapterBooks=async current=>db.books(current().drafts.owner);
export const cacheChapterBook=async(current,book)=>db.cacheBook(current().drafts.owner,book);
export const pendingChapterDraftCount=async current=>db.pending(current().drafts.owner);
const tools=new Map();
export function nativeChapterTools(_session,book){
 if(tools.has(book))return tools.get(book);
 const repo=db.repository(book),api=chapterDraftsApi(fixtureHttp,book),identity=()=>({owner:session.snapshot().drafts.owner,generation:session.snapshot().generation,online:window.draftUi.online&&session.snapshot().drafts.phase==="online"});
 const sync=new DraftSynchronizer(repo,api,identity,()=>crypto.randomUUID());
 const value={channel:"chapter",local:new AuthorizedDrafts(async()=>repo,session.snapshot),api,current:session.snapshot,online:async()=>window.draftUi.online&&await session.reconnectDrafts(),uuid:()=>crypto.randomUUID(),sync:id=>sync.sync(session.snapshot().drafts.owner,id)};
 tools.set(book,value);return value;
}
