import { useEffect } from "react";
import { Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { getRange } from "./api";
import { addDays } from "./date";
import { reconcileLocationReminders } from "./location-reminders";
import {
  cancelTaskReminder,
  ensureReminderNotificationChannel,
  getScheduledReminderOccurrenceIds,
  hasNotificationPermission,
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
  await Promise.all(desired.map((occurrence) => scheduleTaskReminder(occurrence)));
}

// Owns turning the backend's occurrence data into actual OS-level reminders:
// scheduled local notifications for reminderTime, and a geofencing region
// per location-arrival reminder. Mounted once at the app-shell level (like
// useMobilityRuntime/useDeviceTimelineRuntime) so it reconciles on launch,
// on resume, and whenever any todo mutation invalidates the shared "range"
// query key this reuses.
export function useReminders(today: string) {
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
    if (!days) {
      return;
    }
    const occurrences = flattenOccurrences(days);
    void reconcileTimeReminders(occurrences);
    void reconcileLocationReminders(occurrences);
  }, [days]);
}
