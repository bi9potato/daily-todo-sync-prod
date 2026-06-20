import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  createTask,
  deleteOccurrence,
  getMe,
  getRange,
  login,
  register,
  reorderDay,
  updateOccurrence,
  type DayTodos,
  type RangeTodos,
  type RepeatKind,
  type RepeatRule,
  type TodoOccurrence,
} from "./api";
import {
  addDays,
  datesBetween,
  endOfMonth,
  endOfWeek,
  formatShortDate,
  fromDateKey,
  startOfMonth,
  startOfWeek,
  toDateKey,
  weekdayLabel,
} from "./date";

type AuthMode = "login" | "register";
type ViewMode = "day" | "week" | "month";

type DragState = {
  active: boolean;
  date: string;
  height: number;
  id: string;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  startX: number;
  startY: number;
  targetId: string | null;
  width: number;
  x: number;
  y: number;
};

type PendingDrag = {
  state: DragState;
  timeoutId: number;
};

type ReorderPayload = {
  date: string;
  orderedIds: string[];
};

type ReorderContext = {
  previousRanges: Array<[QueryKey, RangeTodos | undefined]>;
};

const ACCESS_TOKEN_KEY = "daily-todo-sync.access-token";
const REFRESH_TOKEN_KEY = "daily-todo-sync.refresh-token";
const LONG_PRESS_TO_DRAG_MS = 420;
const LONG_PRESS_MOVE_CANCEL_PX = 10;

const REPEAT_OPTIONS: { value: RepeatKind; label: string }[] = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
];

export function App() {
  const [accessToken, setAccessToken] = useState(() =>
    localStorage.getItem(ACCESS_TOKEN_KEY),
  );
  const [refreshToken, setRefreshToken] = useState(() =>
    localStorage.getItem(REFRESH_TOKEN_KEY),
  );

  function saveTokens(tokens: { accessToken: string; refreshToken: string }) {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    setAccessToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);
  }

  function logout() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setAccessToken(null);
    setRefreshToken(null);
  }

  if (!accessToken || !refreshToken) {
    return <AuthScreen onAuthed={saveTokens} />;
  }

  return <TodoScreen accessToken={accessToken} onLogout={logout} />;
}

function AuthScreen({
  onAuthed,
}: {
  onAuthed: (tokens: { accessToken: string; refreshToken: string }) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const authMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      return mode === "login"
        ? login({ identifier, password })
        : register({ username, email, password });
    },
    onSuccess: onAuthed,
    onError: (err) => setError(err instanceof Error ? err.message : "认证失败"),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    authMutation.mutate();
  }

  return (
    <main className="auth-page">
      <section className="auth-panel surface-panel">
        <p className="eyebrow">Daily Todo Sync</p>
        <h1>{mode === "login" ? "登录" : "注册账号"}</h1>

        <div className="segmented">
          <button
            className={mode === "login" ? "active" : ""}
            type="button"
            onClick={() => setMode("login")}
          >
            登录
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            type="button"
            onClick={() => setMode("register")}
          >
            注册
          </button>
        </div>

        <form onSubmit={submit} className="stack">
          {mode === "register" ? (
            <>
              <label>
                用户名
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </label>
              <label>
                邮箱
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
            </>
          ) : (
            <label>
              用户名或邮箱
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                required
              />
            </label>
          )}

          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <button className="primary-button" disabled={authMutation.isPending}>
            {authMutation.isPending ? "处理中..." : mode === "login" ? "登录" : "注册"}
          </button>
        </form>
      </section>
    </main>
  );
}

