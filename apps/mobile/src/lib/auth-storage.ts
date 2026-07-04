import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { recordClientLog } from "./client-logs";
import type { TokenPair } from "@/types";

const ACCESS_TOKEN_KEY = "daily-todo-sync.access-token";
const REFRESH_TOKEN_KEY = "daily-todo-sync.refresh-token";

let memoryTokens: Pick<TokenPair, "accessToken" | "refreshToken"> | null = null;
const tokenClearListeners = new Set<() => void>();

async function getItem(key: string) {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    // The Android Keystore key backing SecureStore's encrypted prefs can be
    // invalidated by an OS update or app reinstall, leaving a value that can
    // never be decrypted again. Previously this rejection surfaced all the
    // way up as a failed session restore with no recovery path short of the
    // user manually clearing all app data. Treat it as "no value" and drop
    // the unreadable entry so the next launch does not hit the same error.
    recordClientLog("warn", "SecureStore read failed, dropping entry", {
      source: "auth-storage",
      context: {
        key,
        message: error instanceof Error ? error.message : String(error),
      },
    });
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
    return null;
  }
}

async function setItem(key: string, value: string) {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string) {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadTokens() {
  if (memoryTokens) {
    return memoryTokens;
  }

  const [accessToken, refreshToken] = await Promise.all([
    getItem(ACCESS_TOKEN_KEY),
    getItem(REFRESH_TOKEN_KEY),
  ]);

  memoryTokens = accessToken && refreshToken ? { accessToken, refreshToken } : null;
  return memoryTokens;
}

export async function saveTokens(tokens: Pick<TokenPair, "accessToken" | "refreshToken">) {
  memoryTokens = tokens;
  await Promise.all([
    setItem(ACCESS_TOKEN_KEY, tokens.accessToken),
    setItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens() {
  memoryTokens = null;
  await Promise.all([
    deleteItem(ACCESS_TOKEN_KEY),
    deleteItem(REFRESH_TOKEN_KEY),
  ]);
  tokenClearListeners.forEach((listener) => listener());
}

export function getMemoryTokens() {
  return memoryTokens;
}

export function subscribeToTokenClear(listener: () => void) {
  tokenClearListeners.add(listener);
  return () => {
    tokenClearListeners.delete(listener);
  };
}
