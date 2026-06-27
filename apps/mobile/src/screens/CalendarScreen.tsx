import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { DateStrip } from "@/components/DateStrip";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import { getRange } from "@/lib/api";
import {
  formatLongDate,
  formatMonthDay,
  getWeekRange,
  shortWeekday,
} from "@/lib/date";
import { colors, radius, spacing, typography } from "@/theme";

type CalendarScreenProps = {
  selectedDate: string;
  today: string;
  onOpenDate: (date: string) => void;
  onSelectDate: (date: string) => void;
};

export function CalendarScreen({
  selectedDate,
  today,
  onOpenDate,
  onSelectDate,
}: CalendarScreenProps) {
  const range = getWeekRange(selectedDate);
  const rangeQuery = useQuery({
    queryKey: ["range", range.start, range.end],
    queryFn: () => getRange(range.start, range.end),
  });

  if (rangeQuery.isPending) {
    return (
      <View style={styles.page}>
        <Header selectedDate={selectedDate} />
        <LoadingState label="正在读取本周日程…" />
      </View>
    );
  }

  if (rangeQuery.isError) {
    return (
      <View style={styles.page}>
        <Header selectedDate={selectedDate} />
        <ErrorState
          message={rangeQuery.error.message || "日历加载失败"}
          onRetry={() => rangeQuery.refetch()}
        />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <Header selectedDate={selectedDate} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <DateStrip
          onSelect={onSelectDate}
          selectedDate={selectedDate}
          today={today}
        />
        <View style={styles.weekList}>
          {rangeQuery.data.days.map((day) => {
            const all = [...day.pending, ...day.done];
            const isSelected = day.date === selectedDate;
            return (
              <Pressable
                key={day.date}
                onPress={() => onOpenDate(day.date)}
                style={({ pressed }) => [
                  styles.dayRow,
                  isSelected && styles.dayRowSelected,
                  pressed && styles.pressed,
                ]}>
                <View style={styles.dayLabel}>
                  <Text style={[styles.weekday, isSelected && styles.selectedText]}>
                    {shortWeekday(day.date)}
                  </Text>
                  <Text style={[styles.monthDay, isSelected && styles.selectedText]}>
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
                <AppIcon name="chevron-forward" color={colors.borderStrong} size={18} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function Header({ selectedDate }: { selectedDate: string }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.title}>日历</Text>
        <Text style={styles.subtitle}>{formatLongDate(selectedDate)}</Text>
      </View>
      <View style={styles.calendarIcon}>
        <AppIcon name="calendar-outline" color={colors.accent} size={22} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
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
  calendarIcon: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  content: {
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  weekList: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dayRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 92,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  dayRowSelected: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.lg,
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
  pressed: {
    opacity: 0.64,
  },
});
