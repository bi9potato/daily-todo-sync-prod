import { useEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  Alert,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import { closeUnlessTypingGuard } from "@/lib/keyboard";
import {
  deletePasswordEntry,
  isPasswordVaultAvailable,
  listPasswordEntries,
  savePasswordEntry,
  type PasswordEntry,
} from "@/lib/password-vault";
import { colors, radius, shadows, spacing, typography } from "@/theme";

const MASKED_VALUE = "••••••••";

// Editor rows need a stable key before a field ever gets a persisted id.
let editorFieldKey = 0;
function nextEditorFieldKey() {
  editorFieldKey += 1;
  return `editor-field-${editorFieldKey}`;
}

type EditorField = {
  key: string;
  id?: string;
  label: string;
  value: string;
};

function editorFieldsFor(entry: PasswordEntry | null): EditorField[] {
  if (entry && entry.fields.length) {
    return entry.fields.map((field) => ({
      key: field.id,
      id: field.id,
      label: field.label,
      value: field.value,
    }));
  }
  // A fresh entry starts from the common shape (GitHub-style); labels are
  // free text, so trade-password-only apps just rename or remove rows.
  return [
    { key: nextEditorFieldKey(), label: "账号", value: "" },
    { key: nextEditorFieldKey(), label: "密码", value: "" },
  ];
}

export function PasswordsScreen() {
  const available = isPasswordVaultAvailable();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // null = closed; { entry: null } = creating a new one.
  const [editor, setEditor] = useState<{ entry: PasswordEntry | null } | null>(
    null,
  );

  const entriesQuery = useQuery({
    queryKey: ["password-vault"],
    queryFn: listPasswordEntries,
    enabled: available,
    // Reads the device's secure store, not the network.
    networkMode: "always",
    staleTime: Infinity,
    // Never allowed into the plaintext persisted cache - see the
    // shouldDehydrateQuery wiring in app/_layout.tsx.
    meta: { sensitive: true },
  });
  const entries = available ? entriesQuery.data : [];

  function reload() {
    void queryClient.invalidateQueries({ queryKey: ["password-vault"] });
  }

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>密码管理</Text>
          <Text style={styles.subtitle}>仅保存在本机 · 系统加密存储</Text>
        </View>
        {available ? (
          <Pressable
            accessibilityLabel="添加密码"
            accessibilityRole="button"
            onPress={() => setEditor({ entry: null })}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <AppIcon name="add" color={colors.white} size={24} />
          </Pressable>
        ) : null}
      </View>

      {!available ? (
        <View style={styles.empty}>
          <AppIcon name="key-outline" color={colors.accent} size={34} />
          <Text style={styles.emptyTitle}>仅移动客户端可用</Text>
          <Text style={styles.emptyCopy}>
            密码保存在手机的系统加密存储中，请在 Android 客户端使用。
          </Text>
        </View>
      ) : entriesQuery.isPending ? (
        <LoadingState label="正在读取…" />
      ) : entriesQuery.isError ? (
        <ErrorState
          message={entriesQuery.error.message || "密码读取失败"}
          onRetry={() => entriesQuery.refetch()}
        />
      ) : (entries ?? []).length === 0 ? (
        <View style={styles.empty}>
          <AppIcon name="key-outline" color={colors.accent} size={34} />
          <Text style={styles.emptyTitle}>还没有保存密码</Text>
          <Text style={styles.emptyCopy}>
            为每个应用记录账号、登录密码、交易密码等任意条目。
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {(entries ?? []).map((entry) => (
            <EntryCard
              entry={entry}
              expanded={expandedId === entry.id}
              key={entry.id}
              onEdit={() => setEditor({ entry })}
              onToggle={() =>
                setExpandedId((current) =>
                  current === entry.id ? null : entry.id,
                )
              }
            />
          ))}
          <Text style={styles.footnote}>
            密码不会同步到云端；卸载应用会一并清除。
          </Text>
        </ScrollView>
      )}

      {editor ? (
        <PasswordEditor
          entry={editor.entry}
          key={editor.entry?.id ?? "new-entry"}
          onClose={() => setEditor(null)}
          onChanged={() => {
            reload();
            setEditor(null);
          }}
        />
      ) : null}
    </View>
  );
}

