import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "./AppIcon";
import { colors, spacing, typography } from "@/theme";
import type { TodoOccurrence } from "@/types";

type TaskRowProps = {
  task: TodoOccurrence;
  onPress: (task: TodoOccurrence) => void;
  onToggle: (task: TodoOccurrence) => void;
};

export function TaskRow({ task, onPress, onToggle }: TaskRowProps) {
  const done = task.status === "done";
  const metadata = [
    task.reminderTime,
    task.repeat.kind !== "none" ? "重复" : null,
    task.note ? "有备注" : null,
  ].filter(Boolean);

  return (
    <Pressable
      accessibilityHint="打开任务详情"
      accessibilityRole="button"
      onPress={() => onPress(task)}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}>
      <Pressable
        accessibilityLabel={done ? "标记为未完成" : "标记为已完成"}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        hitSlop={8}
        onPress={(event) => {
          event.stopPropagation();
          onToggle(task);
        }}
        style={[styles.checkbox, done && styles.checkboxDone]}>
        {done ? <AppIcon name="checkmark" color={colors.white} size={18} /> : null}
      </Pressable>

      <View style={styles.content}>
        <Text numberOfLines={2} style={[styles.text, done && styles.textDone]}>
          {task.text}
        </Text>
        {metadata.length ? (
          <View style={styles.metadata}>
            {task.reminderTime ? (
              <AppIcon name="time-outline" color={colors.accent} size={14} />
            ) : null}
            <Text numberOfLines={1} style={styles.metadataText}>
              {metadata.join(" · ")}
            </Text>
          </View>
        ) : null}
      </View>

      {task.isPinned ? (
        <AppIcon name="pin-outline" color={colors.accent} size={20} />
      ) : task.reminderTime ? (
        <AppIcon name="notifications-outline" color={colors.textMuted} size={20} />
      ) : (
        <AppIcon name="chevron-forward" color={colors.borderStrong} size={18} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 72,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.64,
  },
  checkbox: {
    alignItems: "center",
    borderColor: colors.accent,
    borderRadius: 7,
    borderWidth: 1.5,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  checkboxDone: {
    backgroundColor: colors.accent,
  },
  content: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  text: {
    ...typography.body,
    color: colors.text,
    fontWeight: "500",
  },
  textDone: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  metadata: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  metadataText: {
    ...typography.caption,
    color: colors.textMuted,
    flexShrink: 1,
  },
});
