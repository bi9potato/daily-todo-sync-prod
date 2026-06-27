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
import { DateStrip } from "@/components/DateStrip";
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
import { colors, spacing, typography } from "@/theme";
import type {
  DayTodos,
  TaskUpdatePayload,
  TodoOccurrence,
} from "@/types";

type TodayScreenProps = {
  selectedDate: string;
  today: string;
  onOpenProfile: () => void;
  onSelectDate: (date: string) => void;
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

export function TodayScreen({
  selectedDate,
  today,
  onOpenProfile,
  onSelectDate,
}: TodayScreenProps) {
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
  const progress = total ? groups.done.length / total : 0;

  function toggle(task: TodoOccurrence) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateMutation.mutate({
      id: task.id,
      payload: { done: task.status !== "done" },
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
      <DateStrip
        onSelect={onSelectDate}
        selectedDate={selectedDate}
        today={today}
      />

      <View style={styles.progressRow}>
        <Text style={styles.progressText}>
          <Text style={styles.progressStrong}>{groups.done.length}</Text>
          {` / ${total} 已完成`}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>

      {total === 0 ? (
        <View style={styles.empty}>
          <AppIcon name="sunny-outline" color={colors.accent} size={34} />
          <Text style={styles.emptyTitle}>今天还没有任务</Text>
          <Text style={styles.emptyCopy}>从下面添加一件最重要的事。</Text>
        </View>
      ) : null}

      <TaskGroup
        onPress={setSelectedTask}
        onToggle={toggle}
        tasks={groups.pinned}
        title="置顶"
      />
      <TaskGroup
        onPress={setSelectedTask}
        onToggle={toggle}
        tasks={groups.regular}
        title="待处理"
      />
      <CollapsibleTaskGroup
        count={groups.longTerm.length}
        isOpen={longTermOpen}
        onPress={setSelectedTask}
        onToggle={toggle}
        onToggleOpen={() => setLongTermOpen((current) => !current)}
        tasks={groups.longTerm}
        title="长期任务"
      />
      <CollapsibleTaskGroup
        count={groups.lowPriority.length}
        isOpen={lowPriorityOpen}
        onPress={setSelectedTask}
        onToggle={toggle}
        onToggleOpen={() => setLowPriorityOpen((current) => !current)}
        tasks={groups.lowPriority}
        title="低优先级"
      />
      <TaskGroup
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
        <Pressable
          accessibilityLabel="打开个人设置"
          onPress={onOpenProfile}
          style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}>
          <AppIcon name="person-outline" color={colors.accent} size={22} />
        </Pressable>
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
  onPress,
  onToggle,
}: {
  title: string;
  tasks: TodoOccurrence[];
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
        <TaskRow key={task.id} onPress={onPress} onToggle={onToggle} task={task} />
      ))}
    </View>
  );
}

function CollapsibleTaskGroup({
  count,
  isOpen,
  onPress,
  onToggle,
  onToggleOpen,
  tasks,
  title,
}: {
  count: number;
  isOpen: boolean;
  onPress: (task: TodoOccurrence) => void;
  onToggle: (task: TodoOccurrence) => void;
  onToggleOpen: () => void;
  tasks: TodoOccurrence[];
  title: string;
}) {
  if (!count) {
    return null;
  }
  return (
    <View style={styles.collapsible}>
      <Pressable onPress={onToggleOpen} style={styles.collapsibleHeader}>
        <AppIcon
          name={isOpen ? "chevron-down" : "chevron-forward"}
          color={colors.text}
          size={20}
        />
        <Text style={styles.collapsibleTitle}>{title}</Text>
        <Text style={styles.collapsibleCount}>{count}</Text>
      </Pressable>
      {isOpen
        ? tasks.map((task) => (
            <TaskRow key={task.id} onPress={onPress} onToggle={onToggle} task={task} />
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
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
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
  avatar: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  pressed: {
    opacity: 0.64,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  progressRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.lg,
    paddingVertical: spacing.lg,
  },
  progressText: {
    ...typography.body,
    color: colors.textMuted,
  },
  progressStrong: {
    color: colors.accent,
    fontWeight: "700",
  },
  progressTrack: {
    backgroundColor: colors.border,
    borderRadius: 3,
    flex: 1,
    height: 5,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: 3,
    height: 5,
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
    marginTop: spacing.xl,
  },
  groupTitle: {
    ...typography.section,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  collapsible: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
  },
  collapsibleHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 56,
  },
  collapsibleTitle: {
    ...typography.section,
    color: colors.text,
    flex: 1,
  },
  collapsibleCount: {
    ...typography.body,
    color: colors.textMuted,
  },
});
