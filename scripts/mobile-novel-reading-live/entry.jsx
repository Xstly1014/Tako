import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {NovelDirectoryScreen,NovelChapterScreen} from "../../mobile/src/novels/PublicReadingScreens.tsx";
import {Session} from "../../mobile/src/auth/session.ts";
import {request} from "../../mobile/src/api/client.ts";
import {session} from "../mobile-author-works-ui/context.jsx";
window.readLive={session,route:"",records:new Map()};
window.readLive.setup=async()=>{
 const owner=new Session({get:async()=>null,set:async()=>{},remove:async()=>{}},request);
 window.readLive.owner=owner;
 await owner.signIn("register","reading-owner-"+crypto.randomUUID()+"@example.test",crypto.randomUUID());await owner.setNickname("续读联调作者");
 const book=await owner.authorized('/my/novels',{method:'POST',body:{mutation_id:crypto.randomUUID(),base_revision:0,title:'续读真实链路合成书',introduction:'只用于独立测试',tags:['日常']}});
 window.readLive.book=book.id;
 const draft=await owner.authorized(`/my/novels/${book.id}/chapter-drafts/create`,{method:'POST',body:{mutation_id:crypto.randomUUID(),title:'续读第一章',content:Array.from({length:20},(_,i)=>`第${i+1}段 合成中文与表情😀。`).join('\n')}});
 window.readLive.draft=draft.draft_id;
 const preview=await owner.authorized(`/my/novels/${book.id}/chapter-previews`,{method:'POST',body:{mutation_id:crypto.randomUUID(),draft_id:draft.draft_id,source_revision:draft.revision,book_revision:book.revision}});
 const receipt=await owner.authorized(`/my/novels/${book.id}/chapter-submissions`,{method:'POST',body:{mutation_id:crypto.randomUUID(),preview_id:preview.preview_id,rights_confirmed:true}});
 await session.signIn('register','reading-reader-'+crypto.randomUUID()+'@example.test',crypto.randomUUID());await session.setNickname('续读合成读者');
 window.readLive.owner=owner;window.readLive.book=book.id;window.readLive.chapter=receipt.chapter_id;window.readLive.readerA=session.snapshot().account.id;window.readLive.open('/novel/'+book.id);
};
function Harness(){const [route,setRoute]=useState(''),[epoch,setEpoch]=useState(0);window.readLive.open=route=>{window.readLive.route=route;setRoute(route);setEpoch(n=>n+1)};return route.startsWith('/novel-chapter')?<NovelChapterScreen key={epoch}/>:route?<NovelDirectoryScreen key={epoch}/>:<p>准备真实续读链路</p>}
createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);
