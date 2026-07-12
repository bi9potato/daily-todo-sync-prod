import { FlexWidget, ListWidget, TextWidget } from "react-native-android-widget";

import type { TodayWidgetTask } from "./select-widget-tasks";

export type WidgetColorScheme = "light" | "dark";

// RemoteViews cannot load the app theme, so both palettes live here as plain
// hex values. Light mirrors src/theme.ts; dark follows One UI widget
// conventions (near-black card, desaturated accent) since the layout is
// modeled on Samsung Reminders' widget.
const palettes = {
  light: {
    surface: "#FFFFFF",
    text: "#161B18",
    textMuted: "#687168",
    accent: "#2C5745",
    onAccent: "#FFFFFF",
    overdue: "#C64236",
  },
  dark: {
    surface: "#1B201D",
    text: "#F1F4F1",
    textMuted: "#96A099",
    accent: "#8FC3AA",
    onAccent: "#10281C",
    overdue: "#FF7B6E",
  },
} as const;

export type TodayTasksWidgetData = {
  dateLabel: string;
  pendingTasks: TodayWidgetTask[];
  pendingCount: number;
  doneCount: number;
  offline: boolean;
};

// Home-screen "今日任务" widget, modeled on Samsung Reminders' widget: each
// row is a circle tap-to-complete button plus the task title with a small
// reminder-time line underneath (red once the time has passed - the detail
// One UI 8 dropped and users missed). Completion goes through the offline
// mutation queue; the row opens the app; ＋ deep-links into the My Day
// composer like the long-press app shortcut.
export function TodayTasksWidget({
  colorScheme = "light",
  data,
}: {
  colorScheme?: WidgetColorScheme;
  data: TodayTasksWidgetData;
}) {
  const palette = palettes[colorScheme];
  return (
    <FlexWidget
      style={{
        backgroundColor: palette.surface,
        borderRadius: 24,
        flex: 1,
        flexDirection: "column",
        height: "match_parent",
        padding: 16,
        width: "match_parent",
      }}>
      <FlexWidget
        style={{
          alignItems: "center",
          flexDirection: "row",
          width: "match_parent",
        }}>
        <FlexWidget
          clickAction="OPEN_APP"
          style={{ flex: 1, flexDirection: "column" }}>
          <TextWidget
            style={{ color: palette.text, fontSize: 16, fontWeight: "700" }}
            text="今日任务"
          />
          <TextWidget
            style={{ color: palette.textMuted, fontSize: 11, marginTop: 1 }}
            text={`${data.dateLabel} · 待办 ${data.pendingCount} · 已完成 ${data.doneCount}${data.offline ? " · 离线" : ""}`}
          />
        </FlexWidget>
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: "daily-todo://today?compose=1" }}
          style={{
            alignItems: "center",
            backgroundColor: palette.accent,
            borderRadius: 18,
            height: 36,
            justifyContent: "center",
            width: 36,
          }}>
          <TextWidget
            style={{ color: palette.onAccent, fontSize: 20 }}
            text="＋"
          />
        </FlexWidget>
      </FlexWidget>

      {data.pendingTasks.length ? (
        <ListWidget
          style={{
            height: "match_parent",
            marginTop: 10,
            width: "match_parent",
          }}>
          {data.pendingTasks.map((task) => (
            <FlexWidget
              key={task.id}
              style={{
                alignItems: "center",
                flexDirection: "row",
                paddingVertical: 8,
                width: "match_parent",
              }}>
              <TextWidget
                clickAction="COMPLETE_TASK"
                clickActionData={{ id: task.id }}
                style={{
                  color: palette.accent,
                  fontSize: 22,
                  paddingHorizontal: 6,
                }}
                text="○"
              />
              <FlexWidget
                clickAction="OPEN_APP"
                style={{ flex: 1, flexDirection: "column", marginLeft: 6 }}>
                <TextWidget
                  maxLines={1}
                  style={{
                    color: palette.text,
                    fontSize: 15,
                  }}
                  text={task.text}
                  truncate="END"
                />
                {task.reminderTime ? (
                  <TextWidget
                    style={{
                      color: task.overdue ? palette.overdue : palette.textMuted,
                      fontSize: 12,
                      marginTop: 1,
                    }}
                    text={`${task.reminderTime}${task.overdue ? " · 已过时间" : ""}`}
                  />
                ) : null}
              </FlexWidget>
            </FlexWidget>
          ))}
        </ListWidget>
      ) : (
        <FlexWidget
          clickAction="OPEN_APP"
          style={{
            alignItems: "center",
            flex: 1,
            justifyContent: "center",
            width: "match_parent",
          }}>
          <TextWidget
            style={{ color: palette.textMuted, fontSize: 13 }}
            text={
              data.doneCount
                ? "今天的任务全部完成 🎉"
                : "今天还没有任务，点 ＋ 添加"
            }
          />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
