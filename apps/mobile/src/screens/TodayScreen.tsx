import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import * as Haptics from "expo-haptics";
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  type DragEndParams,
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { Composer } from "@/components/Composer";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import { TaskEditor } from "@/components/TaskEditor";
import { TaskRow } from "@/components/TaskRow";
import {
  ApiError,
  chatWithAi,
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
import {
  createTodoClientId,
  enqueueTodoCreate,
  enqueueTodoDelete,
  enqueueTodoReorder,
  enqueueTodoUpdate,
} from "@/lib/todo-mutation-queue";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type {
  DayTodos,
  LocalAttachmentFile,
  TaskAttachment,
  TaskCreatePayload,
  TaskUpdatePayload,
  TodoOccurrence,
} from "@/types";

// A network-class failure (couldn't reach the server at all) should be
// queued and retried later; a real response from the server (ApiError,
// even a 4xx/5xx) means the request was understood and rejected, so it
// should surface to the user immediately instead of being queued.
function isOfflineError(error: unknown) {
  return !(error instanceof ApiError);
}

function createOptimisticOccurrence(
  clientId: string,
  date: string,
  payload: TaskCreatePayload,
): TodoOccurrence {
  const timestamp = new Date().toISOString();
  return {
    id: clientId,
    taskId: clientId,
    rootId: clientId,
    taskDate: date,
    text: payload.text,
    note: payload.note ?? "",
    status: "pending",
    source: "manual",
    // Date.now() sorts after every server-assigned sortOrder (those are
    // small integers), which is exactly "append to the end of the list"
    // until the real value comes back from a sync.
    sortOrder: Date.now(),
    isPinned: false,
    isLowPriority: payload.isLowPriority ?? false,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    carryoverFromOccurrenceId: null,
    firstCreatedAt: timestamp,
    reminderTime: payload.reminderTime ?? null,
    reminderAt: null,
    isRecurring: Boolean(payload.repeat && payload.repeat.kind !== "none"),
    isLongTerm: payload.isLongTerm ?? false,
    repeat: payload.repeat ?? {
      kind: "none",
      interval: 1,
      daysOfWeek: [],
      until: null,
    },
    location: null,
    attachments: [],
  };
}

type TodayScreenProps = {
  selectedDate: string;
  viewMode?: "my-day" | "long-term" | "low-priority";
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
    mutationFn: async (text: string) => {
      const clientId = createTodoClientId();
      const payload: TaskCreatePayload = {
        text,
        isLongTerm: viewMode === "long-term",
        isLowPriority: viewMode === "low-priority",
        clientId,
      };
      try {
        return await createTask(selectedDate, payload);
      } catch (error) {
        if (!isOfflineError(error)) {
          throw error;
        }
        await enqueueTodoCreate(clientId, selectedDate, payload);
        return createOptimisticOccurrence(clientId, selectedDate, payload);
      }
    },
    onSuccess: (task) => {
      queryClient.setQueryData<DayTodos>(["day", selectedDate], (current) =>
        current ? { ...current, pending: [...current.pending, task] } : current,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: TaskUpdatePayload;
    }) => {
      try {
        return await updateOccurrence(id, payload);
      } catch (error) {
        if (!isOfflineError(error)) {
          throw error;
        }
        await enqueueTodoUpdate(id, payload);
        // onMutate (below) already wrote the optimistic merge into the
        // cache before this ran; re-reading it keeps that state as the
        // mutation's "result" instead of rolling back.
        const current = queryClient.getQueryData<DayTodos>([
          "day",
          selectedDate,
        ]);
        const optimistic = [...(current?.pending ?? []), ...(current?.done ?? [])].find(
          (item) => item.id === id,
        );
        if (!optimistic) {
          throw error;
        }
        return optimistic;
      }
    },
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
    mutationFn: async (id: string) => {
      try {
        await deleteOccurrence(id);
      } catch (error) {
        if (!isOfflineError(error)) {
          throw error;
        }
        await enqueueTodoDelete(id);
      }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["day", selectedDate] });
      const previous = queryClient.getQueryData<DayTodos>(["day", selectedDate]);
      queryClient.setQueryData<DayTodos>(["day", selectedDate], (current) =>
        current
          ? {
              ...current,
              pending: current.pending.filter((item) => item.id !== id),
              done: current.done.filter((item) => item.id !== id),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["day", selectedDate], context.previous);
      }
    },
    onSuccess: () => {
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

  const aiChatMutation = useMutation({
    mutationFn: (message: string) => chatWithAi(message, selectedDate),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["day", selectedDate] });
      void queryClient.invalidateQueries({ queryKey: ["range"] });
    },
    onError: (error) => Alert.alert("AI 请求失败", error.message),
  });

  const reorderMutation = useMutation({
    // The drag handlers below already write the reordered sortOrder
    // directly into the query cache before calling this, so this is
    // already optimistic; offline just needs to queue instead of
    // reverting via a refetch that would fail anyway.
    mutationFn: async (orderedIds: string[]) => {
      try {
        await reorderDay(selectedDate, orderedIds);
      } catch (error) {
        if (!isOfflineError(error)) {
          throw error;
        }
        await enqueueTodoReorder(selectedDate, orderedIds);
      }
    },
    onError: (error) => {
      Alert.alert("任务排序失败", error.message);
      void queryClient.invalidateQueries({ queryKey: ["day", selectedDate] });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });

  // Draggable lists already reorder themselves live while dragging (see
  // TaskGroup/CollapsibleTaskGroup below), so unlike the old
  // DraggableTaskItem-based implementation there is no separate "preview"
  // state to merge in here - this is just the server-sorted order.
  const groups = useMemo(() => {
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

  // Each TaskGroup/CollapsibleTaskGroup renders pinned and unpinned tasks
  // as two separate NestableDraggableFlatLists (see below), so a drag can
  // never cross the pinned/unpinned boundary in the first place - this
  // just persists whichever one of those lists was just dropped.
  function finishTaskDrag(orderedIds: string[]) {
    const current = dayQuery.data;
    if (!current) {
      return;
    }
    const orderById = new Map(
      orderedIds.map((id, index) => [id, (index + 1) * 1000]),
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
    reorderMutation.mutate(orderedIds);
  }

  const content = dayQuery.isPending ? (
    <LoadingState isPaused={dayQuery.fetchStatus === "paused"} />
  ) : dayQuery.isError ? (
    <ErrorState
      message={dayQuery.error.message || "任务加载失败"}
      onRetry={() => dayQuery.refetch()}
    />
  ) : (
    <NestableScrollContainer
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
            onPin={togglePin}
            onPress={(task) => setSelectedTaskId(task.id)}
            onReorder={finishTaskDrag}
            onToggle={toggle}
            onToggleOpen={() => setLongTermOpen((current) => !current)}
            tasks={groups.longTerm}
            title="长期任务"
          />
          <TaskGroup
            onDelete={confirmDelete}
            onPin={togglePin}
            onPress={(task) => setSelectedTaskId(task.id)}
            onReorder={finishTaskDrag}
            onToggle={toggle}
            tasks={groups.regular}
            title=""
          />
          <CollapsibleTaskGroup
            count={groups.lowPriority.length}
            isOpen={lowPriorityOpen}
            onDelete={confirmDelete}
            onPin={togglePin}
            onPress={(task) => setSelectedTaskId(task.id)}
            onReorder={finishTaskDrag}
            onToggle={toggle}
            onToggleOpen={() => setLowPriorityOpen((current) => !current)}
            tasks={groups.lowPriority}
            title="低优先级"
          />
        </>
      ) : (
        <TaskGroup
          onDelete={confirmDelete}
          onPin={togglePin}
          onPress={(task) => setSelectedTaskId(task.id)}
          onReorder={finishTaskDrag}
          onToggle={toggle}
          tasks={
            viewMode === "long-term" ? groups.longTerm : groups.lowPriority
          }
          title=""
        />
      )}
    </NestableScrollContainer>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
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
        isPending={createMutation.isPending || aiChatMutation.isPending}
        lastAiReply={aiChatMutation.data?.reply}
        onAiSubmit={(text) => aiChatMutation.mutateAsync(text).then(() => undefined)}
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

// Pinned and unpinned tasks render as two separate draggable lists rather
// than one, so a drag can never cross the pinned/unpinned boundary - a
// constraint the old single-list implementation had to enforce by hand
// (rejecting any preview move where the drop target's pinned state didn't
// match the dragged task's).
function TaskDragList({
  onDelete,
  onPin,
  onPress,
  onReorder,
  onToggle,
  tasks,
}: {
  onDelete: (task: TodoOccurrence) => void;
  onPin: (task: TodoOccurrence) => void;
  onPress: (task: TodoOccurrence) => void;
  onReorder: (orderedIds: string[]) => void;
  onToggle: (task: TodoOccurrence) => void;
  tasks: TodoOccurrence[];
}) {
  const pinned = tasks.filter((task) => task.isPinned);
  const rest = tasks.filter((task) => !task.isPinned);

  const renderItem = ({ item, drag, isActive }: RenderItemParams<TodoOccurrence>) => (
    <TaskRow
      isDragActive={isActive}
      onDelete={onDelete}
      onDragHandleLongPress={drag}
      onPin={onPin}
      onPress={onPress}
      onToggle={onToggle}
      task={item}
    />
  );

  return (
    <>
      {pinned.length ? (
        <NestableDraggableFlatList
          ItemSeparatorComponent={() => <View style={styles.rowGap} />}
          data={pinned}
          keyExtractor={(task) => task.id}
          onDragEnd={({ data }: DragEndParams<TodoOccurrence>) =>
            onReorder(data.map((task) => task.id))
          }
          renderItem={renderItem}
        />
      ) : null}
      {rest.length ? (
        <NestableDraggableFlatList
          ItemSeparatorComponent={() => <View style={styles.rowGap} />}
          data={rest}
          keyExtractor={(task) => task.id}
          onDragEnd={({ data }: DragEndParams<TodoOccurrence>) =>
            onReorder(data.map((task) => task.id))
          }
          renderItem={renderItem}
        />
      ) : null}
    </>
  );
}

function TaskGroup({
  title,
  tasks,
  onDelete,
  onPin,
  onPress,
  onReorder,
  onToggle,
}: {
  title: string;
  tasks: TodoOccurrence[];
  onDelete: (task: TodoOccurrence) => void;
  onPin: (task: TodoOccurrence) => void;
  onPress: (task: TodoOccurrence) => void;
  onReorder: (orderedIds: string[]) => void;
  onToggle: (task: TodoOccurrence) => void;
}) {
  if (!tasks.length) {
    return null;
  }
  return (
    <View style={styles.group}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <TaskDragList
        onDelete={onDelete}
        onPin={onPin}
        onPress={onPress}
        onReorder={onReorder}
        onToggle={onToggle}
        tasks={tasks}
      />
    </View>
  );
}

function CollapsibleTaskGroup({
  count,
  isOpen,
  onDelete,
  onPin,
  onPress,
  onReorder,
  onToggle,
  onToggleOpen,
  tasks,
  title,
}: {
  count: number;
  isOpen: boolean;
  onDelete: (task: TodoOccurrence) => void;
  onPin: (task: TodoOccurrence) => void;
  onPress: (task: TodoOccurrence) => void;
  onReorder: (orderedIds: string[]) => void;
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
      {isOpen ? (
        <TaskDragList
          onDelete={onDelete}
          onPin={onPin}
          onPress={onPress}
          onReorder={onReorder}
          onToggle={onToggle}
          tasks={tasks}
        />
      ) : null}
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
  rowGap: {
    height: spacing.sm,
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
