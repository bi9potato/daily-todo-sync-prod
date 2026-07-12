import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import {
  categoryLabel,
  formatCny,
  moneyNatureLabels,
} from "@/lib/expense-tracking";
import { colors, radius, spacing, typography } from "@/theme";

import {
  ExpenseEmptyState,
  expenseSharedStyles,
  formatTransactionTime,
  type ExpenseDay,
} from "./expense-shared";

export function ExpenseLedgerTab({
  data,
  isLoading,
  onDelete,
  summary,
  today,
}: {
  data: ExpenseDay | undefined;
  isLoading: boolean;
  onDelete: (id: string) => Promise<void>;
  summary: ExpenseDay["summary"] | undefined;
  today: string;
}) {
  if (isLoading) {
    return (
      <ActivityIndicator color={colors.accent} style={expenseSharedStyles.loader} />
    );
  }
  const transactions = data?.transactions ?? [];
  const netExpense =
    (summary?.expenseMinor ?? 0) - (summary?.refundMinor ?? 0);

  return (
    <View style={expenseSharedStyles.sectionStack}>
      <View style={styles.summaryGrid}>
        <SummaryMetric
          label="净支出"
          value={formatCny(netExpense)}
          wide
        />
        <SummaryMetric
          label="收入"
          tone="positive"
          value={formatCny(summary?.incomeMinor ?? 0)}
        />
        <SummaryMetric
          label="退款"
          value={formatCny(summary?.refundMinor ?? 0)}
        />
      </View>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>今天的记录</Text>
          <Text style={styles.sectionMeta}>
            {today} · {transactions.length} 笔
          </Text>
        </View>
      </View>

      {transactions.length ? (
        transactions.map((transaction) => {
          const positive =
            transaction.moneyNature === "earned_income" ||
            transaction.moneyNature === "refund";
          return (
            <Pressable
              key={transaction.id}
              onLongPress={() =>
                Alert.alert(
                  "删除这笔记录？",
                  "删除后无法自动恢复。",
                  [
                    { text: "取消", style: "cancel" },
                    {
                      text: "删除",
                      style: "destructive",
                      onPress: () => void onDelete(transaction.id),
                    },
                  ],
                )
              }
              style={({ pressed }) => [
                styles.transactionCard,
                pressed && expenseSharedStyles.pressed,
              ]}>
              <View
                style={[
                  styles.transactionIcon,
                  positive && styles.transactionIconPositive,
                ]}>
                <AppIcon
                  color={positive ? colors.accent : colors.text}
                  name={
                    transaction.moneyNature === "earned_income"
                      ? "arrow-down"
                      : transaction.moneyNature === "refund"
                        ? "return-down-back"
                        : "card-outline"
                  }
                  size={19}
                />
              </View>
              <View style={styles.transactionCopy}>
                <Text numberOfLines={1} style={styles.transactionMerchant}>
                  {transaction.merchant ||
                    moneyNatureLabels[transaction.moneyNature]}
                </Text>
                <Text style={styles.transactionMeta}>
                  {formatTransactionTime(transaction.occurredAt)} ·{" "}
                  {categoryLabel(transaction.category)}
                  {transaction.excludedFromTotals ? " · 不计入收支" : ""}
                </Text>
              </View>
              <Text
                style={[
                  styles.transactionAmount,
                  positive && styles.transactionAmountPositive,
                ]}>
                {positive ? "+" : "-"}
                {formatCny(transaction.amountMinor)}
              </Text>
            </Pressable>
          );
        })
      ) : (
        <ExpenseEmptyState
          body="开启数据源后，高置信度交易会自动出现在这里；也可以先手动记一笔。"
          icon="receipt-outline"
          title="今天还没有记录"
        />
      )}
    </View>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
  wide,
}: {
  label: string;
  value: string;
  tone?: "positive";
  wide?: boolean;
}) {
  return (
    <View style={[styles.summaryMetric, wide && styles.summaryMetricWide]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text
        numberOfLines={1}
        style={[
          styles.summaryValue,
          tone === "positive" && styles.summaryValuePositive,
        ]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryMetric: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    flex: 1,
    gap: spacing.xs,
    minWidth: 120,
    padding: spacing.md,
  },
  summaryMetricWide: {
    flexBasis: "100%",
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  summaryValuePositive: {
    color: colors.accent,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  sectionTitle: {
    ...typography.section,
    color: colors.text,
  },
  sectionMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  transactionCard: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 68,
    paddingVertical: spacing.sm,
  },
  transactionIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  transactionIconPositive: {
    backgroundColor: colors.accentSoft,
  },
  transactionCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  transactionMerchant: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  transactionMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  transactionAmount: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  transactionAmountPositive: {
    color: colors.accent,
  },
});
