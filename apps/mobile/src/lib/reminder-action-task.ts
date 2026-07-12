import { completeTaskFromWidget } from "@/widgets/today-tasks-data";
import { refreshTodayTasksWidget } from "@/widgets/refresh-today-widget";

// Headless JS behind the reminder popup/notification's 完成 button
// (ReminderActionService). Reuses the widget's completion path: enqueue in
// the offline mutation queue, flush with a capped timeout, update the local
// snapshot - so the tap works with the app closed and offline, and the
// home-screen widget reflects it immediately.
export async function reminderActionTask(data: {
  action?: string;
  occurrenceId?: string;
}) {
  if (data?.action === "complete" && data.occurrenceId) {
    await completeTaskFromWidget(data.occurrenceId);
    await refreshTodayTasksWidget();
  }
}
