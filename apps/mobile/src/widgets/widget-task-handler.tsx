import { Appearance } from "react-native";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { TodayTasksWidget } from "./TodayTasksWidget";
import { completeTaskFromWidget, loadTodayWidgetData } from "./today-tasks-data";

export const TODAY_TASKS_WIDGET_NAME = "DailyTodoToday";

// RemoteViews snapshots cannot re-theme live, so the system scheme is read
// at render time; a toggle gets picked up on the next update (periodic,
// app-background refresh, or a widget click).
export function currentWidgetColorScheme() {
  return Appearance.getColorScheme() === "dark" ? ("dark" as const) : ("light" as const);
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== TODAY_TASKS_WIDGET_NAME) {
    return;
  }
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
      props.renderWidget(
        <TodayTasksWidget
          colorScheme={currentWidgetColorScheme()}
          data={await loadTodayWidgetData()}
        />,
      );
      break;
    case "WIDGET_CLICK": {
      if (props.clickAction === "COMPLETE_TASK") {
        const occurrenceId = (
          props.clickActionData as { id?: string } | undefined
        )?.id;
        if (occurrenceId) {
          await completeTaskFromWidget(occurrenceId);
        }
        props.renderWidget(
          <TodayTasksWidget
            colorScheme={currentWidgetColorScheme()}
            data={await loadTodayWidgetData()}
          />,
        );
      }
      break;
    }
    default:
      break;
  }
}
