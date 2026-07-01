import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const ACTIVE_RECORDING_KEY = "daily-todo-sync.active-mobility-recording";
const VISIT_DWELL_MINUTES_KEY =
  "daily-todo-sync.mobility-visit-dwell-minutes";

// Matches the dwell time the auto-visit detector used before this became a
// user setting, so upgrading the app doesn't change anyone's existing
// behaviour until they explicitly pick something else.
export const DEFAULT_VISIT_DWELL_MINUTES = 5;
export const VISIT_DWELL_MINUTE_OPTIONS = [3, 5, 10, 15, 30] as const;

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

export async function getVisitDwellMinutes() {
  const raw =
    Platform.OS === "web"
      ? (globalThis.localStorage?.getItem(VISIT_DWELL_MINUTES_KEY) ?? null)
      : await SecureStore.getItemAsync(VISIT_DWELL_MINUTES_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_VISIT_DWELL_MINUTES;
}

export async function setVisitDwellMinutes(minutes: number) {
  const value = String(Math.max(1, Math.round(minutes)));
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(VISIT_DWELL_MINUTES_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(VISIT_DWELL_MINUTES_KEY, value);
}
