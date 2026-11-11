// Metro replaces the direct environment expression in native builds.
export const shortPostsTrial =
  typeof process !== "undefined" && process.env.EXPO_PUBLIC_SHORT_POSTS_TRIAL === "true";
