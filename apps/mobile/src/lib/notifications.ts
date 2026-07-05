import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import {
  ensureNativeReminderNotificationChannel,
  REMINDER_CHANNEL_ID,
} from "./android-reminder-settings";
import { recordClientLog } from "./client-logs";

// One dedicated channel for task reminders, distinct from any channel a
// future feature might add, so its importance/sound settings never get
// diluted by an unrelated notification type sharing the channel.
const REMINDER_ID_PREFIX = "task-reminder-";

// expo-notifications defaults to suppressing alerts while the app is in the
// foreground (the historical "don't interrupt the user with their own app
// open" behavior); a reminder is exactly the case where the user wants to be
// interrupted regardless of what they're doing, so every property here is
// forced on.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Routes the reminder's sound through the ALARM audio stream instead of the
// regular notification stream, and marks the channel PUBLIC/bypass-DND - the
// same trick real alarm-style reminder apps use to get a louder, harder-to-
// miss ring than a normal notification without needing a custom full-screen
// Activity. bypassDnd only takes effect if the user has separately granted
// "Do Not Disturb access" in system settings; if not granted, it's silently
// ignored rather than failing.
export async function ensureReminderNotificationChannel() {
  if (Platform.OS !== "android") {
    return;
  }
  try {
    // The Android module creates the channel with the device's selected alarm
    // ringtone. Expo's "default" resolves to the shorter notification tone,
    // so keep the Expo channel creation below only as a development-client
    // fallback when the native module is unavailable or fails.
    if (await ensureNativeReminderNotificationChannel()) {
      return;
    }
  } catch (error) {
    recordClientLog("warn", "Native reminder channel setup failed", {
      source: "reminders",
      context: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
  try {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: "任务提醒",
      description: "到时间和到达地点的任务提醒",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      enableLights: true,
    });
  } catch (error) {
    recordClientLog("warn", "Failed to configure reminder notification channel", {
      source: "reminders",
      context: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export async function hasNotificationPermission() {
  const current = await Notifications.getPermissionsAsync();
  return current.granted;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  // Android 13 does not show the notification permission prompt until the app
  // has created at least one channel.
  await ensureReminderNotificationChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return true;
  }
  if (!current.canAskAgain) {
    return false;
  }
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function hasUsableReminderNotificationChannel() {
  if (Platform.OS !== "android") {
    return true;
  }
  await ensureReminderNotificationChannel();
  const channel = await Notifications.getNotificationChannelAsync(
    REMINDER_CHANNEL_ID,
  );
  return Boolean(
    channel &&
      channel.importance >= Notifications.AndroidImportance.HIGH &&
      channel.sound,
  );
}

function reminderIdentifier(occurrenceId: string) {
  return `${REMINDER_ID_PREFIX}${occurrenceId}`;
}

function occurrenceIdFromIdentifier(identifier: string) {
  return identifier.startsWith(REMINDER_ID_PREFIX)
    ? identifier.slice(REMINDER_ID_PREFIX.length)
    : null;
}

export async function getScheduledReminderOccurrenceIds(): Promise<Set<string>> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const ids = new Set<string>();
  for (const request of scheduled) {
    const occurrenceId = occurrenceIdFromIdentifier(request.identifier);
    if (occurrenceId) {
      ids.add(occurrenceId);
    }
  }
  return ids;
}

// Cancels then reschedules unconditionally rather than trying to diff
// against whatever is already scheduled - both calls are cheap, and it
// guarantees an edited reminder (time changed, task text changed) always
// reflects the latest data instead of depending on being able to introspect
// an already-scheduled trigger reliably.
export async function scheduleTaskReminder(occurrence: {
  id: string;
  text: string;
  reminderAt: string | null;
  status?: "pending" | "done";
}) {
  await ensureReminderNotificationChannel();
  const identifier = reminderIdentifier(occurrence.id);
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
  if (!occurrence.reminderAt || occurrence.status === "done") {
    return;
  }
  const date = new Date(occurrence.reminderAt);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    return;
  }
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: "任务提醒",
      body: occurrence.text,
      data: { occurrenceId: occurrence.id },
      ...(Platform.OS === "android"
        ? { priority: Notifications.AndroidNotificationPriority.MAX }
        : {}),
      sound: "default",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
      channelId: REMINDER_CHANNEL_ID,
    },
  });
}

export async function cancelTaskReminder(occurrenceId: string) {
  await Notifications.cancelScheduledNotificationAsync(
    reminderIdentifier(occurrenceId),
  ).catch(() => undefined);
}

// Presents immediately (used by the location-arrival geofencing task - see
// location-reminders.ts - which has no future date to schedule against). A
// channel-only trigger (no "type") presents right away on that channel.
export async function presentImmediateReminder(occurrenceId: string, title: string, body: string) {
  await ensureReminderNotificationChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { occurrenceId },
      ...(Platform.OS === "android"
        ? { priority: Notifications.AndroidNotificationPriority.MAX }
        : {}),
      sound: "default",
    },
    trigger: { channelId: REMINDER_CHANNEL_ID },
  });
}
