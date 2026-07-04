import AsyncStorage from "@react-native-async-storage/async-storage";

// The geofencing background task (location-reminders.ts) can run in a
// headless JS context restarted purely to handle a region-enter event, with
// no React Query cache or app state available - it only gets the region
// identifier (the occurrence id) from expo-location. This tiny persisted map
// is the only way it can recover "what does this task say" to put in the
// notification. Kept as a single JSON blob (occurrence counts are small,
// typically single digits to a few dozen) rather than one AsyncStorage key
// per task.
const STORAGE_KEY = "daily-todo-sync.location-reminder-labels";

type LabelMap = Record<string, string>;

export async function readLocationReminderLabels(): Promise<LabelMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LabelMap) : {};
  } catch {
    return {};
  }
}

export async function writeLocationReminderLabels(labels: LabelMap) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(labels));
}
