const path = value => typeof value === "string" ? value : value.pathname === "/novel-chapter" ? "/novel-chapter?" + new URLSearchParams(value.params) : value.pathname.replace("[id]",value.params.id);
export const router={push:value=>window.novelTest.navigate(path(value)),dismissTo:value=>window.novelTest.navigate(path(value)),navigate:value=>window.novelTest.navigate(path(value))};
export function useLocalSearchParams(){const url=new URL(window.novelTest.route,"http://fixture");return {id:url.pathname.split("/").pop(),...Object.fromEntries(url.searchParams)}};
