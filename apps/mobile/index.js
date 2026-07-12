import "expo-router/entry";
import { AppRegistry } from "react-native";
import { registerWidgetTaskHandler } from "react-native-android-widget";

import { reminderActionTask } from "./src/lib/reminder-action-task";
import { widgetTaskHandler } from "./src/widgets/widget-task-handler";

// Widget clicks, reminder-popup actions, and periodic updates run this
// bundle headlessly (no UI mounted), so both handlers must be registered at
// module scope, not from a component.
registerWidgetTaskHandler(widgetTaskHandler);
AppRegistry.registerHeadlessTask(
  "DailyTodoReminderAction",
  () => reminderActionTask,
);
