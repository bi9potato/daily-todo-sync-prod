import { FormEvent, useMemo, useState } from "react";
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
      <section className="auth-panel">
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
  const [newText, setNewText] = useState("");
  const [newReminderTime, setNewReminderTime] = useState("");
  const [newRepeatKind, setNewRepeatKind] = useState<RepeatKind>("none");
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

  const createMutation = useMutation({
    mutationFn: () => {
      const selected = fromDateKey(selectedDate);
      const repeat =
        newRepeatKind === "none"
          ? undefined
          : {
              kind: newRepeatKind,
              interval: 1,
              daysOfWeek: newRepeatKind === "weekly" ? [(selected.getDay() + 6) % 7] : [],
              until: null,
            };

      return createTask(
        selectedDate,
        {
          text: newText,
          reminderTime: newReminderTime || null,
          repeat,
        },
        accessToken,
      );
    },
    onSuccess: () => {
      setNewText("");
      queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      done?: boolean;
      text?: string;
      reminderTime?: string | null;
      repeat?: TodoOccurrence["repeat"];
    }) => {
      const { id, ...changes } = payload;
      return updateOccurrence(id, changes, accessToken);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["range"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOccurrence(id, accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["range"] }),
  });

  const reorderMutation = useMutation({
    mutationFn: (payload: { date: string; orderedIds: string[] }) =>
      reorderDay(payload.date, payload.orderedIds, accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["range"] }),
  });

  function addTask(event: FormEvent) {
    event.preventDefault();

    if (newText.trim()) {
      createMutation.mutate();
    }
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
    if (viewMode === "day") {
      return selectedDate === today ? "今天" : selectedDate;
    }
    if (viewMode === "week") {
      return `${visibleRange.start} - ${visibleRange.end}`;
    }
    return selectedDate.slice(0, 7);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Daily Todo Sync</p>
          <h1>{viewTitle()}</h1>
          <p className="muted">
            {meQuery.data ? `${meQuery.data.username} 的 todolist` : "加载账户..."}
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
          <button type="button" onClick={() => setSelectedDate(today)}>
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

      <div className="view-toggle" role="group" aria-label="视图切换">
        {(["day", "week", "month"] as ViewMode[]).map((mode) => (
          <button
            className={viewMode === mode ? "active" : ""}
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
          >
            {mode === "day" ? "日" : mode === "week" ? "周" : "月"}
          </button>
        ))}
      </div>

      <section className="list-section composer-section">
        <div className="section-heading">
          <div>
            <h2>待处理</h2>
            <p className="muted">新增到当前选中日期；未完成项会在当天结束后进入下一天。</p>
          </div>
        </div>

        <form className="add-row composer-row" onSubmit={addTask}>
          <input
            value={newText}
            onChange={(event) => setNewText(event.target.value)}
            placeholder="新增待处理..."
            maxLength={280}
          />
          <input
            aria-label="提醒时间"
            type="time"
            value={newReminderTime}
            onChange={(event) => setNewReminderTime(event.target.value)}
          />
          <select
            aria-label="重复规则"
            value={newRepeatKind}
            onChange={(event) => setNewRepeatKind(event.target.value as RepeatKind)}
          >
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="submit" aria-label="新增">
            +
          </button>
        </form>
      </section>

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
            onMetaChange={(id, changes) => updateMutation.mutate({ id, ...changes })}
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
            onSelectDate={setSelectedDate}
            onStartDrag={(date, id) => setDraggedCard({ date, id })}
          />
        ))}
      </section>
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
  onMetaChange,
  onDropCard,
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
  onMetaChange: (
    id: string,
    changes: { reminderTime?: string | null; repeat?: TodoOccurrence["repeat"] },
  ) => void;
  onDropCard: (date: string, targetId: string | null) => void;
  onSelectDate: (date: string) => void;
  onStartDrag: (date: string, id: string) => void;
}) {
  return (
    <article className={`day-column ${isSelected ? "is-selected" : ""}`}>
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
            onMetaChange={onMetaChange}
            onDrop={(targetId) => onDropCard(date, targetId)}
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
                onMetaChange={onMetaChange}
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
  onMetaChange,
  onDrop,
  onStartDrag,
}: {
  done?: boolean;
  dragged: boolean;
  item: TodoOccurrence;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onMetaChange: (
    id: string,
    changes: { reminderTime?: string | null; repeat?: TodoOccurrence["repeat"] },
  ) => void;
  onDrop?: (targetId: string) => void;
  onStartDrag?: () => void;
}) {
  return (
    <li
      className={`todo-item task-card ${done ? "is-done" : ""} ${dragged ? "is-dragging" : ""}`}
      draggable={!done}
      onDragOver={(event) => event.preventDefault()}
      onDragStart={() => onStartDrag?.()}
      onDrop={(event) => {
        event.stopPropagation();
        onDrop?.(item.id);
      }}
    >
      <span className="drag-handle" aria-hidden="true">
        ::
      </span>
      <input
        type="checkbox"
        checked={done}
        onChange={(event) => onDone(item.id, event.target.checked)}
      />
      <div className="task-body">
        <p>{item.text}</p>
        <div className="task-badges">
          {item.isRecurring ? <span>重复：{repeatLabel(item.repeat.kind)}</span> : null}
          {item.reminderTime ? <span>提醒：{item.reminderTime}</span> : null}
          {item.source === "carryover" ? <span>结转</span> : null}
          {item.source === "recurring" ? <span>重复生成</span> : null}
        </div>
        <p className="muted">首次创建：{new Date(item.firstCreatedAt).toLocaleString()}</p>
        <div className="task-meta-controls">
          <input
            aria-label="修改提醒时间"
            type="time"
            value={item.reminderTime ?? ""}
            onChange={(event) =>
              onMetaChange(item.id, { reminderTime: event.target.value || null })
            }
          />
          <select
            aria-label="修改重复规则"
            value={item.repeat.kind}
            onChange={(event) =>
              onMetaChange(item.id, {
                repeat: repeatRuleForDate(event.target.value as RepeatKind, item.taskDate),
              })
            }
          >
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button type="button" onClick={() => onDelete(item.id)}>
        删除
      </button>
    </li>
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

function repeatLabel(kind: RepeatKind) {
  return REPEAT_OPTIONS.find((option) => option.value === kind)?.label ?? "重复";
}

function repeatRuleForDate(kind: RepeatKind, date: string): TodoOccurrence["repeat"] {
  const selected = fromDateKey(date);
  return {
    kind,
    interval: 1,
    daysOfWeek: kind === "weekly" ? [(selected.getDay() + 6) % 7] : [],
    until: null,
  };
}
