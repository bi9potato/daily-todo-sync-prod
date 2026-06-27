import { Pressable, StyleSheet, Text, View } from "react-native";

import { fromDateKey, getCenteredDates, shortWeekday } from "@/lib/date";
import { colors, radius, spacing, typography } from "@/theme";

type DateStripProps = {
  selectedDate: string;
  today: string;
  onSelect: (date: string) => void;
};

export function DateStrip({ selectedDate, today, onSelect }: DateStripProps) {
  const dates = getCenteredDates(selectedDate);

  return (
    <View style={styles.container}>
      {dates.map((date) => {
        const selected = date === selectedDate;
        const day = fromDateKey(date).getDate();
        return (
          <Pressable
            accessibilityLabel={`${date}${date === today ? "，今天" : ""}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={date}
            onPress={() => onSelect(date)}
            style={({ pressed }) => [
              styles.day,
              selected && styles.selectedDay,
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.weekday, selected && styles.selectedWeekday]}>
              {shortWeekday(date)}
            </Text>
            <View style={[styles.numberCircle, selected && styles.selectedNumberCircle]}>
              <Text style={[styles.number, selected && styles.selectedNumber]}>{day}</Text>
            </View>
            <View
              style={[
                styles.todayDot,
                date === today && styles.todayDotVisible,
                selected && styles.selectedTodayDot,
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  day: {
    alignItems: "center",
    borderRadius: radius.md,
    minHeight: 80,
    minWidth: 54,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  selectedDay: {
    backgroundColor: colors.accentSoft,
  },
  pressed: {
    opacity: 0.72,
  },
  weekday: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  selectedWeekday: {
    color: colors.accent,
    fontWeight: "700",
  },
  numberCircle: {
    alignItems: "center",
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  selectedNumberCircle: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
  },
  number: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "500",
  },
  selectedNumber: {
    color: colors.white,
    fontWeight: "700",
  },
  todayDot: {
    backgroundColor: "transparent",
    borderRadius: radius.full,
    height: 4,
    marginTop: spacing.xs,
    width: 4,
  },
  todayDotVisible: {
    backgroundColor: colors.accent,
  },
  selectedTodayDot: {
    backgroundColor: colors.accent,
  },
});
