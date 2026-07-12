import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { formatLongDate } from "@/lib/date";
import type { MobilityRuntimeState } from "@/lib/useMobilityRuntime";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type { MobilityDay } from "@/types";

export function formatRuntimeTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function MobilityDetails({
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
    runtime.stepSource === "device"
      ? "原生设备计步传感器"
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
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 3,
  },
  pressed: {
    opacity: 0.68,
  },
  metrics: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
  stepNote: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
    textAlign: "center",
  },
});
