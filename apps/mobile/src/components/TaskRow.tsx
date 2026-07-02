import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "./AppIcon";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type { TodoOccurrence } from "@/types";

type TaskRowProps = {
  task: TodoOccurrence;
  isDragActive?: boolean;
  onDelete: (task: TodoOccurrence) => void;
  onDragLongPress?: () => void;
  onPin: (task: TodoOccurrence) => void;
  onPress: (task: TodoOccurrence) => void;
  onToggle: (task: TodoOccurrence) => void;
};

export function TaskRow({
  task,
  isDragActive,
  onDelete,
  onDragLongPress,
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
      delayLongPress={220}
      disabled={isDragActive}
      onLongPress={onDragLongPress}
      onPress={() => {
        if (!isDragActive) {
          onPress(task);
        }
      }}
      style={({ pressed }) => [
        styles.container,
        task.isLongTerm && styles.longTermContainer,
        task.isLowPriority && !task.isLongTerm && styles.lowPriorityContainer,
        task.isPinned && !task.isLongTerm && styles.pinnedContainer,
        task.isPinned && task.isLongTerm && styles.longTermPinnedContainer,
        done && styles.doneContainer,
        isDragActive && styles.dragActiveContainer,
        pressed && styles.pressed,
      ]}>
      <View
        accessibilityLabel="拖动排序"
        accessibilityRole="image"
        style={styles.dragHandle}>
        <AppIcon name="reorder-two-outline" color={colors.textMuted} size={18} />
      </View>
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
        {task.location ? (
          <View style={styles.locationMetadata}>
            <AppIcon name="location-outline" color={colors.accent} size={14} />
            <Text numberOfLines={1} style={styles.metadataText}>
              {task.location.name || "已记录位置"} ·{" "}
              {new Date(task.location.recordedAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>
        ) : null}
        {task.isPinned ? (
          <View style={styles.pinnedTag}>
            <AppIcon name="bookmark" color={colors.accent} size={12} />
            <Text style={styles.pinnedText}>置顶</Text>
          </View>
        ) : null}
      </View>

      {task.attachments[0] ? (
        <View style={styles.attachmentPreview}>
          <AuthenticatedImage
            contentUrl={task.attachments[0].contentUrl}
            style={styles.attachmentImage}
          />
          {task.attachments.length > 1 ? (
            <View style={styles.attachmentCount}>
              <Text style={styles.attachmentCountText}>
                {task.attachments.length}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

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
          name={task.isPinned ? "bookmark" : "bookmark-outline"}
          color={task.isPinned ? colors.accent : colors.textMuted}
          size={18}
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
  pinnedContainer: {
    backgroundColor: "#F1F7F2",
    borderColor: "#789382",
    borderTopWidth: 3,
    elevation: 3,
  },
  longTermContainer: {
    backgroundColor: "#FFF9EC",
    borderColor: "#C4A45D",
    borderLeftWidth: 4,
  },
  longTermPinnedContainer: {
    backgroundColor: "#FFF9EC",
    borderColor: "#C4A45D",
    borderLeftWidth: 4,
    borderTopWidth: 3,
    elevation: 3,
  },
  lowPriorityContainer: {
    backgroundColor: "#EEF5F6",
    borderColor: "#8299A1",
    borderLeftWidth: 4,
  },
  doneContainer: {
    backgroundColor: "#F5F7F3",
    elevation: 0,
    opacity: 0.76,
  },
  dragActiveContainer: {
    opacity: 0.98,
  },
  pressed: {
    opacity: 0.64,
  },
  dragHandle: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 24,
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
  locationMetadata: {
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
    backgroundColor: "#E3EEE5",
    borderColor: "#A9BDAE",
    borderRadius: radius.full,
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
    backgroundColor: "#DDEBE1",
    borderColor: "#789382",
    borderWidth: 1.5,
  },
  attachmentPreview: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 42,
    overflow: "hidden",
    position: "relative",
    width: 42,
  },
  attachmentImage: {
    height: "100%",
    width: "100%",
  },
  attachmentCount: {
    alignItems: "center",
    backgroundColor: "rgba(22, 27, 24, 0.74)",
    borderRadius: radius.full,
    bottom: 2,
    height: 17,
    justifyContent: "center",
    minWidth: 17,
    paddingHorizontal: 3,
    position: "absolute",
    right: 2,
  },
  attachmentCountText: {
    color: colors.white,
    fontSize: 9,
    fontWeight: "800",
  },
});
