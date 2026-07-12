import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { CaptureHealthCard } from "@/components/expense/CaptureHealthCard";
import { ExpenseLedgerTab } from "@/components/expense/ExpenseLedgerTab";
import { ExpenseReviewTab } from "@/components/expense/ExpenseReviewTab";
import { ExpenseSourcesTab } from "@/components/expense/ExpenseSourcesTab";
import { ManualTransactionModal } from "@/components/expense/ManualTransactionModal";
import {
  expenseTracking,
  isExpenseTrackingAvailable,
  type ExpenseDiagnosticSample,
  type ExpenseSource,
  type InstalledExpenseApp,
} from "@/lib/expense-tracking";
import { colors, radius, shadows, spacing, typography } from "@/theme";

type ScreenTab = "ledger" | "review" | "sources";

const EMPTY_SOURCES: ExpenseSource[] = [];
const EMPTY_INSTALLED_APPS: InstalledExpenseApp[] = [];
const EMPTY_DIAGNOSTIC_SAMPLES: ExpenseDiagnosticSample[] = [];

export function ExpenseTrackingScreen({
  openManualOnMount = false,
  today,
}: {
  openManualOnMount?: boolean;
  today: string;
}) {
  const queryClient = useQueryClient();
  const available = isExpenseTrackingAvailable();
  const [tab, setTab] = useState<ScreenTab>("ledger");
  const [manualOpen, setManualOpen] = useState(openManualOnMount);
  const [sourceSearch, setSourceSearch] = useState("");
  const [actionError, setActionError] = useState("");
  // Drawer screens stay mounted once visited; without a focus gate the
  // 5s health/samples polling would keep running from every other screen.
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  const healthQuery = useQuery({
    queryKey: ["expense-health"],
    queryFn: expenseTracking.getHealth,
    enabled: available,
    refetchInterval: isFocused && tab === "sources" ? 5_000 : false,
  });
  const dayQuery = useQuery({
    queryKey: ["expense-day", today],
    queryFn: () => expenseTracking.getTransactions(today),
    enabled: available,
  });
  const candidatesQuery = useQuery({
    queryKey: ["expense-candidates"],
    queryFn: expenseTracking.getPendingCandidates,
    enabled: available,
  });
  const sourcesQuery = useQuery({
    queryKey: ["expense-sources"],
    queryFn: expenseTracking.getSources,
    enabled: available,
  });
  const installedAppsQuery = useQuery({
    queryKey: ["expense-installed-apps"],
    queryFn: expenseTracking.getInstalledApps,
    enabled: available && tab === "sources",
    staleTime: 60_000,
  });
  // Diagnostic sampling captures real notification/accessibility excerpts,
  // but until now there was no way to actually see them -- the only path to
  // building a real parser for a payment app is reading what it really sent.
  const diagnosticSamplesQuery = useQuery({
    queryKey: ["expense-diagnostic-samples"],
    queryFn: expenseTracking.getDiagnosticSamples,
    enabled: available && tab === "sources",
    refetchInterval: isFocused && tab === "sources" ? 5_000 : false,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && available) {
        void queryClient.invalidateQueries({ queryKey: ["expense-health"] });
        void queryClient.invalidateQueries({ queryKey: ["expense-sources"] });
      }
    });
    return () => subscription.remove();
  }, [available, queryClient]);

  const refreshLedger = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["expense-day", today] }),
      queryClient.invalidateQueries({ queryKey: ["expense-candidates"] }),
      queryClient.invalidateQueries({ queryKey: ["expense-health"] }),
    ]);
  };

  const sourceMutation = useMutation({
    mutationFn: ({
      packageName,
      enabled,
      diagnosticCaptureEnabled,
    }: {
      packageName: string;
      enabled: boolean;
      diagnosticCaptureEnabled: boolean;
    }) =>
      expenseTracking.setSourceConfig(
        packageName,
        enabled,
        diagnosticCaptureEnabled,
      ),
    onSuccess: () => {
      setActionError("");
      void queryClient.invalidateQueries({ queryKey: ["expense-sources"] });
      void queryClient.invalidateQueries({ queryKey: ["expense-health"] });
    },
    onError: setErrorFromUnknown,
  });

  const clearDiagnosticSamplesMutation = useMutation({
    mutationFn: expenseTracking.clearDiagnosticSamples,
    onSuccess: () => {
      setActionError("");
      void queryClient.invalidateQueries({
        queryKey: ["expense-diagnostic-samples"],
      });
    },
    onError: setErrorFromUnknown,
  });

  function setErrorFromUnknown(error: unknown) {
    setActionError(
      error instanceof Error ? error.message : "操作失败，请稍后重试。",
    );
  }

  if (!available) {
    return (
      <View style={styles.centerState}>
        <AppIcon name="logo-android" color={colors.textMuted} size={36} />
        <Text style={styles.centerStateTitle}>需要 Android 原生构建</Text>
        <Text style={styles.centerStateBody}>
          当前构建未包含每日收支原生模块，请重新生成并安装 Android APK。
        </Text>
      </View>
    );
  }

  const health = healthQuery.data;
  const summary = dayQuery.data?.summary;
  const sources = sourcesQuery.data ?? EMPTY_SOURCES;
  const sourceByPackage = new Map(
    sources.map((source) => [source.packageName, source]),
  );
  const installedApps = installedAppsQuery.data ?? EMPTY_INSTALLED_APPS;
  const normalizedSearch = sourceSearch.trim().toLocaleLowerCase("zh-CN");
  const visibleApps = normalizedSearch
    ? installedApps.filter(
        (app) =>
          app.label.toLocaleLowerCase("zh-CN").includes(normalizedSearch) ||
          app.packageName.toLocaleLowerCase("zh-CN").includes(normalizedSearch),
      )
    : installedApps;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <View style={styles.headingCopy}>
            <Text style={styles.title}>每日收支</Text>
            <Text style={styles.subtitle}>本机记录 · Android 专属</Text>
          </View>
          <Pressable
            accessibilityLabel="手动记一笔"
            onPress={() => setManualOpen(true)}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.pressed,
            ]}>
            <AppIcon name="add" color={colors.white} size={22} />
            <Text style={styles.addButtonText}>记一笔</Text>
          </Pressable>
        </View>

        <CaptureHealthCard health={health} loading={healthQuery.isPending} />

        <View style={styles.tabs}>
          {(
            [
              ["ledger", "明细"],
              ["review", `待核对${health?.pendingCandidateCount ? ` ${health.pendingCandidateCount}` : ""}`],
              ["sources", "数据源"],
            ] as [ScreenTab, string][]
          ).map(([key, label]) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              key={key}
              onPress={() => setTab(key)}
              style={[styles.tab, tab === key && styles.tabActive]}>
              <Text
                style={[
                  styles.tabText,
                  tab === key && styles.tabTextActive,
                ]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {actionError ? (
          <View style={styles.errorCard}>
            <AppIcon name="alert-circle-outline" color={colors.danger} size={18} />
            <Text style={styles.errorText}>{actionError}</Text>
          </View>
        ) : null}

        {tab === "ledger" ? (
          <ExpenseLedgerTab
            data={dayQuery.data}
            isLoading={dayQuery.isPending}
            onDelete={async (transactionId) => {
              try {
                await expenseTracking.deleteTransaction(transactionId);
                await refreshLedger();
              } catch (error) {
                setErrorFromUnknown(error);
              }
            }}
            summary={summary}
            today={today}
          />
        ) : null}

        {tab === "review" ? (
          <ExpenseReviewTab
            candidates={candidatesQuery.data ?? []}
            isLoading={candidatesQuery.isPending}
            onConfirm={async (candidate) => {
              try {
                await expenseTracking.confirmCandidate(
                  candidate.id,
                  candidate.moneyNature,
                  candidate.category,
                );
                await refreshLedger();
              } catch (error) {
                setErrorFromUnknown(error);
              }
            }}
            onIgnore={async (candidate) => {
              try {
                await expenseTracking.ignoreCandidate(candidate.id);
                await refreshLedger();
              } catch (error) {
                setErrorFromUnknown(error);
              }
            }}
          />
        ) : null}

        {tab === "sources" ? (
          <ExpenseSourcesTab
            apps={visibleApps}
            health={health}
            isLoading={
              installedAppsQuery.isPending || sourcesQuery.isPending
            }
            onClearSamples={() => clearDiagnosticSamplesMutation.mutate()}
            onSearch={setSourceSearch}
            onSetSource={(app, enabled, diagnostics) => {
              setActionError("");
              sourceMutation.mutate({
                packageName: app.packageName,
                enabled,
                diagnosticCaptureEnabled: diagnostics,
              });
            }}
            clearingSamples={clearDiagnosticSamplesMutation.isPending}
            samples={diagnosticSamplesQuery.data ?? EMPTY_DIAGNOSTIC_SAMPLES}
            search={sourceSearch}
            sourceByPackage={sourceByPackage}
            updatePending={sourceMutation.isPending}
          />
        ) : null}
      </ScrollView>

      <ManualTransactionModal
        onClose={() => setManualOpen(false)}
        onSaved={async () => {
          setManualOpen(false);
          await refreshLedger();
        }}
        open={manualOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.surface,
    flex: 1,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  headingCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  addButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  addButtonText: {
    ...typography.label,
    color: colors.white,
    fontWeight: "800",
  },
  tabs: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    flexDirection: "row",
    padding: spacing.xs,
  },
  tab: {
    alignItems: "center",
    borderRadius: radius.sm,
    flex: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  tabActive: {
    ...shadows.card,
    backgroundColor: colors.surface,
  },
  tabText: {
    ...typography.label,
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.accent,
    fontWeight: "800",
  },
  errorCard: {
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    flex: 1,
  },
  centerState: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.xl,
  },
  centerStateTitle: {
    ...typography.section,
    color: colors.text,
  },
  centerStateBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.62,
  },
});
