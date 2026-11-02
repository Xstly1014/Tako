import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Reader from "../../mobile/src/screens/ReaderScreen.tsx";
import Search from "../../mobile/src/app/search.tsx";
import Community from "../../mobile/src/screens/CommunityScreen.tsx";
import { session } from "../mobile-comments-ui/context.jsx";
window.readerTest = { scrolls: 0, history: [], route: "/works/11111111-1111-4111-8111-111111111111" };
function Harness() {
 const [route,setRoute]=useState(window.readerTest.route),[searchMounted,mountSearch]=useState(false);
 window.readerTest.navigate=next=>{window.readerTest.route=next;if(next==="/search")mountSearch(true);if(next==="/community")mountSearch(false);setRoute(next);};
 return <>
  {route==="/community"?<Community/>:null}
  {searchMounted?<div hidden={route!=="/search"}><Search/></div>:null}
  {route.startsWith("/works/")?<Reader/>:null}
 </>;
}
await session.restore();
createRoot(document.getElementById("root")).render(<React.StrictMode><Harness /></React.StrictMode>);
