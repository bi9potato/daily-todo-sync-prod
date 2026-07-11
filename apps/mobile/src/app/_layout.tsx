import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  defaultShouldDehydrateQuery,
  focusManager,
  QueryClient,
} from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import * as SplashScreen from "expo-splash-screen";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { SessionProvider, useSession } from "@/session";
import {
  flushClientLogs,
  installClientLogCapture,
  recordClientLog,
} from "@/lib/client-logs";
// Side-effect import: registers the iOS background-location TaskManager task at
// global scope before the app finishes loading (required by TaskManager, and a
// no-op on Android/web where the task is never started).
import "@/lib/mobility-ios-location";
// Side-effect import: registers the location-reminder geofencing TaskManager
// task at global scope, for the same reason as above - TaskManager.defineTask
// must run before the app finishes loading, not just once a screen mounts.
import "@/lib/location-reminders";
import { flushMobilityPointQueue } from "@/lib/mobility-queue";
import { initNetworkMonitoring, onNetworkReconnect } from "@/lib/network";
import { cleanupLegacyMobilityRuntime } from "@/lib/mobility-tracking";
import { flushTodoMutationQueue } from "@/lib/todo-mutation-queue";
import { scheduleIdleTask } from "@/lib/schedule-idle-task";

installClientLogCapture();
initNetworkMonitoring();
// React Query doesn't know about AppState on its own - without this, every
// refetchInterval in the app keeps firing while the app is backgrounded,
// and the mobility foreground service keeps the process (and JS timers)
// alive around the clock, so "backgrounded" could mean all night. This is
// the TanStack-documented React Native wiring; with it, intervals pause on
// background and resume-time refetches fire on foreground.
if (Platform.OS !== "web") {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener("change", (state) => {
      handleFocus(state === "active");
    });
    return () => subscription.remove();
  });
}
// Held until src/app/index.tsx knows whether to show the auth screen or the
// main app, so there is exactly one native-splash -> real-content transition
// instead of native splash -> blank/spinner frame -> content.
void SplashScreen.preventAutoHideAsync();

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
const STACK_SCREEN_OPTIONS = { headerShown: false } as const;

// Coming back online is when queued offline work actually has a chance to
// land, so flush both offline queues and refetch so any change made
// elsewhere (another device, a background sync) shows up too. Reconnect
// often fires at the exact moment the app resumes (Android re-checks
// connectivity on foreground), so the sync itself is deferred past
// whatever urgent rendering is in flight. The device
// already reads from cache while offline; this only decides when the
// background refresh happens, never whether the UI can be used meanwhile.
onNetworkReconnect(() => {
  scheduleIdleTask(() => {
    void flushTodoMutationQueue().then(() => {
      void queryClient.invalidateQueries({ queryKey: ["day"] });
      void queryClient.invalidateQueries({ queryKey: ["range"] });
    });
    void flushMobilityPointQueue().then(() => {
      void queryClient.invalidateQueries({ queryKey: ["mobility-day"] });
    });
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
          persistOptions={{
            buster: QUERY_CACHE_BUSTER,
            persister,
            dehydrateOptions: {
              // The persisted cache is plaintext AsyncStorage; queries that
              // read the device's secure storage (the password vault) must
              // never be written into it.
              shouldDehydrateQuery: (query) =>
                defaultShouldDehydrateQuery(query) &&
                query.meta?.sensitive !== true,
            },
          }}>
          <SessionProvider>
            <AppNavigator />
            <OfflineBanner />
            <StatusBar style="dark" />
          </SessionProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppNavigator() {
  const { status } = useSession();

  // Centralized here (rather than in src/app/index.tsx alone) because a cold
  // launch from the Google OAuth deep-link redirect (auth/google.tsx) can
  // mount without index.tsx ever rendering, which previously left the native
  // splash screen up forever in that case.
  useEffect(() => {
    if (status !== "loading") {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  if (Platform.OS !== "android") {
    return <Stack screenOptions={STACK_SCREEN_OPTIONS} />;
  }

  return (
    <Stack screenOptions={STACK_SCREEN_OPTIONS}>
      <Stack.Protected guard={status !== "authenticated"}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/google" />
      </Stack.Protected>
      <Stack.Protected guard={status === "authenticated"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
