import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { DeviceTimelineAppIcon } from "@/components/DeviceTimelineAppIcon";
import { ScreenEnter } from "@/components/ScreenEnter";
import { getDeviceTimelineDay } from "@/lib/api";
import type { DeviceTimelineRuntime } from "@/lib/useDeviceTimelineRuntime";
import { addDays, formatLongDate } from "@/lib/date";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type { DeviceTimelineItem } from "@/types";

const MARKER_META: Record<
  Exclude<DeviceTimelineItem["type"], "app">,
  { icon: React.ComponentProps<typeof AppIcon>["name"]; label: string }
> = {
  screen_on: { icon: "phone-portrait-outline", label: "点亮屏幕" },
  screen_off: { icon: "moon-outline", label: "熄灭屏幕" },
  unlock: { icon: "lock-open-outline", label: "解锁" },
  shutdown: { icon: "power-outline", label: "关机" },
  boot: { icon: "power-outline", label: "开机" },
};
const EMPTY_TIMELINE: DeviceTimelineItem[] = [];

// Reused from elsewhere in the app's palette (long-term gold, low-priority
// blue-gray, the map's visit-marker purple) rather than inventing a new chart
// palette, plus one new muted terracotta. Capped at 5 named segments; the
// rest of the day folds into a neutral "其他" segment.
const USAGE_SEGMENT_COLORS = [
  colors.accent,
  "#C4A45D",
  "#7C5CBF",
  "#8299A1",
  "#B4846B",
];
const USAGE_OTHER_COLOR = colors.borderStrong;
const MAX_USAGE_SEGMENTS = USAGE_SEGMENT_COLORS.length;

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function durationSeconds(item: DeviceTimelineItem) {
  if (!item.startTime || !item.endTime) {
    return Math.max(0, (item.durationMinutes ?? 0) * 60);
  }
  const start = new Date(item.startTime).getTime();
  const end = new Date(item.endTime).getTime();
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.round((end - start) / 1_000))
    : 0;
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return seconds > 0 ? "不到 1 分钟" : "0 分钟";
  }
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) {
    return `${minutes} 分钟`;
  }
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

