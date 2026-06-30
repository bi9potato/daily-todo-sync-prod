import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { RouteMap } from "@/components/RouteMap";
import {
  getMobilityDay,
  startMobilityRecording,
  stopMobilityRecording,
} from "@/lib/api";
import { addDays, formatLongDate } from "@/lib/date";
import {
  clearActiveMobilityRecordingId,
  setActiveMobilityRecordingId,
} from "@/lib/mobility-storage";
import {
  flushMobilityPointQueue,
  syncOrQueueMobilityPoints,
} from "@/lib/mobility-queue";
import {
  locationToMobilityPoint,
  startMobilityLocationTracking,
  stopMobilityLocationTracking,
} from "@/lib/mobility-tracking";
import {
  requestHealthConnectStepAccess,
  startFallbackStepTracking,
  stopFallbackStepTracking,
  syncHealthConnectSteps,
} from "@/lib/mobility-steps";
import type { MobilityRuntimeState } from "@/lib/useMobilityRuntime";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type { MobilityPoint, MobilityRecording } from "@/types";

function explainBackgroundPermission() {
  if (Platform.OS !== "android") {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      "允许后台记录",
      "开始后，Daily Todo 会通过常驻通知持续记录行走路线；你可以随时在本页停止。",
      [
        { text: "暂不", style: "cancel", onPress: () => resolve(false) },
        { text: "继续", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

async function requestTrackingPermissions() {
  if (Platform.OS === "web") {
    throw new Error("网页端不能持续记录轨迹，请在 Android APK 中使用。");
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error("请先打开系统定位服务。");
  }
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    throw new Error("需要“精确位置”权限才能记录路线。");
  }
  if (!(await explainBackgroundPermission())) {
    throw new Error("未开启后台位置权限。");
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) {
    throw new Error("需要选择“始终允许”才能在锁屏后继续记录。");
  }
  if (!(await TaskManager.isAvailableAsync())) {
    throw new Error("当前运行环境不支持后台定位，请安装开发版或正式 APK。");
  }
}

function addressLabel(address: Location.LocationGeocodedAddress | undefined) {
  if (!address) {
    return "";
  }
  return (
    address.name ||
    address.formattedAddress ||
    [address.district, address.city].filter(Boolean).join(" · ")
  );
}

async function captureNamedPoint() {
  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  let name = "";
  try {
    const addresses = await Location.reverseGeocodeAsync(location.coords);
    name = addressLabel(addresses[0]);
  } catch {
    // A coordinate is still useful when the device geocoder is unavailable.
  }
  return locationToMobilityPoint(location, name);
}

export function MobilityScreen({
  runtime,
  today,
}: {
  runtime: MobilityRuntimeState;
  today: string;
}) {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(today);
  const [actionError, setActionError] = useState("");
  const [isEnablingSteps, setIsEnablingSteps] = useState(false);

  const dayQuery = useQuery({
    queryKey: ["mobility-day", selectedDate],
    queryFn: () => getMobilityDay(selectedDate),
    refetchInterval: (query) =>
      query.state.data?.activeRecording ? 30_000 : false,
  });
  const activeRecording = dayQuery.data?.activeRecording ?? null;
  const isToday = selectedDate === today;

  const startMutation = useMutation({
    mutationFn: async () => {
      setActionError("");
      await requestTrackingPermissions();
      await requestHealthConnectStepAccess();
      const recording = await startMobilityRecording();
      await setActiveMobilityRecordingId(recording.id);
      try {
        const initialPoint = await captureNamedPoint();
        await syncOrQueueMobilityPoints(recording.id, [initialPoint]);
        await startMobilityLocationTracking();
        try {
          await startFallbackStepTracking(recording.id);
        } catch {
          // The route can still be recorded when this device has no step sensor.
        }
      } catch (error) {
        await stopMobilityRecording(recording.id);
        await clearActiveMobilityRecordingId();
        throw error;
      }
      return recording;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["mobility-day", selectedDate],
      });
    },
    onError: (error) => {
      setActionError(error.message || "无法开始记录");
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (recording: MobilityRecording) => {
      setActionError("");
      const fallbackRecording = await stopFallbackStepTracking();
      await syncHealthConnectSteps(fallbackRecording ?? recording);
      try {
        const finalPoint = await captureNamedPoint();
        await syncOrQueueMobilityPoints(recording.id, [finalPoint]);
      } catch {
        // Stopping must still succeed when a final GPS fix is unavailable.
      }
      await stopMobilityLocationTracking();
      const stopped = await stopMobilityRecording(recording.id);
      await clearActiveMobilityRecordingId();
      return stopped;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["mobility-day", selectedDate],
      });
    },
    onError: (error) => {
      setActionError(error.message || "无法停止记录");
    },
  });

  useEffect(() => {
    if (activeRecording?.id) {
      void setActiveMobilityRecordingId(activeRecording.id);
      void flushMobilityPointQueue();
    }
  }, [activeRecording?.id]);

  const places = useMemo(
    () => getVisitedPlaces(dayQuery.data?.points ?? []),
    [dayQuery.data?.points],
  );
  const busy = startMutation.isPending || stopMutation.isPending;
  const totalSteps = dayQuery.data?.stepCount ?? 0;
  const trackingHealthy =
    runtime.backgroundPermission && runtime.nativeTaskActive;

  async function enableHealthSteps() {
    setIsEnablingSteps(true);
    setActionError("");
    try {
      const granted = await requestHealthConnectStepAccess();
      if (!granted) {
        throw new Error(
          "Health Connect 不可用或未授权。Android 13 及以下请先安装并配置 Health Connect。",
        );
      }
      if (activeRecording) {
        await syncHealthConnectSteps(activeRecording);
      }
      await queryClient.invalidateQueries({
        queryKey: ["mobility-day", selectedDate],
      });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "无法启用系统步数",
      );
    } finally {
      setIsEnablingSteps(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.title}>足迹地图</Text>
          <Text style={styles.subtitle}>路线只对你可见，主动开始后才会记录</Text>
        </View>
        {activeRecording ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>记录中</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.datePicker}>
        <Pressable
          accessibilityLabel="前一天"
          onPress={() => setSelectedDate((date) => addDays(date, -1))}
          style={styles.dateButton}>
          <AppIcon name="chevron-back" color={colors.text} size={20} />
        </Pressable>
        <View style={styles.dateCopy}>
          <Text style={styles.dateLabel}>{isToday ? "今天" : formatLongDate(selectedDate)}</Text>
          {!isToday ? <Text style={styles.dateMeta}>{selectedDate}</Text> : null}
        </View>
        <Pressable
          accessibilityLabel="后一天"
          disabled={isToday}
          onPress={() => setSelectedDate((date) => addDays(date, 1))}
          style={[styles.dateButton, isToday && styles.dateButtonDisabled]}>
          <AppIcon name="chevron-forward" color={colors.text} size={20} />
        </Pressable>
      </View>

      <View style={styles.mapFrame}>
        {dayQuery.isPending ? (
          <View style={styles.mapLoading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <RouteMap points={dayQuery.data?.points ?? []} />
        )}
      </View>

      <View style={styles.metrics}>
        <Metric icon="footsteps-outline" label="步" value={totalSteps.toLocaleString()} />
        <Metric
          icon="navigate-outline"
          label="公里"
          value={((dayQuery.data?.distanceMeters ?? 0) / 1000).toFixed(2)}
        />
        <Metric
          icon="time-outline"
          label="记录分钟"
          value={String(dayQuery.data?.durationMinutes ?? 0)}
        />
      </View>

      {isToday ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            if (activeRecording) {
              stopMutation.mutate(activeRecording);
            } else {
              startMutation.mutate();
            }
          }}
          style={({ pressed }) => [
            styles.recordButton,
            activeRecording && styles.stopButton,
            busy && styles.recordButtonDisabled,
            pressed && styles.pressed,
          ]}>
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <AppIcon
                name={activeRecording ? "stop" : "navigate"}
                color={colors.white}
                size={20}
              />
              <Text style={styles.recordButtonText}>
                {activeRecording ? "停止记录" : "开始记录"}
              </Text>
            </>
          )}
        </Pressable>
      ) : null}

      {actionError ? (
        <View style={styles.error}>
          <AppIcon name="alert-circle-outline" color={colors.danger} size={18} />
          <Text style={styles.errorText}>{actionError}</Text>
        </View>
      ) : null}
      {dayQuery.isError ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{dayQuery.error.message}</Text>
        </View>
      ) : null}

      <View style={styles.privacy}>
        <AppIcon name="lock-closed-outline" color={colors.textMuted} size={15} />
        <Text style={styles.privacyText}>
          {activeRecording
            ? trackingHealthy
              ? "仅你可见 · Android 后台服务运行中"
              : "后台服务异常 · 请检查下方状态"
            : "轨迹已停止 · 不会在后台获取位置"}
        </Text>
      </View>

      {activeRecording ? (
        <View
          style={[
            styles.runtimePanel,
            !trackingHealthy && styles.runtimePanelWarning,
          ]}>
          <View style={styles.runtimeHeading}>
            <AppIcon
              name={trackingHealthy ? "shield-checkmark-outline" : "warning-outline"}
              color={trackingHealthy ? colors.accent : colors.danger}
              size={21}
            />
            <View style={styles.runtimeHeadingCopy}>
              <Text style={styles.runtimeTitle}>
                {trackingHealthy ? "后台轨迹服务正常" : "后台轨迹服务未运行"}
              </Text>
              <Text style={styles.runtimeMeta}>
                {runtime.lastLocationAt
                  ? `最近定位 ${formatRuntimeTime(runtime.lastLocationAt)}`
                  : "正在等待第一条后台定位"}
                {runtime.queuedPointCount
                  ? ` · ${runtime.queuedPointCount} 个定位点待同步`
                  : ""}
              </Text>
            </View>
          </View>
          {runtime.lastError ? (
            <Text style={styles.runtimeError}>{runtime.lastError}</Text>
          ) : null}
          <View style={styles.stepSourceRow}>
            <View style={styles.stepSourceCopy}>
              <Text style={styles.stepSourceLabel}>步数来源</Text>
              <Text style={styles.stepSourceValue}>
                {runtime.stepSource === "health-connect"
                  ? "Health Connect 系统聚合"
                  : runtime.stepSource === "device"
                    ? "设备传感器（前台补充）"
                    : "尚未连接"}
              </Text>
            </View>
            {runtime.stepSource !== "health-connect" &&
            Platform.OS === "android" ? (
              <Pressable
                disabled={isEnablingSteps}
                onPress={enableHealthSteps}
                style={({ pressed }) => [
                  styles.enableStepsButton,
                  pressed && styles.pressed,
                ]}>
                {isEnablingSteps ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Text style={styles.enableStepsText}>启用系统步数</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.placesSection}>
        <Text style={styles.sectionTitle}>到访地点</Text>
        {places.length ? (
          places.map((place, index) => (
            <View key={`${place.recordedAt}-${index}`} style={styles.placeRow}>
              <View style={styles.timeline}>
                <View style={styles.placeDot} />
                {index < places.length - 1 ? <View style={styles.placeLine} /> : null}
              </View>
              <View style={styles.placeCopy}>
                <Text style={styles.placeName}>{place.label}</Text>
                <Text style={styles.placeTime}>
                  {new Date(place.recordedAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.emptyPlaces}>记录起点或终点后，这里会显示地点</Text>
        )}
      </View>

      <Text style={styles.stepNote}>
        Android 优先读取 Health Connect 去重后的步数；未连接时仅使用设备前台传感器补充，不再跨页面重复累计。
      </Text>
    </ScrollView>
  );
}

function formatRuntimeTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getVisitedPlaces(points: MobilityPoint[]) {
  const named = points
    .filter((point) => point.placeName)
    .filter(
      (point, index, list) =>
        index === 0 || point.placeName !== list[index - 1].placeName,
    )
    .map((point) => ({ ...point, label: point.placeName }));
  if (named.length) {
    return named;
  }
  if (!points.length) {
    return [];
  }
  const first = points[0];
  const last = points.at(-1) ?? first;
  return [
    { ...first, label: "记录起点" },
    ...(last.recordedAt !== first.recordedAt
      ? [{ ...last, label: "记录终点" }]
      : []),
  ];
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof AppIcon>["name"];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metric}>
      <AppIcon name={icon} color={colors.accent} size={18} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  heading: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 3,
  },
  liveBadge: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.full,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  liveDot: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 7,
    width: 7,
  },
  liveText: {
    ...typography.label,
    color: colors.accent,
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
  mapFrame: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 310,
    overflow: "hidden",
  },
  mapLoading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  metrics: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    paddingVertical: spacing.md,
  },
  metric: {
    alignItems: "center",
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: 2,
  },
  metricValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  recordButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 50,
  },
  stopButton: {
    backgroundColor: colors.text,
  },
  recordButtonDisabled: {
    opacity: 0.6,
  },
  recordButtonText: {
    ...typography.label,
    color: colors.white,
    fontSize: 15,
  },
  pressed: {
    opacity: 0.68,
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
  privacy: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  privacyText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  runtimePanel: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  runtimePanelWarning: {
    backgroundColor: colors.dangerSoft,
    borderColor: "#EDB9B4",
  },
  runtimeHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  runtimeHeadingCopy: {
    flex: 1,
    gap: 2,
  },
  runtimeTitle: {
    ...typography.label,
    color: colors.text,
    fontSize: 14,
  },
  runtimeMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  runtimeError: {
    ...typography.caption,
    color: colors.danger,
  },
  stepSourceRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  stepSourceCopy: {
    flex: 1,
    gap: 1,
  },
  stepSourceLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  stepSourceValue: {
    ...typography.label,
    color: colors.text,
  },
  enableStepsButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 112,
    paddingHorizontal: spacing.sm,
  },
  enableStepsText: {
    ...typography.label,
    color: colors.accent,
  },
  placesSection: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.lg,
  },
  sectionTitle: {
    ...typography.section,
    color: colors.text,
    marginBottom: spacing.md,
  },
  placeRow: {
    flexDirection: "row",
    minHeight: 58,
  },
  timeline: {
    alignItems: "center",
    width: 24,
  },
  placeDot: {
    backgroundColor: colors.accent,
    borderColor: colors.white,
    borderRadius: radius.full,
    borderWidth: 2,
    height: 13,
    marginTop: 3,
    width: 13,
  },
  placeLine: {
    backgroundColor: colors.borderStrong,
    flex: 1,
    marginVertical: 3,
    width: 1,
  },
  placeCopy: {
    flex: 1,
    gap: 2,
    paddingBottom: spacing.md,
    paddingLeft: spacing.sm,
  },
  placeName: {
    ...typography.body,
    color: colors.text,
    fontWeight: "600",
  },
  placeTime: {
    ...typography.caption,
    color: colors.textMuted,
  },
  emptyPlaces: {
    ...typography.body,
    color: colors.textMuted,
    paddingBottom: spacing.sm,
  },
  stepNote: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
    textAlign: "center",
  },
});
