import { useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { Composer } from "@/components/Composer";
import { DraggableTaskItem } from "@/components/DraggableTaskItem";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import { TaskEditor } from "@/components/TaskEditor";
import { TaskRow } from "@/components/TaskRow";
import {
  copyLongTermOccurrenceAsRegular,
  createTask,
  deleteTaskAttachment,
  deleteOccurrence,
  getDay,
  reorderDay,
  reorderTaskAttachments,
  updateOccurrence,
  uploadTaskAttachment,
} from "@/lib/api";
import { formatLongDate } from "@/lib/date";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type {
  DayTodos,
  LocalAttachmentFile,
  TaskAttachment,
  TaskUpdatePayload,
  TodoOccurrence,
} from "@/types";

type TodayScreenProps = {
  selectedDate: string;
  viewMode?: "my-day" | "long-term" | "low-priority";
};

type DragPreview = {
  orderedIds: string[];
  section: "long-term" | "regular" | "low-priority";
};

function compareOccurrences(left: TodoOccurrence, right: TodoOccurrence) {
  if (left.isPinned !== right.isPinned) {
    return left.isPinned ? -1 : 1;
  }
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function applyPreviewOrder(
  tasks: TodoOccurrence[],
  preview: DragPreview | null,
  section: DragPreview["section"],
) {
  if (preview?.section !== section) {
    return tasks;
  }
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const ordered = preview.orderedIds
    .map((id) => taskById.get(id))
    .filter((task): task is TodoOccurrence => Boolean(task));
  return ordered.length === tasks.length ? ordered : tasks;
}

function replaceTask(data: DayTodos | undefined, task: TodoOccurrence) {
  if (!data) {
    return data;
  }
  const tasks = [...data.pending, ...data.done].map((item) =>
    item.id === task.id ? task : item,
  );
  return {
    ...data,
    pending: tasks.filter((item) => item.status === "pending"),
    done: tasks.filter((item) => item.status === "done"),
  };
}

function updateTaskAttachments(
  data: DayTodos | undefined,
  occurrenceId: string,
  update: (attachments: TaskAttachment[]) => TaskAttachment[],
) {
  if (!data) {
    return data;
  }
  const task = [...data.pending, ...data.done].find(
    (item) => item.id === occurrenceId,
  );
  return task
    ? replaceTask(data, { ...task, attachments: update(task.attachments) })
    : data;
}

export function TodayScreen({
  selectedDate,
  viewMode = "my-day",
}: TodayScreenProps) {
  const queryClient = useQueryClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [longTermOpen, setLongTermOpen] = useState(false);
  const [lowPriorityOpen, setLowPriorityOpen] = useState(false);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);

  const dayQuery = useQuery({
    queryKey: ["day", selectedDate],
    queryFn: () => getDay(selectedDate),
  });

  const selectedTask = useMemo(
    () =>
      [...(dayQuery.data?.pending ?? []), ...(dayQuery.data?.done ?? [])].find(
        (task) => task.id === selectedTaskId,
      ) ?? null,
    [dayQuery.data, selectedTaskId],
  );

  const createMutation = useMutation({
    mutationFn: (text: string) =>
      createTask(selectedDate, {
        text,
        isLongTerm: viewMode === "long-term",
        isLowPriority: viewMode === "low-priority",
      }),
    onSuccess: (task) => {
      queryClient.setQueryData<DayTodos>(["day", selectedDate], (current) =>
        current ? { ...current, pending: [...current.pending, task] } : current,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: TaskUpdatePayload;
    }) => updateOccurrence(id, payload),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: ["day", selectedDate] });
      const previous = queryClient.getQueryData<DayTodos>(["day", selectedDate]);
      const original = [...(previous?.pending ?? []), ...(previous?.done ?? [])].find(
        (item) => item.id === id,
      );
      if (original) {
        const optimistic: TodoOccurrence = {
          ...original,
          ...(payload.text !== undefined ? { text: payload.text } : {}),
          ...(payload.note !== undefined ? { note: payload.note } : {}),
          ...(payload.done !== undefined
            ? { status: payload.done ? "done" : "pending" }
            : {}),
          ...(payload.pinned !== undefined ? { isPinned: payload.pinned } : {}),
          ...(payload.isLongTerm !== undefined
            ? { isLongTerm: payload.isLongTerm }
            : {}),
          ...(payload.isLowPriority !== undefined
            ? { isLowPriority: payload.isLowPriority }
            : {}),
          ...(payload.reminderTime !== undefined
            ? { reminderTime: payload.reminderTime }
            : {}),
          ...(payload.repeat !== undefined ? { repeat: payload.repeat } : {}),
        };
        queryClient.setQueryData<DayTodos>(["day", selectedDate], (current) =>
          replaceTask(current, optimistic),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["day", selectedDate], context.previous);
      }
    },
    onSuccess: (task) => {
      queryClient.setQueryData<DayTodos>(["day", selectedDate], (current) =>
        replaceTask(current, task),
      );
      setSelectedTaskId(null);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteOccurrence,
    onSuccess: (_result, id) => {
      queryClient.setQueryData<DayTodos>(["day", selectedDate], (current) =>
        current
          ? {
              ...current,
              pending: current.pending.filter((item) => item.id !== id),
              done: current.done.filter((item) => item.id !== id),
            }
          : current,
      );
      setSelectedTaskId(null);
      void queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });

  const copyMutation = useMutation({
    mutationFn: copyLongTermOccurrenceAsRegular,
    onSuccess: (task) => {
      queryClient.setQueryData<DayTodos>(["day", selectedDate], (current) =>
        current ? { ...current, pending: [...current.pending, task] } : current,
      );
      setSelectedTaskId(task.id);
      void queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });

  const uploadAttachmentMutation = useMutation({
    mutationFn: ({
      occurrenceId,
      file,
    }: {
      occurrenceId: string;
      file: LocalAttachmentFile;
    }) => uploadTaskAttachment(occurrenceId, file),
    onSuccess: (attachment, variables) => {
      queryClient.setQueryData<DayTodos>(["day", selectedDate], (current) =>
        updateTaskAttachments(current, variables.occurrenceId, (attachments) => [
          ...attachments,
          attachment,
        ]),
      );
    },
    onError: (error) => Alert.alert("图片上传失败", error.message),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: ({
      attachmentId,
      occurrenceId,
    }: {
      attachmentId: string;
      occurrenceId: string;
    }) => deleteTaskAttachment(attachmentId, occurrenceId),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData<DayTodos>(["day", selectedDate], (current) =>
        updateTaskAttachments(current, variables.occurrenceId, (attachments) =>
          attachments.filter(
            (attachment) => attachment.id !== variables.attachmentId,
          ),
        ),
      );
    },
    onError: (error) => Alert.alert("图片删除失败", error.message),
  });

  const reorderAttachmentsMutation = useMutation({
    mutationFn: ({
      occurrenceId,
      orderedIds,
    }: {
      occurrenceId: string;
      orderedIds: string[];
    }) => reorderTaskAttachments(occurrenceId, orderedIds),
    onMutate: ({ occurrenceId, orderedIds }) => {
      queryClient.setQueryData<DayTodos>(["day", selectedDate], (current) =>
        updateTaskAttachments(current, occurrenceId, (attachments) => {
          const byId = new Map(
            attachments.map((attachment) => [attachment.id, attachment]),
          );
          return orderedIds
            .map((id) => byId.get(id))
            .filter((item): item is TaskAttachment => Boolean(item));
        }),
      );
    },
    onError: (error) => {
      Alert.alert("图片排序失败", error.message);
      void queryClient.invalidateQueries({ queryKey: ["day", selectedDate] });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => reorderDay(selectedDate, orderedIds),
    onError: (error) => {
      Alert.alert("任务排序失败", error.message);
      void queryClient.invalidateQueries({ queryKey: ["day", selectedDate] });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });

  const baseGroups = useMemo(() => {
    const all = [
      ...(dayQuery.data?.pending ?? []),
      ...(dayQuery.data?.done ?? []),
    ].sort(compareOccurrences);
    return {
      regular: all.filter((task) => !task.isLongTerm && !task.isLowPriority),
      longTerm: all.filter((task) => task.isLongTerm),
      lowPriority: all.filter(
        (task) => !task.isLongTerm && task.isLowPriority,
      ),
    };
  }, [dayQuery.data]);
  const groups = useMemo(
    () => ({
      regular: applyPreviewOrder(baseGroups.regular, dragPreview, "regular"),
      longTerm: applyPreviewOrder(
        baseGroups.longTerm,
        dragPreview,
        "long-term",
      ),
      lowPriority: applyPreviewOrder(
        baseGroups.lowPriority,
        dragPreview,
        "low-priority",
      ),
    }),
    [baseGroups, dragPreview],
  );

  const total =
    viewMode === "long-term"
      ? groups.longTerm.length
      : viewMode === "low-priority"
        ? groups.lowPriority.length
        : groups.longTerm.length +
          groups.regular.length +
          groups.lowPriority.length;
  function toggle(task: TodoOccurrence) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateMutation.mutate({
      id: task.id,
      payload: { done: task.status !== "done" },
    });
  }

  function togglePin(task: TodoOccurrence) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateMutation.mutate({
      id: task.id,
      payload: { pinned: !task.isPinned },
    });
  }

  function confirmDelete(task: TodoOccurrence) {
    Alert.alert("删除任务？", `“${task.text}”会移入回收站。`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => deleteMutation.mutate(task.id),
      },
    ]);
  }

  function previewTaskOrder(
    section: DragPreview["section"],
    tasks: TodoOccurrence[],
    taskId: string,
    toIndex: number,
  ) {
    const fromIndex = tasks.findIndex((task) => task.id === taskId);
    if (fromIndex === -1 || fromIndex === toIndex) {
      return;
    }
    if (tasks[toIndex]?.isPinned !== tasks[fromIndex]?.isPinned) {
      return;
    }
    const reordered = [...tasks];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const next = { section, orderedIds: reordered.map((task) => task.id) };
    if (
      dragPreviewRef.current?.section === next.section &&
      dragPreviewRef.current.orderedIds.join("|") === next.orderedIds.join("|")
    ) {
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    dragPreviewRef.current = next;
    setDragPreview(next);
  }

  function finishTaskDrag() {
    const preview = dragPreviewRef.current;
    const current = dayQuery.data;
    if (!preview || !current) {
      return;
    }
    const orderById = new Map(
      preview.orderedIds.map((id, index) => [id, (index + 1) * 1000]),
    );
    const updateSortOrder = (task: TodoOccurrence) =>
      orderById.has(task.id)
        ? { ...task, sortOrder: orderById.get(task.id) ?? task.sortOrder }
        : task;
    queryClient.setQueryData<DayTodos>(["day", selectedDate], {
      ...current,
      pending: current.pending.map(updateSortOrder).sort(compareOccurrences),
      done: current.done.map(updateSortOrder).sort(compareOccurrences),
    });
    reorderMutation.mutate(preview.orderedIds);
    dragPreviewRef.current = null;
    setDragPreview(null);
  }

  const content = dayQuery.isPending ? (
    <LoadingState />
  ) : dayQuery.isError ? (
    <ErrorState
      message={dayQuery.error.message || "任务加载失败"}
      onRetry={() => dayQuery.refetch()}
    />
  ) : (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          colors={[colors.accent]}
          onRefresh={dayQuery.refetch}
          refreshing={dayQuery.isRefetching}
          tintColor={colors.accent}
        />
      }
      showsVerticalScrollIndicator={false}>
      {total === 0 ? (
        <View style={styles.empty}>
          <AppIcon name="sunny-outline" color={colors.accent} size={34} />
          <Text style={styles.emptyTitle}>今天还没有任务</Text>
          <Text style={styles.emptyCopy}>从下面添加一件最重要的事。</Text>
        </View>
      ) : null}

      {viewMode === "my-day" ? (
        <>
          <CollapsibleTaskGroup
            count={groups.longTerm.length}
            isOpen={longTermOpen}
            onDelete={confirmDelete}
            onDrop={finishTaskDrag}
            onPin={togglePin}
            onPress={(task) => setSelectedTaskId(task.id)}
            onPreviewMove={(id, to) =>
              previewTaskOrder("long-term", groups.longTerm, id, to)
            }
            onToggle={toggle}
            onToggleOpen={() => setLongTermOpen((current) => !current)}
            tasks={groups.longTerm}
            title="长期任务"
          />
          <TaskGroup
            onDelete={confirmDelete}
            onDrop={finishTaskDrag}
            onPin={togglePin}
            onPress={(task) => setSelectedTaskId(task.id)}
            onPreviewMove={(id, to) =>
              previewTaskOrder("regular", groups.regular, id, to)
            }
            onToggle={toggle}
            tasks={groups.regular}
            title=""
          />
          <CollapsibleTaskGroup
            count={groups.lowPriority.length}
            isOpen={lowPriorityOpen}
            onDelete={confirmDelete}
            onDrop={finishTaskDrag}
            onPin={togglePin}
            onPress={(task) => setSelectedTaskId(task.id)}
            onPreviewMove={(id, to) =>
              previewTaskOrder("low-priority", groups.lowPriority, id, to)
            }
            onToggle={toggle}
            onToggleOpen={() => setLowPriorityOpen((current) => !current)}
            tasks={groups.lowPriority}
            title="低优先级"
          />
        </>
      ) : (
        <TaskGroup
          onDelete={confirmDelete}
          onDrop={finishTaskDrag}
          onPin={togglePin}
          onPress={(task) => setSelectedTaskId(task.id)}
          onPreviewMove={(id, to) =>
            previewTaskOrder(
              viewMode === "long-term" ? "long-term" : "low-priority",
              viewMode === "long-term"
                ? groups.longTerm
                : groups.lowPriority,
              id,
              to,
            )
          }
          onToggle={toggle}
          tasks={
            viewMode === "long-term" ? groups.longTerm : groups.lowPriority
          }
          title=""
        />
      )}
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
      style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>
            {viewMode === "long-term"
              ? "长期任务"
              : viewMode === "low-priority"
                ? "低优先级任务"
                : "我的一天"}
          </Text>
          <Text style={styles.date}>{formatLongDate(selectedDate)}</Text>
        </View>
      </View>
      {content}
      <Composer
        isPending={createMutation.isPending}
        onSubmit={(text) => createMutation.mutateAsync(text).then(() => undefined)}
      />
      <TaskEditor
        key={selectedTask?.id ?? "empty-editor"}
        isAttachmentMutating={
          uploadAttachmentMutation.isPending ||
          deleteAttachmentMutation.isPending ||
          reorderAttachmentsMutation.isPending
        }
        isSaving={updateMutation.isPending}
        onClose={() => setSelectedTaskId(null)}
        onCopyAsRegular={(task) => copyMutation.mutate(task.id)}
        onDelete={confirmDelete}
        onDeleteAttachment={(attachment) => {
          if (selectedTask) {
            deleteAttachmentMutation.mutate({
              attachmentId: attachment.id,
              occurrenceId: selectedTask.id,
            });
          }
        }}
        onReorderAttachments={(orderedIds) => {
          if (selectedTask) {
            reorderAttachmentsMutation.mutate({
              occurrenceId: selectedTask.id,
              orderedIds,
            });
          }
        }}
        onSave={(task, payload) => updateMutation.mutate({ id: task.id, payload })}
        onUploadAttachment={(file) => {
          if (selectedTask) {
            uploadAttachmentMutation.mutate({
              occurrenceId: selectedTask.id,
              file,
            });
          }
        }}
        task={selectedTask}
      />
    </KeyboardAvoidingView>
  );
}

