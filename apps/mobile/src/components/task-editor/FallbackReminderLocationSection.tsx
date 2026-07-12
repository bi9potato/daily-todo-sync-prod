import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import dayjs from "dayjs";

import { AppIcon } from "@/components/AppIcon";
import { ensureNotificationPermission } from "@/lib/notifications";
import { reminderTimeAsDate } from "@/lib/task-reminder-time";
import { colors, radius, spacing, typography } from "@/theme";
import type { TaskLocation } from "@/types";

// Mirrors the ballpark radius choices Apple/Google Reminders offer: tighter
// than ~100m risks never firing (consumer GPS error alone is often 10-50m,
// worse indoors), wider than ~500m stops reading as "arrival".
const LOCATION_REMINDER_RADIUS_OPTIONS = [100, 150, 300, 500] as const;

// The reminder + location rows for platforms without the Android-native
// reminder settings panel (iOS and web). Android renders
// AndroidReminderSettings instead; permission handling here is limited to
// the basic notification prompt.
export function FallbackReminderLocationSection({
  isLocating,
  isRequestingLocationReminder,
  locationError,
  onCaptureCurrentLocation,
  onChangeLocation,
  onChangeReminderTime,
  onToggleLocationReminder,
  reminderTime,
  taskLocation,
}: {
  isLocating: boolean;
  isRequestingLocationReminder: boolean;
  locationError: string;
  onCaptureCurrentLocation: () => void;
  onChangeLocation: (
    update: (current: TaskLocation | null) => TaskLocation | null,
  ) => void;
  onChangeReminderTime: (value: string) => void;
  onToggleLocationReminder: (enabled: boolean) => void;
  reminderTime: string;
  taskLocation: TaskLocation | null;
}) {
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [reminderPermissionWarning, setReminderPermissionWarning] =
    useState("");

  return (
    <>
      <View style={styles.detailRow}>
        <AppIcon name="notifications-outline" color={colors.text} size={21} />
        <Text style={styles.detailLabel}>提醒</Text>
        {Platform.OS === "web" ? (
          <TextInput
            accessibilityLabel="提醒时间"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            onChangeText={onChangeReminderTime}
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
                onPress={() => onChangeReminderTime("")}
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
              onChangeReminderTime(dayjs(date).format("HH:mm"));
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
                  onChangeLocation((current) =>
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
              onPress={onCaptureCurrentLocation}
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
              onPress={() => onChangeLocation(() => null)}
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
                  onValueChange={onToggleLocationReminder}
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
                        onChangeLocation((current) =>
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
  );
}

const styles = StyleSheet.create({
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
  pressed: {
    opacity: 0.64,
  },
});
