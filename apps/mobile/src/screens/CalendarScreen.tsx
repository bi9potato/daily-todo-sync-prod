import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { DateStrip } from "@/components/DateStrip";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import { getRange } from "@/lib/api";
import {
  addDays,
  addMonths,
  formatLongDate,
  formatMonthDay,
  fromDateKey,
  getMonthRange,
  getWeekRange,
  shortWeekday,
} from "@/lib/date";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type { DayTodos } from "@/types";

export type CalendarViewMode = "day" | "week" | "month";

type CalendarScreenProps = {
  mode: CalendarViewMode;
  selectedDate: string;
  today: string;
  onOpenDate: (date: string) => void;
  onSelectDate: (date: string) => void;
};

export function CalendarScreen({
  mode,
  selectedDate,
  today,
  onOpenDate,
  onSelectDate,
}: CalendarScreenProps) {
  const monthRange = getMonthRange(selectedDate);
  const range =
    mode === "day"
      ? { start: selectedDate, end: selectedDate }
      : mode === "week"
        ? getWeekRange(selectedDate)
        : monthRange;
  const rangeQuery = useQuery({
    queryKey: ["range", range.start, range.end],
    queryFn: () => getRange(range.start, range.end),
  });

  return (
    <View style={styles.page}>
      <Header
        mode={mode}
        onSelectDate={onSelectDate}
        selectedDate={selectedDate}
        today={today}
      />
      {rangeQuery.isPending ? (
        <LoadingState
          label="正在读取日程…"
          isPaused={rangeQuery.fetchStatus === "paused"}
        />
      ) : rangeQuery.isError ? (
        <ErrorState
          message={rangeQuery.error.message || "日历加载失败"}
          onRetry={() => rangeQuery.refetch()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <DateStrip
            onSelect={onSelectDate}
            selectedDate={selectedDate}
            today={today}
          />
          {mode === "month" ? (
            <MonthGrid
              days={rangeQuery.data.days}
              monthEnd={monthRange.monthEnd}
              monthStart={monthRange.monthStart}
              onOpenDate={onOpenDate}
              onSelectDate={onSelectDate}
              selectedDate={selectedDate}
            />
          ) : (
            <DayList
              days={rangeQuery.data.days}
              onOpenDate={onOpenDate}
              selectedDate={selectedDate}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Header({
  mode,
  onSelectDate,
  selectedDate,
  today,
}: {
  mode: CalendarViewMode;
  onSelectDate: (date: string) => void;
  selectedDate: string;
  today: string;
}) {
  const amount = mode === "day" ? 1 : 7;
  const modeLabel = mode === "day" ? "日视图" : mode === "week" ? "周视图" : "月视图";

  function shift(direction: -1 | 1) {
    onSelectDate(
      mode === "month"
        ? addMonths(selectedDate, direction)
        : addDays(selectedDate, amount * direction),
    );
  }

  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.title}>日历</Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          {formatLongDate(selectedDate)} · {modeLabel}
        </Text>
      </View>
      <View style={styles.dateControls}>
        <Pressable
          accessibilityLabel="上一时间段"
          onPress={() => shift(-1)}
          style={styles.dateButton}>
          <AppIcon name="chevron-back" color={colors.textMuted} size={19} />
        </Pressable>
        <Pressable onPress={() => onSelectDate(today)} style={styles.todayButton}>
          <Text style={styles.todayButtonText}>今天</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="下一时间段"
          onPress={() => shift(1)}
          style={styles.dateButton}>
          <AppIcon name="chevron-forward" color={colors.textMuted} size={19} />
        </Pressable>
      </View>
    </View>
  );
}

function DayList({
  days,
  onOpenDate,
  selectedDate,
}: {
  days: DayTodos[];
  onOpenDate: (date: string) => void;
  selectedDate: string;
}) {
  return (
    <View style={styles.dayList}>
      {days.map((day) => {
        const all = [...day.pending, ...day.done];
        const selected = day.date === selectedDate;
        return (
          <Pressable
            key={day.date}
            onPress={() => onOpenDate(day.date)}
            style={({ pressed }) => [
              styles.dayRow,
              selected && styles.dayRowSelected,
              pressed && styles.pressed,
            ]}>
            <View style={styles.dayLabel}>
              <Text style={[styles.weekday, selected && styles.selectedText]}>
                {shortWeekday(day.date)}
              </Text>
              <Text style={[styles.monthDay, selected && styles.selectedText]}>
                {formatMonthDay(day.date)}
              </Text>
            </View>
            <View style={styles.dayTasks}>
              {all.length ? (
                all.slice(0, 3).map((task) => (
                  <View key={task.id} style={styles.taskPreview}>
                    <View
                      style={[
                        styles.taskDot,
                        task.status === "done" && styles.taskDotDone,
                      ]}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.taskText,
                        task.status === "done" && styles.taskTextDone,
                      ]}>
                      {task.text}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.noTasks}>无任务</Text>
              )}
              {all.length > 3 ? (
                <Text style={styles.moreTasks}>还有 {all.length - 3} 项</Text>
              ) : null}
            </View>
            <AppIcon name="chevron-forward" color={colors.textMuted} size={18} />
          </Pressable>
        );
      })}
    </View>
  );
}

function MonthGrid({
  days,
  monthEnd,
  monthStart,
  onOpenDate,
  onSelectDate,
  selectedDate,
}: {
  days: DayTodos[];
  monthEnd: string;
  monthStart: string;
  onOpenDate: (date: string) => void;
  onSelectDate: (date: string) => void;
  selectedDate: string;
}) {
  return (
    <View style={styles.monthPanel}>
      <View style={styles.monthWeekdays}>
        {["一", "二", "三", "四", "五", "六", "日"].map((weekday) => (
          <Text key={weekday} style={styles.monthWeekday}>
            {weekday}
          </Text>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {days.map((day) => {
          const total = day.pending.length + day.done.length;
          const selected = day.date === selectedDate;
          const inMonth = day.date >= monthStart && day.date <= monthEnd;
          return (
            <Pressable
              key={day.date}
              onPress={() => onSelectDate(day.date)}
              style={({ pressed }) => [
                styles.monthCell,
                selected && styles.monthCellSelected,
                pressed && styles.pressed,
              ]}>
              <Text
                style={[
                  styles.monthCellDay,
                  !inMonth && styles.monthCellMuted,
                  selected && styles.monthCellSelectedText,
                ]}>
                {fromDateKey(day.date).getDate()}
              </Text>
              {total ? (
                <View
                  style={[
                    styles.monthTaskDot,
                    selected && styles.monthTaskDotSelected,
                  ]}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={() => onOpenDate(selectedDate)}
        style={({ pressed }) => [
          styles.openDateButton,
          pressed && styles.pressed,
        ]}>
        <Text style={styles.openDateText}>打开所选日期</Text>
        <AppIcon name="arrow-forward" color={colors.white} size={18} />
      </Pressable>
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
    justifyContent: "space-between",
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
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  dateControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  dateButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  todayButton: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  todayButtonText: {
    ...typography.label,
    color: colors.accent,
  },
  content: {
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  dayList: {
    gap: spacing.sm,
  },
  dayRow: {
    ...shadows.card,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 92,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  dayRowSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderStrong,
  },
  dayLabel: {
    gap: 2,
    width: 66,
  },
  weekday: {
    ...typography.caption,
    color: colors.textMuted,
  },
  monthDay: {
    ...typography.label,
    color: colors.text,
  },
  selectedText: {
    color: colors.accent,
  },
  dayTasks: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  taskPreview: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  taskDot: {
    backgroundColor: colors.accent,
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  taskDotDone: {
    backgroundColor: colors.borderStrong,
  },
  taskText: {
    ...typography.label,
    color: colors.text,
    flex: 1,
  },
  taskTextDone: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  noTasks: {
    ...typography.label,
    color: colors.textMuted,
  },
  moreTasks: {
    ...typography.caption,
    color: colors.accent,
  },
  monthPanel: {
    ...shadows.panel,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  monthWeekdays: {
    flexDirection: "row",
  },
  monthWeekday: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
    paddingVertical: spacing.sm,
    textAlign: "center",
  },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  monthCell: {
    alignItems: "center",
    aspectRatio: 1,
    justifyContent: "center",
    width: "14.2857%",
  },
  monthCellSelected: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
  },
  monthCellDay: {
    ...typography.label,
    color: colors.text,
  },
  monthCellMuted: {
    color: colors.borderStrong,
  },
  monthCellSelectedText: {
    color: colors.white,
  },
  monthTaskDot: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 4,
    marginTop: 3,
    width: 4,
  },
  monthTaskDotSelected: {
    backgroundColor: colors.white,
  },
  openDateButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 46,
  },
  openDateText: {
    ...typography.label,
    color: colors.white,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.64,
  },
});
