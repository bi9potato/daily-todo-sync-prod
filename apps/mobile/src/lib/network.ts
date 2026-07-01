import { useEffect, useState } from "react";
import { onlineManager } from "@tanstack/react-query";
import NetInfo from "@react-native-community/netinfo";
import { Platform } from "react-native";

let online = true;
const listeners = new Set<(value: boolean) => void>();
let reconnectHandlers: (() => void)[] = [];
let initialized = false;

function updateOnlineState(next: boolean) {
  const wasOffline = !online;
  online = next;
  listeners.forEach((listener) => listener(next));
  if (wasOffline && next) {
    reconnectHandlers.forEach((handler) => handler());
  }
}

export function isNetworkOnline() {
  return online;
}

export function useIsOnline() {
  const [value, setValue] = useState(online);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

// Runs whenever the device transitions from offline to online, e.g. to
// flush queued mutations. Returns an unsubscribe function.
export function onNetworkReconnect(handler: () => void) {
  reconnectHandlers.push(handler);
  return () => {
    reconnectHandlers = reconnectHandlers.filter((item) => item !== handler);
  };
}

// Wires network status into React Query's onlineManager (so queries pause
// retries instead of spinning while offline, then resume on reconnect) and
// into this module's own listener set (for useIsOnline() and reconnect
// handlers, which the offline mutation queue relies on).
export function initNetworkMonitoring() {
  if (initialized) {
    return;
  }
  initialized = true;

  if (Platform.OS === "web") {
    // NetInfo's web layer needs bundler wiring this project doesn't have
    // configured; the browser's own online/offline events are simpler and
    // reliable for the web build.
    const syncFromBrowser = () => {
      const value = typeof navigator === "undefined" ? true : navigator.onLine;
      onlineManager.setOnline(value);
      updateOnlineState(value);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", syncFromBrowser);
      window.addEventListener("offline", syncFromBrowser);
    }
    syncFromBrowser();
    return;
  }

  onlineManager.setEventListener((setQueryClientOnline) => {
    return NetInfo.addEventListener((state) => {
      const value = state.isConnected === true && state.isInternetReachable !== false;
      setQueryClientOnline(value);
      updateOnlineState(value);
    });
  });
}
