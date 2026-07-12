import "expo-router/entry";
import { registerWidgetTaskHandler } from "react-native-android-widget";

import { widgetTaskHandler } from "./src/widgets/widget-task-handler";

// Widget clicks and periodic updates run this bundle headlessly (no UI
// mounted), so the handler must be registered at module scope, not from a
// component.
registerWidgetTaskHandler(widgetTaskHandler);
