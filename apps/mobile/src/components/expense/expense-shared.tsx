import { StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { expenseTracking } from "@/lib/expense-tracking";
import { colors, spacing, typography } from "@/theme";

export type ExpenseHealth = Awaited<
  ReturnType<typeof expenseTracking.getHealth>
>;
export type ExpenseDay = Awaited<
  ReturnType<typeof expenseTracking.getTransactions>
>;

export function formatTransactionTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ExpenseEmptyState({
  body,
  icon,
  title,
}: {
  body: string;
  icon: React.ComponentProps<typeof AppIcon>["name"];
  title: string;
}) {
  return (
    <View style={styles.emptyState}>
      <AppIcon color={colors.textMuted} name={icon} size={32} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

// Bits every expense tab uses; kept here so the per-tab StyleSheets stay
// scoped to what each tab actually renders.
export const expenseSharedStyles = StyleSheet.create({
  sectionStack: {
    gap: spacing.md,
  },
  loader: {
    marginVertical: spacing.xxl,
  },
  pressed: {
    opacity: 0.62,
  },
  healthDotReady: {
    backgroundColor: colors.accent,
  },
  healthDotWarning: {
    backgroundColor: "#D98E04",
  },
});

const styles = StyleSheet.create({
  emptyState: {
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl * 2,
  },
  emptyTitle: {
    ...typography.section,
    color: colors.text,
    textAlign: "center",
  },
  emptyBody: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 19,
    textAlign: "center",
  },
});