function TodoScreen({
  accessToken,
  onLogout,
}: {
  accessToken: string;
  onLogout: () => void;
}) {
  const today = useMemo(() => toDateKey(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const pendingDragRef = useRef<PendingDrag | null>(null);
  const suppressOpenTaskIdRef = useRef<string | null>(null);
  const reorderAnimationFrameRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  const visibleRange = useMemo(() => {
    if (viewMode === "week") {
      return { start: startOfWeek(selectedDate), end: endOfWeek(selectedDate) };
    }
    if (viewMode === "month") {
      return { start: startOfMonth(selectedDate), end: endOfMonth(selectedDate) };
    }
    return { start: selectedDate, end: selectedDate };
  }, [selectedDate, viewMode]);

  const visibleDates = useMemo(
    () => datesBetween(visibleRange.start, visibleRange.end),
    [visibleRange.end, visibleRange.start],
  );

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe(accessToken),
  });

  const rangeQuery = useQuery({
    queryKey: ["range", visibleRange.start, visibleRange.end],
    queryFn: () => getRange(visibleRange.start, visibleRange.end, accessToken),
  });

  const daysByDate = useMemo(() => {
    return new Map(rangeQuery.data?.days.map((day) => [day.date, day]) ?? []);
  }, [rangeQuery.data]);

  const allTasks = useMemo(() => {
    return rangeQuery.data?.days.flatMap((day) => [...day.pending, ...day.done]) ?? [];
  }, [rangeQuery.data]);

  const selectedTask = allTasks.find((item) => item.id === selectedTaskId) ?? null;
  const draggedTask =
    dragState?.active ? allTasks.find((item) => item.id === dragState.id) ?? null : null;
  const isMyDay = viewMode === "day" && selectedDate === today;

  const createMutation = useMutation({
    mutationFn: (payload: {
      date: string;
      text: string;
      note: string;
      reminderTime: string | null;
      repeat: RepeatRule;
    }) =>
      createTask(
        payload.date,
        {
          text: payload.text,
          note: payload.note,
          reminderTime: payload.reminderTime,
          repeat: payload.repeat.kind === "none" ? undefined : payload.repeat,
        },
        accessToken,
      ),
    onSuccess: () => {
      setIsAddOpen(false);
      queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      done?: boolean;
      text?: string;
      note?: string;
      reminderTime?: string | null;
      repeat?: RepeatRule;
    }) => {
      const { id, ...changes } = payload;
      return updateOccurrence(id, changes, accessToken);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["range"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOccurrence(id, accessToken),
    onSuccess: () => {
      setSelectedTaskId(null);
      queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });

  const reorderMutation = useMutation<void, Error, ReorderPayload, ReorderContext>({
    mutationFn: (payload) =>
      reorderDay(payload.date, payload.orderedIds, accessToken),
    onMutate: (payload) => {
      void queryClient.cancelQueries({ queryKey: ["range"] });
      const previousRanges = queryClient.getQueriesData<RangeTodos>({
        queryKey: ["range"],
      });

      queryClient.setQueriesData<RangeTodos>({ queryKey: ["range"] }, (data) =>
        applyOptimisticDayOrder(data, payload),
      );

      return { previousRanges };
    },
    onError: (_error, _payload, context) => {
      context?.previousRanges.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["range"] }),
  });

  function openMyDay() {
    setSelectedDate(today);
    setViewMode("day");
    setIsMobileSidebarOpen(false);
  }

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    setIsMobileSidebarOpen(false);
  }

  function openTaskDetails(id: string) {
    if (suppressOpenTaskIdRef.current === id) {
      suppressOpenTaskIdRef.current = null;
      return;
    }
    setSelectedTaskId(id);
  }

  function measureTaskRects(date: string) {
    const rects = new Map<string, DOMRect>();
    document
      .querySelectorAll<HTMLElement>(`[data-day-date="${date}"] [data-task-id]`)
      .forEach((element) => {
        const taskId = element.dataset.taskId;
        if (taskId) {
          rects.set(taskId, element.getBoundingClientRect());
        }
      });
    return rects;
  }

  function animateReorderFrom(
    date: string,
    draggedId: string,
    before: Map<string, DOMRect>,
  ) {
    if (reorderAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(reorderAnimationFrameRef.current);
    }
    reorderAnimationFrameRef.current = window.requestAnimationFrame(() => {
      document
        .querySelectorAll<HTMLElement>(`[data-day-date="${date}"] [data-task-id]`)
        .forEach((element) => {
          const taskId = element.dataset.taskId;
          const previous = taskId ? before.get(taskId) : null;
          if (!previous || taskId === draggedId) {
            return;
          }
          const next = element.getBoundingClientRect();
          const deltaX = previous.left - next.left;
          const deltaY = previous.top - next.top;
          if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
            return;
          }
          element.animate(
            [
              { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
              { transform: "translate3d(0, 0, 0)" },
            ],
            {
              duration: 210,
              easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            },
          );
        });
    });
  }

  function setDragStateWithReorderAnimation(nextState: DragState) {
    const before = measureTaskRects(nextState.date);
    flushSync(() => setDragState(nextState));
    animateReorderFrom(nextState.date, nextState.id, before);
  }

  function clearPendingDrag() {
    const pending = pendingDragRef.current;
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timeoutId);
    pendingDragRef.current = null;
  }

  function nextTargetIdAfter(date: string, hoveredId: string, draggedId: string) {
    const ids =
      orderedDayItems(daysByDate.get(date) ?? emptyDay(date))
        .map((item) => item.id)
        .filter((id) => id !== draggedId);
    const index = ids.indexOf(hoveredId);
    if (index === -1) {
      return null;
    }
    return ids[index + 1] ?? null;
  }

  function targetIdFromPointer(current: DragState, clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const hoveredCard = element?.closest<HTMLElement>('[data-task-sortable="true"]');
    if (hoveredCard?.dataset.taskDate === current.date) {
      const hoveredId = hoveredCard.dataset.taskId;
      if (!hoveredId || hoveredId === current.id) {
        return current.targetId;
      }
      const rect = hoveredCard.getBoundingClientRect();
      const shouldInsertAfter = clientY > rect.top + rect.height / 2;
      return shouldInsertAfter
        ? nextTargetIdAfter(current.date, hoveredId, current.id)
        : hoveredId;
    }

    const hoveredList = element?.closest<HTMLElement>("[data-day-date]");
    if (hoveredList?.dataset.dayDate === current.date) {
      return null;
    }

    return current.targetId;
  }

  function startTaskDrag(
    date: string,
    id: string,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    clearPendingDrag();
    const initialState = {
      active: false,
      date,
      height: rect.height,
      id,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      targetId: id,
      width: rect.width,
      x: event.clientX,
      y: event.clientY,
    };
    pendingDragRef.current = {
      state: initialState,
      timeoutId: window.setTimeout(() => {
        const pending = pendingDragRef.current;
        if (!pending || pending.state.pointerId !== initialState.pointerId) {
          return;
        }
        pendingDragRef.current = null;
        setDragState({ ...pending.state, active: true });
      }, LONG_PRESS_TO_DRAG_MS),
    };
  }

  function moveTaskDrag(event: ReactPointerEvent<HTMLElement>) {
    const pending = pendingDragRef.current;
    if (pending?.state.pointerId === event.pointerId) {
      const deltaX = event.clientX - pending.state.startX;
      const deltaY = event.clientY - pending.state.startY;
      if (Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_CANCEL_PX) {
        suppressOpenTaskIdRef.current = pending.state.id;
        clearPendingDrag();
        return;
      }
      pending.state = {
        ...pending.state,
        x: event.clientX,
        y: event.clientY,
      };
      return;
    }

    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const targetId = targetIdFromPointer(dragState, event.clientX, event.clientY);
    const nextState = {
      ...dragState,
      active: true,
      targetId,
      x: event.clientX,
      y: event.clientY,
    };

    event.preventDefault();

    if (targetId !== dragState.targetId) {
      setDragStateWithReorderAnimation(nextState);
      return;
    }

    setDragState(nextState);
  }

  function finishTaskDrag() {
    if (pendingDragRef.current) {
      clearPendingDrag();
      return;
    }

    if (!dragState) {
      return;
    }

    if (dragState.active) {
      suppressOpenTaskIdRef.current = dragState.id;
      const day = daysByDate.get(dragState.date) ?? emptyDay(dragState.date);
      const currentIds = orderedDayItems(day).map((item) => item.id);
      const orderedIds = reorderIds(currentIds, dragState.id, dragState.targetId);
      if (orderedIds.join("|") !== currentIds.join("|")) {
        reorderMutation.mutate({ date: dragState.date, orderedIds });
      }
    }

    setDragState(null);
  }

  function cancelTaskDrag() {
    clearPendingDrag();
    setDragState(null);
  }

  function shiftDate(amount: number) {
    if (viewMode === "week") {
      setSelectedDate(addDays(selectedDate, amount * 7));
      return;
    }
    if (viewMode === "month") {
      const current = fromDateKey(selectedDate);
      const next = new Date(current.getFullYear(), current.getMonth() + amount, 1, 12);
      setSelectedDate(toDateKey(next));
      return;
    }
    setSelectedDate(addDays(selectedDate, amount));
  }

  function viewTitle() {
    if (viewMode === "day" && selectedDate === today) {
      return "我的一天";
    }
    if (viewMode === "day") {
      return "日视图";
    }
    if (viewMode === "week") {
      return "周视图";
    }
    return "月视图";
  }

  return (
    <main
      className={[
        "app-layout",
        isSidebarCollapsed ? "sidebar-collapsed" : "",
        isMobileSidebarOpen ? "mobile-sidebar-open" : "",
        isMyDay ? "is-my-day" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        className="sidebar-scrim"
        type="button"
        aria-label="关闭侧边栏"
        onClick={() => setIsMobileSidebarOpen(false)}
      />
      <aside className="sidebar surface-panel">
        <div className="brand-block">
          <div className="account-menu">
            <button
              className="account-trigger"
              type="button"
              aria-expanded={isAccountMenuOpen}
              onClick={() => setIsAccountMenuOpen((value) => !value)}
            >
              <span className="brand-mark">D</span>
              <span className="sidebar-label account-copy">
                <span className="eyebrow">Daily Todo Sync</span>
                <strong>{meQuery.data?.username ?? "账户"}</strong>
              </span>
              <ChevronDownIcon expanded={isAccountMenuOpen} />
            </button>

            {isAccountMenuOpen ? (
              <div className="account-dropdown">
                <button className="account-menu-item is-placeholder" type="button">
                  <span>Settings</span>
                  <small>占位，稍后接入</small>
                </button>
                <button className="account-menu-item danger-menu-item" type="button" onClick={onLogout}>
                  登出账户
                </button>
              </div>
            ) : null}
          </div>
          <button
            className="sidebar-icon-button sidebar-collapse-button"
            type="button"
            aria-label={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={() => setIsSidebarCollapsed((value) => !value)}
          >
            <PanelIcon />
          </button>
          <button
            className="sidebar-icon-button sidebar-close-button"
            type="button"
            aria-label="关闭侧边栏"
            onClick={() => setIsMobileSidebarOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>

        <button className="sidebar-back" type="button" onClick={openMyDay}>
          <ArrowLeftIcon />
          <span>返回今天</span>
        </button>

        <nav className="sidebar-nav" aria-label="任务视图">
          <button
            className={selectedDate === today && viewMode === "day" ? "active" : ""}
            type="button"
            onClick={openMyDay}
          >
            <span className="nav-icon">
              <SunIcon />
            </span>
            <span className="nav-label">我的一天</span>
            <small className="nav-meta">
              {today} · {weekdayLabel(today)}
            </small>
          </button>
        </nav>

        <div className="sidebar-section">
          <p>视图</p>
          <div className="sidebar-switch">
            {(["day", "week", "month"] as ViewMode[]).map((mode) => (
              <button
                className={viewMode === mode ? "active" : ""}
                key={mode}
                type="button"
                onClick={() => changeViewMode(mode)}
              >
                {mode === "day" ? "日" : mode === "week" ? "周" : "月"}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-date">
          <span>当前日期</span>
          <strong>{selectedDate}</strong>
          <small>{weekdayLabel(selectedDate)}</small>
        </div>
      </aside>

      <section className="workspace">
        <div className="mobile-appbar surface-panel">
          <button
            className="sidebar-icon-button"
            type="button"
            aria-label="打开侧边栏"
            onClick={() => setIsMobileSidebarOpen(true)}
          >
            <MenuIcon />
          </button>
          <div>
            <strong>Daily Todo Sync</strong>
            <small>{meQuery.data?.username ?? "账户"}</small>
          </div>
        </div>

        <header className="workspace-header surface-panel">
          <div>
            {!isMyDay ? (
              <p className="eyebrow">
                {visibleRange.start === visibleRange.end
                  ? selectedDate
                  : `${visibleRange.start} - ${visibleRange.end}`}
              </p>
            ) : null}
            <h1>{viewTitle()}</h1>
            <p className="muted">
              {selectedDate} · {weekdayLabel(selectedDate)}
            </p>
          </div>

          {!isMyDay ? (
            <nav className="date-controls">
              <button type="button" onClick={() => shiftDate(-1)}>
                &lt;
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
              <button type="button" onClick={openMyDay}>
                今天
              </button>
              <button type="button" onClick={() => shiftDate(1)}>
                &gt;
              </button>
            </nav>
          ) : null}
        </header>

        <div className="workspace-actions">
          <button
            className="add-task-button"
            type="button"
            aria-label="新增任务"
            onClick={() => setIsAddOpen(true)}
          >
            +
          </button>
        </div>

        {rangeQuery.isLoading ? <p className="empty-state is-visible">加载中...</p> : null}
        {rangeQuery.isError ? (
          <p className="empty-state is-visible">加载失败：{String(rangeQuery.error)}</p>
        ) : null}

        <section className={`calendar-grid view-${viewMode}`}>
          {visibleDates.map((date) => (
            <DayColumn
              date={date}
              day={daysByDate.get(date) ?? emptyDay(date)}
              dragState={dragState}
              isSelected={date === selectedDate}
              isToday={date === today}
              hideHeading={isMyDay}
              key={date}
              onDelete={(id) => deleteMutation.mutate(id)}
              onDone={(id, done) => updateMutation.mutate({ id, done })}
              onCancelDrag={cancelTaskDrag}
              onEndDrag={finishTaskDrag}
              onMoveDrag={moveTaskDrag}
              onOpenTask={openTaskDetails}
              onSelectDate={setSelectedDate}
              onStartDrag={startTaskDrag}
            />
          ))}
        </section>
      </section>

      {dragState?.active && draggedTask ? (
        <div
          className="drag-floating-card"
          style={{
            height: dragState.height,
            left: dragState.x - dragState.offsetX,
            top: dragState.y - dragState.offsetY,
            width: dragState.width,
          }}
        >
          <GripIcon />
          <span>{draggedTask.text}</span>
        </div>
      ) : null}

      {isAddOpen ? (
        <AddTaskModal
          date={selectedDate}
          isSaving={createMutation.isPending}
          onClose={() => setIsAddOpen(false)}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      ) : null}

      {selectedTask ? (
        <TaskDetailsModal
          item={selectedTask}
          isDeleting={deleteMutation.isPending}
          isSaving={updateMutation.isPending}
          onClose={() => setSelectedTaskId(null)}
          onDelete={() => deleteMutation.mutate(selectedTask.id)}
          onSave={(changes) => updateMutation.mutate({ id: selectedTask.id, ...changes })}
        />
      ) : null}
    </main>
  );
}

function DayColumn({
  date,
  day,
  dragState,
  hideHeading,
  isSelected,
  isToday,
  onCancelDrag,
  onDelete,
  onDone,
  onEndDrag,
  onMoveDrag,
  onOpenTask,
  onSelectDate,
  onStartDrag,
}: {
  date: string;
  day: DayTodos;
  dragState: DragState | null;
  hideHeading: boolean;
  isSelected: boolean;
  isToday: boolean;
  onCancelDrag: () => void;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onEndDrag: () => void;
  onMoveDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onOpenTask: (id: string) => void;
  onSelectDate: (date: string) => void;
  onStartDrag: (
    date: string,
    id: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
}) {
  const items = previewDayItems(orderedDayItems(day), dragState, date);
  const isReordering = dragState?.active && dragState.date === date;

  return (
    <article className={`day-column surface-panel ${isSelected ? "is-selected" : ""}`}>
      {!hideHeading ? (
        <button className="day-heading" type="button" onClick={() => onSelectDate(date)}>
          <span>{weekdayLabel(date)}</span>
          <strong>{formatShortDate(date)}</strong>
          {isToday ? <span className="today-pill">今天</span> : null}
        </button>
      ) : null}

      <ul
        className={`todo-list card-list ${isReordering ? "is-reordering" : ""}`}
        data-day-date={date}
      >
        {items.length === 0 ? (
          <li className="empty-state is-visible">暂无任务</li>
        ) : null}
        {items.map((item) => (
          <TodoCard
            date={date}
            done={item.status === "done"}
            dragged={Boolean(dragState?.active && dragState.id === item.id)}
            item={item}
            key={item.id}
            onCancelDrag={onCancelDrag}
            onDelete={onDelete}
            onDone={onDone}
            onEndDrag={onEndDrag}
            onMoveDrag={onMoveDrag}
            onOpen={() => onOpenTask(item.id)}
            onStartDrag={(event) => onStartDrag(date, item.id, event)}
          />
        ))}
      </ul>
    </article>
  );
}

function TodoCard({
  date,
  done = false,
  dragged,
  item,
  onCancelDrag,
  onDelete,
  onDone,
  onEndDrag,
  onMoveDrag,
  onOpen,
  onStartDrag,
}: {
  date: string;
  done?: boolean;
  dragged: boolean;
  item: TodoOccurrence;
  onCancelDrag: () => void;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onEndDrag: () => void;
  onMoveDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onOpen: () => void;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  function isInteractiveTarget(target: EventTarget) {
    return Boolean(
      target instanceof Element &&
        target.closest("button, input, textarea, select, a"),
    );
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (isInteractiveTarget(event.target)) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    onStartDrag(event);
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onEndDrag();
  }

  return (
    <li
      className={`todo-item task-card ${done ? "is-done" : ""} ${dragged ? "is-dragging" : ""}`}
      data-task-date={date}
      data-task-id={item.id}
      data-task-sortable="true"
      onClick={onOpen}
      onPointerCancel={onCancelDrag}
      onPointerDown={startDrag}
      onPointerMove={onMoveDrag}
      onPointerUp={endDrag}
    >
      <span
        className="drag-handle"
        aria-hidden="true"
        onClick={(event) => event.stopPropagation()}
      >
        <GripIcon />
      </span>
      <input
        className="round-checkbox"
        type="checkbox"
        checked={done}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onDone(item.id, event.target.checked)}
      />
      <div className="task-body">
        <p>{item.text}</p>
      </div>
      <button
        className="icon-button"
        type="button"
        aria-label="删除任务"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(item.id);
        }}
      >
        <TrashIcon />
      </button>
    </li>
  );
}

function AddTaskModal({
  date,
  isSaving,
  onClose,
  onSubmit,
}: {
  date: string;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    date: string;
    text: string;
    note: string;
    reminderTime: string | null;
    repeat: RepeatRule;
  }) => void;
}) {
  const [taskDate, setTaskDate] = useState(date);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [reminderTime, setReminderTime] = useState("");
  const [repeatKind, setRepeatKind] = useState<RepeatKind>("none");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      return;
    }
    onSubmit({
      date: taskDate,
      text,
      note,
      reminderTime: reminderTime || null,
      repeat: repeatRuleForDate(repeatKind, taskDate),
    });
  }

  return (
    <ModalShell title="新增任务" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          任务内容
          <input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={280}
            required
          />
        </label>
        <label>
          备注
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="补充细节、链接、上下文..."
            rows={4}
          />
        </label>
        <div className="field-grid">
          <label>
            日期
            <input
              type="date"
              value={taskDate}
              onChange={(event) => setTaskDate(event.target.value)}
            />
          </label>
          <label>
            提醒
            <input
              type="time"
              value={reminderTime}
              onChange={(event) => setReminderTime(event.target.value)}
            />
          </label>
          <label>
            重复
            <select
              value={repeatKind}
              onChange={(event) => setRepeatKind(event.target.value as RepeatKind)}
            >
              {REPEAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function TaskDetailsModal({
  item,
  isDeleting,
  isSaving,
  onClose,
  onDelete,
  onSave,
}: {
  item: TodoOccurrence;
  isDeleting: boolean;
  isSaving: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSave: (changes: {
    text: string;
    note: string;
    reminderTime: string | null;
    repeat: RepeatRule;
  }) => void;
}) {
  const [text, setText] = useState(item.text);
  const [note, setNote] = useState(item.note);
  const [reminderTime, setReminderTime] = useState(item.reminderTime ?? "");
  const [repeatKind, setRepeatKind] = useState<RepeatKind>(item.repeat.kind);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      return;
    }
    onSave({
      text,
      note,
      reminderTime: reminderTime || null,
      repeat: repeatRuleForDate(repeatKind, item.taskDate),
    });
  }

  return (
    <ModalShell title="任务详情" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          任务内容
          <input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={280}
            required
          />
        </label>
        <label>
          备注
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="补充细节、链接、上下文..."
            rows={5}
          />
        </label>
        <div className="field-grid">
          <label>
            日期
            <input type="date" value={item.taskDate} disabled />
          </label>
          <label>
            创建时间
            <input value={new Date(item.firstCreatedAt).toLocaleString()} disabled />
          </label>
          <label>
            状态
            <input value={item.status === "done" ? "已完成" : "待处理"} disabled />
          </label>
          <label>
            提醒
            <input
              type="time"
              value={reminderTime}
              onChange={(event) => setReminderTime(event.target.value)}
            />
          </label>
          <label>
            重复
            <select
              value={repeatKind}
              onChange={(event) => setRepeatKind(event.target.value as RepeatKind)}
            >
              {REPEAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button
            className="icon-button danger-button"
            type="button"
            aria-label="删除任务"
            disabled={isDeleting}
            onClick={onDelete}
          >
            <TrashIcon />
          </button>
          <span className="modal-spacer" />
          <button className="ghost-button" type="button" onClick={onClose}>
            关闭
          </button>
          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            x
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      className="trash-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg
      className="mini-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg
      className="mini-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M9 5v14" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      className="mini-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      className="mini-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ChevronDownIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`mini-icon chevron-icon ${expanded ? "is-expanded" : ""}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      className="mini-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg
      className="grip-icon"
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <circle cx="7" cy="5" r="1.2" />
      <circle cx="13" cy="5" r="1.2" />
      <circle cx="7" cy="10" r="1.2" />
      <circle cx="13" cy="10" r="1.2" />
      <circle cx="7" cy="15" r="1.2" />
      <circle cx="13" cy="15" r="1.2" />
    </svg>
  );
}

function emptyDay(date: string): DayTodos {
  return { date, pending: [], done: [] };
}

function orderedDayItems(day: DayTodos) {
  return [...day.pending, ...day.done].sort(compareOccurrences);
}

function applyOptimisticDayOrder(
  data: RangeTodos | undefined,
  payload: ReorderPayload,
) {
  if (!data) {
    return data;
  }

  let changed = false;
  const orderById = new Map(
    payload.orderedIds.map((id, index) => [id, (index + 1) * 1000]),
  );

  const updateSortOrder = (item: TodoOccurrence) => {
    const sortOrder = orderById.get(item.id);
    return sortOrder === undefined ? item : { ...item, sortOrder };
  };

  const days = data.days.map((day) => {
    if (day.date !== payload.date) {
      return day;
    }
    changed = true;
    return {
      ...day,
      pending: day.pending.map(updateSortOrder).sort(compareOccurrences),
      done: day.done.map(updateSortOrder).sort(compareOccurrences),
    };
  });

  return changed ? { ...data, days } : data;
}

function compareOccurrences(left: TodoOccurrence, right: TodoOccurrence) {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function previewDayItems(
  items: TodoOccurrence[],
  dragState: DragState | null,
  date: string,
) {
  if (!dragState?.active || dragState.date !== date) {
    return items;
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  if (!byId.has(dragState.id)) {
    return items;
  }

  return reorderIds(
    items.map((item) => item.id),
    dragState.id,
    dragState.targetId,
  )
    .map((id) => byId.get(id))
    .filter((item): item is TodoOccurrence => Boolean(item));
}

function reorderIds(ids: string[], draggedId: string, targetId: string | null) {
  const withoutDragged = ids.filter((id) => id !== draggedId);
  if (targetId === null) {
    return [...withoutDragged, draggedId];
  }
  const targetIndex = withoutDragged.indexOf(targetId);
  if (targetIndex === -1) {
    return ids;
  }
  return [
    ...withoutDragged.slice(0, targetIndex),
    draggedId,
    ...withoutDragged.slice(targetIndex),
  ];
}

function repeatRuleForDate(kind: RepeatKind, date: string): RepeatRule {
  const selected = fromDateKey(date);
  return {
    kind,
    interval: 1,
    daysOfWeek: kind === "weekly" ? [(selected.getDay() + 6) % 7] : [],
    until: null,
  };
}
