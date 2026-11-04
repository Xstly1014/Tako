import React from 'react';
export default function Svg({children,width,height,viewBox}){return <svg width={width} height={height} viewBox={viewBox} aria-hidden="true">{children}</svg>}
export const Path=p=><path {...p}/>;export const Circle=p=><circle {...p}/>;
export const Defs=({children})=><defs>{children}</defs>,LinearGradient=({children,...p})=><linearGradient {...p}>{children}</linearGradient>,Stop=p=><stop {...p}/>,Rect=p=><rect {...p}/>;
