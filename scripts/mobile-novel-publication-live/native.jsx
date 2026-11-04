// Styled DOM projection reuses the established RN style translation. Not a native layout.
import React from "react";
export {View,SafeAreaView,ScrollView,StyleSheet} from "../mobile-author-list-layout/native.jsx";
export {Alert,ActivityIndicator,Image,Modal} from "../mobile-comments-ui/native.jsx";
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

export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityRole,accessibilityState})=><button type="button" role={accessibilityRole==="tab"?"tab":undefined} aria-selected={accessibilityRole==="tab"?accessibilityState?.selected:undefined} aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} style={{display:"flex",flexDirection:"column",border:0,padding:0,background:"transparent",font:"inherit",textAlign:"left",flexShrink:0,minWidth:0,...css(typeof style==="function"?style({pressed:false}):style)}}>{children}</button>;
export const Text=({children,style,numberOfLines,accessibilityLiveRegion})=><span aria-live={accessibilityLiveRegion} style={{display:"block",whiteSpace:"pre-wrap",...(numberOfLines?{overflow:"hidden",display:"-webkit-box",WebkitBoxOrient:"vertical",WebkitLineClamp:numberOfLines}:{}),...css(style)}}>{children}</span>;
export const TextInput=({value,onChangeText,multiline,style,editable=true,accessibilityLabel,...props})=>React.createElement(multiline?"textarea":"input",{value,disabled:!editable,"aria-label":accessibilityLabel,onChange:e=>onChangeText?.(e.target.value),style:{...css(style)},maxLength:props.maxLength});
export const FlatList=({data,renderItem,keyExtractor,ListHeaderComponent,ListEmptyComponent,ListFooterComponent,contentContainerStyle})=><div style={{flex:1,overflow:"auto",minHeight:0,minWidth:0}}><div style={{display:"flex",flexDirection:"column",minHeight:"100%",...css(contentContainerStyle)}}>{ListHeaderComponent}{data.length?data.map((item,index)=><React.Fragment key={keyExtractor(item,index)}>{renderItem({item,index})}</React.Fragment>):ListEmptyComponent}{ListFooterComponent}</div></div>;
export const Share={async share(value){if(window.novelLive.failExport)throw Error("fixture_export_failure");window.novelLive.exported=value;return {action:"sharedAction"}}};
