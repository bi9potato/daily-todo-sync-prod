import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";

import { AppIcon } from "./AppIcon";
import { isReminderTimeUpcoming } from "@/lib/task-reminder-time";
import { toDateKey } from "@/lib/date";
import { colors, radius, spacing, typography } from "@/theme";
import type { PlaceSearchResult, TaskLocation } from "@/types";

const MIN_RADIUS_METERS = 100;
const MAX_RADIUS_METERS = 2_000;

function formatRadius(value: number) {
  return value >= 1_000
    ? `${Number((value / 1_000).toFixed(1))} 公里`
    : `${value} 米`;
}

function clampRadius(value: number) {
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, value));
}

// The quick suggestions Samsung Reminders offers before the full picker;
// past slots are hidden when the task is for today.
const TIME_PRESETS = [
  { label: "上午 9:00", time: "09:00" },
  { label: "下午 3:00", time: "15:00" },
  { label: "晚上 8:00", time: "20:00" },
] as const;

// Samsung's "1 hour from now" quick condition; only meaningful for today's
// tasks and only while it still lands inside the same day.
function oneHourFromNow(): string | null {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  if (date.getDate() !== new Date().getDate()) {
    return null;
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

type AndroidReminderSettingsProps = {
  isLocationBusy: boolean;
  isRequestingLocationReminder: boolean;
  location: TaskLocation | null;
  locationError: string;
  onChangeLocationName: (name: string) => void;
  onChangeRadius: (radiusMeters: number) => void;
  onClearLocation: () => void;
  onClearTime: () => void;
  onOpenReminderSettings: () => void;
  onOpenTimePicker: () => void;
  onSearchLocation: (address: string) => Promise<PlaceSearchResult[]>;
  onSelectSearchResult: (result: PlaceSearchResult) => void;
  onSelectTime: (time: string) => void;
  onUseCurrentLocation: () => void;
  reminderPermissionWarning: string;
  reminderTime: string;
  taskDate: string;
};

// Compact reminder rows in the Microsoft To Do style: one slim line per
// reminder kind, icon + value, accent color when armed, detail editors only
// while actually editing. Replaces the old card with 40px icon circles,
// two-line rows, and permanent helper copy.
export function AndroidReminderSettings({
  isLocationBusy,
  isRequestingLocationReminder,
  location,
  locationError,
  onChangeLocationName,
  onChangeRadius,
  onClearLocation,
  onClearTime,
  onOpenReminderSettings,
  onOpenTimePicker,
  onSearchLocation,
  onSelectSearchResult,
  onSelectTime,
  onUseCurrentLocation,
  reminderPermissionWarning,
  reminderTime,
  taskDate,
}: AndroidReminderSettingsProps) {
  const [address, setAddress] = useState(location?.name ?? "");
  // The location editor is heavy; keep it closed unless there is nothing
  // configured yet (first-time setup) or the user opens it.
  const [isLocationExpanded, setIsLocationExpanded] = useState(false);
  const [isTimeExpanded, setIsTimeExpanded] = useState(false);
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const locationReminderEnabled = Boolean(location?.reminderEnabled);
  const hasTime = Boolean(reminderTime);
  const isForToday = taskDate === toDateKey(new Date());
  const presets = TIME_PRESETS.filter(
    (preset) => !isForToday || isReminderTimeUpcoming(taskDate, preset.time),
  );
  const inOneHour = isForToday ? oneHourFromNow() : null;

  async function handleSearch() {
    if (!address.trim()) {
      return;
    }
    const results = await onSearchLocation(address);
    setSearchResults(results);
    setHasSearched(true);
  }

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityLabel={hasTime ? `时间提醒 ${reminderTime.slice(0, 5)}` : "添加时间提醒"}
        accessibilityRole="button"
        onPress={() =>
          hasTime
            ? onOpenTimePicker()
            : setIsTimeExpanded((current) => !current)
        }
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <AppIcon
          name={hasTime ? "alarm" : "alarm-outline"}
          color={hasTime ? colors.accent : colors.textMuted}
          size={20}
        />
        {hasTime ? (
          <>
            <View style={styles.rowChipArea}>
              <View style={styles.valueChip}>
                <Text style={styles.valueChipText}>{reminderTime.slice(0, 5)}</Text>
                <Pressable
                  accessibilityLabel="清除时间提醒"
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={onClearTime}>
                  <AppIcon name="close-circle" color={colors.accent} size={17} />
                </Pressable>
              </View>
            </View>
            <AppIcon name="chevron-forward" color={colors.textMuted} size={16} />
          </>
        ) : (
          <>
            <Text style={styles.rowLabel}>时间</Text>
            <AppIcon
              name={isTimeExpanded ? "chevron-up" : "chevron-down"}
              color={colors.textMuted}
              size={16}
            />
          </>
        )}
      </Pressable>

      {!hasTime && isTimeExpanded ? (
        // Samsung Reminders-style quick conditions before the full picker
        // ("1 hour from now" / preset slots / date-time picker).
        <View style={styles.presetRow}>
          {inOneHour ? (
            <Pressable
              accessibilityLabel="1 小时后提醒"
              accessibilityRole="button"
              onPress={() => {
                setIsTimeExpanded(false);
                onSelectTime(inOneHour);
              }}
              style={({ pressed }) => [
                styles.presetChip,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.presetChipText}>1 小时后</Text>
            </Pressable>
          ) : null}
          {presets.map((preset) => (
            <Pressable
              accessibilityLabel={`提醒时间 ${preset.label}`}
              accessibilityRole="button"
              key={preset.time}
              onPress={() => {
                setIsTimeExpanded(false);
                onSelectTime(preset.time);
              }}
              style={({ pressed }) => [
                styles.presetChip,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.presetChipText}>{preset.label}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityLabel="自定义提醒时间"
            accessibilityRole="button"
            onPress={() => {
              setIsTimeExpanded(false);
              onOpenTimePicker();
            }}
            style={({ pressed }) => [
              styles.presetChip,
              styles.presetChipCustom,
              pressed && styles.pressed,
            ]}>
            <AppIcon name="time-outline" color={colors.accent} size={14} />
            <Text style={styles.presetChipCustomText}>自定义</Text>
          </Pressable>
        </View>
      ) : null}

      {reminderPermissionWarning ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenReminderSettings}
          style={styles.warningRow}>
          <AppIcon name="warning-outline" color={colors.danger} size={16} />
          <Text style={styles.warningText}>{reminderPermissionWarning}</Text>
          <AppIcon name="chevron-forward" color={colors.danger} size={15} />
        </Pressable>
      ) : null}

      <View style={styles.divider} />

      <Pressable
        accessibilityHint={isLocationExpanded ? "收起地点设置" : "展开地点设置"}
        accessibilityRole="button"
        onPress={() => setIsLocationExpanded((current) => !current)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <AppIcon
          name={location ? "location" : "location-outline"}
          color={location ? colors.accent : colors.textMuted}
          size={20}
        />
        {location ? (
          // Samsung semantics: a chosen place IS the condition. The pill
          // reads "到达 · 地点名"; its ✕ removes the condition entirely.
          <>
            <View style={styles.rowChipArea}>
              <View style={styles.valueChip}>
                <Text numberOfLines={1} style={styles.valueChipText}>
                  {locationReminderEnabled ? "到达 · " : ""}
                  {location.name || "已选地点"}
                </Text>
                {isRequestingLocationReminder ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Pressable
                    accessibilityLabel="移除地点条件"
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() => {
                      setAddress("");
                      setIsLocationExpanded(false);
                      onClearLocation();
                    }}>
                    <AppIcon name="close-circle" color={colors.accent} size={17} />
                  </Pressable>
                )}
              </View>
            </View>
            <AppIcon
              name={isLocationExpanded ? "chevron-up" : "chevron-down"}
              color={colors.textMuted}
              size={16}
            />
          </>
        ) : (
          <>
            <Text style={styles.rowLabel}>地点</Text>
            {isRequestingLocationReminder ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <AppIcon
                name={isLocationExpanded ? "chevron-up" : "chevron-down"}
                color={colors.textMuted}
                size={16}
              />
            )}
          </>
        )}
      </Pressable>

      {isLocationExpanded ? (
        <View style={styles.locationEditor}>
          <View style={styles.searchRow}>
            <AppIcon name="search-outline" color={colors.textMuted} size={18} />
            <TextInput
              accessibilityLabel="输入地点或地址"
              autoCorrect={false}
              onChangeText={setAddress}
              onSubmitEditing={() => void handleSearch()}
              placeholder="搜索地点"
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              style={styles.searchInput}
              value={address}
            />
            {isLocationBusy ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <Pressable
                accessibilityLabel="使用当前位置"
                accessibilityRole="button"
                disabled={isLocationBusy}
                hitSlop={8}
                onPress={onUseCurrentLocation}
                style={({ pressed }) => [
                  styles.trailingButton,
                  pressed && styles.pressed,
                ]}>
                <AppIcon name="locate-outline" color={colors.accent} size={20} />
              </Pressable>
            )}
          </View>

          {searchResults.length ? (
            <View style={styles.searchResults}>
              {searchResults.map((result) => (
                <Pressable
                  accessibilityRole="button"
                  key={result.id}
                  onPress={() => {
                    setAddress(result.name);
                    setSearchResults([]);
                    setHasSearched(false);
                    onSelectSearchResult(result);
                  }}
                  style={({ pressed }) => [
                    styles.searchResult,
                    pressed && styles.pressed,
                  ]}>
                  <AppIcon
                    name="location-outline"
                    color={colors.accent}
                    size={17}
                  />
                  <View style={styles.searchResultCopy}>
                    <Text numberOfLines={1} style={styles.searchResultName}>
                      {result.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.searchResultAddress}>
                      {result.address}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : hasSearched && !isLocationBusy ? (
            <Text style={styles.hint}>没有找到结果，试试补充城市或道路</Text>
          ) : null}

          {location ? (
            <>
              <View style={styles.selectedLocation}>
                <TextInput
                  accessibilityLabel="地点名称"
                  onChangeText={(name) => {
                    setAddress(name);
                    onChangeLocationName(name);
                  }}
                  style={styles.selectedLocationName}
                  value={location.name}
                />
                <Pressable
                  accessibilityLabel="清除地点"
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={() => {
                    setAddress("");
                    onClearLocation();
                  }}
                  style={styles.trailingButton}>
                  <AppIcon name="close-circle" color={colors.textMuted} size={19} />
                </Pressable>
              </View>
              <View style={styles.radiusHeader}>
                <AppIcon name="radio-outline" color={colors.textMuted} size={17} />
                <Slider
                  accessibilityLabel="到达提醒半径"
                  accessibilityValue={{
                    min: MIN_RADIUS_METERS,
                    max: MAX_RADIUS_METERS,
                    now: location.radiusMeters,
                    text: formatRadius(location.radiusMeters),
                  }}
                  maximumTrackTintColor={colors.border}
                  maximumValue={MAX_RADIUS_METERS}
                  minimumTrackTintColor={colors.accent}
                  minimumValue={MIN_RADIUS_METERS}
                  onValueChange={(value) =>
                    onChangeRadius(clampRadius(Math.round(value)))
                  }
                  step={50}
                  style={styles.slider}
                  thumbTintColor={colors.accent}
                  value={clampRadius(location.radiusMeters)}
                />
                <Text style={styles.radiusValue}>
                  {formatRadius(location.radiusMeters)}
                </Text>
              </View>
            </>
          ) : null}

          {locationError ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {locationError}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              void Linking.openURL("https://www.openstreetmap.org/copyright")
            }
            style={styles.attribution}>
            <Text style={styles.attributionText}>© OpenStreetMap</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Flat One UI-style rows (Samsung Reminders): no card chrome, icons
  // aligned with the editor's title input, hairline separators only.
  card: {
    backgroundColor: "transparent",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
  },
  rowMain: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minWidth: 0,
    // Keep the whole slim row tappable without growing its visual height.
    minHeight: 54,
  },
  rowLabel: {
    ...typography.body,
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
  },
  rowLabelActive: {
    color: colors.accent,
    fontWeight: "600",
  },
  rowChipArea: {
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  valueChip: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.full,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 32,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  valueChipText: {
    ...typography.label,
    color: colors.accent,
    flexShrink: 1,
    fontWeight: "700",
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    paddingLeft: 20 + spacing.sm,
  },
  presetChip: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  presetChipText: {
    ...typography.label,
    color: colors.text,
    fontSize: 13,
  },
  presetChipCustom: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  presetChipCustomText: {
    ...typography.label,
    color: colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  trailingButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 32,
  },
  divider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginLeft: 20 + spacing.sm,
  },
  warningRow: {
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  warningText: {
    ...typography.caption,
    color: colors.danger,
    flex: 1,
  },
  locationEditor: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.sm,
  },
  searchRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    minWidth: 0,
    paddingVertical: spacing.xs,
  },
  searchResults: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  searchResult: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  searchResultCopy: {
    flex: 1,
    minWidth: 0,
  },
  searchResultName: {
    ...typography.label,
    color: colors.text,
    fontSize: 14,
  },
  searchResultAddress: {
    ...typography.caption,
    color: colors.textMuted,
  },
  selectedLocation: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  selectedLocationName: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    fontWeight: "600",
    margin: 0,
    minHeight: 28,
    minWidth: 0,
    padding: 0,
  },
  radiusHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  slider: {
    flex: 1,
    height: 32,
  },
  radiusValue: {
    ...typography.caption,
    color: colors.text,
    fontVariant: ["tabular-nums"],
    minWidth: 52,
    textAlign: "right",
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
  },
  attribution: {
    alignSelf: "flex-start",
  },
  attributionText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    textDecorationLine: "underline",
  },
  pressed: {
    opacity: 0.68,
  },
});
