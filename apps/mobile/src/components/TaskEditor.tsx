import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import dayjs from "dayjs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "./AppIcon";
import { AndroidReminderSettings } from "./AndroidReminderSettings";
import { AttachmentGallery } from "./AttachmentGallery";
import { FallbackReminderLocationSection } from "./task-editor/FallbackReminderLocationSection";
import { RepeatMenu } from "./task-editor/RepeatMenu";
import { ToggleAction } from "./task-editor/ToggleAction";
import {
  hasExactAlarmAccess,
  hasReminderBatteryExemption,
  openExactAlarmSettings,
  openReminderBatteryOptimizationSettings,
  openReminderNotificationSettings,
} from "@/lib/android-reminder-settings";
import { useBackPressKeyboardGuard } from "@/lib/keyboard";
import { useKeyboardControllerShim } from "@/lib/useKeyboardControllerShim";
import {
  ensureNotificationPermission,
  ensureReminderNotificationChannel,
  hasNotificationPermission,
  hasUsableReminderNotificationChannel,
} from "@/lib/notifications";
import {
  isReminderTimeUpcoming,
  reminderTimeAsDate,
} from "@/lib/task-reminder-time";
import {
  normalizedRepeatInterval,
  repeatSummaryLabel,
} from "@/lib/task-repeat";
import { useTaskLocationEditor } from "@/lib/useTaskLocationEditor";
import { colors, radius, spacing, typography } from "@/theme";
import type {
  LocalAttachmentFile,
  RepeatKind,
  TaskAttachment,
  TaskUpdatePayload,
  TodoOccurrence,
} from "@/types";

type ReminderSettingsTarget =
  | "app-notifications"
  | "exact-alarm"
  | "notification-channel"
  | "battery-optimization"
  | null;

