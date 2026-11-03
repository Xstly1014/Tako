import React, { forwardRef, useImperativeHandle } from "react";
export * from "../mobile-comments-ui/native.jsx";
export const BackHandler = { addEventListener: () => ({ remove() {} }) };
export const Keyboard = { dismiss() {} };
export const Linking = {
  openURL: async () => {
    throw new Error("external_contact_disabled_in_test");
  },
};
export const ScrollView = forwardRef(function Scroll({ children }, ref) {
  useImperativeHandle(ref, () => ({ scrollTo() {} }), []);
  return <div>{children}</div>;
});
