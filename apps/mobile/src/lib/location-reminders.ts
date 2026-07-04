import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { recordClientLog } from "./client-logs";
import {
  readLocationReminderLabels,
  writeLocationReminderLabels,
} from "./location-reminder-labels";
import { presentImmediateReminder } from "./notifications";
import type { TodoOccurrence } from "@/types";

// One geofencing task shared by every location-based reminder: expo-location
// replaces the entire monitored region set on each startGeofencingAsync
// call, so there is exactly one task to define, not one per task.
export const LOCATION_REMINDER_TASK = "daily-todo-location-reminders";

type GeofencingTaskBody = {
  eventType?: Location.LocationGeofencingEventType;
  region?: Location.LocationRegion;
};

TaskManager.defineTask(LOCATION_REMINDER_TASK, async ({ data, error }) => {
  if (error) {
    recordClientLog("warn", "Location reminder task error", {
      source: "reminders",
      context: { message: error.message },
    });
    return;
  }
  const { eventType, region } = (data ?? {}) as GeofencingTaskBody;
  if (eventType !== Location.LocationGeofencingEventType.Enter || !region?.identifier) {
    return;
  }
  const labels = await readLocationReminderLabels();
  const text = labels[region.identifier];
  if (!text) {
    return;
  }
  await presentImmediateReminder(region.identifier, "到达提醒", text).catch((presentError) => {
    recordClientLog("warn", "Failed to present location reminder", {
      source: "reminders",
      context: {
        message:
          presentError instanceof Error ? presentError.message : String(presentError),
      },
    });
  });
});

function occurrenceHasLocationReminder(occurrence: TodoOccurrence) {
  return (
    occurrence.status === "pending" &&
    Boolean(occurrence.location?.reminderEnabled) &&
    occurrence.location != null
  );
}

export async function isLocationRemindersAvailable() {
  if (Platform.OS !== "android") {
    return false;
  }
  return TaskManager.isAvailableAsync();
}

// Geofencing needs "always" (background) location, the same permission
// mobility's continuous tracking requires - a region can only be watched
// while the app isn't in the foreground looking at it.
export async function hasLocationReminderPermission() {
  const background = await Location.getBackgroundPermissionsAsync();
  return background.granted;
}

export async function requestLocationReminderPermission() {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) {
    const requested = await Location.requestForegroundPermissionsAsync();
    if (!requested.granted) {
      return false;
    }
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.granted;
}

// Rebuilds the full monitored-region set from whatever occurrences the
// caller currently knows about (see useReminders.ts, which fetches a
// forward-looking range of days). Called on every reconcile, so an edited
// or completed task's region drops out the next time this runs.
export async function reconcileLocationReminders(occurrences: TodoOccurrence[]) {
  if (!(await isLocationRemindersAvailable())) {
    return;
  }
  const withReminders = occurrences.filter(occurrenceHasLocationReminder);

  if (!withReminders.length) {
    if (await TaskManager.isTaskRegisteredAsync(LOCATION_REMINDER_TASK)) {
      await Location.stopGeofencingAsync(LOCATION_REMINDER_TASK).catch(() => undefined);
    }
    await writeLocationReminderLabels({});
    return;
  }

  if (!(await hasLocationReminderPermission())) {
    // Permission was revoked (or never granted) after these reminders were
    // set - nothing to monitor with; the UI surfaces this via
    // hasLocationReminderPermission() when the user opens the task again.
    return;
  }

  const labels: Record<string, string> = {};
  const regions: Location.LocationRegion[] = withReminders.map((occurrence) => {
    labels[occurrence.id] = occurrence.text;
    return {
      identifier: occurrence.id,
      latitude: occurrence.location!.latitude,
      longitude: occurrence.location!.longitude,
      radius: occurrence.location!.radiusMeters,
      notifyOnEnter: true,
      notifyOnExit: false,
    };
  });

  await writeLocationReminderLabels(labels);
  await Location.startGeofencingAsync(LOCATION_REMINDER_TASK, regions).catch((error) => {
    recordClientLog("warn", "Failed to start location reminder geofencing", {
      source: "reminders",
      context: {
        message: error instanceof Error ? error.message : String(error),
        regionCount: regions.length,
      },
    });
  });
}
