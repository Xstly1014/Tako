import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { theme } from "../theme";
import { SessionProvider } from "../auth/context";
export default function Layout() {
  const path = usePathname();
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style={path === "/" ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.surface },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="works/[id]" />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
