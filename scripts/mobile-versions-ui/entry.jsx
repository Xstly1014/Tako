import React from "react";
import { createRoot } from "react-dom/client";
import Reader from "../../mobile/src/screens/ReaderScreen.tsx";
import { session } from "../mobile-comments-ui/context.jsx";
window.readerTest = { scrolls: 0 };
await session.restore();
createRoot(document.getElementById("root")).render(<React.StrictMode><Reader /></React.StrictMode>);
