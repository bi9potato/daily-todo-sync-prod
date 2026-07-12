import { Appearance } from "react-native";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { TodayTasksWidget } from "./TodayTasksWidget";
import { layoutForWidgetSize } from "./widget-layout";
import {
  completeTaskFromWidget,
  loadTodayWidgetData,
  loadTodayWidgetDataFromCache,
} from "./today-tasks-data";

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
  const layout = layoutForWidgetSize(props.widgetInfo);
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
      props.renderWidget(
        <TodayTasksWidget
          colorScheme={currentWidgetColorScheme()}
          data={await loadTodayWidgetData()}
          layout={layout}
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
        // Render from the local snapshot rather than refetching the day, so
        // the tapped task disappears without waiting on another round trip.
        props.renderWidget(
          <TodayTasksWidget
            colorScheme={currentWidgetColorScheme()}
            data={await loadTodayWidgetDataFromCache()}
            layout={layout}
          />,
        );
      }
      break;
    }
    default:
      break;
  }
}
