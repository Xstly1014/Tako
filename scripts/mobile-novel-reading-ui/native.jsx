import React from "react";
export * from "../mobile-comments-ui/native.jsx";
export function FlatList({data,renderItem,keyExtractor,ListHeaderComponent,ListEmptyComponent,ListFooterComponent,onRefresh}) {
 return <div>{ListHeaderComponent}<button aria-label="下拉刷新" onClick={onRefresh}>刷新</button>{data.length?data.map((item,index)=><div key={keyExtractor(item,index)}>{renderItem({item,index})}</div>):ListEmptyComponent}{ListFooterComponent}</div>;
}

export const AppState={currentState:"active",addEventListener:()=>({remove(){}})};
