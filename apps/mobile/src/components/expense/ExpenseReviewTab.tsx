import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import {
  formatCny,
  moneyNatureLabels,
  type ExpenseCandidate,
} from "@/lib/expense-tracking";
import { colors, radius, shadows, spacing, typography } from "@/theme";

import { ExpenseEmptyState, expenseSharedStyles } from "./expense-shared";

export function ExpenseReviewTab({
  candidates,
  isLoading,
  onConfirm,
  onIgnore,
}: {
  candidates: ExpenseCandidate[];
  isLoading: boolean;
  onConfirm: (candidate: ExpenseCandidate) => Promise<void>;
  onIgnore: (candidate: ExpenseCandidate) => Promise<void>;
}) {
  if (isLoading) {
    return (
      <ActivityIndicator color={colors.accent} style={expenseSharedStyles.loader} />
    );
  }
  if (!candidates.length) {
    return (
      <ExpenseEmptyState
        body="只有信息不足或存在冲突的交易才会进入这里。"
        icon="checkmark-done-outline"
        title="没有待核对交易"
      />
    );
  }
  return (
    <View style={expenseSharedStyles.sectionStack}>
      {candidates.map((candidate) => (
        <View key={candidate.id} style={styles.reviewCard}>
          <View style={styles.reviewHeader}>
            <View style={styles.reviewCopy}>
              <Text style={styles.reviewMerchant}>
                {candidate.merchant || "商户待确认"}
              </Text>
              <Text style={styles.reviewMeta}>
                {moneyNatureLabels[candidate.moneyNature]} ·{" "}
                {candidate.sourceKind === "notification" ? "通知" : "页面"}
              </Text>
            </View>
            <Text style={styles.reviewAmount}>
              {candidate.amountMinor == null
                ? "金额待确认"
                : formatCny(candidate.amountMinor)}
            </Text>
          </View>
          <Text style={styles.reviewReason}>
            {candidate.confidenceReasons.join("、") || "识别信息不足"}
          </Text>
          <View style={styles.reviewActions}>
            <Pressable
              onPress={() => void onIgnore(candidate)}
              style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>忽略</Text>
            </Pressable>
            <Pressable
              disabled={candidate.amountMinor == null}
              onPress={() => void onConfirm(candidate)}
              style={[
                styles.primaryAction,
                candidate.amountMinor == null && styles.actionDisabled,
              ]}>
              <Text style={styles.primaryActionText}>确认记录</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  reviewCard: {
    ...shadows.card,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  reviewHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  reviewCopy: {
    flex: 1,
    gap: 3,
  },
  reviewMerchant: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  reviewMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  reviewAmount: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  reviewReason: {
    ...typography.caption,
    color: colors.textMuted,
  },
  reviewActions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  secondaryAction: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  secondaryActionText: {
    ...typography.label,
    color: colors.text,
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  primaryActionText: {
    ...typography.label,
    color: colors.white,
    fontWeight: "800",
  },
  actionDisabled: {
    opacity: 0.45,
  },
});
