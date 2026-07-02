import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { RefreshControl } from "react-native-gesture-handler";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { AppIcon } from "@/components/AppIcon";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import {
  getSleepAccessStatus,
  isSleepSupported,
  openSleepSourceSettings,
  readSleepNights,
  requestSleepPermission,
  type SleepNight,
  type SleepStageKey,
} from "@/lib/sleep";
import { colors, radius, shadows, spacing, typography } from "@/theme";

const NIGHTS_TO_SHOW = 7;

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

// Bar/legend order: sleep phases first, then the interruptions.
const STAGE_META: { key: SleepStageKey; label: string; color: string }[] = [
  { key: "deep", label: "深睡", color: colors.accent },
  { key: "light", label: "浅睡", color: "#7FA08C" },
  { key: "rem", label: "快速眼动", color: "#C4A45D" },
  { key: "sleeping", label: "睡眠", color: "#5B7D6C" },
  { key: "awake", label: "清醒", color: colors.borderStrong },
  { key: "outOfBed", label: "离床", color: "#8299A1" },
];

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) {
    return `${rest} 分钟`;
  }
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function formatClock(value: string) {
  return dayjs(value).format("HH:mm");
}

function formatNightDate(night: SleepNight) {
  const end = dayjs(night.endTime);
  return `${end.format("M月D日")} 周${WEEKDAYS[end.day()]}`;
}

