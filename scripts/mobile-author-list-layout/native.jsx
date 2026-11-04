// Styled DOM projection for geometry checks only; not a native runtime.
import React from "react";
function css(style) {
  const out = Object.assign(
    {},
    ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean),
  );
  for (const prefix of ["padding", "margin"]) {
    for (const [axis, sides] of [
      ["Horizontal", ["Left", "Right"]],
      ["Vertical", ["Top", "Bottom"]],
    ]) {
      const key = prefix + axis;
      if (out[key] !== undefined) {
        for (const side of sides) out[prefix + side] = out[key];
        delete out[key];
      }
    }
  }
  if (out.borderWidth !== undefined || out.borderBottomWidth !== undefined) {
    out.borderStyle = "solid";
    if (out.borderWidth === undefined) {
      out.borderTopWidth = 0;
      out.borderLeftWidth = 0;
      out.borderRightWidth = 0;
    }
  }
  if (typeof out.lineHeight === "number") out.lineHeight += "px";
  return out;
}
const flex = { display: "flex", flexDirection: "column", minWidth: 0 };
export const View = ({ children, style }) => (
  <div style={{ ...flex, ...css(style) }}>{children}</div>
);
export const Text = ({
  children,
  style,
  numberOfLines,
  accessibilityLiveRegion,
}) => (
  <span
    aria-live={accessibilityLiveRegion}
    style={{
      display: "block",
      ...(numberOfLines
        ? {
            overflow: "hidden",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: numberOfLines,
          }
        : {}),
      ...css(style),
    }}
  >
    {children}
  </span>
);
export const Pressable = ({
  children,
  style,
  onPress,
  disabled,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
}) => (
  <button
    aria-label={accessibilityLabel}
    role={accessibilityRole === "radio" ? "radio" : undefined}
    aria-checked={
      accessibilityRole === "radio" ? accessibilityState?.checked : undefined
    }
    disabled={disabled}
    onClick={onPress}
    style={{
      ...flex,
      border: 0,
      padding: 0,
      background: "transparent",
      font: "inherit",
      textAlign: "left",
      flexShrink: 0,
      ...css(typeof style === "function" ? style({ pressed: false }) : style),
    }}
  >
    {children}
  </button>
);
export const TextInput = ({
  value,
  onChangeText,
  onSubmitEditing,
  accessibilityLabel,
  style,
  placeholder,
}) => (
  <input
    aria-label={accessibilityLabel}
    value={value}
    onChange={(e) => onChangeText(e.target.value)}
    onKeyDown={(e) => e.key === "Enter" && onSubmitEditing?.()}
    placeholder={placeholder}
    style={{
      border: 0,
      background: "transparent",
      font: "inherit",
      ...css(style),
    }}
  />
);
export const ScrollView = ({ children, contentContainerStyle }) => (
  <div style={{ ...flex, overflow: "auto", ...css(contentContainerStyle) }}>
    {children}
  </div>
);
export const SafeAreaView = View;
export const FlatList = ({
  data,
  renderItem,
  keyExtractor,
  ListEmptyComponent,
  ListFooterComponent,
  contentContainerStyle,
}) => (
  <div data-list style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
    <div style={{ ...flex, minHeight: "100%", ...css(contentContainerStyle) }}>
      {data.length
        ? data.map((item) => (
            <React.Fragment key={keyExtractor(item)}>
              {renderItem({ item })}
            </React.Fragment>
          ))
        : ListEmptyComponent}
      {ListFooterComponent}
    </div>
  </div>
);
export const RefreshControl = () => null;
export const Modal = ({ visible, children }) =>
  visible ? (
    <div role="dialog" style={{ ...flex, position: "fixed", inset: 0 }}>
      {children}
    </div>
  ) : null;
export const StyleSheet = { create: (x) => x, hairlineWidth: 1 };
