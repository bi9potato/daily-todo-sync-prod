import { NativeModules, Platform } from "react-native";

type ReminderSettingsNativeModule = {
  canScheduleExactAlarms(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
};

const nativeModule = NativeModules.ReminderSettings as
  | ReminderSettingsNativeModule
  | undefined;

export async function hasExactAlarmAccess() {
  if (Platform.OS !== "android" || !nativeModule) {
    return true;
  }
  return nativeModule.canScheduleExactAlarms().catch(() => false);
}

export async function openExactAlarmSettings() {
  if (Platform.OS !== "android" || !nativeModule) {
    return;
  }
  await nativeModule.openExactAlarmSettings();
}
