import { useMemo, useState } from "react";
import {
  Alert,
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
import { ErrorState, LoadingState } from "@/components/ScreenState";
import { TaskEditor } from "@/components/TaskEditor";
import { TaskRow } from "@/components/TaskRow";
import {
  createTask,
  deleteOccurrence,
  getDay,
  updateOccurrence,
} from "@/lib/api";
import { formatLongDate } from "@/lib/date";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type {
  DayTodos,
  TaskUpdatePayload,
  TodoOccurrence,
} from "@/types";

type TodayScreenProps = {
  selectedDate: string;
};

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

export function TodayScreen({ selectedDate }: TodayScreenProps) {
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<TodoOccurrence | null>(null);
  const [longTermOpen, setLongTermOpen] = useState(false);
  const [lowPriorityOpen, setLowPriorityOpen] = useState(false);

  const dayQuery = useQuery({
    queryKey: ["day", selectedDate],
    queryFn: () => getDay(selectedDate),
  });

  const createMutation = useMutation({
    mutationFn: (text: string) => createTask(selectedDate, { text }),
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
      setSelectedTask(null);
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
      setSelectedTask(null);
      void queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });

  const groups = useMemo(() => {
    const pending = dayQuery.data?.pending ?? [];
    return {
      pinned: pending.filter(
        (task) => task.isPinned && !task.isLongTerm && !task.isLowPriority,
      ),
      regular: pending.filter(
        (task) => !task.isPinned && !task.isLongTerm && !task.isLowPriority,
      ),
      longTerm: pending.filter((task) => task.isLongTerm),
      lowPriority: pending.filter((task) => task.isLowPriority),
      done: dayQuery.data?.done ?? [],
    };
  }, [dayQuery.data]);

  const total = (dayQuery.data?.pending.length ?? 0) + groups.done.length;
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

      <CollapsibleTaskGroup
        count={groups.longTerm.length}
        isOpen={longTermOpen}
        onDelete={confirmDelete}
        onPin={togglePin}
        onPress={setSelectedTask}
        onToggle={toggle}
        onToggleOpen={() => setLongTermOpen((current) => !current)}
        tasks={groups.longTerm}
        title="长期任务"
      />
      <TaskGroup
        onDelete={confirmDelete}
        onPin={togglePin}
        onPress={setSelectedTask}
        onToggle={toggle}
        tasks={[...groups.pinned, ...groups.regular]}
        title=""
      />
      <CollapsibleTaskGroup
        count={groups.lowPriority.length}
        isOpen={lowPriorityOpen}
        onDelete={confirmDelete}
        onPin={togglePin}
        onPress={setSelectedTask}
        onToggle={toggle}
        onToggleOpen={() => setLowPriorityOpen((current) => !current)}
        tasks={groups.lowPriority}
        title="低优先级"
      />
      <TaskGroup
        onDelete={confirmDelete}
        onPin={togglePin}
        onPress={setSelectedTask}
        onToggle={toggle}
        tasks={groups.done}
        title={groups.done.length ? "已完成" : ""}
      />
    </ScrollView>
  );

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>我的一天</Text>
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
        isSaving={updateMutation.isPending}
        onClose={() => setSelectedTask(null)}
        onDelete={confirmDelete}
        onSave={(task, payload) => updateMutation.mutate({ id: task.id, payload })}
        task={selectedTask}
      />
    </View>
  );
}

function TaskGroup({
  title,
  tasks,
  onDelete,
  onPin,
  onPress,
  onToggle,
}: {
  title: string;
  tasks: TodoOccurrence[];
  onDelete: (task: TodoOccurrence) => void;
  onPin: (task: TodoOccurrence) => void;
  onPress: (task: TodoOccurrence) => void;
  onToggle: (task: TodoOccurrence) => void;
}) {
  if (!tasks.length) {
    return null;
  }
  return (
    <View style={styles.group}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          onDelete={onDelete}
          onPin={onPin}
          onPress={onPress}
          onToggle={onToggle}
          task={task}
        />
      ))}
    </View>
  );
}

function CollapsibleTaskGroup({
  count,
  isOpen,
  onDelete,
  onPin,
  onPress,
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
        ? tasks.map((task) => (
            <TaskRow
              key={task.id}
              onDelete={onDelete}
              onPin={onPin}
              onPress={onPress}
              onToggle={onToggle}
              task={task}
            />
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
