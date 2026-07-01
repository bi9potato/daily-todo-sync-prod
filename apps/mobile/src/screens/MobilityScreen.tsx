import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { RouteMap } from "@/components/RouteMap";
import { flushClientLogs, recordClientLog } from "@/lib/client-logs";
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
  supportsNativeBackgroundLocationTracking,
} from "@/lib/mobility-tracking";
import {
  startFallbackStepTracking,
  stopFallbackStepTracking,
} from "@/lib/mobility-steps";
import type { MobilityRuntimeState } from "@/lib/useMobilityRuntime";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type { MobilityDay, MobilityPoint, MobilityRecording } from "@/types";

function explainBackgroundPermission() {
  if (Platform.OS !== "android") {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      "允许后台记录",
      "授权打开后，Daily Todo 会通过常驻通知持续记录行走路线；关闭授权开关才会停止。",
      [
        { text: "暂不", style: "cancel", onPress: () => resolve(false) },
        { text: "继续", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

async function requestAndroidNotificationPermission() {
  const version =
    typeof Platform.Version === "string"
      ? Number.parseInt(Platform.Version, 10)
      : Platform.Version;
  if (
    Platform.OS !== "android" ||
    !Number.isFinite(version) ||
    version < 33
  ) {
    return;
  }
  try {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  } catch (error) {
    console.warn("Notification permission request failed", error);
  }
}

async function requestTrackingPermissions({
  requireBackground,
}: {
  requireBackground: boolean;
}) {
  if (Platform.OS === "web") {
    throw new Error("网页端不能持续记录轨迹，请在 Android APK 中使用。");
  }
  recordClientLog("info", "Requesting foreground location permission", {
    source: "mobility",
  });
  await flushClientLogs();
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error("请先打开系统定位服务。");
  }
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    throw new Error("需要“精确位置”权限才能记录路线。");
  }
  if (!requireBackground) {
    return;
  }
  await requestAndroidNotificationPermission();
  if (!(await explainBackgroundPermission())) {
    throw new Error("未开启后台位置权限。");
  }
  recordClientLog("info", "Requesting background location permission", {
    source: "mobility",
  });
  await flushClientLogs();
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

async function captureNamedPoint() {
  const location = await withTimeout(
    Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    }),
    8000,
    "定位暂时不可用",
  );
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
  const [showDetails, setShowDetails] = useState(false);

  const dayQuery = useQuery({
    queryKey: ["mobility-day", selectedDate],
    queryFn: () => getMobilityDay(selectedDate),
  });
  const todayQuery = useQuery({
    queryKey: ["mobility-day", today],
    queryFn: () => getMobilityDay(today),
    refetchInterval: (query) =>
      query.state.data?.activeRecording ? 30_000 : false,
  });
  const activeRecording = todayQuery.data?.activeRecording ?? null;
  const isToday = selectedDate === today;

  const startMutation = useMutation({
    mutationFn: async () => {
      setActionError("");
      const nativeBackgroundAvailable = supportsNativeBackgroundLocationTracking();
      recordClientLog("info", "Mobility recording start requested", {
        source: "mobility",
        context: { nativeBackgroundAvailable },
      });
      await flushClientLogs();
      await requestTrackingPermissions({
        requireBackground: nativeBackgroundAvailable,
      });
      const recording = await startMobilityRecording();
      await setActiveMobilityRecordingId(recording.id);
      try {
        recordClientLog("info", "Starting mobility location tracking", {
          source: "mobility",
          context: { nativeBackgroundAvailable },
        });
        await flushClientLogs();
        await startMobilityLocationTracking({
          background: nativeBackgroundAvailable,
          manual: true,
          recordingId: recording.id,
        });
        try {
          const initialPoint = await captureNamedPoint();
          await syncOrQueueMobilityPoints(recording.id, [initialPoint]);
        } catch (error) {
          console.warn("Initial mobility point capture failed", error);
        }
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
        queryKey: ["mobility-day"],
      });
    },
    onError: (error) => {
      setActionError(error.message || "无法开启持续记录");
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (recording: MobilityRecording) => {
      setActionError("");
      recordClientLog("info", "Mobility recording stop requested", {
        source: "mobility",
      });
      await flushClientLogs();
      await stopFallbackStepTracking();
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
        queryKey: ["mobility-day"],
      });
    },
    onError: (error) => {
      setActionError(error.message || "无法关闭持续记录");
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
  const backgroundTrackingHealthy =
    runtime.nativeBackgroundAvailable &&
    runtime.backgroundPermission &&
    runtime.nativeTaskActive;
  const trackingHealthy =
    runtime.foregroundWatchActive || backgroundTrackingHealthy;
  const recordingEnabled = Boolean(activeRecording);

  if (showDetails) {
    return (
      <MobilityDetails
        day={dayQuery.data}
        onBack={() => setShowDetails(false)}
        runtime={runtime}
        selectedDate={selectedDate}
        totalSteps={totalSteps}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.title}>足迹地图</Text>
          <Text style={styles.subtitle}>打开后实时记录路线，关闭开关才会停止</Text>
        </View>
        {recordingEnabled ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>持续记录</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.authorizationCard}>
        <View style={styles.authorizationCopy}>
          <Text style={styles.authorizationTitle}>足迹记录</Text>
          <Text style={styles.authorizationDescription}>
            {recordingEnabled
              ? backgroundTrackingHealthy
                ? "正在记录；应用关闭后后台服务也会继续写入路线"
                : runtime.foregroundWatchActive
                  ? "正在安全实时记录；保持应用打开即可持续写入路线"
                  : "已开启记录，正在等待定位服务恢复"
              : "未开启，不会获取位置和活动数据"}
          </Text>
        </View>
        {busy || todayQuery.isPending ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Switch
            accessibilityLabel="足迹记录"
            onValueChange={(enabled) => {
              if (enabled) {
                startMutation.mutate();
              } else if (activeRecording) {
                stopMutation.mutate(activeRecording);
              }
            }}
            thumbColor={colors.white}
            trackColor={{
              false: colors.borderStrong,
              true: colors.accent,
            }}
            value={recordingEnabled}
          />
        )}
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
          <RouteMap
            key={selectedDate}
            points={dayQuery.data?.points ?? []}
          />
        )}
      </View>
      <Text style={styles.mapHint}>双指缩放或使用地图按钮 · 拖动查看路线</Text>

      <View style={styles.distanceSummary}>
        <View style={styles.distanceCopy}>
          <AppIcon name="navigate-outline" color={colors.accent} size={20} />
          <View>
            <Text style={styles.distanceValue}>
              {((dayQuery.data?.distanceMeters ?? 0) / 1000).toFixed(2)} 公里
            </Text>
            <Text style={styles.distanceLabel}>
              {isToday ? "今日记录距离" : "当日记录距离"}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowDetails(true)}
          style={({ pressed }) => [
            styles.detailsButton,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.detailsButtonText}>查看详情</Text>
          <AppIcon name="chevron-forward" color={colors.accent} size={18} />
        </Pressable>
      </View>

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
          {recordingEnabled
            ? backgroundTrackingHealthy
              ? "仅你可见 · 后台服务运行中"
              : runtime.foregroundWatchActive
                ? "仅你可见 · 安全实时记录中"
                : "定位服务等待恢复 · 请检查下方状态"
            : "记录已关闭 · 不会获取位置"}
        </Text>
      </View>

      {recordingEnabled ? (
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
                {backgroundTrackingHealthy
                  ? "后台轨迹服务正常"
                  : runtime.foregroundWatchActive
                    ? "安全实时记录正常"
                    : "定位服务未运行"}
              </Text>
              <Text style={styles.runtimeMeta}>
                {runtime.lastLocationAt
                  ? `最近定位 ${formatRuntimeTime(runtime.lastLocationAt)}`
                  : "正在等待第一条定位"}
                {runtime.queuedPointCount
                  ? ` · ${runtime.queuedPointCount} 个定位点待同步`
                  : ""}
              </Text>
            </View>
          </View>
          {runtime.lastError ? (
            <Text style={styles.runtimeError}>{runtime.lastError}</Text>
          ) : null}
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
    </ScrollView>
  );
}

function MobilityDetails({
  day,
  onBack,
  runtime,
  selectedDate,
  totalSteps,
}: {
  day: MobilityDay | undefined;
  onBack: () => void;
  runtime: MobilityRuntimeState;
  selectedDate: string;
  totalSteps: number;
}) {
  const stepSource =
    runtime.stepSource === "health-connect"
      ? "Health Connect 系统聚合"
      : runtime.stepSource === "device"
        ? "设备传感器（前台补充）"
        : "暂无可用来源";

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.detailsHeader}>
        <Pressable
          accessibilityLabel="返回足迹地图"
          onPress={onBack}
          style={({ pressed }) => [
            styles.detailsBackButton,
            pressed && styles.pressed,
          ]}>
          <AppIcon name="chevron-back" color={colors.text} size={21} />
        </Pressable>
        <View style={styles.detailsHeadingCopy}>
          <Text style={styles.title}>足迹详情</Text>
          <Text style={styles.subtitle}>{formatLongDate(selectedDate)}</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <Metric
          icon="footsteps-outline"
          label="步数"
          value={totalSteps.toLocaleString()}
        />
        <Metric
          icon="navigate-outline"
          label="公里"
          value={((day?.distanceMeters ?? 0) / 1000).toFixed(2)}
        />
        <Metric
          icon="time-outline"
          label="记录分钟"
          value={String(day?.durationMinutes ?? 0)}
        />
      </View>

      <View style={styles.detailsPanel}>
        <DetailRow
          icon="location-outline"
          label="定位点"
          value={`${day?.points.length ?? 0} 个`}
        />
        <DetailRow
          icon="footsteps-outline"
          label="步数来源"
          value={stepSource}
        />
        <DetailRow
          icon="cloud-upload-outline"
          label="等待同步"
          value={`${runtime.queuedPointCount} 个定位点`}
        />
        <DetailRow
          icon="time-outline"
          label="最近定位"
          value={
            runtime.lastLocationAt
              ? formatRuntimeTime(runtime.lastLocationAt)
              : "暂无"
          }
        />
      </View>

      <Text style={styles.stepNote}>
        Android 会在你开启足迹记录后使用设备传感器统计本次步数。
      </Text>
    </ScrollView>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof AppIcon>["name"];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <AppIcon name={icon} color={colors.accent} size={19} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.detailValue}>
        {value}
      </Text>
    </View>
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
  authorizationCard: {
    ...shadows.card,
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
  mapHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: -spacing.sm,
    textAlign: "center",
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
  distanceSummary: {
    ...shadows.card,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  distanceCopy: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  distanceValue: {
    ...typography.section,
    color: colors.text,
  },
  distanceLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 1,
  },
  detailsButton: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: 2,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  detailsButtonText: {
    ...typography.label,
    color: colors.accent,
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
  detailsHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  detailsBackButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  detailsHeadingCopy: {
    flex: 1,
  },
  detailsPanel: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  detailRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    paddingVertical: spacing.sm,
  },
  detailLabel: {
    ...typography.body,
    color: colors.textMuted,
    flex: 1,
  },
  detailValue: {
    ...typography.label,
    color: colors.text,
    flex: 1.4,
    textAlign: "right",
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
