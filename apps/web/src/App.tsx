import {
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

const ACCESS_TOKEN_KEY = "daily-todo-sync.access-token";
const REFRESH_TOKEN_KEY = "daily-todo-sync.refresh-token";

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
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draggedCard, setDraggedCard] = useState<{ date: string; id: string } | null>(null);
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

  const reorderMutation = useMutation({
    mutationFn: (payload: { date: string; orderedIds: string[] }) =>
      reorderDay(payload.date, payload.orderedIds, accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["range"] }),
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
          <span className="brand-mark">D</span>
          <div className="sidebar-label">
            <p className="eyebrow">Daily Todo Sync</p>
            <strong>{meQuery.data?.username ?? "账户"}</strong>
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
            <strong>{viewTitle()}</strong>
            <small>
              {selectedDate} · {weekdayLabel(selectedDate)}
            </small>
          </div>
        </div>

        <header className="workspace-header surface-panel">
          <div>
            <p className="eyebrow">
              {visibleRange.start === visibleRange.end
                ? selectedDate
                : `${visibleRange.start} - ${visibleRange.end}`}
            </p>
            <h1>{viewTitle()}</h1>
            <p className="muted">
              {selectedDate} · {weekdayLabel(selectedDate)}
            </p>
          </div>

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
            <button className="ghost-button" type="button" onClick={onLogout}>
              退出
            </button>
          </nav>
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
              draggedCard={draggedCard}
              isSelected={date === selectedDate}
              isToday={date === today}
              key={date}
              onDelete={(id) => deleteMutation.mutate(id)}
              onDone={(id, done) => updateMutation.mutate({ id, done })}
              onDropCard={(targetDate, targetId) => {
                if (!draggedCard || draggedCard.date !== targetDate) {
                  return;
                }
                const day = daysByDate.get(targetDate) ?? emptyDay(targetDate);
                const orderedIds = reorderIds(
                  day.pending.map((item) => item.id),
                  draggedCard.id,
                  targetId,
                );
                reorderMutation.mutate({ date: targetDate, orderedIds });
                setDraggedCard(null);
              }}
              onEndDrag={() => setDraggedCard(null)}
              onOpenTask={setSelectedTaskId}
              onSelectDate={setSelectedDate}
              onStartDrag={(date, id) => setDraggedCard({ date, id })}
            />
          ))}
        </section>
      </section>

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
  draggedCard,
  isSelected,
  isToday,
  onDelete,
  onDone,
  onDropCard,
  onEndDrag,
  onOpenTask,
  onSelectDate,
  onStartDrag,
}: {
  date: string;
  day: DayTodos;
  draggedCard: { date: string; id: string } | null;
  isSelected: boolean;
  isToday: boolean;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onDropCard: (date: string, targetId: string | null) => void;
  onEndDrag: () => void;
  onOpenTask: (id: string) => void;
  onSelectDate: (date: string) => void;
  onStartDrag: (date: string, id: string) => void;
}) {
  return (
    <article className={`day-column surface-panel ${isSelected ? "is-selected" : ""}`}>
      <button className="day-heading" type="button" onClick={() => onSelectDate(date)}>
        <span>{weekdayLabel(date)}</span>
        <strong>{formatShortDate(date)}</strong>
        {isToday ? <span className="today-pill">今天</span> : null}
      </button>

      <ul
        className="todo-list card-list"
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => onDropCard(date, null)}
      >
        {day.pending.length === 0 ? (
          <li className="empty-state is-visible">无待处理</li>
        ) : null}
        {day.pending.map((item) => (
          <TodoCard
            dragged={draggedCard?.id === item.id}
            item={item}
            key={item.id}
            onDelete={onDelete}
            onDone={onDone}
            onDrop={(targetId) => onDropCard(date, targetId)}
            onEndDrag={onEndDrag}
            onOpen={() => onOpenTask(item.id)}
            onStartDrag={() => onStartDrag(date, item.id)}
          />
        ))}
      </ul>

      {day.done.length > 0 ? (
        <details className="done-list">
          <summary>已完成 {day.done.length}</summary>
          <ul className="todo-list">
            {day.done.map((item) => (
              <TodoCard
                done
                dragged={false}
                item={item}
                key={item.id}
                onDelete={onDelete}
                onDone={onDone}
                onEndDrag={onEndDrag}
                onOpen={() => onOpenTask(item.id)}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

function TodoCard({
  done = false,
  dragged,
  item,
  onDelete,
  onDone,
  onDrop,
  onEndDrag,
  onOpen,
  onStartDrag,
}: {
  done?: boolean;
  dragged: boolean;
  item: TodoOccurrence;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onDrop?: (targetId: string) => void;
  onEndDrag: () => void;
  onOpen: () => void;
  onStartDrag?: () => void;
}) {
  function startDrag(event: DragEvent<HTMLElement>) {
    if (done) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    onStartDrag?.();
  }

  return (
    <li
      className={`todo-item task-card ${done ? "is-done" : ""} ${dragged ? "is-dragging" : ""}`}
      draggable={!done}
      onClick={onOpen}
      onDragOver={(event) => event.preventDefault()}
      onDragStart={startDrag}
      onDragEnd={onEndDrag}
      onDrop={(event) => {
        event.stopPropagation();
        onDrop?.(item.id);
      }}
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
