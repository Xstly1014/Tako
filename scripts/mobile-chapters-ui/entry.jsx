import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import Novels from "../../mobile/src/app/novels.tsx";
import ChapterDrafts from "../../mobile/src/app/novel-drafts.tsx";
import ChapterEditor from "../../mobile/src/app/chapter-edit.tsx";
import Drafts from "../../mobile/src/app/drafts/index.tsx";
import {session} from "../mobile-drafts-ui/context.jsx";
import {RouteContext} from "../mobile-drafts-ui/router.jsx";
import {nativeDraftTools,fixtureHttp} from "../mobile-drafts-ui/tools.jsx";
import {ApiError} from "../../mobile/src/api/client.ts";
const book={id:"a1111111-1111-4111-8111-111111111111",title:"合成连载",introduction:"合成简介",tags:["冒险"],revision:1,created_at:new Date().toISOString(),saved_at:new Date().toISOString()};
const server=new Map(),receipts=new Map(),requests=[];
window.chapterUi={book,server,requests,drop:false,restart:null,original:null,advance(){const current=server.get(window.chapterUi.original);server.set(current.id,{...current,title:"服务器另端章节",content:"服务器另端文字",revision:current.revision+1});},async http(path,options={}){
 const owner=session.snapshot().account?.id==="22222222-2222-4222-8222-222222222222";
 if(path==="/my/novels")return {items:owner?[book]:[],next_cursor:""};
 if(!owner||!path.startsWith("/my/novels/"+book.id))throw new ApiError("resource_not_found","",404);
 if(path==="/my/novels/"+book.id)return book;
 const root="/my/novels/"+book.id+"/chapter-drafts";
 if(options.method!=="POST"){
  if(path===root||path.startsWith(root+"?"))return {items:[...server.values()].map(v=>({...v,created_at:v.saved_at,recovered_from:v.from??null})),next_cursor:""};
  const draft=server.get(path.split("/").at(-1));if(!draft)throw new ApiError("draft_not_found","",404);const {from,...value}=draft;return value;
 }
 const body=options.body,op=path.split("/").at(-1);requests.push({path,mutation:body.mutation_id});
 const previous=receipts.get(body.mutation_id);if(previous)return previous;
 let result;
 if(op==="save"){
  const old=server.get(body.draft_id);if(!old)throw new ApiError("draft_not_found","",404);if(old.revision!==body.base_revision)throw new ApiError("revision_conflict","",409);
  result={draft_id:old.id,revision:old.revision+1,saved_at:new Date().toISOString()};server.set(old.id,{...old,title:body.title,content:body.content,revision:result.revision,saved_at:result.saved_at});
 }else{
  if(op==="recover"&&!server.has(body.draft_id))throw new ApiError("draft_not_found","",404);
  result={draft_id:crypto.randomUUID(),revision:1,saved_at:new Date().toISOString()};server.set(result.draft_id,{id:result.draft_id,title:body.title,content:body.content,revision:1,saved_at:result.saved_at,from:op==="recover"?body.draft_id:null});
 }
 receipts.set(body.mutation_id,result);if(window.chapterUi.drop){window.chapterUi.drop=false;throw new ApiError("network");}return result;
}};
window.draftUi={session,history:[],route:"/novels",listeners:new Set(),online:false,failStore:false,blocked:false,drop:false,tools:nativeDraftTools(),journal:new Map(),http:fixtureHttp};
function Harness(){const [route,setRoute]=useState(window.draftUi.route),[version,setVersion]=useState(0);window.draftUi.navigate=setRoute;window.chapterUi.restart=()=>setVersion(v=>v+1);return <RouteContext.Provider value={route}><div key={version}>{route==="/novels"?<Novels/>:route.startsWith("/novel-drafts")?<ChapterDrafts/>:route.startsWith("/chapter-edit")?<ChapterEditor/>:route==="/drafts"?<Drafts/>:null}</div></RouteContext.Provider>;}
(async()=>{await session.restore();await session.signIn("login","a@example.test","fixture-password");await session.confirmDraftAccess();createRoot(document.getElementById("root")).render(<Harness/>);})();
