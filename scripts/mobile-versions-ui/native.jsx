import React, { forwardRef, useImperativeHandle } from "react";
export * from "../mobile-comments-ui/native.jsx";
export const BackHandler = { addEventListener: () => ({ remove() {} }) };
export const ScrollView = forwardRef(function Scroll({ children }, ref) {
  useImperativeHandle(ref, () => ({ scrollTo: () => { window.readerTest.scrolls++; } }), []);
  return <div>{children}</div>;
});
