import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

import { AppIcon } from "./AppIcon";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { colors, radius, spacing, typography } from "@/theme";
import type {
  LocalAttachmentFile,
  TaskAttachment,
  TodoOccurrence,
} from "@/types";

type AttachmentGalleryProps = {
  isMutating: boolean;
  onDelete: (attachment: TaskAttachment) => void;
  onReorder: (orderedIds: string[]) => void;
  onUpload: (file: LocalAttachmentFile) => void;
  task: TodoOccurrence;
};

export function AttachmentGallery({
  isMutating,
  onDelete,
  onReorder,
  onUpload,
  task,
}: AttachmentGalleryProps) {
  const [preview, setPreview] = useState<TaskAttachment | null>(null);

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: false,
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled) {
      return;
    }
    const asset = result.assets[0];
    onUpload({
      uri: asset.uri,
      name: asset.fileName || `task-image-${Date.now()}.jpg`,
      type: asset.mimeType || "image/jpeg",
    });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= task.attachments.length) {
      return;
    }
    const next = [...task.attachments];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onReorder(next.map((attachment) => attachment.id));
  }

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>图片</Text>
          <Text style={styles.meta}>{task.attachments.length} 张附件</Text>
        </View>
        <Pressable
          accessibilityLabel="添加图片"
          disabled={isMutating}
          onPress={pickImage}
          style={({ pressed }) => [
            styles.addButton,
            pressed && styles.pressed,
          ]}>
          {isMutating ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <AppIcon name="image-outline" color={colors.accent} size={20} />
          )}
          <Text style={styles.addText}>添加图片</Text>
        </Pressable>
      </View>

      {task.attachments.length ? (
        <View style={styles.grid}>
          {task.attachments.map((attachment, index) => (
            <View key={attachment.id} style={styles.tile}>
              <Pressable onPress={() => setPreview(attachment)}>
                <AuthenticatedImage
                  contentUrl={attachment.contentUrl}
                  style={styles.thumbnail}
                />
              </Pressable>
              <Text numberOfLines={1} style={styles.filename}>
                {attachment.originalFilename}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  accessibilityLabel="图片前移"
                  disabled={index === 0 || isMutating}
                  onPress={() => move(index, -1)}
                  style={styles.iconButton}>
                  <AppIcon
                    name="chevron-back"
                    color={index === 0 ? colors.borderStrong : colors.textMuted}
                    size={17}
                  />
                </Pressable>
                <Pressable
                  accessibilityLabel="图片后移"
                  disabled={index === task.attachments.length - 1 || isMutating}
                  onPress={() => move(index, 1)}
                  style={styles.iconButton}>
                  <AppIcon
                    name="chevron-forward"
                    color={
                      index === task.attachments.length - 1
                        ? colors.borderStrong
                        : colors.textMuted
                    }
                    size={17}
                  />
                </Pressable>
                <Pressable
                  accessibilityLabel="删除图片"
                  disabled={isMutating}
                  onPress={() => onDelete(attachment)}
                  style={styles.iconButton}>
                  <AppIcon name="trash-outline" color={colors.danger} size={17} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>尚未添加图片。</Text>
      )}

      <Modal
        animationType="fade"
        onRequestClose={() => setPreview(null)}
        transparent
        visible={Boolean(preview)}>
        <View style={styles.previewBackdrop}>
          <Pressable
            accessibilityLabel="关闭图片预览"
            onPress={() => setPreview(null)}
            style={styles.previewClose}>
            <AppIcon name="close" color={colors.white} size={26} />
          </Pressable>
          {preview ? (
            <AuthenticatedImage
              contentUrl={preview.contentUrl}
              resizeMode="contain"
              style={styles.previewImage}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    ...typography.label,
    color: colors.textMuted,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  addButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  addText: {
    ...typography.label,
    color: colors.accent,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    overflow: "hidden",
    width: "48%",
  },
  thumbnail: {
    height: 116,
    width: "100%",
  },
  filename: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: spacing.xs,
  },
  iconButton: {
    alignItems: "center",
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
  },
  previewBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.92)",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  previewClose: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    position: "absolute",
    right: spacing.lg,
    top: spacing.xxl,
    width: 48,
    zIndex: 2,
  },
  previewImage: {
    borderRadius: radius.md,
    height: "72%",
    width: "100%",
  },
  pressed: {
    opacity: 0.62,
  },
});
