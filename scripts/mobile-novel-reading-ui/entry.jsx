import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {NovelCommunityScreen,NovelDirectoryScreen,NovelChapterScreen} from "../../mobile/src/novels/PublicReadingScreens.tsx";
window.novelTest={route:"/novel-community"};
function Harness(){const [route,setRoute]=useState(window.novelTest.route);window.novelTest.navigate=next=>{window.novelTest.route=next;setRoute(next)};return route.startsWith("/novel-chapter")?<NovelChapterScreen/>:route.startsWith("/novel/")?<NovelDirectoryScreen/>:<NovelCommunityScreen/>}
createRoot(document.getElementById("root")).render(<React.StrictMode><Harness/></React.StrictMode>);
