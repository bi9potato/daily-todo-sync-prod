import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "./AppIcon";
import { AttachmentGallery } from "./AttachmentGallery";
import { colors, radius, spacing, typography } from "@/theme";
import type {
  LocalAttachmentFile,
  RepeatKind,
  TaskAttachment,
  TaskUpdatePayload,
  TodoOccurrence,
} from "@/types";

const repeatOptions: { value: RepeatKind; label: string }[] = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
];

type TaskEditorProps = {
  task: TodoOccurrence | null;
  isAttachmentMutating: boolean;
  isSaving: boolean;
  onClose: () => void;
  onCopyAsRegular: (task: TodoOccurrence) => void;
  onDelete: (task: TodoOccurrence) => void;
  onDeleteAttachment: (attachment: TaskAttachment) => void;
  onReorderAttachments: (orderedIds: string[]) => void;
  onSave: (task: TodoOccurrence, payload: TaskUpdatePayload) => void;
  onUploadAttachment: (file: LocalAttachmentFile) => void;
};

export function TaskEditor({
  task,
  isAttachmentMutating,
  isSaving,
  onClose,
  onCopyAsRegular,
  onDelete,
  onDeleteAttachment,
  onReorderAttachments,
  onSave,
  onUploadAttachment,
}: TaskEditorProps) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(task?.text ?? "");
  const [note, setNote] = useState(task?.note ?? "");
  const [reminderTime, setReminderTime] = useState(task?.reminderTime ?? "");
  const [repeatKind, setRepeatKind] = useState<RepeatKind>(
    task?.repeat.kind ?? "none",
  );
  const [repeatInterval, setRepeatInterval] = useState(
    String(task?.repeat.interval ?? 1),
  );
  const [repeatMenuOpen, setRepeatMenuOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(task?.isPinned ?? false);
  const [isLongTerm, setIsLongTerm] = useState(task?.isLongTerm ?? false);
  const [isLowPriority, setIsLowPriority] = useState(task?.isLowPriority ?? false);

  function save() {
    if (!task || !text.trim()) {
      return;
    }
    onSave(task, {
      text: text.trim(),
      note: note.trim(),
      reminderTime: reminderTime.trim() || null,
      pinned: isPinned,
      isLongTerm,
      isLowPriority,
      repeat: {
        ...task.repeat,
        kind: isLongTerm ? "daily" : repeatKind,
        interval: Math.max(1, Number.parseInt(repeatInterval, 10) || 1),
      },
    });
  }

  const repeatSummary = isLongTerm
    ? "每天"
    : repeatKind === "none"
      ? "重复"
      : repeatOptions.find((option) => option.value === repeatKind)?.label ?? "重复";

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={Boolean(task)}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.page, { paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <Pressable
            accessibilityLabel="关闭"
            hitSlop={8}
            onPress={onClose}
            style={styles.iconButton}>
            <AppIcon name="close" color={colors.text} />
          </Pressable>
          <Text style={styles.title}>任务详情</Text>
          <Pressable
            accessibilityLabel="保存"
            disabled={isSaving || !text.trim()}
            onPress={save}
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
            {isSaving ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.saveText}>保存</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <TextInput
              autoFocus={false}
              multiline
              onChangeText={setText}
              placeholder="要完成什么？"
              placeholderTextColor={colors.textMuted}
              style={styles.heroInput}
              value={text}
            />
            <View style={styles.quickActions}>
              <TogglePill
                icon="bookmark-outline"
                label="置顶"
                onPress={() => setIsPinned((current) => !current)}
                selected={isPinned}
              />
              <TogglePill
                icon="infinite-outline"
                label="长期"
                onPress={() => {
                  setIsLongTerm((current) => {
                    const next = !current;
                    if (next) {
                      setIsLowPriority(false);
                    }
                    return next;
                  });
                }}
                selected={isLongTerm}
              />
              <TogglePill
                icon="leaf-outline"
                label="低优先"
                onPress={() => {
                  setIsLowPriority((current) => {
                    const next = !current;
                    if (next) {
                      setIsLongTerm(false);
                    }
                    return next;
                  });
                }}
                selected={isLowPriority}
              />
            </View>
          </View>

          <Field label="提醒">
            <View style={styles.inlineInput}>
              <AppIcon name="time-outline" color={colors.textMuted} size={20} />
              <TextInput
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                onChangeText={setReminderTime}
                placeholder="例如 14:30"
                placeholderTextColor={colors.textMuted}
                style={styles.inlineTextInput}
                value={reminderTime}
              />
            </View>
          </Field>


          <Field label="备注">
            <TextInput
              multiline
              onChangeText={setNote}
              placeholder="补充细节、链接或想法"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.noteInput]}
              textAlignVertical="top"
              value={note}
            />
          </Field>

          {task ? (
            <>
              <AttachmentGallery
                isMutating={isAttachmentMutating}
                onDelete={onDeleteAttachment}
                onReorder={onReorderAttachments}
                onUpload={onUploadAttachment}
                task={task}
              />
              <View style={styles.footerActions}>
                {task.isLongTerm ? (
                  <Pressable
                    onPress={() => onCopyAsRegular(task)}
                    style={({ pressed }) => [
                      styles.copyButton,
                      pressed && styles.pressed,
                    ]}>
                    <AppIcon name="copy-outline" color={colors.accent} size={20} />
                    <Text style={styles.copyText}>复制为普通任务</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => onDelete(task)}
                  style={({ pressed }) => [
                    styles.deleteButton,
                    pressed && styles.pressed,
                  ]}>
                  <AppIcon name="trash-outline" color={colors.danger} size={20} />
                  <Text style={styles.deleteText}>删除任务</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </ScrollView>
        <RepeatMenu
          interval={repeatInterval}
          isLongTerm={isLongTerm}
          onChangeInterval={setRepeatInterval}
          onClose={() => setRepeatMenuOpen(false)}
          onSelect={setRepeatKind}
          repeatKind={isLongTerm ? "daily" : repeatKind}
          visible={repeatMenuOpen}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function TogglePill({
  icon,
  label,
  onPress,
  selected,
}: {
  icon: React.ComponentProps<typeof AppIcon>["name"];
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.togglePill,
        selected && styles.togglePillSelected,
        pressed && styles.pressed,
      ]}>
      <AppIcon
        name={selected && icon === "bookmark-outline" ? "bookmark" : icon}
        color={selected ? colors.white : colors.textMuted}
        size={20}
      />
      <Text style={[styles.togglePillText, selected && styles.togglePillTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  iconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  title: {
    ...typography.section,
    color: colors.text,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    justifyContent: "center",
    minHeight: 40,
    minWidth: 64,
    paddingHorizontal: spacing.md,
  },
  saveText: {
    ...typography.label,
    color: colors.white,
  },
  pressed: {
    opacity: 0.64,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  heroInput: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 30,
    minHeight: 78,
    padding: 0,
    textAlignVertical: "top",
  },
  quickActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  togglePill: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  togglePillSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  togglePillText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "700",
  },
  togglePillTextSelected: {
    color: colors.white,
  },
  field: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  titleInput: {
    fontSize: 18,
    fontWeight: "600",
    minHeight: 58,
  },
  noteInput: {
    minHeight: 128,
  },
  switchGroup: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  switchRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 66,
    paddingHorizontal: spacing.md,
  },
  switchCopy: {
    flex: 1,
  },
  switchLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: "500",
  },
  switchDescription: {
    ...typography.caption,
    color: colors.textMuted,
  },
  inlineInput: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  inlineTextInput: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    paddingVertical: spacing.md,
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  option: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  optionSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  optionDisabled: {
    opacity: 0.58,
  },
  optionText: {
    ...typography.label,
    color: colors.textMuted,
  },
  optionTextSelected: {
    color: colors.accent,
  },
  deleteButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
  },
  deleteText: {
    ...typography.label,
    color: colors.danger,
  },
  footerActions: {
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  copyButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
  },
  copyText: {
    ...typography.label,
    color: colors.accent,
  },
});
