import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider } from "@/session";
import {
  flushClientLogs,
  installClientLogCapture,
  recordClientLog,
} from "@/lib/client-logs";
import {
  cleanupUnsupportedMobilityRuntime,
  isMobilityNativeRuntimeDisabled,
} from "@/lib/mobility-tracking";

installClientLogCapture();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function RootLayout() {
  useEffect(() => {
    void (async () => {
      if (!isMobilityNativeRuntimeDisabled()) {
        return;
      }
      recordClientLog("info", "Running unsupported mobility runtime cleanup", {
        source: "startup",
      });
      await flushClientLogs();
      await cleanupUnsupportedMobilityRuntime();
    })();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
            </Stack>
            <StatusBar style="dark" />
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
