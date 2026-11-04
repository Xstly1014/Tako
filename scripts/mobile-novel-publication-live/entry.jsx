import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import Management from "../../mobile/src/novels/NovelManagementScreen.tsx";
import Screen from "../../mobile/src/novels/chapters/ChapterPublishScreen.tsx";
import {session} from "../mobile-author-works-ui/context.jsx";
import {NovelsApi} from "../../mobile/src/api/novels.ts";
import {NovelReadingApi} from "../../mobile/src/novels/reading-api.ts";
window.novelLive={session,source:{},records:new Map(),reader:new NovelReadingApi()};
window.novelLive.setup=async()=>{
 window.novelLive.credentials={email:"novel-publish-"+crypto.randomUUID()+"@example.test",password:crypto.randomUUID()};
 await session.signIn("register",window.novelLive.credentials.email,window.novelLive.credentials.password);await session.setNickname("长文联调作者");
 const books=new NovelsApi((p,o)=>session.authorized(p,o));
 const book=await books.write(null,{mutation_id:crypto.randomUUID(),base_revision:0,title:"长文真实页面联调",introduction:"同一数据作者提交与匿名阅读",tags:["幻想"]});
 const draft=await session.authorized(`/my/novels/${book.id}/chapter-drafts/create`,{method:"POST",body:{mutation_id:crypto.randomUUID(),title:"固定第一章",content:"本次正式中文与表情😀。\n冻结正文末尾。"}});
 window.novelLive.source={book:book.id,draft:draft.draft_id,revision:"1",local:crypto.randomUUID()};window.novelLive.mount();
};
function Harness(){const [mounted,setMounted]=useState(false),[generation,setGeneration]=useState(0),[management,setManagement]=useState(false);window.novelLive.mount=()=>{setMounted(true);setGeneration(n=>n+1)};window.novelLive.openManagement=()=>{setManagement(true);setMounted(true);setGeneration(n=>n+1)};return mounted?management?<Management key={generation}/>:<Screen key={generation}/>:<p>准备真实联调</p>}
createRoot(document.getElementById("root")).render(<React.StrictMode><Harness/></React.StrictMode>);