function EntryCard({
  entry,
  expanded,
  onEdit,
  onToggle,
}: {
  entry: PasswordEntry;
  expanded: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.cardHeader, pressed && styles.pressed]}>
        <View style={styles.cardIcon}>
          <AppIcon name="key-outline" color={colors.accent} size={20} />
        </View>
        <View style={styles.cardCopy}>
          <Text numberOfLines={1} style={styles.cardName}>
            {entry.name}
          </Text>
          <Text style={styles.cardMeta}>
            {entry.fields.length} 项
            {entry.note ? ` · ${entry.note}` : ""}
          </Text>
        </View>
        <AppIcon
          name={expanded ? "chevron-down" : "chevron-forward"}
          color={colors.textMuted}
          size={18}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.cardBody}>
          {entry.fields.map((field) => (
            <FieldRow field={field} key={field.id} />
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={onEdit}
            style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
            <AppIcon name="create-outline" color={colors.accent} size={18} />
            <Text style={styles.editButtonText}>编辑</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FieldRow({ field }: { field: PasswordEntry["fields"][number] }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
    },
    [],
  );

  async function copy() {
    try {
      await Clipboard.setStringAsync(field.value);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCopied(true);
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      Alert.alert("复制失败", "无法写入剪贴板。");
    }
  }

  return (
    <View style={styles.fieldRow}>
      <View style={styles.fieldCopy}>
        <Text style={styles.fieldLabel}>{field.label || "未命名"}</Text>
        <Text numberOfLines={1} selectable={revealed} style={styles.fieldValue}>
          {field.value ? (revealed ? field.value : MASKED_VALUE) : "—"}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={revealed ? "隐藏内容" : "明文查看"}
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => setRevealed((current) => !current)}
        style={({ pressed }) => [styles.fieldAction, pressed && styles.pressed]}>
        <AppIcon
          name={revealed ? "eye-off-outline" : "eye-outline"}
          color={colors.textMuted}
          size={19}
        />
      </Pressable>
      <Pressable
        accessibilityLabel={`复制${field.label}`}
        accessibilityRole="button"
        disabled={!field.value}
        hitSlop={6}
        onPress={copy}
        style={({ pressed }) => [
          styles.fieldAction,
          !field.value && styles.fieldActionDisabled,
          pressed && styles.pressed,
        ]}>
        <AppIcon
          name={copied ? "checkmark" : "copy-outline"}
          color={copied ? colors.accent : colors.textMuted}
          size={19}
        />
      </Pressable>
    </View>
  );
}

