import { useCallback, useEffect, useState } from "react";
import * as Location from "expo-location";
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
  Switch,
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
import { ScreenEnter } from "./ScreenEnter";
import {
  hasExactAlarmAccess,
  openExactAlarmSettings,
  openReminderNotificationSettings,
} from "@/lib/android-reminder-settings";
import { useBackPressKeyboardGuard } from "@/lib/keyboard";
import { useKeyboardControllerShim } from "@/lib/useKeyboardControllerShim";
import {
  searchNominatimPlaces,
} from "@/lib/place-search";
import {
  hasLocationReminderPermission,
  requestLocationReminderPermission,
} from "@/lib/location-reminders";
import {
  ensureNotificationPermission,
  ensureReminderNotificationChannel,
  hasNotificationPermission,
  hasUsableReminderNotificationChannel,
} from "@/lib/notifications";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { colors, radius, spacing, typography } from "@/theme";
import type {
  LocalAttachmentFile,
  RepeatKind,
  PlaceSearchResult,
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

// Mirrors the ballpark radius choices Apple/Google Reminders offer: tighter
// than ~100m risks never firing (consumer GPS error alone is often 10-50m,
// worse indoors), wider than ~500m stops reading as "arrival".
const LOCATION_REMINDER_RADIUS_OPTIONS = [100, 150, 300, 500] as const;

type ReminderSettingsTarget =
  | "app-notifications"
  | "exact-alarm"
  | "notification-channel"
  | null;

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
  const handleKeyboardGuard = useBackPressKeyboardGuard(onClose);
  return (
    <Modal
      animationType="fade"
      onRequestClose={handleKeyboardGuard}
      transparent
      visible={visible}>
      <View style={styles.menuBackdrop}>
        <Pressable
          accessibilityLabel="关闭重复设置"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <ScreenEnter style={styles.repeatMenu}>
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
        </ScreenEnter>
      </View>
    </Modal>
  );
}


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
  const [taskLocation, setTaskLocation] = useState<TaskLocation | null>(
    task?.location ?? null,
  );
  const [isLocating, setIsLocating] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [isRequestingLocationReminder, setIsRequestingLocationReminder] =
    useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [reminderPermissionWarning, setReminderPermissionWarning] = useState("");
  const [reminderSettingsTarget, setReminderSettingsTarget] =
    useState<ReminderSettingsTarget>(null);

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

  async function toggleLocationReminder(enabled: boolean) {
    if (!enabled) {
      if (taskLocation) {
        setTaskLocation({ ...taskLocation, reminderEnabled: false });
      }
      return;
    }
    if (!taskLocation) {
      setLocationError("请先输入地点或使用当前位置。");
      return;
    }
    setIsRequestingLocationReminder(true);
    setLocationError("");
    try {
      if (Platform.OS !== "android") {
        throw new Error("到达地点提醒目前仅支持 Android。");
      }
      if (!(await hasLocationReminderPermission())) {
        const shouldContinue = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "允许后台位置",
            "地点提醒需要在应用未打开时判断你是否进入提醒范围。下一步请在系统设置中将位置权限设为“始终允许”。",
            [
              { text: "暂不开启", style: "cancel", onPress: () => resolve(false) },
              { text: "继续", onPress: () => resolve(true) },
            ],
            {
              cancelable: true,
              onDismiss: () => resolve(false),
            },
          );
        });
        if (!shouldContinue || !(await requestLocationReminderPermission())) {
          throw new Error("需要选择“始终允许”位置权限才能在到达时提醒。");
        }
      }
      if (!(await ensureNotificationPermission())) {
        throw new Error("需要开启通知权限，到达地点后才能弹出提醒。");
      }
      setTaskLocation({ ...taskLocation, reminderEnabled: true });
    } catch (error) {
      setLocationError(
        error instanceof Error ? error.message : "开启到达提醒失败",
      );
    } finally {
      setIsRequestingLocationReminder(false);
    }
  }

  async function searchLocation(address: string) {
    const query = address.trim();
    if (!query) {
      setLocationError("请输入地点或地址。");
      return [];
    }
    setIsSearchingLocation(true);
    setLocationError("");
    try {
      return await withTimeout(
        searchNominatimPlaces(query),
        12_000,
        "地点查找超时，请稍后重试。",
      );
    } catch (error) {
      setLocationError(
        error instanceof Error ? error.message : "无法查找这个地点",
      );
      return [];
    } finally {
      setIsSearchingLocation(false);
    }
  }

  function selectSearchResult(result: PlaceSearchResult) {
    setLocationError("");
    setTaskLocation({
      name: result.name,
      latitude: result.latitude,
      longitude: result.longitude,
      recordedAt: new Date().toISOString(),
      reminderEnabled: taskLocation?.reminderEnabled ?? false,
      radiusMeters: Math.max(100, taskLocation?.radiusMeters ?? 150),
    });
  }

  async function captureCurrentLocation() {
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
      // The platform Geocoder resolves through whatever backend the OEM
      // wired in - on Chinese ROMs that is typically a GCJ-02-offset vendor
      // service, which mismatches the raw WGS84 GPS coordinate above and
      // silently resolves the wrong building/street (see the identical fix
      // and full rationale in reverse-geocode.ts, originally applied to
      // mobility visit points).
      const name = await reverseGeocode(
        current.coords.latitude,
        current.coords.longitude,
      ).catch(() => null);
      setTaskLocation({
        name:
          name ||
          `${current.coords.latitude.toFixed(5)}, ${current.coords.longitude.toFixed(5)}`,
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        recordedAt: new Date(current.timestamp).toISOString(),
        reminderEnabled: taskLocation?.reminderEnabled ?? false,
        radiusMeters: taskLocation?.radiusMeters ?? 150,
      });
    } catch (error) {
      setLocationError(
        error instanceof Error ? error.message : "无法获取当前位置",
      );
    } finally {
      setIsLocating(false);
    }
  }

  async function save() {
    if (!task || !text.trim()) {
      return;
    }
    if (Platform.OS === "android" && reminderTime) {
      const reminderDate = new Date(
        `${task.taskDate}T${reminderTime.slice(0, 5)}:00`,
      );
      if (
        Number.isNaN(reminderDate.getTime()) ||
        reminderDate.getTime() <= Date.now()
      ) {
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
      onRequestClose={handleKeyboardGuard}
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
                  onToggleLocationReminder={(enabled) =>
                    void toggleLocationReminder(enabled)
                  }
                  onUseCurrentLocation={() => void captureCurrentLocation()}
                  reminderPermissionWarning={reminderPermissionWarning}
                  reminderTime={reminderTime}
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
              <>
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
                    setReminderPermissionWarning("");
                    void ensureNotificationPermission().then((granted) => {
                      if (!granted) {
                        setReminderPermissionWarning(
                          "需要开启通知权限，提醒才能弹出。",
                        );
                      }
                    });
                  }
                }}
                value={reminderTimeAsDate(reminderTime)}
              />
            ) : null}
            {reminderPermissionWarning ? (
              <Text style={styles.reminderWarning}>{reminderPermissionWarning}</Text>
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
                    onPress={captureCurrentLocation}
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
              {taskLocation ? (
                <View style={styles.locationReminderRow}>
                  <View style={styles.locationReminderToggle}>
                    <AppIcon
                      name="navigate-circle-outline"
                      color={colors.textMuted}
                      size={18}
                    />
                    <Text style={styles.locationReminderLabel}>到达时提醒</Text>
                    {isRequestingLocationReminder ? (
                      <ActivityIndicator color={colors.accent} size="small" />
                    ) : (
                      <Switch
                        accessibilityLabel="到达时提醒"
                        onValueChange={(enabled) =>
                          void toggleLocationReminder(enabled)
                        }
                        trackColor={{
                          false: colors.borderStrong,
                          true: colors.accent,
                        }}
                        thumbColor={colors.white}
                        value={taskLocation.reminderEnabled}
                      />
                    )}
                  </View>
                  {taskLocation.reminderEnabled ? (
                    <View style={styles.radiusOptions}>
                      {LOCATION_REMINDER_RADIUS_OPTIONS.map((radius) => {
                        const selected = taskLocation.radiusMeters === radius;
                        return (
                          <Pressable
                            accessibilityLabel={`提醒范围 ${radius} 米`}
                            accessibilityRole="button"
                            key={radius}
                            onPress={() =>
                              setTaskLocation((current) =>
                                current ? { ...current, radiusMeters: radius } : current,
                              )
                            }
                            style={[
                              styles.radiusChip,
                              selected && styles.radiusChipSelected,
                            ]}>
                            <Text
                              style={[
                                styles.radiusChipText,
                                selected && styles.radiusChipTextSelected,
                              ]}>
                              {radius}m
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ) : null}
              {locationError ? (
                <Text style={styles.locationError}>{locationError}</Text>
              ) : null}
            </View>
              </>
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
  reminderWarning: {
    ...typography.caption,
    color: colors.danger,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
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
  locationReminderRow: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  locationReminderToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  locationReminderLabel: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  radiusOptions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  radiusChip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  radiusChipSelected: {
    backgroundColor: colors.accent,
  },
  radiusChipText: {
    ...typography.label,
    color: colors.textMuted,
    fontSize: 12,
  },
  radiusChipTextSelected: {
    color: colors.white,
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
