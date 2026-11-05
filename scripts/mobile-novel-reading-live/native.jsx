import React,{forwardRef,useImperativeHandle} from 'react';
export {View,Text,Pressable,TextInput,StyleSheet,SafeAreaView,ScrollView,Image,ActivityIndicator,Modal,Share} from '../mobile-novel-publication-live/native.jsx';
export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};
export const FlatList=forwardRef(function List({data,renderItem,keyExtractor,ListHeaderComponent,ListFooterComponent,ListEmptyComponent,onViewableItemsChanged,onScrollBeginDrag,contentContainerStyle},ref){
 useImperativeHandle(ref,()=>({scrollToIndex({index}){window.readLive.restoredIndex=index},scrollToOffset(){}}),[]);
 return <div style={{overflow:'auto',padding:24}}>{ListHeaderComponent}{data.length?data.map((item,index)=><div key={keyExtractor(item,index)}>{onViewableItemsChanged?<button aria-label={'模拟稳定阅读段落 '+index} onClick={()=>{onScrollBeginDrag?.();onViewableItemsChanged({viewableItems:[{item,index,isViewable:true}],changed:[]})}}>模拟稳定阅读</button>:null}{renderItem({item,index})}</div>):ListEmptyComponent}{ListFooterComponent}</div>;
});

export {KeyboardAvoidingView,Platform,Alert} from "../mobile-comments-ui/native.jsx";
