import { useEffect } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { SessionProvider } from "@/session";
import {
  flushClientLogs,
  installClientLogCapture,
  recordClientLog,
} from "@/lib/client-logs";
import { flushMobilityPointQueue } from "@/lib/mobility-queue";
import { initNetworkMonitoring, onNetworkReconnect } from "@/lib/network";
import { cleanupLegacyMobilityRuntime } from "@/lib/mobility-tracking";
import { flushTodoMutationQueue } from "@/lib/todo-mutation-queue";

installClientLogCapture();
initNetworkMonitoring();
void cleanupLegacyMobilityRuntime({ includeCurrent: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      // Serve whatever is cached immediately instead of blocking on the
      // network, so previously-viewed days/screens stay usable offline.
      networkMode: "offlineFirst",
      // Long-lived so persisted data survives more than a few minutes
      // between app opens; the persister below is what actually survives
      // app restarts.
      gcTime: 7 * 24 * 60 * 60 * 1000,
    },
    mutations: {
      // Mutations keep the default "always" mode - offline handling for
      // todo mutations is done explicitly (see todo-mutation-queue.ts)
      // rather than via React Query's built-in pause/replay, since it
      // needs to coalesce edits instead of replaying every one verbatim.
      networkMode: "always",
    },
  },
});

const webStorage = {
  getItem: async (key: string) => globalThis.localStorage?.getItem(key) ?? null,
  setItem: async (key: string, value: string) => {
    globalThis.localStorage?.setItem(key, value);
  },
  removeItem: async (key: string) => {
    globalThis.localStorage?.removeItem(key);
  },
};

const persister = createAsyncStoragePersister({
  key: "daily-todo-sync.query-cache",
  storage: Platform.OS === "web" ? webStorage : AsyncStorage,
});

// Bump this whenever a query response shape changes in a way that would
// break rehydrating an older persisted cache (e.g. a required field was
// added/renamed) so stale-shaped cache entries get discarded instead of
// crashing the screen that reads them.
const QUERY_CACHE_BUSTER = "v1";

// Coming back online is when queued offline work actually has a chance to
// land, so flush both offline queues right away instead of waiting for
// their own debounce timers, then refetch so any change made elsewhere
// (another device, a background sync) shows up too.
onNetworkReconnect(() => {
  void flushTodoMutationQueue().then(() => {
    void queryClient.invalidateQueries({ queryKey: ["day"] });
    void queryClient.invalidateQueries({ queryKey: ["range"] });
  });
  void flushMobilityPointQueue().then(() => {
    void queryClient.invalidateQueries({ queryKey: ["mobility-day"] });
  });
});

export default function RootLayout() {
  useEffect(() => {
    void (async () => {
      recordClientLog("info", "Running legacy mobility runtime cleanup", {
        source: "startup",
      });
      await cleanupLegacyMobilityRuntime({ includeCurrent: true });
      await flushClientLogs();
    })();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ buster: QUERY_CACHE_BUSTER, persister }}>
          <SessionProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
            </Stack>
            <OfflineBanner />
            <StatusBar style="dark" />
          </SessionProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
