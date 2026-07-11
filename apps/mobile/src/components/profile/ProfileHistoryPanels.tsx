import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { colors, radius, spacing, typography } from "@/theme";
import type { DeletedTodoOccurrence, TodoOccurrence } from "@/types";

export function TrashPanel({ isBusy, items, onClear, onRestore }: {
  isBusy: boolean;
  items: DeletedTodoOccurrence[];
  onClear: () => void;
  onRestore: (id: string) => void;
}) {
  return <View style={styles.panel}>
    {items.length ? items.map((item) => <View key={item.id} style={styles.row}>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title}>{item.text}</Text>
        <Text style={styles.meta}>{item.taskDate}</Text>
      </View>
      <Pressable disabled={isBusy} onPress={() => onRestore(item.id)} style={styles.restore}>
        <Text style={styles.restoreText}>恢复</Text>
      </Pressable>
    </View>) : <Text style={styles.empty}>回收站为空。</Text>}
    {items.length ? <Pressable disabled={isBusy} onPress={onClear} style={styles.clear}>
      <AppIcon name="trash-outline" color={colors.danger} size={18} />
      <Text style={styles.clearText}>清空回收站</Text>
    </Pressable> : null}
  </View>;
}

export function ArchivedLongTermPanel({ isBusy, items, onUnarchive }: {
  isBusy: boolean;
  items: TodoOccurrence[];
  onUnarchive: (id: string) => void;
}) {
  const [viewing, setViewing] = useState<TodoOccurrence | null>(null);
  return <View style={styles.panel}>
    {items.length ? items.map((item) => <View key={item.id} style={styles.row}>
      <Pressable accessibilityHint="查看归档任务详情" accessibilityRole="button"
        onPress={() => setViewing(item)} style={({ pressed }) => [styles.copy, pressed && styles.pressed]}>
        <Text numberOfLines={1} style={styles.title}>{item.text}</Text>
        <Text style={styles.meta}>{item.archivedAt ? `归档于 ${item.archivedAt.slice(0, 10)}` : item.taskDate}</Text>
      </Pressable>
      <Pressable disabled={isBusy} onPress={() => onUnarchive(item.id)} style={styles.restore}>
        <Text style={styles.restoreText}>取消归档</Text>
      </Pressable>
    </View>) : <Text style={styles.empty}>暂无已归档的长期任务。</Text>}
    <ArchivedTaskViewer isBusy={isBusy} onClose={() => setViewing(null)}
      onUnarchive={(id) => { setViewing(null); onUnarchive(id); }} task={viewing} />
  </View>;
}

function ArchivedTaskViewer({ isBusy, onClose, onUnarchive, task }: {
  isBusy: boolean;
  onClose: () => void;
  onUnarchive: (id: string) => void;
  task: TodoOccurrence | null;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  return <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={Boolean(task)}>
    {task ? <View style={styles.viewerPage}>
      <View style={styles.viewerHeader}>
        <Pressable accessibilityLabel="关闭" hitSlop={8} onPress={onClose} style={styles.viewerClose}>
          <AppIcon name="close" color={colors.text} size={22} />
        </Pressable>
        <Text numberOfLines={1} style={styles.viewerTitle}>归档任务</Text>
        <Pressable disabled={isBusy} onPress={() => onUnarchive(task.id)} style={[styles.restore, isBusy && styles.pressed]}>
          <Text style={styles.restoreText}>取消归档</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.viewerBody}>
        <Text style={styles.taskText}>{task.text}</Text>
        <Text style={styles.meta}>{task.archivedAt ? `归档于 ${task.archivedAt.slice(0, 10)}` : task.taskDate}</Text>
        {task.note.trim() ? <Text style={styles.note}>{task.note}</Text> : null}
        {task.attachments.length ? <View style={styles.images}>{task.attachments.map((attachment) =>
          <Pressable key={attachment.id} onPress={() => setPreview(attachment.contentUrl)} style={styles.thumb}>
            <AuthenticatedImage contentUrl={attachment.contentUrl} style={styles.thumbImage} />
          </Pressable>)}</View> : null}
      </ScrollView>
      <Modal animationType="fade" onRequestClose={() => setPreview(null)} transparent visible={Boolean(preview)}>
        <Pressable onPress={() => setPreview(null)} style={styles.previewBackdrop}>
          {preview ? <AuthenticatedImage contentUrl={preview} resizeMode="contain" style={styles.previewImage} /> : null}
        </Pressable>
      </Modal>
    </View> : null}
  </Modal>;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm, padding: spacing.sm },
  row: { alignItems: "center", backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, flexDirection: "row", gap: spacing.sm, minHeight: 54, padding: spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  title: { ...typography.label, color: colors.text },
  meta: { ...typography.caption, color: colors.textMuted },
  restore: { alignItems: "center", justifyContent: "center", minHeight: 40, paddingHorizontal: spacing.sm },
  restoreText: { ...typography.label, color: colors.accent },
  empty: { ...typography.body, color: colors.textMuted, padding: spacing.sm },
  clear: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: spacing.xs, minHeight: 42 },
  clearText: { ...typography.label, color: colors.danger },
  viewerPage: { backgroundColor: colors.background, flex: 1 },
  viewerHeader: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  viewerClose: { alignItems: "center", height: 40, justifyContent: "center", width: 40 },
  viewerTitle: { ...typography.section, color: colors.text, flex: 1 },
  viewerBody: { gap: spacing.sm, padding: spacing.lg },
  taskText: { ...typography.title, color: colors.text },
  note: { ...typography.body, color: colors.text, lineHeight: 22, marginTop: spacing.sm },
  images: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  thumb: { borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, height: 96, overflow: "hidden", width: 96 },
  thumbImage: { height: "100%", width: "100%" },
  previewBackdrop: { alignItems: "center", backgroundColor: "rgba(11, 14, 12, 0.92)", flex: 1, justifyContent: "center" },
  previewImage: { height: "86%", width: "94%" },
  pressed: { opacity: 0.62 },
});
