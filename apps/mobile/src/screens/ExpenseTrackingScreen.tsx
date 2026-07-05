import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import {
  categoryLabel,
  expenseCategoryLabels,
  expenseTracking,
  formatCny,
  incomeCategoryLabels,
  isExpenseTrackingAvailable,
  moneyNatureLabels,
  type ExpenseCandidate,
  type ExpenseCategory,
  type ExpenseSource,
  type InstalledExpenseApp,
  type TransactionCategory,
} from "@/lib/expense-tracking";
import { colors, radius, shadows, spacing, typography } from "@/theme";

type ScreenTab = "ledger" | "review" | "sources";
type ManualMode = "purchase_expense" | "earned_income" | "refund";

const EMPTY_SOURCES: ExpenseSource[] = [];
const EMPTY_INSTALLED_APPS: InstalledExpenseApp[] = [];
const EXPENSE_CATEGORY_ENTRIES = Object.entries(expenseCategoryLabels) as [
  ExpenseCategory,
  string,
][];
const INCOME_CATEGORY_ENTRIES = Object.entries(incomeCategoryLabels);

export function ExpenseTrackingScreen({ today }: { today: string }) {
  const queryClient = useQueryClient();
  const available = isExpenseTrackingAvailable();
  const [tab, setTab] = useState<ScreenTab>("ledger");
  const [manualOpen, setManualOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [actionError, setActionError] = useState("");

  const healthQuery = useQuery({
    queryKey: ["expense-health"],
    queryFn: expenseTracking.getHealth,
    enabled: available,
    refetchInterval: tab === "sources" ? 5_000 : false,
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
          <LedgerTab
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
          <ReviewTab
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
          <SourcesTab
            apps={visibleApps}
            health={health}
            isLoading={
              installedAppsQuery.isPending || sourcesQuery.isPending
            }
            onSearch={setSourceSearch}
            onSetSource={(app, enabled, diagnostics) => {
              setActionError("");
              sourceMutation.mutate({
                packageName: app.packageName,
                enabled,
                diagnosticCaptureEnabled: diagnostics,
              });
            }}
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

function CaptureHealthCard({
  health,
  loading,
}: {
  health: Awaited<ReturnType<typeof expenseTracking.getHealth>> | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <View style={styles.healthCard}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.healthLoading}>正在检查采集服务…</Text>
      </View>
    );
  }

  const checks = [
    {
      label: "通知读取",
      ready:
        Boolean(health?.notificationAccessGranted) &&
        Boolean(health?.notificationListenerConnected),
      onPress: expenseTracking.openNotificationAccessSettings,
    },
    {
      label: "页面识别",
      ready:
        Boolean(health?.accessibilityAccessGranted) &&
        Boolean(health?.accessibilityServiceConnected),
      onPress: expenseTracking.openAccessibilitySettings,
    },
    {
      label: "后台运行",
      ready: Boolean(health?.ignoringBatteryOptimizations),
      onPress: expenseTracking.openBatteryOptimizationSettings,
    },
  ];
  const readyCount = checks.filter((check) => check.ready).length;

  return (
    <View style={styles.healthCard}>
      <View style={styles.healthHeader}>
        <View>
          <Text style={styles.cardEyebrow}>采集状态</Text>
          <Text style={styles.healthTitle}>
            {readyCount === checks.length ? "服务已就绪" : `${readyCount}/3 项就绪`}
          </Text>
        </View>
        <View
          style={[
            styles.healthDot,
            readyCount === checks.length
              ? styles.healthDotReady
              : styles.healthDotWarning,
          ]}
        />
      </View>
      <View style={styles.healthChecks}>
        {checks.map((check) => (
          <Pressable
            key={check.label}
            onPress={() => void check.onPress()}
            style={({ pressed }) => [
              styles.healthCheck,
              pressed && styles.pressed,
            ]}>
            <AppIcon
              color={check.ready ? colors.accent : colors.danger}
              name={
                check.ready
                  ? "checkmark-circle"
                  : "alert-circle-outline"
              }
              size={18}
            />
            <Text style={styles.healthCheckLabel}>{check.label}</Text>
            {!check.ready ? (
              <Text style={styles.healthAction}>去设置</Text>
            ) : null}
          </Pressable>
        ))}
      </View>
      <Text style={styles.healthFootnote}>
        已启用 {health?.enabledSourceCount ?? 0} 个数据源；仅处理选中应用中的交易候选
      </Text>
    </View>
  );
}

function LedgerTab({
  data,
  isLoading,
  onDelete,
  summary,
  today,
}: {
  data: Awaited<ReturnType<typeof expenseTracking.getTransactions>> | undefined;
  isLoading: boolean;
  onDelete: (id: string) => Promise<void>;
  summary: Awaited<
    ReturnType<typeof expenseTracking.getTransactions>
  >["summary"] | undefined;
  today: string;
}) {
  if (isLoading) {
    return <ActivityIndicator color={colors.accent} style={styles.loader} />;
  }
  const transactions = data?.transactions ?? [];
  const netExpense =
    (summary?.expenseMinor ?? 0) - (summary?.refundMinor ?? 0);

  return (
    <View style={styles.sectionStack}>
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
                pressed && styles.pressed,
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
                  {formatTime(transaction.occurredAt)} ·{" "}
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
        <EmptyState
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

function ReviewTab({
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
    return <ActivityIndicator color={colors.accent} style={styles.loader} />;
  }
  if (!candidates.length) {
    return (
      <EmptyState
        body="只有信息不足或存在冲突的交易才会进入这里。"
        icon="checkmark-done-outline"
        title="没有待核对交易"
      />
    );
  }
  return (
    <View style={styles.sectionStack}>
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

function SourcesTab({
  apps,
  health,
  isLoading,
  onSearch,
  onSetSource,
  search,
  sourceByPackage,
  updatePending,
}: {
  apps: InstalledExpenseApp[];
  health: Awaited<ReturnType<typeof expenseTracking.getHealth>> | undefined;
  isLoading: boolean;
  onSearch: (value: string) => void;
  onSetSource: (
    app: InstalledExpenseApp,
    enabled: boolean,
    diagnostics: boolean,
  ) => void;
  search: string;
  sourceByPackage: Map<string, ExpenseSource>;
  updatePending: boolean;
}) {
  function setDiagnostics(
    app: InstalledExpenseApp,
    enabled: boolean,
  ) {
    if (!enabled) {
      onSetSource(app, true, false);
      return;
    }
    Alert.alert(
      "开启加密诊断采样？",
      "仅疑似交易的最小通知或页面片段会加密保存在本机，最长 7 天，用于验证当前应用版本的解析模板。不会自动上传。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "开启",
          onPress: () => onSetSource(app, true, true),
        },
      ],
    );
  }

  return (
    <View style={styles.sectionStack}>
      <View style={styles.disclosureCard}>
        <AppIcon name="shield-checkmark-outline" color={colors.accent} size={21} />
        <Text style={styles.disclosureText}>
          只选择你需要记录交易的应用。未验证版本只采集模板，不会自动记账；诊断采样必须单独开启，样本加密并在 7 天内删除。
        </Text>
      </View>

      {!health?.appNotificationsEnabled ? (
        <SettingsRow
          description="用于显示待核对和服务异常提醒"
          label="开启 Daily Todo 通知"
          onPress={expenseTracking.openAppNotificationSettings}
        />
      ) : null}
      {!health?.notificationAccessGranted ? (
        <SettingsRow
          description="读取选中应用发出的交易通知"
          label="开启通知使用权"
          onPress={expenseTracking.openNotificationAccessSettings}
        />
      ) : null}
      {!health?.accessibilityAccessGranted ? (
        <SettingsRow
          description="只读识别选中应用的交易结果页"
          label="开启页面识别"
          onPress={expenseTracking.openAccessibilitySettings}
        />
      ) : null}

      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onSearch}
        placeholder="搜索已安装应用或包名"
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
        value={search}
      />

      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : apps.length ? (
        apps.map((app) => {
          const source = sourceByPackage.get(app.packageName);
          const enabled = source?.enabled ?? false;
          const diagnostics = source?.diagnosticCaptureEnabled ?? false;
          return (
            <View key={app.packageName} style={styles.sourceCard}>
              <View style={styles.sourceHeader}>
                <View style={styles.sourceIcon}>
                  <Text style={styles.sourceIconText}>
                    {app.label.trim().slice(0, 1)}
                  </Text>
                </View>
                <View style={styles.sourceCopy}>
                  <Text numberOfLines={1} style={styles.sourceLabel}>
                    {app.label}
                  </Text>
                  <Text numberOfLines={1} style={styles.sourcePackage}>
                    {app.packageName} · {app.versionName || "未知版本"}
                  </Text>
                </View>
                <Switch
                  disabled={updatePending}
                  onValueChange={(next) =>
                    onSetSource(app, next, next ? diagnostics : false)
                  }
                  thumbColor={colors.white}
                  trackColor={{
                    false: colors.borderStrong,
                    true: colors.accent,
                  }}
                  value={enabled}
                />
              </View>
              {enabled ? (
                <View style={styles.sourceDetails}>
                  <View style={styles.sourceStatus}>
                    <View
                      style={[
                        styles.sourceStatusDot,
                        source?.validationState === "validated"
                          ? styles.healthDotReady
                          : styles.healthDotWarning,
                      ]}
                    />
                    <Text style={styles.sourceStatusText}>
                      {source?.validationState === "validated"
                        ? "模板已验证，可按置信度规则记录"
                        : "模板未验证，自动记录已锁定"}
                    </Text>
                  </View>
                  <View style={styles.diagnosticRow}>
                    <View style={styles.diagnosticCopy}>
                      <Text style={styles.diagnosticTitle}>诊断采样</Text>
                      <Text style={styles.diagnosticDescription}>
                        只保存疑似交易的加密最小片段
                      </Text>
                    </View>
                    <Switch
                      disabled={updatePending}
                      onValueChange={(next) => setDiagnostics(app, next)}
                      thumbColor={colors.white}
                      trackColor={{
                        false: colors.borderStrong,
                        true: colors.accent,
                      }}
                      value={diagnostics}
                    />
                  </View>
                  {source?.unknownTemplateCount ? (
                    <Text style={styles.unknownCount}>
                      已发现 {source.unknownTemplateCount} 个待验证交易事件
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })
      ) : (
        <EmptyState
          body="没有找到符合搜索条件的已安装应用。"
          icon="apps-outline"
          title="无结果"
        />
      )}
    </View>
  );
}

function SettingsRow({
  description,
  label,
  onPress,
}: {
  description: string;
  label: string;
  onPress: () => Promise<void>;
}) {
  return (
    <Pressable
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.settingsRow,
        pressed && styles.pressed,
      ]}>
      <AppIcon name="settings-outline" color={colors.danger} size={20} />
      <View style={styles.settingsCopy}>
        <Text style={styles.settingsLabel}>{label}</Text>
        <Text style={styles.settingsDescription}>{description}</Text>
      </View>
      <AppIcon name="chevron-forward" color={colors.textMuted} size={18} />
    </Pressable>
  );
}

function ManualTransactionModal({
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
    const normalized = amount.replace(",", ".").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
      setError("请输入正确金额，最多保留两位小数。");
      return;
    }
    const amountMinor = Math.round(Number(normalized) * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      setError("金额必须大于 0。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await expenseTracking.addManualTransaction(
        amountMinor,
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
      onRequestClose={onClose}
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

function EmptyState({
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

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
  healthCard: {
    ...shadows.card,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  healthHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardEyebrow: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  healthTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "800",
    marginTop: 2,
  },
  healthDot: {
    borderRadius: radius.full,
    height: 11,
    width: 11,
  },
  healthDotReady: {
    backgroundColor: colors.accent,
  },
  healthDotWarning: {
    backgroundColor: "#D98E04",
  },
  healthChecks: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  healthCheck: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    gap: spacing.xs,
    minHeight: 72,
    justifyContent: "center",
    padding: spacing.xs,
  },
  healthCheckLabel: {
    ...typography.caption,
    color: colors.text,
    fontWeight: "700",
  },
  healthAction: {
    color: colors.danger,
    fontSize: 10,
    fontWeight: "700",
  },
  healthFootnote: {
    ...typography.caption,
    color: colors.textMuted,
  },
  healthLoading: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
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
  sectionStack: {
    gap: spacing.md,
  },
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
  disclosureCard: {
    alignItems: "flex-start",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  disclosureText: {
    ...typography.caption,
    color: colors.accentPressed,
    flex: 1,
    lineHeight: 19,
  },
  settingsRow: {
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  settingsCopy: {
    flex: 1,
    gap: 2,
  },
  settingsLabel: {
    ...typography.label,
    color: colors.danger,
    fontWeight: "800",
  },
  settingsDescription: {
    ...typography.caption,
    color: colors.textMuted,
  },
  searchInput: {
    ...typography.body,
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  sourceCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  sourceHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 70,
    padding: spacing.md,
  },
  sourceIcon: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  sourceIconText: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: "800",
  },
  sourceCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  sourceLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  sourcePackage: {
    ...typography.caption,
    color: colors.textMuted,
  },
  sourceDetails: {
    backgroundColor: colors.surfaceMuted,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.md,
  },
  sourceStatus: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  sourceStatusDot: {
    borderRadius: radius.full,
    height: 8,
    width: 8,
  },
  sourceStatusText: {
    ...typography.caption,
    color: colors.text,
    flex: 1,
  },
  diagnosticRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  diagnosticCopy: {
    flex: 1,
    gap: 2,
  },
  diagnosticTitle: {
    ...typography.label,
    color: colors.text,
  },
  diagnosticDescription: {
    ...typography.caption,
    color: colors.textMuted,
  },
  unknownCount: {
    ...typography.caption,
    color: "#9A6500",
  },
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
  loader: {
    marginVertical: spacing.xxl,
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
  pressed: {
    opacity: 0.62,
  },
});