export function SleepScreen() {
  const supported = isSleepSupported();
  const queryClient = useQueryClient();
  const [isRequesting, setIsRequesting] = useState(false);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);

  const accessQuery = useQuery({
    queryKey: ["sleep-access"],
    queryFn: getSleepAccessStatus,
    enabled: supported,
    // Local Health Connect state, not the network; never persist it so a
    // revoked permission can't present as still granted after a restart.
    networkMode: "always",
    staleTime: 0,
    gcTime: 0,
    meta: { sensitive: true },
  });
  const access = supported ? accessQuery.data : "unsupported";

  const nightsQuery = useQuery({
    queryKey: ["sleep-nights"],
    queryFn: () => readSleepNights(NIGHTS_TO_SHOW),
    enabled: supported && access === "granted",
    networkMode: "always",
    staleTime: 5 * 60_000,
    // Health data stays out of the plaintext persisted cache - see the
    // shouldDehydrateQuery wiring in app/_layout.tsx.
    meta: { sensitive: true },
  });

  async function requestAccess() {
    if (isRequesting) {
      return;
    }
    setIsRequesting(true);
    try {
      await requestSleepPermission();
    } finally {
      setIsRequesting(false);
      void queryClient.invalidateQueries({ queryKey: ["sleep-access"] });
      void queryClient.invalidateQueries({ queryKey: ["sleep-nights"] });
    }
  }

  async function refresh() {
    if (isPullRefreshing) {
      return;
    }
    setIsPullRefreshing(true);
    try {
      await accessQuery.refetch();
      await nightsQuery.refetch();
    } finally {
      setIsPullRefreshing(false);
    }
  }

  const nights = nightsQuery.data ?? [];
  const latest = nights[0];

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>睡眠</Text>
          <Text style={styles.subtitle}>Health Connect · 手环或手表同步</Text>
        </View>
        {supported && access === "granted" ? (
          <Pressable
            accessibilityLabel="打开 Health Connect"
            accessibilityRole="button"
            onPress={openSleepSourceSettings}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <AppIcon name="settings-outline" color={colors.textMuted} size={20} />
          </Pressable>
        ) : null}
      </View>

      {!supported ? (
        <Notice
          copy="睡眠数据来自 Android 的 Health Connect，请在 Android 客户端使用。"
          title="仅 Android 客户端可用"
        />
      ) : accessQuery.isPending ? (
        <LoadingState label="正在检查 Health Connect…" />
      ) : accessQuery.isError ? (
        <ErrorState
          message={accessQuery.error.message || "Health Connect 状态检查失败"}
          onRetry={() => accessQuery.refetch()}
        />
      ) : access === "unavailable" ? (
        <Notice
          copy="此设备上没有可用的 Health Connect。Android 14 及以上系统内置；更早的系统需要先安装 Health Connect 应用。"
          title="Health Connect 不可用"
        />
      ) : access === "update-required" ? (
        <Notice
          copy="系统的 Health Connect 版本过旧，请先在应用商店更新后再试。"
          title="需要更新 Health Connect"
        />
      ) : access === "denied" ? (
        <View style={styles.permissionCard}>
          <AppIcon name="moon-outline" color={colors.accent} size={34} />
          <Text style={styles.permissionTitle}>连接 Health Connect</Text>
          <Text style={styles.permissionCopy}>
            读取手环、手表同步到 Health Connect 的睡眠记录。数据仅在本机展示，不会上传。
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isRequesting}
            onPress={() => void requestAccess()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
            ]}>
            {isRequesting ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>授权读取睡眠数据</Text>
            )}
          </Pressable>
        </View>
      ) : nightsQuery.isPending ? (
        <LoadingState label="正在读取睡眠记录…" />
      ) : nightsQuery.isError ? (
        <ErrorState
          message={nightsQuery.error.message || "睡眠数据读取失败"}
          onRetry={() => nightsQuery.refetch()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              colors={[colors.accent]}
              onRefresh={() => void refresh()}
              progressBackgroundColor={colors.surfaceStrong}
              refreshing={isPullRefreshing}
              tintColor={colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}>
          {!latest ? (
            <View style={styles.emptyCard}>
              <AppIcon name="moon-outline" color={colors.accent} size={34} />
              <Text style={styles.permissionTitle}>近 7 天没有睡眠记录</Text>
              <Text style={styles.permissionCopy}>
                需要手环或手表先把睡眠同步到 Health
                Connect（例如小米运动健康、Zepp、三星健康），这里会自动展示。
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={openSleepSourceSettings}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.secondaryButtonText}>打开 Health Connect</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.heroCard}>
                <Text style={styles.heroDate}>{formatNightDate(latest)}</Text>
                <Text style={styles.heroDuration}>
                  {formatDuration(latest.minutesAsleep)}
                </Text>
                <Text style={styles.heroMeta}>
                  {formatClock(latest.startTime)} 入睡 · {formatClock(latest.endTime)} 醒来
                  {latest.hasStages
                    ? ` · 在床 ${formatDuration(latest.minutesInBed)}`
                    : ""}
                </Text>
                {latest.hasStages ? (
                  <>
                    <StageBar night={latest} tall />
                    <View style={styles.legend}>
                      {STAGE_META.filter(
                        (meta) => latest.stageMinutes[meta.key] > 0,
                      ).map((meta) => (
                        <View key={meta.key} style={styles.legendItem}>
                          <View
                            style={[styles.legendDot, { backgroundColor: meta.color }]}
                          />
                          <Text style={styles.legendText}>
                            {meta.label} {formatDuration(latest.stageMinutes[meta.key])}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                ) : null}
              </View>

              {nights.length > 1 ? (
                <View style={styles.historyCard}>
                  <Text style={styles.historyTitle}>最近 7 天</Text>
                  {nights.slice(1).map((night) => (
                    <View key={night.id} style={styles.historyRow}>
                      <Text style={styles.historyDate}>{formatNightDate(night)}</Text>
                      <View style={styles.historyBarArea}>
                        <StageBar night={night} />
                      </View>
                      <Text style={styles.historyDuration}>
                        {formatDuration(night.minutesAsleep)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Notice({ copy, title }: { copy: string; title: string }) {
  return (
    <View style={styles.emptyCard}>
      <AppIcon name="moon-outline" color={colors.accent} size={34} />
      <Text style={styles.permissionTitle}>{title}</Text>
      <Text style={styles.permissionCopy}>{copy}</Text>
    </View>
  );
}

function StageBar({ night, tall = false }: { night: SleepNight; tall?: boolean }) {
  const segments = night.hasStages
    ? STAGE_META.map((meta) => ({
        key: meta.key,
        color: meta.color,
        minutes: night.stageMinutes[meta.key],
      })).filter((segment) => segment.minutes > 0)
    : [{ key: "sleeping", color: colors.accent, minutes: night.minutesInBed }];
  if (!segments.length) {
    return null;
  }
  return (
    <View style={[styles.stageBar, tall && styles.stageBarTall]}>
      {segments.map((segment) => (
        <View
          key={segment.key}
          style={{ backgroundColor: segment.color, flex: segment.minutes }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    ...shadows.panel,
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  headerButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  pressed: {
    opacity: 0.64,
  },
  listContent: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  emptyCard: {
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
    margin: spacing.md,
    padding: spacing.xl,
  },
  permissionCard: {
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
    margin: spacing.md,
    padding: spacing.xl,
  },
  permissionTitle: {
    ...typography.section,
    color: colors.text,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  permissionCopy: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 46,
    minWidth: 200,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    ...typography.label,
    color: colors.white,
    fontSize: 15,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
    ...typography.label,
    color: colors.accent,
  },
  heroCard: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  heroDate: {
    ...typography.label,
    color: colors.textMuted,
  },
  heroDuration: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "700",
    lineHeight: 40,
  },
  heroMeta: {
    ...typography.body,
    color: colors.textMuted,
  },
  stageBar: {
    borderRadius: radius.full,
    flexDirection: "row",
    height: 8,
    overflow: "hidden",
  },
  stageBarTall: {
    height: 14,
    marginTop: spacing.xs,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  legendItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  legendDot: {
    borderRadius: radius.full,
    height: 8,
    width: 8,
  },
  legendText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  historyCard: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  historyTitle: {
    ...typography.section,
    color: colors.text,
  },
  historyRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 36,
  },
  historyDate: {
    ...typography.caption,
    color: colors.textMuted,
    width: 92,
  },
  historyBarArea: {
    flex: 1,
  },
  historyDuration: {
    ...typography.label,
    color: colors.text,
    minWidth: 76,
    textAlign: "right",
  },
});
