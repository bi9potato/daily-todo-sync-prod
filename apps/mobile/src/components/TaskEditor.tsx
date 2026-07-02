import { useState } from "react";
import * as Location from "expo-location";
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
import DateTimePicker from "@react-native-community/datetimepicker";
import dayjs from "dayjs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "./AppIcon";
import { AttachmentGallery } from "./AttachmentGallery";
import { colors, radius, spacing, typography } from "@/theme";
import type {
  LocalAttachmentFile,
  RepeatKind,
  TaskAttachment,
  TaskLocation,
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

const repeatUnitOptions: { value: Exclude<RepeatKind, "none" | "weekdays">; label: string }[] = [
  { value: "daily", label: "天" },
  { value: "weekly", label: "周" },
  { value: "monthly", label: "月" },
  { value: "yearly", label: "年" },
];

function reminderTimeAsDate(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(
    Number.isFinite(hours) ? hours : 9,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
  return date;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function RepeatMenu({
  interval,
  isLongTerm,
  onChangeInterval,
  onClose,
  onSelect,
  repeatKind,
  visible,
}: {
  interval: string;
  isLongTerm: boolean;
  onChangeInterval: (value: string) => void;
  onClose: () => void;
  onSelect: (kind: RepeatKind) => void;
  repeatKind: RepeatKind;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.menuBackdrop}>
        <Pressable
          accessibilityLabel="关闭重复设置"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.repeatMenu}>
          <View style={styles.sheetHandle} />
          <View style={styles.menuHeader}>
            <AppIcon name="repeat-outline" color={colors.accent} size={22} />
            <Text style={styles.menuTitle}>重复</Text>
          </View>
          <View style={styles.repeatList}>
            {repeatOptions.map((option) => {
              const selected = repeatKind === option.value;
              return (
                <Pressable
                  disabled={isLongTerm && option.value !== "daily"}
                  key={option.value}
                  onPress={() => {
                    onChangeInterval("1");
                    onSelect(option.value);
                  }}
                  accessibilityRole="button"
                  style={[
                    styles.repeatOption,
                    selected && styles.repeatOptionSelected,
                    isLongTerm && option.value !== "daily" && styles.optionDisabled,
                  ]}>
                  <Text style={[styles.repeatOptionText, selected && styles.optionTextSelected]}>
                    {option.label}
                  </Text>
                  <AppIcon
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    color={selected ? colors.accent : colors.borderStrong}
                    size={20}
                  />
                </Pressable>
              );
            })}
          </View>
          <View style={styles.customRepeat}>
            <View style={styles.customRepeatHeader}>
              <AppIcon name="options-outline" color={colors.textMuted} size={19} />
              <Text style={styles.customRepeatTitle}>自定义</Text>
            </View>
            <View style={styles.customRepeatControls}>
              <Text style={styles.customRepeatText}>每</Text>
              <TextInput
                accessibilityLabel="重复间隔"
                editable={!isLongTerm}
                keyboardType="number-pad"
                maxLength={2}
                onChangeText={(value) => onChangeInterval(value.replace(/[^0-9]/g, ""))}
                selectTextOnFocus
                style={styles.intervalInput}
                value={interval}
              />
              <View style={styles.unitSelector}>
                {repeatUnitOptions.map((unit) => {
                  const selected = repeatKind === unit.value;
                  return (
                    <Pressable
                      accessibilityLabel={`每${unit.label}重复`}
                      accessibilityRole="button"
                      disabled={isLongTerm}
                      key={unit.value}
                      onPress={() => onSelect(unit.value)}
                      style={[styles.unitOption, selected && styles.unitOptionSelected]}>
                      <Text style={[styles.unitText, selected && styles.unitTextSelected]}>
                        {unit.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.menuDoneButton}>
            <Text style={styles.menuDoneText}>完成</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}


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
  const [taskLocation, setTaskLocation] = useState<TaskLocation | null>(
    task?.location ?? null,
  );
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  async function useCurrentLocation() {
    setIsLocating(true);
    setLocationError("");
    try {
      if (Platform.OS === "web") {
        throw new Error("请在 Android 或 iOS 客户端中获取当前位置。");
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error("需要位置权限才能记录任务地点。");
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        throw new Error("请先打开系统定位服务。");
      }
      const current = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }),
        8000,
        "定位暂时不可用，请稍后重试。",
      );
      let name = "";
      try {
        const [address] = await Location.reverseGeocodeAsync(current.coords);
        name =
          address?.name ||
          address?.formattedAddress ||
          [address?.district, address?.city].filter(Boolean).join(" · ");
      } catch {
        // Coordinates remain usable when reverse geocoding is unavailable.
      }
      setTaskLocation({
        name:
          name ||
          `${current.coords.latitude.toFixed(5)}, ${current.coords.longitude.toFixed(5)}`,
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        recordedAt: new Date(current.timestamp).toISOString(),
      });
    } catch (error) {
      setLocationError(
        error instanceof Error ? error.message : "无法获取当前位置",
      );
    } finally {
      setIsLocating(false);
    }
  }

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
      location: taskLocation,
    });
  }

  const repeatSummary = isLongTerm
    ? "每天"
    : repeatKind === "none"
      ? "重复"
      : Number.parseInt(repeatInterval, 10) > 1 && repeatKind !== "weekdays"
        ? `每 ${repeatInterval} ${
            repeatUnitOptions.find((option) => option.value === repeatKind)?.label ?? ""
          }`
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
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={styles.iconButton}>
            <AppIcon name="close" color={colors.text} />
          </Pressable>
          <Text style={styles.title}>任务详情</Text>
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
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
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

          <View style={styles.detailsSurface}>
            <View style={styles.detailRow}>
              <AppIcon name="notifications-outline" color={colors.text} size={21} />
              <Text style={styles.detailLabel}>提醒</Text>
              {Platform.OS === "web" ? (
                <TextInput
                  accessibilityLabel="提醒时间"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  onChangeText={setReminderTime}
                  placeholder="无"
                  placeholderTextColor={colors.textMuted}
                  style={styles.detailValueInput}
                  value={reminderTime}
                />
              ) : (
                <View style={styles.reminderControls}>
                  {reminderTime ? (
                    <Pressable
                      accessibilityLabel="清除提醒时间"
                      accessibilityRole="button"
                      onPress={() => setReminderTime("")}
                      style={({ pressed }) => [
                        styles.reminderClear,
                        pressed && styles.pressed,
                      ]}>
                      <AppIcon
                        name="close-circle"
                        color={colors.textMuted}
                        size={19}
                      />
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityLabel="选择提醒时间"
                    accessibilityRole="button"
                    onPress={() => setTimePickerOpen(true)}
                    style={({ pressed }) => [
                      styles.reminderButton,
                      pressed && styles.pressed,
                    ]}>
                    <Text
                      style={[
                        styles.reminderValue,
                        !reminderTime && styles.reminderPlaceholder,
                      ]}>
                      {reminderTime ? reminderTime.slice(0, 5) : "无"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
            {timePickerOpen && Platform.OS !== "web" ? (
              <DateTimePicker
                is24Hour
                mode="time"
                onChange={(event, date) => {
                  setTimePickerOpen(false);
                  if (event.type === "set" && date) {
                    setReminderTime(dayjs(date).format("HH:mm"));
                  }
                }}
                value={reminderTimeAsDate(reminderTime)}
              />
            ) : null}
            <View style={styles.locationBlock}>
              <View style={[styles.detailRow, styles.locationRow]}>
                <AppIcon name="location-outline" color={colors.text} size={21} />
                <View style={styles.locationCopy}>
                  <Text style={styles.detailLabel}>位置</Text>
                  {taskLocation ? (
                    <TextInput
                      accessibilityLabel="任务位置名称"
                      onChangeText={(name) =>
                        setTaskLocation((current) =>
                          current ? { ...current, name } : current,
                        )
                      }
                      placeholder="位置名称"
                      placeholderTextColor={colors.textMuted}
                      style={styles.locationNameInput}
                      value={taskLocation.name}
                    />
                  ) : null}
                </View>
                {isLocating ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={useCurrentLocation}
                    style={({ pressed }) => [
                      styles.locationButton,
                      pressed && styles.pressed,
                    ]}>
                    <Text style={styles.locationButtonText}>
                      {taskLocation ? "更新" : "使用当前位置"}
                    </Text>
                  </Pressable>
                )}
                {taskLocation ? (
                  <Pressable
                    accessibilityLabel="清除任务位置"
                    hitSlop={8}
                    onPress={() => setTaskLocation(null)}
                    style={styles.clearLocationButton}>
                    <AppIcon name="close-circle" color={colors.textMuted} size={20} />
                  </Pressable>
                ) : null}
              </View>
              {locationError ? (
                <Text style={styles.locationError}>{locationError}</Text>
              ) : null}
            </View>
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
          onSelect={(kind) => {
            setRepeatKind(kind);
            if (kind === "none" || kind === "weekdays") {
              setRepeatInterval("1");
            }
          }}
          repeatKind={isLongTerm ? "daily" : repeatKind}
          visible={repeatMenuOpen}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ToggleAction({
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
        styles.toggleAction,
        pressed && styles.pressed,
      ]}>
      <View style={[styles.toggleIcon, selected && styles.toggleIconSelected]}>
        <AppIcon
          name={selected && icon === "bookmark-outline" ? "bookmark" : icon}
          color={selected ? colors.accent : colors.textMuted}
          size={23}
        />
      </View>
      <Text numberOfLines={1} style={[styles.toggleActionText, selected && styles.toggleActionTextSelected]}>
        {label}
      </Text>
    </Pressable>
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
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  heroInput: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 32,
    minHeight: 72,
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
  toggleAction: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 62,
    minWidth: 0,
  },
  toggleIcon: {
    alignItems: "center",
    borderRadius: radius.md,
    height: 36,
    justifyContent: "center",
    width: 44,
  },
  toggleIconSelected: {
    backgroundColor: colors.accentSoft,
  },
  toggleActionText: {
    ...typography.caption,
    color: colors.textMuted,
    maxWidth: "100%",
  },
  toggleActionTextSelected: {
    color: colors.accent,
    fontWeight: "700",
  },
  detailsSurface: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
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
  detailLabel: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  detailValueInput: {
    color: colors.text,
    fontSize: 16,
    minWidth: 76,
    paddingVertical: spacing.sm,
    textAlign: "right",
  },
  reminderControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  reminderClear: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    minWidth: 32,
  },
  reminderButton: {
    alignItems: "flex-end",
    justifyContent: "center",
    minHeight: 40,
    minWidth: 64,
  },
  reminderValue: {
    color: colors.text,
    fontSize: 16,
  },
  reminderPlaceholder: {
    color: colors.textMuted,
  },
  locationBlock: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  locationRow: {
    borderBottomWidth: 0,
    minHeight: 64,
  },
  locationCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  locationNameInput: {
    color: colors.textMuted,
    fontSize: 13,
    margin: 0,
    minHeight: 24,
    padding: 0,
  },
  locationButton: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  locationButtonText: {
    ...typography.label,
    color: colors.accent,
  },
  clearLocationButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  locationError: {
    ...typography.caption,
    color: colors.danger,
    paddingBottom: spacing.sm,
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
  optionDisabled: {
    opacity: 0.58,
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
  menuBackdrop: {
    backgroundColor: "rgba(22, 27, 24, 0.48)",
    flex: 1,
    justifyContent: "flex-end",
  },
  repeatMenu: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: colors.borderStrong,
    borderRadius: radius.full,
    height: 4,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
    width: 38,
  },
  menuHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
  },
  menuTitle: {
    ...typography.section,
    color: colors.text,
    fontSize: 19,
  },
  repeatList: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  repeatOption: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  repeatOptionSelected: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
  },
  repeatOptionText: {
    ...typography.body,
    color: colors.text,
  },
  customRepeat: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  customRepeatHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  customRepeatTitle: {
    ...typography.label,
    color: colors.text,
  },
  customRepeatControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  customRepeatText: {
    ...typography.body,
    color: colors.textMuted,
  },
  intervalInput: {
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    height: 42,
    paddingHorizontal: spacing.sm,
    textAlign: "center",
    width: 52,
  },
  unitSelector: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  unitOption: {
    alignItems: "center",
    flex: 1,
    height: 42,
    justifyContent: "center",
  },
  unitOptionSelected: {
    backgroundColor: colors.accentSoft,
  },
  unitText: {
    ...typography.label,
    color: colors.textMuted,
  },
  unitTextSelected: {
    color: colors.accent,
  },
  menuDoneButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    justifyContent: "center",
    minHeight: 46,
  },
  menuDoneText: {
    ...typography.label,
    color: colors.white,
    fontSize: 15,
  },
});
