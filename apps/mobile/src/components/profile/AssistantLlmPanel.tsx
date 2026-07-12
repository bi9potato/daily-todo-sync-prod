import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppIcon } from "@/components/AppIcon";
import {
  clearAssistantApiKey,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  getAssistantLlmSettings,
  saveAssistantLlmSettings,
} from "@/lib/assistant-settings";
import { colors, radius, spacing, typography } from "@/theme";

// Settings for the voice assistant's optional LLM parser. Simple commands
// ("添加任务买牛奶") work without any of this; the key only unlocks
// free-form phrasing. Any OpenAI-compatible provider works.
export function AssistantLlmPanel() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_LLM_BASE_URL);
  const [model, setModel] = useState(DEFAULT_LLM_MODEL);
  const [apiKey, setApiKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAssistantLlmSettings().then((settings) => {
      if (!cancelled) {
        setBaseUrl(settings.baseUrl);
        setModel(settings.model);
        setHasStoredKey(settings.hasApiKey);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      await saveAssistantLlmSettings({ baseUrl, model, apiKey });
      if (apiKey.trim()) {
        setHasStoredKey(true);
        setApiKey("");
      }
      Alert.alert("已保存", "语音助手将使用该服务解析更自然的说法。");
    } catch (error) {
      Alert.alert(
        "保存失败",
        error instanceof Error ? error.message : "请稍后重试。",
      );
    } finally {
      setSaving(false);
    }
  }

  function removeKey() {
    Alert.alert("清除 API Key？", "清除后语音操作只支持固定句式。", [
      { text: "取消", style: "cancel" },
      {
        text: "清除",
        style: "destructive",
        onPress: () => {
          void clearAssistantApiKey().then(() => setHasStoredKey(false));
        },
      },
    ]);
  }

  if (loading) {
    return <ActivityIndicator color={colors.accent} style={styles.loader} />;
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>
        「添加任务…、完成…、删除…」等固定说法无需配置。填入任意 OpenAI
        兼容服务（默认 DeepSeek）的 API Key 后，可用自然说法，例如
        “下午三点提醒我开会”。Key 只保存在本机加密存储。
      </Text>
      <Text style={styles.fieldLabel}>服务地址</Text>
      <TextInput
        accessibilityLabel="LLM 服务地址"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setBaseUrl}
        placeholder={DEFAULT_LLM_BASE_URL}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={baseUrl}
      />
      <Text style={styles.fieldLabel}>模型</Text>
      <TextInput
        accessibilityLabel="LLM 模型"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setModel}
        placeholder={DEFAULT_LLM_MODEL}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={model}
      />
      <Text style={styles.fieldLabel}>
        API Key{hasStoredKey ? " · 已配置" : ""}
      </Text>
      <TextInput
        accessibilityLabel="LLM API Key"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setApiKey}
        placeholder={hasStoredKey ? "已保存（输入新值可替换）" : "sk-…"}
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        style={styles.input}
        value={apiKey}
      />
      <View style={styles.actions}>
        {hasStoredKey ? (
          <Pressable
            accessibilityLabel="清除 API Key"
            onPress={removeKey}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}>
            <Text style={styles.clearButtonText}>清除 Key</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel="保存语音助手设置"
          disabled={saving}
          onPress={() => void save()}
          style={({ pressed }) => [
            styles.saveButton,
            saving && styles.disabled,
            pressed && styles.pressed,
          ]}>
          {saving ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <>
              <AppIcon name="checkmark" color={colors.white} size={17} />
              <Text style={styles.saveButtonText}>保存</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.sm,
  },
  loader: {
    marginVertical: spacing.md,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
  },
  fieldLabel: {
    ...typography.label,
    color: colors.text,
    marginTop: spacing.xs,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
    marginTop: spacing.xs,
  },
  clearButton: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  clearButtonText: {
    ...typography.label,
    color: colors.danger,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.lg,
  },
  saveButtonText: {
    ...typography.label,
    color: colors.white,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.72,
  },
});
