import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";

import { AppIcon } from "@/components/AppIcon";
import {
  expenseTracking,
  type ExpenseDiagnosticSample,
  type ExpenseSource,
  type InstalledExpenseApp,
} from "@/lib/expense-tracking";
import { colors, radius, spacing, typography } from "@/theme";

import {
  ExpenseEmptyState,
  expenseSharedStyles,
  formatTransactionTime,
  type ExpenseHealth,
} from "./expense-shared";

export function ExpenseSourcesTab({
  apps,
  clearingSamples,
  health,
  isLoading,
  onClearSamples,
  onSearch,
  onSetSource,
  samples,
  search,
  sourceByPackage,
  updatePending,
}: {
  apps: InstalledExpenseApp[];
  clearingSamples: boolean;
  health: ExpenseHealth | undefined;
  isLoading: boolean;
  onClearSamples: () => void;
  onSearch: (value: string) => void;
  onSetSource: (
    app: InstalledExpenseApp,
    enabled: boolean,
    diagnostics: boolean,
  ) => void;
  samples: ExpenseDiagnosticSample[];
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
    <View style={expenseSharedStyles.sectionStack}>
      <View style={styles.disclosureCard}>
        <AppIcon name="shield-checkmark-outline" color={colors.accent} size={21} />
        <Text style={styles.disclosureText}>
          只选择你需要记录交易的应用。识别到的交易只会进入“待核对”，经你确认才记账；诊断采样必须单独开启，样本加密并在 7 天内删除。
        </Text>
      </View>

      {samples.length ? (
        <DiagnosticSamplesCard
          clearing={clearingSamples}
          onClear={onClearSamples}
          samples={samples}
        />
      ) : null}

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
        <ActivityIndicator color={colors.accent} style={expenseSharedStyles.loader} />
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
                          ? expenseSharedStyles.healthDotReady
                          : expenseSharedStyles.healthDotWarning,
                      ]}
                    />
                    <Text style={styles.sourceStatusText}>
                      {source?.validationState === "validated"
                        ? "模板已验证，可按置信度规则记录"
                        : "通用识别中：交易通知会进入待核对，确认后才记账"}
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
                      {!diagnostics
                        ? "，但未开启诊断采样，无法查看具体内容。开启上面的开关后，下一次触发才会留存样本。"
                        : "。如果上面没有出现「诊断样本」卡片，说明开启诊断采样之后还没有新的交易触发——过去已计数的事件不会补录样本。"}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })
      ) : (
        <ExpenseEmptyState
          body="没有找到符合搜索条件的已安装应用。"
          icon="apps-outline"
          title="无结果"
        />
      )}
    </View>
  );
}

// Surfaces what diagnostic sampling actually captured. Without this there was
// no way to ever see a sample once saved -- the native module has always
// been able to decrypt and return them, but nothing on the JS side called it,
// so a real parser for any app could never be written or validated.
function DiagnosticSamplesCard({
  clearing,
  onClear,
  samples,
}: {
  clearing: boolean;
  onClear: () => void;
  samples: ExpenseDiagnosticSample[];
}) {
  const [copiedId, setCopiedId] = useState("");

  async function copySample(sample: ExpenseDiagnosticSample) {
    await Clipboard.setStringAsync(sample.excerpt);
    setCopiedId(sample.id);
    setTimeout(() => setCopiedId(""), 1500);
  }

  function confirmClear() {
    Alert.alert(
      "清除全部诊断样本？",
      "已保存的加密样本会被立即删除，此操作无法撤销。",
      [
        { text: "取消", style: "cancel" },
        { text: "清除", style: "destructive", onPress: onClear },
      ],
      { cancelable: true },
    );
  }

  return (
    <View style={styles.diagnosticSamplesCard}>
      <View style={styles.diagnosticSamplesHeader}>
        <Text style={styles.diagnosticSamplesTitle}>
          诊断样本 · {samples.length}
        </Text>
        <Pressable disabled={clearing} onPress={confirmClear}>
          <Text style={styles.diagnosticSamplesClear}>
            {clearing ? "清除中…" : "清除全部"}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.diagnosticSamplesHint}>
        还没有可用的自动解析模板，这些是本机捕获到的原始片段。复制后发给开发者可用于开发对应的解析模板。
      </Text>
      {samples.map((sample) => (
        <View key={sample.id} style={styles.diagnosticSample}>
          <View style={styles.diagnosticSampleMeta}>
            <Text numberOfLines={1} style={styles.diagnosticSamplePackage}>
              {sample.sourcePackage} · {sample.sourceKind === "notification" ? "通知" : "页面识别"}
            </Text>
            <Text style={styles.diagnosticSampleTime}>
              {formatTransactionTime(sample.capturedAt)}
            </Text>
          </View>
          <Text style={styles.diagnosticSampleExcerpt}>{sample.excerpt}</Text>
          <Pressable
            onPress={() => void copySample(sample)}
            style={({ pressed }) => [
              styles.diagnosticSampleCopy,
              pressed && expenseSharedStyles.pressed,
            ]}>
            <AppIcon
              name={copiedId === sample.id ? "checkmark" : "copy-outline"}
              color={colors.accent}
              size={16}
            />
            <Text style={styles.diagnosticSampleCopyText}>
              {copiedId === sample.id ? "已复制" : "复制文本"}
            </Text>
          </Pressable>
        </View>
      ))}
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
        pressed && expenseSharedStyles.pressed,
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

const styles = StyleSheet.create({
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
  diagnosticSamplesCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  diagnosticSamplesHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  diagnosticSamplesTitle: {
    ...typography.label,
    color: colors.text,
    fontWeight: "700",
  },
  diagnosticSamplesClear: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: "600",
  },
  diagnosticSamplesHint: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
  },
  diagnosticSample: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  diagnosticSampleMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  diagnosticSamplePackage: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
  },
  diagnosticSampleTime: {
    ...typography.caption,
    color: colors.textMuted,
  },
  diagnosticSampleExcerpt: {
    ...typography.body,
    color: colors.text,
  },
  diagnosticSampleCopy: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  diagnosticSampleCopyText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: "600",
  },
});