function TaskGroup({
  title,
  tasks,
  onDelete,
  onDrop,
  onPin,
  onPress,
  onPreviewMove,
  onToggle,
}: {
  title: string;
  tasks: TodoOccurrence[];
  onDelete: (task: TodoOccurrence) => void;
  onDrop: () => void;
  onPin: (task: TodoOccurrence) => void;
  onPress: (task: TodoOccurrence) => void;
  onPreviewMove: (id: string, toIndex: number) => void;
  onToggle: (task: TodoOccurrence) => void;
}) {
  if (!tasks.length) {
    return null;
  }
  return (
    <View style={styles.group}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      {tasks.map((task, index) => (
        <DraggableTaskItem
          id={task.id}
          index={index}
          key={task.id}
          onDrop={onDrop}
          onPreviewMove={onPreviewMove}
          total={tasks.length}>
          <TaskRow
            onDelete={onDelete}
            onPin={onPin}
            onPress={onPress}
            onToggle={onToggle}
            task={task}
          />
        </DraggableTaskItem>
      ))}
    </View>
  );
}

function CollapsibleTaskGroup({
  count,
  isOpen,
  onDelete,
  onDrop,
  onPin,
  onPress,
  onPreviewMove,
  onToggle,
  onToggleOpen,
  tasks,
  title,
}: {
  count: number;
  isOpen: boolean;
  onDelete: (task: TodoOccurrence) => void;
  onDrop: () => void;
  onPin: (task: TodoOccurrence) => void;
  onPress: (task: TodoOccurrence) => void;
  onPreviewMove: (id: string, toIndex: number) => void;
  onToggle: (task: TodoOccurrence) => void;
  onToggleOpen: () => void;
  tasks: TodoOccurrence[];
  title: string;
}) {
  return (
    <View style={styles.collapsible}>
      <Pressable onPress={onToggleOpen} style={styles.collapsibleHeader}>
        <View style={styles.collapsibleCopy}>
          <Text style={styles.collapsibleTitle}>{title}</Text>
          <Text style={styles.collapsibleCount}>{count} 个任务</Text>
        </View>
        <AppIcon
          name={isOpen ? "chevron-down" : "chevron-forward"}
          color={colors.accent}
          size={20}
        />
      </Pressable>
      {isOpen
        ? tasks.map((task, index) => (
            <DraggableTaskItem
              id={task.id}
              index={index}
              key={task.id}
              onDrop={onDrop}
              onPreviewMove={onPreviewMove}
              total={tasks.length}>
              <TaskRow
                onDelete={onDelete}
                onPin={onPin}
                onPress={onPress}
                onToggle={onToggle}
                task={task}
              />
            </DraggableTaskItem>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    ...shadows.panel,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  date: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  pressed: {
    opacity: 0.64,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  empty: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 260,
  },
  emptyTitle: {
    ...typography.section,
    color: colors.text,
    marginTop: spacing.md,
  },
  emptyCopy: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  group: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  groupTitle: {
    ...typography.section,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  collapsible: {
    ...shadows.card,
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    overflow: "hidden",
    padding: spacing.sm,
  },
  collapsibleHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 58,
    paddingHorizontal: spacing.sm,
  },
  collapsibleCopy: {
    gap: 2,
  },
  collapsibleTitle: {
    ...typography.section,
    color: colors.accent,
  },
  collapsibleCount: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
