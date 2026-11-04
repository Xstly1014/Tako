import React,{useMemo,useState} from "react";
import {createRoot} from "react-dom/client";
import Management from "../../mobile/src/novels/NovelManagementScreen.tsx";
import {PublicationWorkspace} from "../../mobile/src/publication/PublicationWorkspace.tsx";
import {WorkSubmissionNodes} from "../../mobile/src/publication/WorkSubmissionNodes.tsx";
import WorkSubmissionsScreen from "../../mobile/src/publication/WorkSubmissionsScreen.tsx";
import {useSession} from "../mobile-author-works-ui/context.jsx";
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

function Middle(){const {account,generation}=useSession();const store=useMemo(()=>({get:async()=>window.novelLive.records.get('middle:'+account.id)??null,set:async v=>window.novelLive.records.set('middle:'+account.id,v),remove:async()=>window.novelLive.records.delete('middle:'+account.id)}),[account.id]);return <PublicationWorkspace store={store} accountId={account.id} generation={generation} draftId={window.novelLive.middleWork?undefined:window.novelLive.middleDraft} workId={window.novelLive.middleWork} revision={window.novelLive.middleWork?0:1}/>}
function Harness(){const [mounted,setMounted]=useState(false),[generation,setGeneration]=useState(0),[mode,setMode]=useState('chapter');window.novelLive.mount=()=>{setMounted(true);setGeneration(n=>n+1)};const show=mode=>{setMode(mode);setMounted(true);setGeneration(n=>n+1)};window.novelLive.openPublisher=()=>show('chapter');window.novelLive.openManagement=()=>show('management');window.novelLive.openMiddle=()=>show('middle');window.novelLive.openSubmissions=()=>show('submissions');window.novelLive.openNodes=()=>show('nodes');return mounted?mode==='management'?<Management key={generation}/>:mode==='middle'?<Middle key={generation}/>:mode==='nodes'?<WorkSubmissionNodes key={generation} work={window.novelLive.source.work}/>:mode==='submissions'?<WorkSubmissionsScreen key={generation}/>:<Screen key={generation}/>:<p>准备真实联调</p>}
createRoot(document.getElementById("root")).render(<React.StrictMode><Harness/></React.StrictMode>);
