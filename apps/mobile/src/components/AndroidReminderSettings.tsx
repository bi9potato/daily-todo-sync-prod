import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";

import { AppIcon } from "./AppIcon";
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

type AndroidReminderSettingsProps = {
  isLocationBusy: boolean;
  isRequestingLocationReminder: boolean;
  location: TaskLocation | null;
  locationError: string;
  onChangeLocationName: (name: string) => void;
  onChangeRadius: (radiusMeters: number) => void;
  onClearLocation: () => void;
  onClearTime: () => void;
  onOpenExactAlarmSettings: () => void;
  onOpenTimePicker: () => void;
  onSearchLocation: (address: string) => Promise<PlaceSearchResult[]>;
  onSelectSearchResult: (result: PlaceSearchResult) => void;
  onToggleLocationReminder: (enabled: boolean) => void;
  onUseCurrentLocation: () => void;
  reminderPermissionWarning: string;
  reminderTime: string;
};

export function AndroidReminderSettings({
  isLocationBusy,
  isRequestingLocationReminder,
  location,
  locationError,
  onChangeLocationName,
  onChangeRadius,
  onClearLocation,
  onClearTime,
  onOpenExactAlarmSettings,
  onOpenTimePicker,
  onSearchLocation,
  onSelectSearchResult,
  onToggleLocationReminder,
  onUseCurrentLocation,
  reminderPermissionWarning,
  reminderTime,
}: AndroidReminderSettingsProps) {
  const [address, setAddress] = useState(location?.name ?? "");
  const [isLocationExpanded, setIsLocationExpanded] = useState(
    !location || Boolean(location.reminderEnabled),
  );
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const locationReminderEnabled = Boolean(location?.reminderEnabled);
  const locationSummary = location
    ? `${location.name || "已选地点"} · ${formatRadius(location.radiusMeters)}`
    : "输入地点后可开启";

  async function handleSearch() {
    if (!address.trim()) {
      return;
    }
    const results = await onSearchLocation(address);
    setSearchResults(results);
    setHasSearched(true);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>提醒方式</Text>

      <View style={styles.reminderList}>
        <View style={styles.reminderRow}>
          <View style={styles.iconSurface}>
            <AppIcon name="time-outline" color={colors.text} size={20} />
          </View>
          <Pressable
            accessibilityLabel="选择时间提醒"
            accessibilityRole="button"
            onPress={onOpenTimePicker}
            style={({ pressed }) => [
              styles.rowCopy,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.rowTitle}>时间提醒</Text>
            <Text style={styles.rowDescription}>
              {reminderTime ? "在任务日期的这个时间提醒" : "未设置"}
            </Text>
          </Pressable>
          {reminderTime ? (
            <>
              <Text style={styles.timeValue}>{reminderTime.slice(0, 5)}</Text>
              <Pressable
                accessibilityLabel="清除时间提醒"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClearTime}
                style={styles.compactButton}>
                <AppIcon name="close-circle" color={colors.textMuted} size={20} />
              </Pressable>
            </>
          ) : (
            <Pressable
              accessibilityLabel="添加时间提醒"
              accessibilityRole="button"
              onPress={onOpenTimePicker}
              style={styles.addButton}>
              <Text style={styles.addButtonText}>添加</Text>
            </Pressable>
          )}
        </View>

        {reminderPermissionWarning ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenExactAlarmSettings}
            style={styles.warningRow}>
            <AppIcon name="warning-outline" color={colors.danger} size={17} />
            <Text style={styles.warningText}>{reminderPermissionWarning}</Text>
            <Text style={styles.warningAction}>去设置</Text>
          </Pressable>
        ) : null}

        <View style={styles.locationHeader}>
          <Pressable
            accessibilityHint={isLocationExpanded ? "收起地点设置" : "展开地点设置"}
            accessibilityRole="button"
            onPress={() => setIsLocationExpanded((current) => !current)}
            style={({ pressed }) => [
              styles.locationHeaderCopy,
              pressed && styles.pressed,
            ]}>
            <View style={[styles.iconSurface, styles.locationIconSurface]}>
              <AppIcon name="location-outline" color={colors.accent} size={21} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>地点提醒</Text>
              <Text numberOfLines={1} style={styles.rowDescription}>
                {locationReminderEnabled ? locationSummary : "进入范围时提醒"}
              </Text>
            </View>
            <AppIcon
              name={isLocationExpanded ? "chevron-up" : "chevron-down"}
              color={colors.textMuted}
              size={18}
            />
          </Pressable>
          {isRequestingLocationReminder ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Switch
              accessibilityLabel="地点提醒"
              onValueChange={(enabled) => {
                if (enabled && !location) {
                  setIsLocationExpanded(true);
                }
                onToggleLocationReminder(enabled);
              }}
              thumbColor={colors.white}
              trackColor={{
                false: colors.borderStrong,
                true: colors.accent,
              }}
              value={locationReminderEnabled}
            />
          )}
        </View>

        {isLocationExpanded ? (
          <View style={styles.locationEditor}>
            <View style={styles.searchRow}>
              <AppIcon name="search-outline" color={colors.textMuted} size={19} />
              <TextInput
                accessibilityLabel="输入地点或地址"
                autoCorrect={false}
                onChangeText={setAddress}
                onSubmitEditing={() => void handleSearch()}
                placeholder="输入地点或地址"
                placeholderTextColor={colors.textMuted}
                returnKeyType="search"
                style={styles.searchInput}
                value={address}
              />
              {isLocationBusy ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={!address.trim()}
                  onPress={() => void handleSearch()}
                  style={({ pressed }) => [
                    styles.searchButton,
                    !address.trim() && styles.buttonDisabled,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={styles.searchButtonText}>查找</Text>
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
                      size={19}
                    />
                    <View style={styles.searchResultCopy}>
                      <Text numberOfLines={1} style={styles.searchResultName}>
                        {result.name}
                      </Text>
                      <Text numberOfLines={2} style={styles.searchResultAddress}>
                        {result.address}
                      </Text>
                    </View>
                    <AppIcon
                      name="chevron-forward"
                      color={colors.textMuted}
                      size={17}
                    />
                  </Pressable>
                ))}
              </View>
            ) : hasSearched && !isLocationBusy ? (
              <Text style={styles.noSearchResults}>
                没有找到结果，请补充城市、区县或道路名称
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={isLocationBusy}
              onPress={onUseCurrentLocation}
              style={({ pressed }) => [
                styles.currentLocationButton,
                pressed && styles.pressed,
              ]}>
              <AppIcon name="locate-outline" color={colors.accent} size={19} />
              <Text style={styles.currentLocationText}>使用当前位置</Text>
            </Pressable>

            {location ? (
              <>
                <View style={styles.selectedLocation}>
                  <AppIcon name="location" color={colors.accent} size={20} />
                  <View style={styles.selectedLocationCopy}>
                    <TextInput
                      accessibilityLabel="地点名称"
                      onChangeText={(name) => {
                        setAddress(name);
                        onChangeLocationName(name);
                      }}
                      style={styles.selectedLocationName}
                      value={location.name}
                    />
                    <Text style={styles.coordinates}>
                      {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel="清除地点"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => {
                      setAddress("");
                      onClearLocation();
                    }}
                    style={styles.compactButton}>
                    <AppIcon
                      name="close-circle"
                      color={colors.textMuted}
                      size={20}
                    />
                  </Pressable>
                </View>

                <View style={styles.radiusHeader}>
                  <Text style={styles.radiusLabel}>到达半径</Text>
                  <Text style={styles.radiusValue}>
                    {formatRadius(location.radiusMeters)}
                  </Text>
                </View>
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
                <View style={styles.radiusScale}>
                  <Text style={styles.scaleText}>100 米</Text>
                  <Text style={styles.scaleText}>2 公里</Text>
                </View>
                <Text style={styles.locationHint}>
                  Android 建议至少 100 米；到达提醒可能有几分钟延迟
                </Text>
              </>
            ) : (
              <Text style={styles.locationHint}>
                先查找地址或使用当前位置，再开启地点提醒
              </Text>
            )}

            {locationError ? (
              <Text accessibilityRole="alert" style={styles.locationError}>
                {locationError}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                void Linking.openURL("https://www.openstreetmap.org/copyright")
              }
              style={styles.attribution}>
              <Text style={styles.attributionText}>
                地点数据 © OpenStreetMap contributors
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.section,
    color: colors.text,
    paddingHorizontal: spacing.xs,
  },
  reminderList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  reminderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 70,
    paddingHorizontal: spacing.md,
  },
  iconSurface: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  locationIconSurface: {
    backgroundColor: colors.accentSoft,
  },
  rowCopy: {
    flex: 1,
    gap: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 0,
  },
  rowTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: "600",
  },
  rowDescription: {
    ...typography.caption,
    color: colors.textMuted,
  },
  timeValue: {
    ...typography.body,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  compactButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 36,
  },
  addButton: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  addButtonText: {
    ...typography.label,
    color: colors.accent,
  },
  warningRow: {
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  warningText: {
    ...typography.caption,
    color: colors.danger,
    flex: 1,
  },
  warningAction: {
    ...typography.label,
    color: colors.danger,
  },
  locationHeader: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 76,
    paddingHorizontal: spacing.md,
  },
  locationHeaderCopy: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minWidth: 0,
  },
  locationEditor: {
    backgroundColor: colors.surfaceMuted,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.md,
  },
  searchRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    minWidth: 0,
    paddingVertical: spacing.sm,
  },
  searchButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  searchButtonText: {
    ...typography.label,
    color: colors.accent,
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  currentLocationButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
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
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchResultCopy: {
    flex: 1,
    gap: 2,
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
  noSearchResults: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
  },
  currentLocationText: {
    ...typography.label,
    color: colors.accent,
    fontSize: 14,
  },
  selectedLocation: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  selectedLocationCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  selectedLocationName: {
    ...typography.body,
    color: colors.text,
    fontWeight: "600",
    margin: 0,
    minHeight: 28,
    padding: 0,
  },
  coordinates: {
    ...typography.caption,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  radiusHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  radiusLabel: {
    ...typography.body,
    color: colors.text,
  },
  radiusValue: {
    ...typography.body,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  slider: {
    height: 32,
    marginHorizontal: -4,
  },
  radiusScale: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -spacing.sm,
  },
  scaleText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  locationHint: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
  },
  locationError: {
    ...typography.caption,
    color: colors.danger,
  },
  attribution: {
    alignSelf: "flex-start",
    minHeight: 32,
    justifyContent: "center",
  },
  attributionText: {
    ...typography.caption,
    color: colors.textMuted,
    textDecorationLine: "underline",
  },
  pressed: {
    opacity: 0.68,
  },
});
