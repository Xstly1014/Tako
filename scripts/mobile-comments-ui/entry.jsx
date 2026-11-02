import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CommentsPanel,
  MyCommentList,
} from "../../mobile/src/components/CommentsPanel.tsx";
import { session, work } from "./context.jsx";
function App() {
  const [visible, setVisible] = useState(true),
    [mine, setMine] = useState(false);
  window.componentTest.showMine = () => setMine(true);
  return mine ? (
    <MyCommentList />
  ) : (
    <>
      <button onClick={() => setVisible(true)}>测试打开评论</button>
      <CommentsPanel
        workId={work}
        context="fixture-context"
        visible={visible}
        onClose={() => setVisible(false)}
        onDirtyChange={(value) => {
          window.componentTest.dirty = value;
        }}
      />
    </>
  );
}
await session.restore();
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