export function DeviceTimelineScreen({
  runtime,
  today,
}: {
  runtime: DeviceTimelineRuntime;
  today: string;
}) {
  const [selectedDateOverride, setSelectedDateOverride] = useState<
    string | null
  >(null);
  const selectedDate = selectedDateOverride ?? today;
  const isToday = selectedDate === today;
  const [actionError, setActionError] = useState("");
  const [isTogglePending, setIsTogglePending] = useState(false);
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);

  const dayQuery = useQuery({
    queryKey: ["device-timeline-day", selectedDate],
    queryFn: () => getDeviceTimelineDay(selectedDate),
  });

  const changeSelectedDate = (updater: (date: string) => string) => {
    setSelectedDateOverride((current) => {
      const next = updater(current ?? today);
      return next === today ? null : next;
    });
  };

  async function handleToggle(next: boolean) {
    if (Platform.OS !== "android") {
      setActionError("设备时间线目前仅支持 Android。");
      return;
    }
    setActionError("");
    setIsTogglePending(true);
    try {
      if (next) {
        await runtime.enable();
      } else {
        await runtime.disable();
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "操作失败，请稍后重试。",
      );
    } finally {
      setIsTogglePending(false);
    }
  }

  function confirmClearHistory() {
    Alert.alert(
      "清除时间线历史记录",
      "此操作将永久删除本机保存的设备时间线记录，且无法恢复。是否继续？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => void runtime.clearHistory(),
        },
      ],
      { cancelable: true },
    );
  }

  const timeline = dayQuery.data?.timeline ?? EMPTY_TIMELINE;
  const appUsage = useMemo(() => {
    const byPackage = new Map<
      string,
      {
        appLabel: string;
        packageName: string;
        sessionCount: number;
        totalSeconds: number;
      }
    >();
    for (const item of timeline) {
      if (item.type !== "app") {
        continue;
      }
      const packageName = item.packageName || item.appLabel || "unknown";
      const current = byPackage.get(packageName) ?? {
        appLabel: item.appLabel || packageName,
        packageName,
        sessionCount: 0,
        totalSeconds: 0,
      };
      current.sessionCount += 1;
      current.totalSeconds += durationSeconds(item);
      byPackage.set(packageName, current);
    }
    return [...byPackage.values()]
      .filter((item) => item.totalSeconds > 0)
      .sort((left, right) => right.totalSeconds - left.totalSeconds);
  }, [timeline]);
  const totalAppUsageSeconds = useMemo(
    () => appUsage.reduce((total, item) => total + item.totalSeconds, 0),
    [appUsage],
  );
  // Top apps get their own bar segment + color; the long tail folds into one
  // neutral "其他" segment instead of a chart with 30 slivers.
  const usageSegments = useMemo(() => {
    const named = appUsage.slice(0, MAX_USAGE_SEGMENTS).map((item, index) => ({
      ...item,
      color: USAGE_SEGMENT_COLORS[index],
    }));
    const otherSeconds = appUsage
      .slice(MAX_USAGE_SEGMENTS)
      .reduce((total, item) => total + item.totalSeconds, 0);
    return { named, otherSeconds };
  }, [appUsage]);

  const renderTimelineItem = useCallback(
    ({ item, index }: { item: DeviceTimelineItem; index: number }) => (
      <TimelineRow item={item} isLast={index === timeline.length - 1} />
    ),
    [timeline.length],
  );

  return (
    <ScreenEnter style={{ backgroundColor: colors.surface, flex: 1 }}>
      <FlatList
        contentContainerStyle={styles.content}
        data={isTimelineExpanded ? timeline : EMPTY_TIMELINE}
        initialNumToRender={8}
        keyExtractor={(item, index) =>
          `${item.type}-${item.time ?? item.startTime}-${index}`
        }
        ListHeaderComponent={
          <>
        <View style={styles.heading}>
          <Text style={styles.title}>设备时间线</Text>
          <Text style={styles.subtitle}>
            记录锁屏解锁、开关机与应用使用情况
          </Text>
        </View>

        <View style={styles.authorizationCard}>
          <View style={styles.authorizationCopy}>
            <Text style={styles.authorizationTitle}>记录设备时间线</Text>
            <Text style={styles.authorizationDescription}>
              {!runtime.runtime.available
                ? "当前版本仅支持 Android"
                : runtime.runtime.enabled
                  ? runtime.runtime.isRunning
                    ? "正在持续记录；应用关闭后后台服务也会继续写入"
                    : "已开启记录，正在等待原生服务恢复"
                  : "未开启，不会读取应用使用情况和锁屏状态"}
            </Text>
          </View>
          {isTogglePending ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Switch
              accessibilityLabel="设备时间线记录"
              disabled={!runtime.runtime.available}
              onValueChange={handleToggle}
              thumbColor={colors.white}
              trackColor={{
                false: colors.borderStrong,
                true: colors.accent,
              }}
              value={runtime.runtime.enabled}
            />
          )}
        </View>
        <Text style={styles.localIconDisclosure}>
          应用图标仅在本机读取和缓存，不会上传服务器
        </Text>

        {runtime.runtime.enabled && !runtime.runtime.hasUsageAccess ? (
          <Pressable
            onPress={() => void runtime.openUsageAccessSettings()}
            style={({ pressed }) => [
              styles.permissionCard,
              pressed && styles.pressed,
            ]}>
            <AppIcon name="warning-outline" color={colors.danger} size={20} />
            <View style={styles.permissionCopy}>
              <Text style={styles.permissionTitle}>需要使用情况访问权限</Text>
              <Text style={styles.permissionDescription}>
                点击前往系统设置，为 Daily Todo 开启“使用情况访问权限”
              </Text>
            </View>
            <AppIcon
              name="chevron-forward"
              color={colors.textMuted}
              size={18}
            />
          </Pressable>
        ) : null}

        <View style={styles.datePicker}>
          <Pressable
            accessibilityLabel="前一天"
            onPress={() => changeSelectedDate((date) => addDays(date, -1))}
            style={styles.dateButton}>
            <AppIcon name="chevron-back" color={colors.text} size={20} />
          </Pressable>
          <View style={styles.dateCopy}>
            <Text style={styles.dateLabel}>
              {isToday ? "今天" : formatLongDate(selectedDate)}
            </Text>
            {!isToday ? <Text style={styles.dateMeta}>{selectedDate}</Text> : null}
          </View>
          <Pressable
            accessibilityLabel="后一天"
            disabled={isToday}
            onPress={() => changeSelectedDate((date) => addDays(date, 1))}
            style={[styles.dateButton, isToday && styles.dateButtonDisabled]}>
            <AppIcon name="chevron-forward" color={colors.text} size={20} />
          </Pressable>
        </View>

        {actionError ? (
          <View style={styles.error}>
            <AppIcon name="alert-circle-outline" color={colors.danger} size={18} />
            <Text style={styles.errorText}>{actionError}</Text>
          </View>
        ) : null}
        {runtime.runtime.lastError ? (
          <View style={styles.error}>
            <Text style={styles.errorText}>{runtime.runtime.lastError}</Text>
          </View>
        ) : null}

        {dayQuery.isPending ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : (
          <>
            {appUsage.length ? (
              <View style={styles.usageSummary}>
                <Text style={styles.sectionTitle}>应用使用总时长</Text>
                <Text style={styles.totalUsage}>
                  {formatDuration(totalAppUsageSeconds)}
                </Text>

                <View style={styles.usageBar}>
                  {usageSegments.named.map((item) => (
                    <View
                      key={item.packageName}
                      style={[
                        styles.usageBarSegment,
                        {
                          backgroundColor: item.color,
                          flexGrow: item.totalSeconds,
                        },
                      ]}
                    />
                  ))}
                  {usageSegments.otherSeconds > 0 ? (
                    <View
                      style={[
                        styles.usageBarSegment,
                        {
                          backgroundColor: USAGE_OTHER_COLOR,
                          flexGrow: usageSegments.otherSeconds,
                        },
                      ]}
                    />
                  ) : null}
                </View>

                <View style={styles.usageList}>
                  {usageSegments.named.map((item) => (
                    <View key={item.packageName} style={styles.usageRow}>
                      <View
                        style={[styles.usageDot, { backgroundColor: item.color }]}
                      />
                      <DeviceTimelineAppIcon
                        packageName={item.packageName}
                        size={28}
                      />
                      <Text numberOfLines={1} style={styles.usageLabel}>
                        {item.appLabel}
                      </Text>
                      <Text style={styles.usageDuration}>
                        {formatDuration(item.totalSeconds)}
                      </Text>
                    </View>
                  ))}
                  {usageSegments.otherSeconds > 0 ? (
                    <View style={styles.usageRow}>
                      <View
                        style={[
                          styles.usageDot,
                          { backgroundColor: USAGE_OTHER_COLOR },
                        ]}
                      />
                      <View style={styles.usageOtherIcon}>
                        <AppIcon
                          name="apps-outline"
                          color={colors.textMuted}
                          size={15}
                        />
                      </View>
                      <Text numberOfLines={1} style={styles.usageLabel}>
                        其他
                      </Text>
                      <Text style={styles.usageDuration}>
                        {formatDuration(usageSegments.otherSeconds)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isTimelineExpanded }}
              onPress={() => setIsTimelineExpanded((expanded) => !expanded)}
              style={({ pressed }) => [
                styles.timelineHeader,
                pressed && styles.pressed,
              ]}>
              <View style={styles.timelineHeaderCopy}>
                <Text style={styles.sectionTitle}>时间线</Text>
                <Text style={styles.timelineCount}>
                  {timeline.length ? `${timeline.length} 条记录` : "暂无记录"}
                </Text>
              </View>
              <AppIcon
                color={colors.textMuted}
                name={isTimelineExpanded ? "chevron-up" : "chevron-down"}
                size={20}
              />
            </Pressable>
            {!timeline.length ? (
              <View style={styles.timelineSection}>
                <Text style={styles.emptyTimeline}>
                  这一天还没有记录，开启记录后会在这里显示时间线
                </Text>
              </View>
            ) : null}
          </>
        )}
          </>
        }
        ListFooterComponent={
          <>
          {runtime.runtime.queuedEventCount ? (
          <Text style={styles.queueHint}>
            {runtime.runtime.queuedEventCount} 条事件待同步
          </Text>
        ) : null}

        <Pressable
          accessibilityLabel="清除设备时间线历史记录"
          accessibilityRole="button"
          onPress={confirmClearHistory}
          style={({ pressed }) => [
            styles.dangerRow,
            pressed && styles.pressed,
          ]}>
          <AppIcon name="trash-outline" color={colors.danger} size={18} />
          <Text style={styles.dangerRowText}>清除设备时间线历史记录</Text>
        </Pressable>
          </>
        }
        maxToRenderPerBatch={8}
        renderItem={renderTimelineItem}
        showsVerticalScrollIndicator={false}
        updateCellsBatchingPeriod={50}
        windowSize={7}
      />
    </ScreenEnter>
  );
}

function TimelineRow({
  item,
  isLast,
}: {
  item: DeviceTimelineItem;
  isLast: boolean;
}) {
  if (item.type === "app") {
    return (
      <View style={styles.row}>
        <View style={styles.timeline}>
          <View style={styles.appDot} />
          {!isLast ? <View style={styles.line} /> : null}
        </View>
        <View style={styles.appRowContent}>
          <DeviceTimelineAppIcon packageName={item.packageName} size={30} />
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {item.appLabel || item.packageName}
            </Text>
            <Text style={styles.rowMeta}>
              {item.startTime ? formatTime(item.startTime) : ""}
              {item.endTime && item.endTime !== item.startTime
                ? ` - ${formatTime(item.endTime)}`
                : ""}
              {` · ${formatDuration(durationSeconds(item))}`}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  const meta = MARKER_META[item.type];
  return (
    <View style={styles.row}>
      <View style={styles.timeline}>
        <View style={styles.markerDot}>
          <AppIcon color={colors.white} name={meta.icon} size={10} />
        </View>
        {!isLast ? <View style={styles.line} /> : null}
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowMeta}>
          {item.time ? formatTime(item.time) : ""}
          {"  "}
          {meta.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  heading: {
    gap: 3,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  authorizationCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  authorizationCopy: {
    flex: 1,
    gap: 3,
  },
  authorizationTitle: {
    ...typography.section,
    color: colors.text,
  },
  authorizationDescription: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
  },
  localIconDisclosure: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
  },
  permissionCard: {
    ...shadows.card,
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    borderColor: "#EDB9B4",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  permissionCopy: {
    flex: 1,
    gap: 2,
  },
  permissionTitle: {
    ...typography.label,
    color: colors.text,
  },
  permissionDescription: {
    ...typography.caption,
    color: colors.textMuted,
  },
  datePicker: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dateButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  dateButtonDisabled: {
    opacity: 0.3,
  },
  dateCopy: {
    alignItems: "center",
    gap: 1,
  },
  dateLabel: {
    ...typography.section,
    color: colors.text,
  },
  dateMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  error: {
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    flex: 1,
  },
  loading: {
    paddingVertical: spacing.xxl,
  },
  timelineSection: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xs,
  },
  timelineHeader: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  timelineHeaderCopy: {
    gap: 2,
  },
  timelineCount: {
    ...typography.caption,
    color: colors.textMuted,
  },
  sectionTitle: {
    ...typography.section,
    color: colors.text,
  },
  usageSummary: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  totalUsage: {
    color: colors.text,
    fontSize: 28,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    lineHeight: 34,
  },
  usageBar: {
    borderRadius: radius.full,
    flexDirection: "row",
    gap: 2,
    height: 10,
    overflow: "hidden",
  },
  usageBarSegment: {
    height: "100%",
    minWidth: 3,
  },
  usageList: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  usageRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 36,
  },
  usageDot: {
    borderRadius: radius.full,
    height: 8,
    width: 8,
  },
  usageOtherIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  usageLabel: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    minWidth: 0,
  },
  usageDuration: {
    ...typography.caption,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  emptyTimeline: {
    ...typography.body,
    color: colors.textMuted,
  },
  row: {
    flexDirection: "row",
    minHeight: 44,
  },
  timeline: {
    alignItems: "center",
    width: 24,
  },
  appDot: {
    backgroundColor: colors.accent,
    borderColor: colors.white,
    borderRadius: radius.full,
    borderWidth: 2,
    height: 11,
    marginTop: 3,
    width: 11,
  },
  markerDot: {
    alignItems: "center",
    backgroundColor: colors.textMuted,
    borderRadius: radius.full,
    height: 18,
    justifyContent: "center",
    marginTop: -2,
    width: 18,
  },
  line: {
    backgroundColor: colors.borderStrong,
    flex: 1,
    marginVertical: 2,
    width: 1,
  },
  rowCopy: {
    flex: 1,
    gap: 1,
    justifyContent: "center",
    paddingBottom: spacing.sm,
    paddingLeft: spacing.sm,
  },
  appRowContent: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
    paddingBottom: spacing.sm,
  },
  rowTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: "600",
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  queueHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center",
  },
  dangerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  dangerRowText: {
    ...typography.label,
    color: colors.danger,
  },
  pressed: {
    opacity: 0.68,
  },
});
