import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { hasExactAlarmAccess } from "./android-reminder-settings";
import { getRange } from "./api";
import { recordClientLog } from "./client-logs";
import { addDays } from "./date";
import { reconcileLocationReminders } from "./location-reminders";
import {
  cancelTaskReminder,
  ensureReminderNotificationChannel,
  getScheduledReminderOccurrenceIds,
  hasNotificationPermission,
  rememberedReminderSignature,
  reminderSignature,
  scheduleTaskReminder,
} from "./notifications";
import type { DayTodos, TodoOccurrence } from "@/types";

// How far ahead reminders stay scheduled. Local notifications persist across
// app restarts once scheduled, but the app still needs to (re)schedule new
// ones and cancel stale ones whenever it runs - this bounds that sweep to a
// manageable, still-generous window rather than every occurrence that will
// ever exist.
const REMINDER_LOOKAHEAD_DAYS = 30;

function flattenOccurrences(days: DayTodos[]) {
  const all: TodoOccurrence[] = [];
  for (const day of days) {
    all.push(...day.pending, ...day.done);
  }
  return all;
}

async function reconcileTimeReminders(occurrences: TodoOccurrence[]) {
  if (!(await hasNotificationPermission())) {
    // Scheduling without permission would either fail outright or silently
    // never present - skip rather than churn through no-op work. The prompt
    // itself lives in TaskEditor, at the point the user actually sets a
    // reminder, not here in a background reconciler.
    return;
  }
  if (Platform.OS === "android" && !(await hasExactAlarmAccess())) {
    // Android removes exact alarms when this special access is revoked.
    // Do not silently replace a user-visible reminder with an inexact alarm;
    // the task editor explains how to restore access.
    return;
  }
  const desired = occurrences.filter(
    (occurrence) => occurrence.status === "pending" && occurrence.reminderAt,
  );
  const desiredIds = new Set(desired.map((occurrence) => occurrence.id));

  const currentlyScheduled = await getScheduledReminderOccurrenceIds();
  await Promise.all(
    [...currentlyScheduled]
      .filter((id) => !desiredIds.has(id))
      .map((id) => cancelTaskReminder(id)),
  );
  // Only touch reminders whose inputs actually changed. This runs after
  // every todo mutation (each one invalidates the range this hook watches);
  // rescheduling all ~30 days of reminders each time meant dozens of
  // synchronous native calls right after every checkbox tap.
  const stale = desired.filter(
    (occurrence) =>
      !currentlyScheduled.has(occurrence.id) ||
      rememberedReminderSignature(occurrence.id) !== reminderSignature(occurrence),
  );
  await Promise.all(stale.map((occurrence) => scheduleTaskReminder(occurrence)));
}

// Owns turning the backend's occurrence data into actual OS-level reminders:
// scheduled local notifications for reminderTime, and a geofencing region
// per location-arrival reminder. Mounted once at the app-shell level (like
// useMobilityRuntime/useDeviceTimelineRuntime) so it reconciles on launch,
// on resume, and whenever any todo mutation invalidates the shared "range"
// query key this reuses.
export function useReminders(today: string) {
  const [androidResumeRevision, setAndroidResumeRevision] = useState(0);
  const end = addDays(today, REMINDER_LOOKAHEAD_DAYS);
  const rangeQuery = useQuery({
    queryKey: ["range", today, end],
    queryFn: () => getRange(today, end),
    enabled: Platform.OS !== "web",
    staleTime: 60_000,
  });
  const days = rangeQuery.data?.days;

  useEffect(() => {
    if (Platform.OS !== "web") {
      void ensureReminderNotificationChannel();
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // Returning from notification or exact-alarm settings must rerun the
        // scheduler even when the cached range data itself did not change.
        setAndroidResumeRevision((current) => current + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!days) {
      return;
    }
    const occurrences = flattenOccurrences(days);
    if (Platform.OS !== "android") {
      // Preserve the existing iOS behavior; the ordered channel setup and
      // permission-resume repair path below are Android-only.
      void reconcileTimeReminders(occurrences);
      void reconcileLocationReminders(occurrences);
      return;
    }
    void (async () => {
      try {
        await ensureReminderNotificationChannel();
        await Promise.all([
          reconcileTimeReminders(occurrences),
          reconcileLocationReminders(occurrences),
        ]);
      } catch (error) {
        recordClientLog("warn", "Failed to reconcile task reminders", {
          source: "reminders",
          context: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    })();
  }, [androidResumeRevision, days]);
}
