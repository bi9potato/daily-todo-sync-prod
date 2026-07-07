import { NativeModules, Platform } from "react-native";

type ReminderSettingsNativeModule = {
  reminderChannelId?: string;
  canScheduleExactAlarms(): Promise<boolean>;
  ensureReminderNotificationChannel(): Promise<void>;
  openExactAlarmSettings(): Promise<void>;
  openReminderNotificationSettings(): Promise<void>;
  isBatteryOptimizationDisabled(): Promise<boolean>;
  openBatteryOptimizationSettings(): Promise<void>;
};

const nativeModule = NativeModules.ReminderSettings as
  | ReminderSettingsNativeModule
  | undefined;

export const REMINDER_CHANNEL_ID =
  nativeModule?.reminderChannelId ?? "task-reminders-v2";

export async function ensureNativeReminderNotificationChannel() {
  if (
    Platform.OS !== "android" ||
    !nativeModule?.ensureReminderNotificationChannel
  ) {
    return false;
  }
  await nativeModule.ensureReminderNotificationChannel();
  return true;
}

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

export async function openReminderNotificationSettings() {
  if (Platform.OS !== "android" || !nativeModule) {
    return;
  }
  await nativeModule.openReminderNotificationSettings();
}

export async function hasReminderBatteryExemption() {
  if (Platform.OS !== "android" || !nativeModule) {
    return true;
  }
  return nativeModule.isBatteryOptimizationDisabled().catch(() => true);
}

export async function openReminderBatteryOptimizationSettings() {
  if (Platform.OS !== "android" || !nativeModule) {
    return;
  }
  await nativeModule.openBatteryOptimizationSettings();
}