type TaskEditorProps = {
  task: TodoOccurrence | null;
  isAttachmentMutating: boolean;
  isSaving: boolean;
  onArchive: (task: TodoOccurrence) => void;
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
  onArchive,
  onClose,
  onCopyAsRegular,
  onDelete,
  onDeleteAttachment,
  onReorderAttachments,
  onSave,
  onUploadAttachment,
}: TaskEditorProps) {
  const insets = useSafeAreaInsets();
  const handleKeyboardGuard = useBackPressKeyboardGuard(onClose);
  // KeyboardAvoidingView's "padding" behavior below is iOS-only (see its
  // `behavior` prop): Android got nothing, so the IME simply overlaid the
  // sheet and covered whatever field -- almost always the note, since it
  // sits lowest in the scroll content -- was actually focused. Pad the
  // ScrollView's content by the keyboard's height instead, the same
  // approach Composer.tsx already uses for this exact Android gap.
  const { keyboardInset } = useKeyboardControllerShim(insets.bottom);
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
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [reminderPermissionWarning, setReminderPermissionWarning] = useState("");
  const [reminderSettingsTarget, setReminderSettingsTarget] =
    useState<ReminderSettingsTarget>(null);
  // The editor body (reminder settings, attachments, repeat menu) is the
  // expensive part of this modal; mounting it during the slide-in animation
  // is what made opening feel janky. Defer it to the Modal's onShow, which
  // fires once the animation has settled.
  const visible = Boolean(task);
  const [contentReady, setContentReady] = useState(false);
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (!visible) {
      setContentReady(false);
    }
  }
  const {
    captureCurrentLocation,
    isLocating,
    isRequestingLocationReminder,
    isSearchingLocation,
    locationError,
    searchLocation,
    selectSearchResult,
    setTaskLocation,
    taskLocation,
    toggleLocationReminder,
  } = useTaskLocationEditor(task?.location ?? null);

  const checkAndroidTimeReminderAccess = useCallback(
    async (requestNotificationAccess: boolean) => {
      if (Platform.OS !== "android") {
        return true;
      }
      try {
        await ensureReminderNotificationChannel();
        const notificationsGranted = requestNotificationAccess
          ? await ensureNotificationPermission()
          : await hasNotificationPermission();
        if (!notificationsGranted) {
          setReminderPermissionWarning("请开启通知权限，时间提醒才能弹出并响铃。");
          setReminderSettingsTarget("app-notifications");
          return false;
        }
        if (!(await hasExactAlarmAccess())) {
          setReminderPermissionWarning(
            "请允许“闹钟和提醒”权限，确保时间提醒按时触发。",
          );
          setReminderSettingsTarget("exact-alarm");
          return false;
        }
        if (!(await hasUsableReminderNotificationChannel())) {
          setReminderPermissionWarning(
            "任务提醒类别已被静音或关闭，请在系统设置中允许弹出和响铃。",
          );
          setReminderSettingsTarget("notification-channel");
          return false;
        }
        if (!(await hasReminderBatteryExemption())) {
          // Softer than the checks above: exact alarms already bypass Doze
          // for firing time, so this isn't a hard failure, just a
          // device-dependent reliability risk (some OEM battery managers,
          // e.g. Samsung's "sleeping apps" bucket, can still throttle a
          // backgrounded app). Warn, but don't block saving the reminder.
          setReminderPermissionWarning(
            "系统电池优化可能会延迟或压低提醒，建议允许该应用不受限制地后台运行。",
          );
          setReminderSettingsTarget("battery-optimization");
          return true;
        }
        setReminderPermissionWarning("");
        setReminderSettingsTarget(null);
        return true;
      } catch {
        setReminderPermissionWarning(
          "无法初始化任务提醒，请在系统通知设置中检查提醒类别。",
        );
        setReminderSettingsTarget("notification-channel");
        return false;
      }
    },
    [],
  );

  useEffect(() => {
    if (Platform.OS !== "android" || !reminderTime) {
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void checkAndroidTimeReminderAccess(false);
      }
    });
    return () => subscription.remove();
  }, [checkAndroidTimeReminderAccess, reminderTime]);

  async function save() {
    if (!task || !text.trim()) {
      return;
    }
    if (Platform.OS === "android" && reminderTime) {
      if (!isReminderTimeUpcoming(task.taskDate, reminderTime)) {
        Alert.alert("提醒时间已过", "请选择任务日期内尚未到达的时间。");
        return;
      }
      if (!(await checkAndroidTimeReminderAccess(true))) {
        return;
      }
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
        interval: normalizedRepeatInterval(repeatInterval),
      },
      location: taskLocation,
    });
  }

  const repeatSummary = repeatSummaryLabel(isLongTerm, repeatKind, repeatInterval);

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleKeyboardGuard}
      onShow={() => setContentReady(true)}
      presentationStyle="pageSheet"
      visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.page, { paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <Pressable
            accessibilityLabel="关闭"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={styles.iconButton}>
            <AppIcon name="close" color={colors.text} />
          </Pressable>
          <Text style={styles.title}>任务详情</Text>
          {Platform.OS !== "android" ? (
            <Pressable
              accessibilityLabel="保存"
              accessibilityRole="button"
              disabled={isSaving || !text.trim()}
              onPress={save}
              style={({ pressed }) => [
                styles.saveButton,
                (!text.trim() || isSaving) && styles.saveButtonDisabled,
                pressed && styles.pressed,
              ]}>
              {isSaving ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <AppIcon name="checkmark" color={colors.white} size={24} />
              )}
            </Pressable>
          ) : (
            <View style={styles.iconButton} />
          )}
        </View>

        {!contentReady ? (
          <View style={styles.contentLoading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}
        {contentReady ? (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            Platform.OS === "android" && { paddingBottom: spacing.xxl + keyboardInset },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
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
            <ToggleAction
              icon="bookmark-outline"
              label="置顶"
              onPress={() => setIsPinned((current) => !current)}
              selected={isPinned}
            />
            <ToggleAction
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
            <ToggleAction
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
            <ToggleAction
              icon="repeat-outline"
              label={repeatSummary}
              onPress={() => setRepeatMenuOpen(true)}
              selected={isLongTerm || repeatKind !== "none"}
            />
          </View>

          <View
            style={[
              styles.detailsSurface,
              Platform.OS === "android" && styles.androidDetailsSurface,
            ]}>
            {Platform.OS === "android" ? (
              <>
                <AndroidReminderSettings
                  isLocationBusy={isLocating || isSearchingLocation}
                  isRequestingLocationReminder={isRequestingLocationReminder}
                  location={taskLocation}
                  locationError={locationError}
                  onChangeLocationName={(name) =>
                    setTaskLocation((current) =>
                      current ? { ...current, name } : current,
                    )
                  }
                  onChangeRadius={(radiusMeters) =>
                    setTaskLocation((current) =>
                      current ? { ...current, radiusMeters } : current,
                    )
                  }
                  onClearLocation={() => setTaskLocation(null)}
                  onClearTime={() => {
                    setReminderTime("");
                    setReminderPermissionWarning("");
                    setReminderSettingsTarget(null);
                  }}
                  onOpenReminderSettings={() => {
                    const openSettings =
                      reminderSettingsTarget === "exact-alarm"
                        ? openExactAlarmSettings
                        : reminderSettingsTarget === "notification-channel"
                          ? openReminderNotificationSettings
                          : reminderSettingsTarget === "battery-optimization"
                            ? openReminderBatteryOptimizationSettings
                            : Linking.openSettings;
                    void openSettings().catch(() => {
                      Alert.alert(
                        "无法打开系统设置",
                        "请手动进入系统设置，检查 Daily Todo 的通知及“闹钟和提醒”权限。",
                      );
                    });
                  }}
                  onOpenTimePicker={() => setTimePickerOpen(true)}
                  onSearchLocation={searchLocation}
                  onSelectSearchResult={selectSearchResult}
                  onSelectTime={(time) => {
                    setReminderTime(time);
                    setReminderPermissionWarning("");
                    setReminderSettingsTarget(null);
                    void checkAndroidTimeReminderAccess(true);
                  }}
                  onToggleLocationReminder={(enabled) =>
                    void toggleLocationReminder(enabled)
                  }
                  onUseCurrentLocation={() => void captureCurrentLocation()}
                  reminderPermissionWarning={reminderPermissionWarning}
                  reminderTime={reminderTime}
                  taskDate={task?.taskDate ?? ""}
                />
                {timePickerOpen ? (
                  <DateTimePicker
                    is24Hour
                    mode="time"
                    onChange={(event, date) => {
                      setTimePickerOpen(false);
                      if (event.type === "set" && date) {
                        setReminderTime(dayjs(date).format("HH:mm"));
                        setReminderPermissionWarning("");
                        setReminderSettingsTarget(null);
                        void checkAndroidTimeReminderAccess(true);
                      }
                    }}
                    value={reminderTimeAsDate(reminderTime)}
                  />
                ) : null}
              </>
            ) : (
              <FallbackReminderLocationSection
                isLocating={isLocating}
                isRequestingLocationReminder={isRequestingLocationReminder}
                locationError={locationError}
                onCaptureCurrentLocation={() => void captureCurrentLocation()}
                onChangeLocation={setTaskLocation}
                onChangeReminderTime={setReminderTime}
                onToggleLocationReminder={(enabled) =>
                  void toggleLocationReminder(enabled)
                }
                reminderTime={reminderTime}
                taskLocation={taskLocation}
              />
            )}
            <View style={[styles.detailRow, styles.noteRow]}>
              <AppIcon name="document-text-outline" color={colors.text} size={21} />
              <View style={styles.noteContent}>
                <TextInput
                  accessibilityLabel="备注"
                  multiline
                  onChangeText={setNote}
                  placeholder="添加备注"
                  placeholderTextColor={colors.textMuted}
                  style={styles.noteInput}
                  textAlignVertical="top"
                  value={note}
                />
                {task ? (
                  <AttachmentGallery
                    isMutating={isAttachmentMutating}
                    onDelete={onDeleteAttachment}
                    onReorder={onReorderAttachments}
                    onUpload={onUploadAttachment}
                    task={task}
                  />
                ) : null}
              </View>
            </View>
          </View>

          {task ? (
            <>
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
                {task.isLongTerm && !task.isArchived ? (
                  <Pressable
                    onPress={() => onArchive(task)}
                    style={({ pressed }) => [
                      styles.copyButton,
                      pressed && styles.pressed,
                    ]}>
                    <AppIcon name="archive-outline" color={colors.accent} size={20} />
                    <Text style={styles.copyText}>归档</Text>
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
        ) : null}
        {Platform.OS === "android" ? (
          // One UI-style bottom action bar (Samsung Reminders): full-width
          // 取消/保存 instead of a small header icon.
          <View style={styles.bottomBar}>
            <Pressable
              accessibilityLabel="取消"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.bottomAction,
                pressed && styles.bottomActionPressed,
              ]}>
              <Text style={styles.bottomActionText}>取消</Text>
            </Pressable>
            <View style={styles.bottomBarDivider} />
            <Pressable
              accessibilityLabel="保存"
              accessibilityRole="button"
              disabled={isSaving || !text.trim()}
              onPress={save}
              style={({ pressed }) => [
                styles.bottomAction,
                pressed && styles.bottomActionPressed,
              ]}>
              {isSaving ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text
                  style={[
                    styles.bottomActionText,
                    styles.bottomActionPrimary,
                    !text.trim() && styles.bottomActionDisabled,
                  ]}>
                  保存
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}
        {contentReady ? (
          <RepeatMenu
            interval={repeatInterval}
            isLongTerm={isLongTerm}
            onChangeInterval={setRepeatInterval}
            onClose={() => setRepeatMenuOpen(false)}
            onSelect={(kind) => {
              setRepeatKind(kind);
              if (kind === "none" || kind === "weekdays") {
                setRepeatInterval("1");
              }
            }}
            repeatKind={isLongTerm ? "daily" : repeatKind}
            visible={repeatMenuOpen}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.surface,
    flex: 1,
  },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
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
    borderRadius: radius.full,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  saveButtonDisabled: {
    opacity: 0.42,
  },
  pressed: {
    opacity: 0.64,
  },
  content: {
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  heroInput: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 30,
    minHeight: 56,
    padding: 0,
    textAlignVertical: "top",
  },
  quickActions: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingVertical: spacing.sm,
  },
  detailsSurface: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  androidDetailsSurface: {
    backgroundColor: "transparent",
    borderWidth: 0,
    gap: spacing.md,
    overflow: "visible",
  },
  detailRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  noteRow: {
    alignItems: "flex-start",
    borderBottomWidth: 0,
    minHeight: 118,
    paddingTop: spacing.md,
  },
  noteContent: {
    flex: 1,
    minWidth: 0,
  },
  noteInput: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 23,
    minHeight: 76,
    padding: 0,
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
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.xs,
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
  contentLoading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  bottomBar: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 54,
  },
  bottomBarDivider: {
    backgroundColor: colors.border,
    height: 22,
    width: StyleSheet.hairlineWidth,
  },
  bottomAction: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 54,
  },
  bottomActionPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  bottomActionText: {
    ...typography.body,
    color: colors.text,
    fontWeight: "600",
  },
  bottomActionPrimary: {
    color: colors.accent,
    fontWeight: "800",
  },
  bottomActionDisabled: {
    opacity: 0.4,
  },
});
