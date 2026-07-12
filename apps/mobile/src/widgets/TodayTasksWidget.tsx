import { FlexWidget, ListWidget, TextWidget } from "react-native-android-widget";

import type { TodayWidgetTask } from "./select-widget-tasks";

// RemoteViews cannot load the app theme, so the palette from src/theme.ts is
// repeated here as plain hex values.
const palette = {
  surface: "#FFFFFF",
  text: "#161B18",
  textMuted: "#687168",
  accent: "#2C5745",
  accentSoft: "#E8F0EB",
  border: "#D5DDD3",
} as const;

export type TodayTasksWidgetData = {
  dateLabel: string;
  pendingTasks: TodayWidgetTask[];
  pendingCount: number;
  doneCount: number;
  offline: boolean;
};

// Home-screen "今日任务" widget. Tapping a task's circle completes it via
// the offline mutation queue; tapping its text opens the app; the plus
// button deep-links straight into the My Day composer (same URI as the
// long-press app shortcut).
export function TodayTasksWidget({ data }: { data: TodayTasksWidgetData }) {
  return (
    <FlexWidget
      style={{
        backgroundColor: palette.surface,
        borderRadius: 18,
        flex: 1,
        flexDirection: "column",
        height: "match_parent",
        padding: 14,
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
            style={{ color: palette.text, fontSize: 15, fontWeight: "700" }}
            text="今日任务"
          />
          <TextWidget
            style={{ color: palette.textMuted, fontSize: 11 }}
            text={`${data.dateLabel} · 待办 ${data.pendingCount} · 已完成 ${data.doneCount}${data.offline ? " · 离线" : ""}`}
          />
        </FlexWidget>
        <TextWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: "daily-todo://today?compose=1" }}
          style={{
            backgroundColor: palette.accent,
            borderRadius: 16,
            color: "#FFFFFF",
            fontSize: 18,
            paddingHorizontal: 12,
            paddingVertical: 2,
          }}
          text="＋"
        />
      </FlexWidget>

      {data.pendingTasks.length ? (
        <ListWidget
          style={{
            height: "match_parent",
            marginTop: 8,
            width: "match_parent",
          }}>
          {data.pendingTasks.map((task) => (
            <FlexWidget
              key={task.id}
              style={{
                alignItems: "center",
                flexDirection: "row",
                paddingVertical: 7,
                width: "match_parent",
              }}>
              <TextWidget
                clickAction="COMPLETE_TASK"
                clickActionData={{ id: task.id }}
                style={{
                  color: palette.accent,
                  fontSize: 20,
                  paddingHorizontal: 6,
                }}
                text="○"
              />
              <FlexWidget
                clickAction="OPEN_APP"
                style={{ flex: 1, marginLeft: 4 }}>
                <TextWidget
                  maxLines={1}
                  style={{
                    color: palette.text,
                    fontSize: 14,
                  }}
                  text={task.text}
                  truncate="END"
                />
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
