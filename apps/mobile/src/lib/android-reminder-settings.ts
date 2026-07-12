import { NativeModules, Platform } from "react-native";

type ReminderSettingsNativeModule = {
  reminderChannelId?: string;
  supportsAlarmPipeline?: boolean;
  canScheduleExactAlarms(): Promise<boolean>;
  ensureReminderNotificationChannel(): Promise<void>;
  openExactAlarmSettings(): Promise<void>;
  openReminderNotificationSettings(): Promise<void>;
  isBatteryOptimizationDisabled(): Promise<boolean>;
  openBatteryOptimizationSettings(): Promise<void>;
  scheduleReminderAlarm?(id: string, title: string, atMillis: number): Promise<void>;
  cancelReminderAlarm?(id: string): Promise<void>;
  getScheduledReminderAlarmIds?(): Promise<string[]>;
  presentReminderNow?(id: string, body: string): Promise<void>;
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

// The Samsung Reminders-style native alarm pipeline (full-screen popup,
// notification actions handled without opening the app). Absent in builds
// made before plugin v2, in which case scheduling falls back to
// expo-notifications.
export const hasNativeReminderAlarms = Boolean(
  Platform.OS === "android" && nativeModule?.supportsAlarmPipeline,
);

export async function scheduleNativeReminderAlarm(
  id: string,
  title: string,
  atMillis: number,
) {
  await nativeModule?.scheduleReminderAlarm?.(id, title, atMillis);
}

export async function cancelNativeReminderAlarm(id: string) {
  await nativeModule?.cancelReminderAlarm?.(id).catch(() => {});
}

export async function getNativeReminderAlarmIds(): Promise<string[]> {
  if (!hasNativeReminderAlarms || !nativeModule?.getScheduledReminderAlarmIds) {
    return [];
  }
  return nativeModule.getScheduledReminderAlarmIds().catch(() => []);
}

export async function presentNativeReminderNow(
  id: string,
  body: string,
): Promise<boolean> {
  if (!hasNativeReminderAlarms || !nativeModule?.presentReminderNow) {
    return false;
  }
  await nativeModule.presentReminderNow(id, body);
  return true;
}
