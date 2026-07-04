import * as SecureStore from "expo-secure-store";

const ENABLED_KEY = "daily-todo-sync.device-timeline-enabled";

// Whether the user has turned the device-timeline feature on - the master
// switch mirroring mobility's auto-tracking preference. Android-only (see
// device-timeline-native-service.ts), so no web fallback is needed here.
export async function getDeviceTimelineEnabled() {
  return (await SecureStore.getItemAsync(ENABLED_KEY)) === "true";
}

export async function setDeviceTimelineEnabled(enabled: boolean) {
  await SecureStore.setItemAsync(ENABLED_KEY, enabled ? "true" : "false");
}
