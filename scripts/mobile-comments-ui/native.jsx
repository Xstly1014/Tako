// DOM adapters for component interaction tests only; not a mobile runtime or UI screenshot baseline.
import React, { forwardRef } from "react";
import { createRoot } from "react-dom/client";
export const View = ({ children, accessibilityLabel }) => (
  <div aria-label={accessibilityLabel}>{children}</div>
);
export const Text = ({ children }) => <span>{children}</span>;
export const Pressable = ({
  children,
  onPress,
  disabled,
  accessibilityRole,
  accessibilityLabel,
}) => (
  <button
    type="button"
    aria-label={accessibilityLabel}
    disabled={disabled}
    onClick={onPress}
  >
    {children}
  </button>
);
export const TextInput = forwardRef(function Input(
  {
    multiline,
    value,
    onChangeText,
    editable = true,
    accessibilityLabel,
    placeholder,
    secureTextEntry,
  },
  ref,
) {
  return React.createElement(multiline ? "textarea" : "input", {
    ref,
    value,
    readOnly: !editable,
    disabled: !editable,
    "aria-label": accessibilityLabel,
    placeholder,
    type: multiline ? undefined : secureTextEntry ? "password" : "text",
    onChange: (e) => onChangeText?.(e.target.value),
  });
});
export const ScrollView = View,
  KeyboardAvoidingView = View,
  SafeAreaView = View;
export const ActivityIndicator = () => <span role="status">正在加载</span>;
export const Image = () => null;
export const Modal = ({ children, visible }) =>
  visible ? <div>{children}</div> : null;
export const FlatList = ({
  data,
  renderItem,
  keyExtractor,
  ListEmptyComponent,
  ListFooterComponent,
}) => (
  <div>
    {data.length
      ? data.map((item) => (
          <div key={keyExtractor(item)}>{renderItem({ item })}</div>
        ))
      : ListEmptyComponent}
    {ListFooterComponent}
  </div>
);
export const StyleSheet = {
  create: (x) => x,
  hairlineWidth: 1,
  absoluteFill: {},
};
export const Platform = { OS: "web" };
let alertRoot;
export const Alert = {
  alert(title, message, buttons) {
    if (!alertRoot) {
      const host = document.createElement("div");
      document.body.append(host);
      alertRoot = createRoot(host);
    }
    const close = () => alertRoot.render(null);
    alertRoot.render(
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <p>{message}</p>
        {buttons.map((button, i) => (
          <button
            key={i}
            onClick={() => {
              close();
              button.onPress?.();
            }}
          >
            {button.text}
          </button>
        ))}
      </div>,
    );
  },
};
