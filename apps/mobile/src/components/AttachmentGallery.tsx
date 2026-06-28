import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import { AppIcon } from "./AppIcon";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { colors, radius, spacing, typography } from "@/theme";
import type {
  LocalAttachmentFile,
  TaskAttachment,
  TodoOccurrence,
} from "@/types";

const contentTypeByExtension: Record<string, string> = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  json: "application/json",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

function resolveContentType(filename: string, reportedType?: string | null) {
  if (reportedType && reportedType !== "application/octet-stream") {
    return reportedType;
  }
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return contentTypeByExtension[extension] ?? "application/octet-stream";
}

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
      quality: 0.72,
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

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "*/*",
    });
    if (result.canceled) {
      return;
    }
    const asset = result.assets[0];
    onUpload({
      uri: asset.uri,
      name: asset.name || `task-file-${Date.now()}`,
      type: resolveContentType(asset.name, asset.mimeType),
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
      {task.attachments.length ? (
        <View style={styles.attachmentList}>
          {task.attachments.map((attachment, index) => (
            <View key={attachment.id} style={styles.attachmentRow}>
              {attachment.contentType.startsWith("image/") ? (
                <Pressable
                  accessibilityLabel={`预览 ${attachment.originalFilename}`}
                  onPress={() => setPreview(attachment)}>
                <AuthenticatedImage
                  contentUrl={attachment.contentUrl}
                  style={styles.thumbnail}
                />
                </Pressable>
              ) : (
                <View style={styles.fileIcon}>
                  <AppIcon name="document-outline" color={colors.accent} size={22} />
                </View>
              )}
              <View style={styles.fileCopy}>
                <Text numberOfLines={1} style={styles.filename}>
                  {attachment.originalFilename}
                </Text>
                <Text style={styles.fileMeta}>
                  {Math.max(1, Math.ceil(attachment.sizeBytes / 1024))} KB
                </Text>
              </View>
              <View style={styles.actions}>
                <Pressable
                  accessibilityLabel="附件前移"
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
                  accessibilityLabel="附件后移"
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
                  accessibilityLabel="删除附件"
                  disabled={isMutating}
                  onPress={() => onDelete(attachment)}
                  style={styles.iconButton}>
                  <AppIcon name="trash-outline" color={colors.danger} size={17} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.addActions}>
        {isMutating ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <>
            <Pressable
              accessibilityLabel="添加图片"
              disabled={isMutating}
              hitSlop={8}
              onPress={pickImage}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
              <AppIcon name="image-outline" color={colors.textMuted} size={21} />
            </Pressable>
            <Pressable
              accessibilityLabel="添加文件"
              disabled={isMutating}
              hitSlop={8}
              onPress={pickFile}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
              <AppIcon name="attach-outline" color={colors.textMuted} size={22} />
            </Pressable>
          </>
        )}
        {task.attachments.length ? (
          <Text style={styles.meta}>{task.attachments.length} 个附件</Text>
        ) : null}
      </View>

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
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingTop: spacing.xs,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
    marginLeft: spacing.xs,
  },
  addActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 36,
  },
  addButton: {
    alignItems: "center",
    borderRadius: radius.sm,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  attachmentList: {
    gap: spacing.sm,
  },
  attachmentRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
    padding: spacing.xs,
  },
  thumbnail: {
    borderRadius: 6,
    height: 42,
    width: 42,
  },
  fileIcon: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 6,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  fileCopy: {
    flex: 1,
    minWidth: 0,
  },
  filename: {
    ...typography.caption,
    color: colors.text,
    fontWeight: "600",
  },
  fileMeta: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  actions: {
    flexDirection: "row",
  },
  iconButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 30,
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
