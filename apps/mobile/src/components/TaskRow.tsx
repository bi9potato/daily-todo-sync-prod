import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "./AppIcon";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type { TodoOccurrence } from "@/types";

type TaskRowProps = {
  task: TodoOccurrence;
  onDelete: (task: TodoOccurrence) => void;
  onPin: (task: TodoOccurrence) => void;
  onPress: (task: TodoOccurrence) => void;
  onToggle: (task: TodoOccurrence) => void;
};

export function TaskRow({
  task,
  onDelete,
  onPin,
  onPress,
  onToggle,
}: TaskRowProps) {
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
      <AppIcon name="reorder-two-outline" color={colors.textMuted} size={18} />
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
        {task.isPinned ? (
          <View style={styles.pinnedTag}>
            <AppIcon name="pin-outline" color={colors.accent} size={12} />
            <Text style={styles.pinnedText}>置顶</Text>
          </View>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel={task.isPinned ? "取消置顶任务" : "置顶任务"}
        onPress={(event) => {
          event.stopPropagation();
          onPin(task);
        }}
        style={({ pressed }) => [
          styles.actionButton,
          task.isPinned && styles.actionButtonActive,
          pressed && styles.pressed,
        ]}>
        <AppIcon
          name="pin-outline"
          color={task.isPinned ? colors.accent : colors.textMuted}
          size={19}
        />
      </Pressable>
      <Pressable
        accessibilityLabel="删除任务"
        onPress={(event) => {
          event.stopPropagation();
          onDelete(task);
        }}
        style={({ pressed }) => [
          styles.actionButton,
          pressed && styles.pressed,
        ]}>
        <AppIcon name="trash-outline" color={colors.textMuted} size={19} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    ...shadows.card,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    padding: spacing.sm,
  },
  pressed: {
    opacity: 0.64,
  },
  checkbox: {
    alignItems: "center",
    borderColor: colors.accent,
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  checkboxDone: {
    backgroundColor: colors.accent,
  },
  content: {
    flex: 1,
    gap: 3,
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
  pinnedTag: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pinnedText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  actionButtonActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderStrong,
  },
});
