import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { TodayTasksWidget } from "./TodayTasksWidget";
import { completeTaskFromWidget, loadTodayWidgetData } from "./today-tasks-data";

export const TODAY_TASKS_WIDGET_NAME = "DailyTodoToday";

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== TODAY_TASKS_WIDGET_NAME) {
    return;
  }
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
      props.renderWidget(<TodayTasksWidget data={await loadTodayWidgetData()} />);
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
          <TodayTasksWidget data={await loadTodayWidgetData()} />,
        );
      }
      break;
    }
    default:
      break;
  }
}
