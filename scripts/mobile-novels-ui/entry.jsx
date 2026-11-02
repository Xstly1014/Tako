import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {BooksWorkspace} from "../../mobile/src/novels/NovelsScreen.tsx";
import {NovelsApi} from "../../mobile/src/api/novels.ts";
import {ApiError} from "../../mobile/src/api/client.ts";
import {RouteContext} from "../mobile-drafts-ui/router.jsx";
let pending=null;
const books=new Map(),receipts=new Map();
window.bookUi={posts:0,drop:false,conflict:false,failRead:false,remount:null,books};
window.draftUi={history:[],route:"/novels",navigate:()=>{window.bookUi.left=true;}};
const api=new NovelsApi(async(path,options={})=>{
 if(options.method==="POST"){
  window.bookUi.posts++;
  if(window.bookUi.conflict)throw new ApiError("novel_revision_conflict","",409);
  const input=options.body,id=path==="/my/novels"?crypto.randomUUID():path.split("/").at(-1);
  const book={id,title:input.title,introduction:input.introduction,tags:input.tags,revision:input.base_revision+1,created_at:new Date().toISOString(),saved_at:new Date().toISOString()};
  books.set(id,book);receipts.set(input.mutation_id,book);
  if(window.bookUi.drop){window.bookUi.drop=false;throw new ApiError("network");}return book;
 }
 if(path.startsWith("/my/novel-mutations/")){const receipt=receipts.get(path.split("/").at(-1));if(!receipt)throw new ApiError("resource_not_found","",404);return receipt;}
 if(path==="/my/novels")return {items:[...books.values()],next_cursor:""};
 if(window.bookUi.failRead)throw new ApiError("network");
 return books.get(path.split("/").at(-1));
});
const journal={async load(){return pending;},async save(value){pending=value;}};
const current=()=>true,uuid=()=>crypto.randomUUID();
function Harness(){const [key,setKey]=useState(0);window.bookUi.remount=()=>setKey(x=>x+1);return <RouteContext.Provider value="/novels"><BooksWorkspace key={key} api={api} journal={journal} current={current} uuid={uuid}/></RouteContext.Provider>;}
createRoot(document.getElementById("root")).render(<Harness/>);
