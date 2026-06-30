import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const ACTIVE_RECORDING_KEY = "daily-todo-sync.active-mobility-recording";

export async function getActiveMobilityRecordingId() {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(ACTIVE_RECORDING_KEY) ?? null;
  }
  return SecureStore.getItemAsync(ACTIVE_RECORDING_KEY);
}

export async function setActiveMobilityRecordingId(id: string) {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(ACTIVE_RECORDING_KEY, id);
    return;
  }
  await SecureStore.setItemAsync(ACTIVE_RECORDING_KEY, id);
}

export async function clearActiveMobilityRecordingId() {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(ACTIVE_RECORDING_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(ACTIVE_RECORDING_KEY);
}
