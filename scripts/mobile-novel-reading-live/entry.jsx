import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {NovelDirectoryScreen,NovelChapterScreen,NovelCommunityScreen,NovelSearchScreen} from "../../mobile/src/novels/PublicReadingScreens.tsx";
import {ShelfScreen} from "../../mobile/src/novels/ShelfScreen.tsx";
import {NovelNoticesScreen,NovelNoticeDetailScreen} from "../../mobile/src/novels/NoticeScreens.tsx";
import AuthorChapterComments from "../../mobile/src/app/novel-comments.tsx";
import MyComments from "../../mobile/src/app/my-comments.tsx";
import Account from "../../mobile/src/app/account.tsx";
import {Session} from "../../mobile/src/auth/session.ts";
import {request} from "../../mobile/src/api/client.ts";
import {session} from "../mobile-author-works-ui/context.jsx";
window.readLive={session,route:"",records:new Map()};
window.readLive.setup=async()=>{
 const owner=new Session({get:async()=>null,set:async()=>{},remove:async()=>{}},request);
 window.readLive.owner=owner;
 window.readLive.ownerCredentials={email:"reading-owner-"+crypto.randomUUID()+"@example.test",password:crypto.randomUUID()};await owner.signIn("register",window.readLive.ownerCredentials.email,window.readLive.ownerCredentials.password);await owner.setNickname("续读联调作者");
 window.readLive.searchKeyword='合成作品-'+crypto.randomUUID();
 const book=await owner.authorized('/my/novels',{method:'POST',body:{mutation_id:crypto.randomUUID(),base_revision:0,title:'续读真实链路合成书',introduction:window.readLive.searchKeyword,tags:['日常']}});
 window.readLive.book=book.id;
 const draft=await owner.authorized(`/my/novels/${book.id}/chapter-drafts/create`,{method:'POST',body:{mutation_id:crypto.randomUUID(),title:'续读第一章',content:Array.from({length:20},(_,i)=>`第${i+1}段 合成中文与表情😀。`).join('\n')}});
 window.readLive.draft=draft.draft_id;
 const preview=await owner.authorized(`/my/novels/${book.id}/chapter-previews`,{method:'POST',body:{mutation_id:crypto.randomUUID(),draft_id:draft.draft_id,source_revision:draft.revision,book_revision:book.revision}});
 const receipt=await owner.authorized(`/my/novels/${book.id}/chapter-submissions`,{method:'POST',body:{mutation_id:crypto.randomUUID(),preview_id:preview.preview_id,rights_confirmed:true}});
 await session.signIn('register','reading-reader-'+crypto.randomUUID()+'@example.test',crypto.randomUUID());await session.setNickname('续读合成读者');
 window.readLive.owner=owner;window.readLive.book=book.id;window.readLive.chapter=receipt.chapter_id;window.readLive.readerA=session.snapshot().account.id;window.readLive.open('/novel/'+book.id);
};
function Harness(){
 const [route,setRoute]=useState(''),[epoch,setEpoch]=useState(0),[searchMounted,setSearchMounted]=useState(false);
 window.readLive.open=next=>{window.readLive.route=next;setRoute(next);setEpoch(n=>n+1);if(next==='/novel-search')setSearchMounted(true);if(next==='/novel-community')setSearchMounted(false)};
 // Model the search screen staying mounted underneath a pushed directory route.
 const content=route==='/novel-community'?<NovelCommunityScreen key={epoch}/>:route.startsWith('/novel-comments')?<AuthorChapterComments key={epoch}/>:route==='/my-comments'?<MyComments key={epoch}/>:route==='/notices'?<NovelNoticesScreen key={epoch}/>:route.startsWith('/notice/')?<NovelNoticeDetailScreen key={epoch}/>:route==='/account'?<Account key={epoch}/>:route.startsWith('/shelf')?<ShelfScreen key={epoch}/>:route.startsWith('/novel-chapter')?<NovelChapterScreen key={epoch}/>:route?<NovelDirectoryScreen key={epoch}/>:<p>准备真实续读链路</p>;
 return <>{searchMounted?<div hidden={route!=='/novel-search'}><NovelSearchScreen/></div>:null}{route==='/novel-search'?null:content}</>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);
