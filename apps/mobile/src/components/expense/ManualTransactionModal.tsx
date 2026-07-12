import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { parseManualAmount } from "@/lib/expense-manual-entry";
import {
  expenseCategoryLabels,
  expenseTracking,
  incomeCategoryLabels,
  type ExpenseCategory,
  type TransactionCategory,
} from "@/lib/expense-tracking";
import { useBackPressKeyboardGuard } from "@/lib/keyboard";
import { colors, radius, spacing, typography } from "@/theme";

type ManualMode = "purchase_expense" | "earned_income" | "refund";

const EXPENSE_CATEGORY_ENTRIES = Object.entries(expenseCategoryLabels) as [
  ExpenseCategory,
  string,
][];
const INCOME_CATEGORY_ENTRIES = Object.entries(incomeCategoryLabels);

export function ManualTransactionModal({
  onClose,
  onSaved,
  open,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
  open: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [mode, setMode] = useState<ManualMode>("purchase_expense");
  const [category, setCategory] = useState<TransactionCategory>("food_dining");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const handleKeyboardGuard = useBackPressKeyboardGuard(onClose);

  const categoryEntries = useMemo(
    () =>
      mode === "earned_income"
        ? INCOME_CATEGORY_ENTRIES
        : EXPENSE_CATEGORY_ENTRIES,
    [mode],
  );

  function selectMode(nextMode: ManualMode) {
    setMode(nextMode);
    setCategory(nextMode === "earned_income" ? "salary" : "food_dining");
  }

  async function save() {
    const parsed = parseManualAmount(amount);
    if (parsed.error !== null) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await expenseTracking.addManualTransaction(
        parsed.amountMinor,
        Date.now(),
        mode,
        category,
        merchant.trim() || null,
      );
      setAmount("");
      setMerchant("");
      setMode("purchase_expense");
      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存失败，请重试。",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleKeyboardGuard}
      transparent
      visible={open}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalBackdrop}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>手动记一笔</Text>
            <Pressable
              accessibilityLabel="关闭"
              onPress={onClose}
              style={styles.modalClose}>
              <AppIcon name="close" color={colors.text} size={21} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>资金性质</Text>
            <View style={styles.modeRow}>
              {(
                [
                  ["purchase_expense", "支出"],
                  ["earned_income", "收入"],
                  ["refund", "退款"],
                ] as [ManualMode, string][]
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => selectMode(key)}
                  style={[
                    styles.modeButton,
                    mode === key && styles.modeButtonActive,
                  ]}>
                  <Text
                    style={[
                      styles.modeButtonText,
                      mode === key && styles.modeButtonTextActive,
                    ]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>金额</Text>
            <View style={styles.amountInputRow}>
              <Text style={styles.currencyPrefix}>¥</Text>
              <TextInput
                autoFocus
                keyboardType="decimal-pad"
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={colors.borderStrong}
                style={styles.amountInput}
                value={amount}
              />
            </View>

            <Text style={styles.fieldLabel}>商户/来源（可选）</Text>
            <TextInput
              onChangeText={setMerchant}
              placeholder="例如：美团外卖"
              placeholderTextColor={colors.textMuted}
              style={styles.textField}
              value={merchant}
            />

            <Text style={styles.fieldLabel}>分类</Text>
            <View style={styles.categoryGrid}>
              {categoryEntries.map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => setCategory(key as TransactionCategory)}
                  style={[
                    styles.categoryChip,
                    category === key && styles.categoryChipActive,
                  ]}>
                  <Text
                    style={[
                      styles.categoryChipText,
                      category === key && styles.categoryChipTextActive,
                    ]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error ? <Text style={styles.modalError}>{error}</Text> : null}
            <Pressable
              disabled={saving}
              onPress={() => void save()}
              style={[
                styles.saveButton,
                saving && styles.actionDisabled,
              ]}>
              {saving ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.saveButtonText}>保存记录</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    backgroundColor: "rgba(22, 27, 24, 0.45)",
    flex: 1,
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "88%",
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  modalHandle: {
    alignSelf: "center",
    backgroundColor: colors.borderStrong,
    borderRadius: radius.full,
    height: 4,
    marginBottom: spacing.md,
    width: 42,
  },
  modalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  modalClose: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  fieldLabel: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  modeButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
  },
  modeButtonActive: {
    backgroundColor: colors.accent,
  },
  modeButtonText: {
    ...typography.label,
    color: colors.textMuted,
  },
  modeButtonTextActive: {
    color: colors.white,
    fontWeight: "800",
  },
  amountInputRow: {
    alignItems: "center",
    borderBottomColor: colors.accent,
    borderBottomWidth: 2,
    flexDirection: "row",
  },
  currencyPrefix: {
    color: colors.text,
    fontSize: 27,
    fontWeight: "700",
  },
  amountInput: {
    color: colors.text,
    flex: 1,
    fontSize: 34,
    fontWeight: "800",
    minHeight: 62,
    paddingHorizontal: spacing.sm,
  },
  textField: {
    ...typography.body,
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  categoryChip: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  categoryChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  categoryChipText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  categoryChipTextActive: {
    color: colors.accent,
    fontWeight: "800",
  },
  modalError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.md,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    justifyContent: "center",
    marginTop: spacing.xl,
    minHeight: 50,
  },
  saveButtonText: {
    ...typography.body,
    color: colors.white,
    fontWeight: "800",
  },
  actionDisabled: {
    opacity: 0.45,
  },
});
