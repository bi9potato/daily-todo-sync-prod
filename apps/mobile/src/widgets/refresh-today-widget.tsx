import { Platform } from "react-native";

// Re-renders every home-screen "今日任务" widget from current data. Called
// when the app goes to the background (the moment task edits made in-app
// should become visible on the launcher) - cheap no-op when no widget has
// been added or on non-Android platforms.
export async function refreshTodayTasksWidget() {
  if (Platform.OS !== "android") {
    return;
  }
  try {
    const { requestWidgetUpdate } = await import("react-native-android-widget");
    const { TodayTasksWidget } = await import("./TodayTasksWidget");
    const { loadTodayWidgetData } = await import("./today-tasks-data");
    const { TODAY_TASKS_WIDGET_NAME } = await import("./widget-task-handler");
    const data = await loadTodayWidgetData();
    await requestWidgetUpdate({
      widgetName: TODAY_TASKS_WIDGET_NAME,
      renderWidget: () => <TodayTasksWidget data={data} />,
      widgetNotFound: () => {
        // No widget on the launcher yet - nothing to refresh.
      },
    });
  } catch (error) {
    console.warn("Today-tasks widget refresh failed", error);
  }
}