function PasswordEditor({
  entry,
  onChanged,
  onClose,
}: {
  entry: PasswordEntry | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(entry?.name ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [fields, setFields] = useState<EditorField[]>(() =>
    editorFieldsFor(entry),
  );
  const [isSaving, setIsSaving] = useState(false);

  const canSave =
    Boolean(name.trim()) &&
    fields.some((field) => field.label.trim() || field.value.trim());

  function updateField(key: string, patch: Partial<EditorField>) {
    setFields((current) =>
      current.map((field) =>
        field.key === key ? { ...field, ...patch } : field,
      ),
    );
  }

  async function save() {
    if (!canSave || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await savePasswordEntry({
        id: entry?.id,
        createdAt: entry?.createdAt,
        name,
        note,
        fields: fields.map(({ id, label, value }) => ({ id, label, value })),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onChanged();
    } catch (error) {
      Alert.alert(
        "保存失败",
        error instanceof Error ? error.message : "无法写入系统加密存储。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function confirmDelete() {
    if (!entry) {
      return;
    }
    Alert.alert("删除密码？", `“${entry.name}”将从本机移除，无法恢复。`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void deletePasswordEntry(entry.id)
            .then(onChanged)
            .catch((error) =>
              Alert.alert(
                "删除失败",
                error instanceof Error ? error.message : "请稍后重试。",
              ),
            );
        },
      },
    ]);
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={closeUnlessTypingGuard(onClose)}
      presentationStyle="pageSheet"
      visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.editorPage, { paddingBottom: insets.bottom }]}>
        <View style={[styles.editorHeader, { paddingTop: insets.top }]}>
          <Pressable
            accessibilityLabel="关闭"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={styles.iconButton}>
            <AppIcon name="close" color={colors.text} />
          </Pressable>
          <Text style={styles.editorTitle}>
            {entry ? "编辑密码" : "新建密码"}
          </Text>
          <Pressable
            accessibilityLabel="保存"
            accessibilityRole="button"
            disabled={!canSave || isSaving}
            onPress={save}
            style={({ pressed }) => [
              styles.saveButton,
              (!canSave || isSaving) && styles.saveButtonDisabled,
              pressed && styles.pressed,
            ]}>
            {isSaving ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <AppIcon name="checkmark" color={colors.white} size={24} />
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.editorContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <TextInput
            accessibilityLabel="应用名称"
            onChangeText={setName}
            placeholder="应用名称，如 GitHub、博时基金"
            placeholderTextColor={colors.textMuted}
            style={styles.nameInput}
            value={name}
          />

          <View style={styles.fieldsSurface}>
            {fields.map((field, index) => (
              <View
                key={field.key}
                style={[styles.editorFieldRow, index === 0 && styles.editorFieldRowFirst]}>
                <View style={styles.editorFieldInputs}>
                  <TextInput
                    accessibilityLabel="字段名称"
                    onChangeText={(label) => updateField(field.key, { label })}
                    placeholder="名称，如 登录密码 / 交易密码"
                    placeholderTextColor={colors.textMuted}
                    style={styles.editorFieldLabel}
                    value={field.label}
                  />
                  <TextInput
                    accessibilityLabel={`${field.label || "字段"}的内容`}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(value) => updateField(field.key, { value })}
                    placeholder="内容"
                    placeholderTextColor={colors.textMuted}
                    style={styles.editorFieldValue}
                    value={field.value}
                  />
                </View>
                <Pressable
                  accessibilityLabel={`移除${field.label || "字段"}`}
                  accessibilityRole="button"
                  disabled={fields.length <= 1}
                  hitSlop={6}
                  onPress={() =>
                    setFields((current) =>
                      current.filter((item) => item.key !== field.key),
                    )
                  }
                  style={({ pressed }) => [
                    styles.removeFieldButton,
                    fields.length <= 1 && styles.fieldActionDisabled,
                    pressed && styles.pressed,
                  ]}>
                  <AppIcon
                    name="remove-circle-outline"
                    color={colors.textMuted}
                    size={20}
                  />
                </Pressable>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setFields((current) => [
                  ...current,
                  { key: nextEditorFieldKey(), label: "", value: "" },
                ])
              }
              style={({ pressed }) => [styles.addFieldButton, pressed && styles.pressed]}>
              <AppIcon name="add" color={colors.accent} size={19} />
              <Text style={styles.addFieldText}>添加一项</Text>
            </Pressable>
          </View>

          <TextInput
            accessibilityLabel="备注"
            multiline
            onChangeText={setNote}
            placeholder="备注（可选）"
            placeholderTextColor={colors.textMuted}
            style={styles.noteInput}
            textAlignVertical="top"
            value={note}
          />

          {entry ? (
            <Pressable
              accessibilityRole="button"
              onPress={confirmDelete}
              style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
              <AppIcon name="trash-outline" color={colors.danger} size={20} />
              <Text style={styles.deleteText}>删除密码</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    ...shadows.panel,
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
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
  addButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  pressed: {
    opacity: 0.64,
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
    padding: spacing.xl,
  },
  emptyTitle: {
    ...typography.section,
    color: colors.text,
    marginTop: spacing.md,
  },
  emptyCopy: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
  },
  card: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 62,
    paddingHorizontal: spacing.md,
  },
  cardIcon: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  cardCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  cardName: {
    ...typography.section,
    color: colors.text,
  },
  cardMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  cardBody: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  fieldRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 54,
    paddingVertical: spacing.xs,
  },
  fieldCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  fieldValue: {
    ...typography.body,
    color: colors.text,
  },
  fieldAction: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 36,
  },
  fieldActionDisabled: {
    opacity: 0.35,
  },
  editButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingTop: spacing.xs,
  },
  editButtonText: {
    ...typography.label,
    color: colors.accent,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    paddingTop: spacing.sm,
    textAlign: "center",
  },
  editorPage: {
    backgroundColor: colors.surface,
    flex: 1,
  },
  editorHeader: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  iconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  editorTitle: {
    ...typography.section,
    color: colors.text,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  saveButtonDisabled: {
    opacity: 0.42,
  },
  editorContent: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  nameInput: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 30,
    padding: 0,
  },
  fieldsSurface: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
  },
  editorFieldRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  editorFieldRowFirst: {
    borderTopWidth: 0,
  },
  editorFieldInputs: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  editorFieldLabel: {
    ...typography.label,
    color: colors.textMuted,
    padding: 0,
  },
  editorFieldValue: {
    color: colors.text,
    fontSize: 16,
    padding: 0,
  },
  removeFieldButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 36,
  },
  addFieldButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 46,
  },
  addFieldText: {
    ...typography.label,
    color: colors.accent,
  },
  noteInput: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 60,
    padding: 0,
  },
  deleteButton: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
  },
  deleteText: {
    ...typography.label,
    color: colors.danger,
  },
});
