import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { ErrorState, LoadingState } from "@/components/ScreenState";
import { getDay } from "@/lib/api";
import { formatLongDate } from "@/lib/date";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type { TodoOccurrence } from "@/types";

export function AnalyticsScreen({ today }: { today: string }) {
  const dayQuery = useQuery({
    queryKey: ["day", today],
    queryFn: () => getDay(today),
  });
  const snapshot = useMemo(() => {
    const pending = dayQuery.data?.pending ?? [];
    const done = dayQuery.data?.done ?? [];
    const all = [...pending, ...done];
    const total = all.length;
    const completionRate = total ? Math.round((done.length / total) * 100) : 0;
    const reminderCoverage = total
      ? Math.round(
          (all.filter((task) => Boolean(task.reminderTime)).length / total) * 100,
        )
      : 0;
    const recurringRate = total
      ? Math.round((all.filter((task) => task.isRecurring).length / total) * 100)
      : 0;
    const carryover = all.filter((task) => task.source === "carryover").length;
    const focusScore = Math.max(
      0,
      Math.min(100, completionRate - pending.length * 2 + 20),
    );
    return {
      all,
      carryover,
      completionRate,
      done,
      focusScore,
      pending,
      recurringRate,
      reminderCoverage,
      total,
    };
  }, [dayQuery.data]);

  if (dayQuery.isPending) {
    return <LoadingState label="正在整理今日复盘…" />;
  }
  if (dayQuery.isError) {
    return (
      <ErrorState
        message={dayQuery.error.message || "分析加载失败"}
        onRetry={() => dayQuery.refetch()}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.title}>分析</Text>
          <Text style={styles.subtitle}>
            {formatLongDate(today)} · 完成 {snapshot.done.length} 项，待处理{" "}
            {snapshot.pending.length} 项
          </Text>
        </View>
        <View style={styles.rate}>
          <Text style={styles.rateValue}>{snapshot.completionRate}%</Text>
          <Text style={styles.rateLabel}>完成率</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <Metric label="今日任务" value={snapshot.total} />
        <Metric label="已完成" value={snapshot.done.length} />
        <Metric label="未完成" value={snapshot.pending.length} />
        <Metric label="专注分" value={snapshot.focusScore} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>任务质量</Text>
        <Quality label="提醒覆盖" value={snapshot.reminderCoverage} />
        <Quality label="重复任务" value={snapshot.recurringRate} />
        <Quality
          label="结转压力"
          value={
            snapshot.total
              ? Math.round((snapshot.carryover / snapshot.total) * 100)
              : 0
          }
        />
      </View>

      <TaskSummary title="今天干了啥" tasks={snapshot.done} />
      <TaskSummary title="今天还剩什么" tasks={snapshot.pending} />
    </ScrollView>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Quality({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.quality}>
      <View style={styles.qualityHeading}>
        <Text style={styles.qualityLabel}>{label}</Text>
        <Text style={styles.qualityValue}>{value}%</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${value}%` }]} />
      </View>
    </View>
  );
}

function TaskSummary({
  tasks,
  title,
}: {
  tasks: TodoOccurrence[];
  title: string;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {tasks.length ? (
        tasks.slice(0, 8).map((task) => (
          <View key={task.id} style={styles.summaryRow}>
            <Text numberOfLines={1} style={styles.summaryText}>
              {task.text}
            </Text>
            {task.reminderTime ? (
              <Text style={styles.summaryTime}>{task.reminderTime}</Text>
            ) : null}
          </View>
        ))
      ) : (
        <Text style={styles.empty}>暂无任务。</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  hero: {
    ...shadows.panel,
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
  },
  heroCopy: {
    flex: 1,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  rate: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.full,
    height: 78,
    justifyContent: "center",
    width: 78,
  },
  rateValue: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: "900",
  },
  rateLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metric: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 2,
    padding: spacing.md,
    width: "48%",
  },
  metricValue: {
    color: colors.accent,
    fontSize: 24,
    fontWeight: "900",
  },
  metricLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  panel: {
    ...shadows.panel,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelTitle: {
    ...typography.section,
    color: colors.text,
  },
  quality: {
    gap: spacing.xs,
  },
  qualityHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  qualityLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  qualityValue: {
    ...typography.label,
    color: colors.accent,
  },
  track: {
    backgroundColor: colors.border,
    borderRadius: radius.full,
    height: 6,
    overflow: "hidden",
  },
  fill: {
    backgroundColor: colors.accent,
    height: 6,
  },
  summaryRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
  },
  summaryText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  summaryTime: {
    ...typography.caption,
    color: colors.textMuted,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
  },
});
