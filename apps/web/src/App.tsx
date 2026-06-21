import {
  useEffect,
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
  authorizeGoogleCalendar,
  bindGoogleAccount,
  createTask,
  deleteOccurrence,
  disconnectGoogleAccount,
  getGoogleCalendarStatus,
  getMe,
  getRange,
  login,
  register,
  reorderDay,
  setGoogleCalendarSyncEnabled,
  syncGoogleCalendar,
  updateOccurrence,
  type DayTodos,
  type GoogleCalendarStatus,
  type GoogleCalendarSyncResult,
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
type CalendarViewMode = "day" | "week" | "month";
type ViewMode = CalendarViewMode | "analytics";
type TaskDraftSource = "typed" | "voice" | "ai";

type TaskDraft = {
  confidence: number;
  fields: {
    note?: string;
    reminderTime?: string | null;
    repeat?: RepeatRule;
  };
  locale: string;
  rawText: string;
  source: TaskDraftSource;
  text: string;
};

type VoiceCaptureState =
  | { status: "idle"; message: string }
  | { status: "listening"; message: string }
  | { status: "ready"; message: string }
  | { status: "error"; message: string }
  | { status: "unsupported"; message: string };

type DailyAnalytics = {
  carryover: number;
  completionRate: number;
  date: string;
  done: number;
  pending: number;
  recurring: number;
  reminders: number;
  total: number;
};

type WeekdayAnalytics = {
  completionRate: number;
  done: number;
  label: string;
  total: number;
};

type AnalyticsSnapshot = {
  activeDays: number;
  bestDay: DailyAnalytics | null;
  carryoverRate: number;
  completionRate: number;
  completionStreak: number;
  dailyStats: DailyAnalytics[];
  done: number;
  insights: string[];
  pending: number;
  recurringRate: number;
  reminderCoverage: number;
  total: number;
  weekdayStats: WeekdayAnalytics[];
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionLike = {
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionErrorLike = {
  error?: string;
};

type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  [index: number]: { transcript: string } | undefined;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

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
const LONG_PRESS_TO_DRAG_MS = 320;
const LONG_PRESS_MOVE_CANCEL_PX = 10;

const REPEAT_OPTIONS: { value: RepeatKind; label: string }[] = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
];

const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

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
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isSidebarPinned, setIsSidebarPinned] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const pendingDragRef = useRef<PendingDrag | null>(null);
  const suppressOpenTaskIdRef = useRef<string | null>(null);
  const reorderAnimationFrameRef = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const isAnalytics = viewMode === "analytics";

  const visibleRange = useMemo(() => {
    if (viewMode === "analytics") {
      return { start: addDays(today, -29), end: today };
    }
    if (viewMode === "week") {
      return { start: startOfWeek(selectedDate), end: endOfWeek(selectedDate) };
    }
    if (viewMode === "month") {
      return { start: startOfMonth(selectedDate), end: endOfMonth(selectedDate) };
    }
    return { start: selectedDate, end: selectedDate };
  }, [selectedDate, today, viewMode]);

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

  const googleCalendarStatusQuery = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: () => getGoogleCalendarStatus(accessToken),
    enabled: isSettingsOpen,
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
  const isSidebarExpanded =
    isSidebarPinned || isSidebarHovered || isMobileSidebarOpen;
  const isSidebarCollapsed = !isSidebarExpanded;

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

  const bindGoogleAccountMutation = useMutation({
    mutationFn: () => bindGoogleAccount(accessToken),
    onSuccess: (payload) => {
      window.location.href = payload.authorizationUrl;
    },
  });

  const authorizeGoogleCalendarMutation = useMutation({
    mutationFn: () => authorizeGoogleCalendar(accessToken),
    onSuccess: (payload) => {
      window.location.href = payload.authorizationUrl;
    },
  });

  const disconnectGoogleAccountMutation = useMutation({
    mutationFn: () => disconnectGoogleAccount(accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
    },
  });

  const toggleGoogleCalendarSyncMutation = useMutation({
    mutationFn: (enabled: boolean) => setGoogleCalendarSyncEnabled(enabled, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
    },
  });

  const syncGoogleCalendarMutation = useMutation({
    mutationFn: () => syncGoogleCalendar(accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
    },
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
    if (viewMode === "analytics") {
      return "分析";
    }
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
      <aside
        className="sidebar surface-panel"
        onMouseEnter={() => setIsSidebarHovered(true)}
        onMouseLeave={() => {
          setIsSidebarHovered(false);
          setIsAccountMenuOpen(false);
        }}
      >
        <div className="brand-block">
          <div
            className="account-menu"
            onBlur={(event) => {
              const nextFocus = event.relatedTarget;
              if (
                !(nextFocus instanceof Node) ||
                !event.currentTarget.contains(nextFocus)
              ) {
                setIsAccountMenuOpen(false);
              }
            }}
            onFocus={() => setIsAccountMenuOpen(true)}
            onMouseEnter={() => setIsAccountMenuOpen(true)}
            onMouseLeave={() => setIsAccountMenuOpen(false)}
          >
            <button
              className="account-trigger"
              type="button"
              aria-expanded={isAccountMenuOpen}
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
                <button
                  className="account-menu-item"
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(true);
                    setIsAccountMenuOpen(false);
                  }}
                >
                  <span>Settings</span>
                  <small>连接日历与同步设置</small>
                </button>
                <button className="account-menu-item danger-menu-item" type="button" onClick={onLogout}>
                  登出账户
                </button>
              </div>
            ) : null}
          </div>
          <button
            className={`sidebar-icon-button sidebar-pin-button ${
              isSidebarPinned ? "is-pinned" : ""
            }`}
            type="button"
            aria-label={isSidebarPinned ? "取消固定侧边栏" : "固定侧边栏"}
            aria-pressed={isSidebarPinned}
            onClick={() => setIsSidebarPinned((value) => !value)}
          >
            <PinIcon pinned={isSidebarPinned} />
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
          <button
            className={viewMode === "analytics" ? "active" : ""}
            type="button"
            onClick={() => changeViewMode("analytics")}
          >
            <span className="nav-icon">
              <AnalyticsIcon />
            </span>
            <span className="nav-label">分析</span>
            <small className="nav-meta">近 30 天</small>
          </button>
        </nav>

        <div className="sidebar-section">
          <p>视图</p>
          <div className="sidebar-switch">
            {(["day", "week", "month"] as CalendarViewMode[]).map((mode) => (
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
          <span>{isAnalytics ? "分析范围" : "当前日期"}</span>
          <strong>{isAnalytics ? "近 30 天" : selectedDate}</strong>
          <small>
            {isAnalytics
              ? `${visibleRange.start} - ${visibleRange.end}`
              : weekdayLabel(selectedDate)}
          </small>
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
            {isAnalytics ? (
              <p className="eyebrow">近 30 天</p>
            ) : !isMyDay ? (
              <p className="eyebrow">
                {visibleRange.start === visibleRange.end
                  ? selectedDate
                  : `${visibleRange.start} - ${visibleRange.end}`}
              </p>
            ) : null}
            <h1>{viewTitle()}</h1>
            <p className="muted">
              {isAnalytics
                ? `${visibleRange.start} - ${visibleRange.end} · 单向日历同步策略`
                : `${selectedDate} · ${weekdayLabel(selectedDate)}`}
            </p>
          </div>

          {!isMyDay && !isAnalytics ? (
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

        {!isAnalytics ? (
          <div className="workspace-actions">
            <QuickAddTask
              date={selectedDate}
              isSaving={createMutation.isPending}
              onSubmit={(payload) => createMutation.mutate(payload)}
            />
          </div>
        ) : null}

        {rangeQuery.isLoading ? <p className="empty-state is-visible">加载中...</p> : null}
        {rangeQuery.isError ? (
          <p className="empty-state is-visible">加载失败：{String(rangeQuery.error)}</p>
        ) : null}

        {!rangeQuery.isLoading && !rangeQuery.isError ? (
          isAnalytics ? (
            <AnalyticsDashboard
              days={rangeQuery.data?.days ?? []}
              range={visibleRange}
              today={today}
            />
          ) : (
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
          )
        ) : null}
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

      {isSettingsOpen ? (
        <SettingsModal
          status={googleCalendarStatusQuery.data ?? null}
          syncResult={syncGoogleCalendarMutation.data ?? null}
          isAuthorizingCalendar={authorizeGoogleCalendarMutation.isPending}
          isBindingGoogle={bindGoogleAccountMutation.isPending}
          isDisconnecting={disconnectGoogleAccountMutation.isPending}
          isLoading={googleCalendarStatusQuery.isLoading}
          isSyncing={syncGoogleCalendarMutation.isPending}
          isTogglingSync={toggleGoogleCalendarSyncMutation.isPending}
          error={
            googleCalendarStatusQuery.error ??
            bindGoogleAccountMutation.error ??
            authorizeGoogleCalendarMutation.error ??
            disconnectGoogleAccountMutation.error ??
            toggleGoogleCalendarSyncMutation.error ??
            syncGoogleCalendarMutation.error
          }
          onClose={() => setIsSettingsOpen(false)}
          onAuthorizeCalendar={() => authorizeGoogleCalendarMutation.mutate()}
          onBindGoogle={() => bindGoogleAccountMutation.mutate()}
          onDisconnect={() => disconnectGoogleAccountMutation.mutate()}
          onSync={() => syncGoogleCalendarMutation.mutate()}
          onToggleSync={(enabled) => toggleGoogleCalendarSyncMutation.mutate(enabled)}
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

function AnalyticsDashboard({
  days,
  range,
  today,
}: {
  days: DayTodos[];
  range: { start: string; end: string };
  today: string;
}) {
  const snapshot = useMemo(
    () => buildAnalyticsSnapshot(days, today),
    [days, today],
  );

  return (
    <section className="analytics-dashboard">
      <div className="analytics-hero surface-panel">
        <div>
          <p className="eyebrow">节奏概览</p>
          <h2>把每天的任务流动看清楚</h2>
          <p className="muted">
            {range.start} - {range.end}，共 {snapshot.activeDays} 个有任务的日子。
          </p>
        </div>
        <div className="completion-ring-wrap">
          <div
            className="completion-ring"
            style={{
              background: `conic-gradient(var(--accent) ${snapshot.completionRate}%, rgba(213, 221, 211, 0.72) 0)`,
            }}
          >
            <span>{snapshot.completionRate}%</span>
          </div>
          <small>完成率</small>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="总任务" value={String(snapshot.total)} detail="近 30 天" />
        <MetricCard label="已完成" value={String(snapshot.done)} detail="保持推进" />
        <MetricCard label="待处理" value={String(snapshot.pending)} detail="当前压力" />
        <MetricCard
          label="连续完成"
          value={`${snapshot.completionStreak} 天`}
          detail="有任务且全完成"
        />
      </div>

      <div className="analytics-grid">
        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">趋势</p>
              <h2>完成节奏</h2>
            </div>
            <span>{snapshot.dailyStats.length} 天</span>
          </div>
          <div className="trend-bars" aria-label="近 30 天完成趋势">
            {snapshot.dailyStats.map((day) => (
              <span
                className={day.date === today ? "is-today" : ""}
                key={day.date}
                style={{
                  height: `${Math.max(8, day.completionRate)}%`,
                }}
                title={`${day.date}: ${day.done}/${day.total}`}
              />
            ))}
          </div>
          <div className="trend-footer">
            <span>{formatShortDate(range.start)}</span>
            <span>{formatShortDate(range.end)}</span>
          </div>
        </section>

        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">结构</p>
              <h2>任务质量</h2>
            </div>
          </div>
          <div className="quality-list">
            <QualityMeter label="提醒覆盖" value={snapshot.reminderCoverage} />
            <QualityMeter label="结转压力" value={snapshot.carryoverRate} inverse />
            <QualityMeter label="重复任务" value={snapshot.recurringRate} />
          </div>
        </section>

        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">周内节奏</p>
              <h2>哪天最稳</h2>
            </div>
          </div>
          <div className="weekday-list">
            {snapshot.weekdayStats.map((day) => (
              <div className="weekday-row" key={day.label}>
                <span>{day.label}</span>
                <div className="weekday-track">
                  <i style={{ width: `${day.completionRate}%` }} />
                </div>
                <strong>{day.done}/{day.total}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">洞察</p>
              <h2>下一步建议</h2>
            </div>
          </div>
          <ul className="insight-list">
            {snapshot.insights.map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="calendar-sync-panel surface-panel">
        <div>
          <p className="eyebrow">Google Calendar</p>
          <h2>同步策略：Todo 单向写入日历</h2>
          <p className="muted">
            暂不做双向同步。任务创建和更新后只推送到 Google Calendar，
            Google Calendar 里的改动不会反向修改 Todo。
          </p>
        </div>
        <div className="sync-flow" aria-label="单向同步流程">
          <span>Todo</span>
          <i />
          <span>Google Calendar</span>
        </div>
      </section>
    </section>
  );
}

function MetricCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <section className="metric-card surface-panel">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function QualityMeter({
  inverse = false,
  label,
  value,
}: {
  inverse?: boolean;
  label: string;
  value: number;
}) {
  const score = inverse ? 100 - value : value;
  return (
    <div className="quality-meter">
      <div>
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="meter-track">
        <i
          className={score >= 65 ? "is-strong" : score >= 35 ? "is-medium" : ""}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

function SettingsModal({
  error,
  isAuthorizingCalendar,
  isBindingGoogle,
  isDisconnecting,
  isLoading,
  isSyncing,
  isTogglingSync,
  onAuthorizeCalendar,
  onBindGoogle,
  onClose,
  onDisconnect,
  onSync,
  onToggleSync,
  status,
  syncResult,
}: {
  error: Error | null;
  isAuthorizingCalendar: boolean;
  isBindingGoogle: boolean;
  isDisconnecting: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  isTogglingSync: boolean;
  onAuthorizeCalendar: () => void;
  onBindGoogle: () => void;
  onClose: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  onToggleSync: (enabled: boolean) => void;
  status: GoogleCalendarStatus | null;
  syncResult: GoogleCalendarSyncResult | null;
}) {
  const isGoogleBound = Boolean(status?.googleBound);
  const isCalendarAuthorized = Boolean(status?.calendarAuthorized);
  const isConfigured = Boolean(status?.configured);
  const syncEnabled = Boolean(status?.syncEnabled);
  const toggleDisabled =
    !isConfigured || !isGoogleBound || isAuthorizingCalendar || isTogglingSync;

  function toggleCalendarSync() {
    if (toggleDisabled) {
      return;
    }
    if (!syncEnabled && !isCalendarAuthorized) {
      onAuthorizeCalendar();
      return;
    }
    onToggleSync(!syncEnabled);
  }

  return (
    <ModalShell title="Settings" onClose={onClose}>
      <div className="settings-body">
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="eyebrow">Google Account</p>
              <h3>绑定 Google 账户</h3>
            </div>
            <span
              className={`integration-status ${
                isGoogleBound ? "is-connected" : "is-muted"
              }`}
            >
              {isLoading
                ? "检查中"
                : isGoogleBound
                  ? "已绑定"
                  : isConfigured
                    ? "未绑定"
                    : "暂未开启"}
            </span>
          </div>

          <p className="muted">
            先绑定 Google 账户，再开启 Calendar 单向同步。普通用户只需要登录 Google
            并授权，不需要自己获取 token 或密钥。
          </p>

          {isGoogleBound ? (
            <div className="bound-account">
              <span className="brand-mark google-mark">G</span>
              <div>
                <strong>{status?.googleName || "Google 账户"}</strong>
                <small>{status?.googleEmail || "已绑定"}</small>
              </div>
            </div>
          ) : null}

          {!isConfigured ? (
            <p className="settings-note">
              Google 登录暂未开启。等应用侧开启后，你只需要登录 Google 账号并授权，
              不需要自己获取任何 token 或密钥。
            </p>
          ) : null}

          <div className="settings-actions">
            {!isGoogleBound ? (
              <button
                className="primary-button"
                type="button"
                disabled={!isConfigured || isBindingGoogle}
                onClick={onBindGoogle}
              >
                {isBindingGoogle
                  ? "正在跳转..."
                  : isConfigured
                    ? "绑定 Google 账户"
                    : "Google 登录暂未开启"}
              </button>
            ) : (
              <button
                className="ghost-button"
                type="button"
                disabled={isDisconnecting}
                onClick={onDisconnect}
              >
                {isDisconnecting ? "取消绑定中..." : "取消绑定 Google 账户"}
              </button>
            )}
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="eyebrow">Google Calendar</p>
              <h3>单向同步</h3>
            </div>
            <button
              className={`toggle-switch ${syncEnabled ? "is-on" : ""}`}
              type="button"
              aria-label={syncEnabled ? "关闭 Google Calendar 同步" : "开启 Google Calendar 同步"}
              aria-pressed={syncEnabled}
              disabled={toggleDisabled}
              onClick={toggleCalendarSync}
            >
              <span />
            </button>
          </div>

          <p className="muted">
            开启后，有提醒时间的任务会写入 Google Calendar。Google Calendar
            里的修改不会反向覆盖 Todo。
          </p>

          {!isGoogleBound ? (
            <p className="settings-note">请先绑定 Google 账户，之后才能开启 Calendar 同步。</p>
          ) : !isCalendarAuthorized ? (
            <p className="settings-note">
              开启同步时会跳转到 Google 授权 Calendar 权限。授权后开关会自动打开。
            </p>
          ) : null}

          {status ? (
            <div className="integration-stats">
              <span>
                日历
                <strong>{status.calendarId}</strong>
              </span>
              <span>
                已同步
                <strong>{status.syncedCount}</strong>
              </span>
              <span>
                失败
                <strong>{status.failedCount}</strong>
              </span>
            </div>
          ) : null}

          {status?.lastSyncAt ? (
            <p className="settings-note">
              上次同步：{new Date(status.lastSyncAt).toLocaleString()}
            </p>
          ) : null}

          {syncResult ? (
            <p className="settings-note">
              刚刚同步 {syncResult.synced} 个任务，范围 {syncResult.start} -{" "}
              {syncResult.end}。
            </p>
          ) : null}

          {status?.lastError ? (
            <p className="settings-error">{status.lastError}</p>
          ) : null}
          {error ? <p className="settings-error">{error.message}</p> : null}

          <div className="settings-actions">
            <button
              className="primary-button"
              type="button"
              disabled={!syncEnabled || isSyncing}
              onClick={onSync}
            >
              {isSyncing ? "同步中..." : "同步未来 45 天"}
            </button>
            {isAuthorizingCalendar ? (
              <span className="settings-inline-status">正在前往 Google 授权...</span>
            ) : null}
          </div>
        </section>
      </div>
    </ModalShell>
  );
}

function QuickAddTask({
  date,
  isSaving,
  onSubmit,
}: {
  date: string;
  isSaving: boolean;
  onSubmit: (payload: {
    date: string;
    text: string;
    note: string;
    reminderTime: string | null;
    repeat: RepeatRule;
  }) => void;
}) {
  const [text, setText] = useState("");
  const [inputSource, setInputSource] = useState<TaskDraftSource>("typed");
  const [voiceState, setVoiceState] = useState<VoiceCaptureState>({
    status: "idle",
    message: "语音输入",
  });
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const latestTranscriptRef = useRef("");
  const isListening = voiceState.status === "listening";

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const draft = createTaskDraftFromInput(text, inputSource, date);
    if (!draft.text || isSaving) {
      return;
    }
    onSubmit({
      date,
      text: draft.text,
      note: draft.fields.note ?? "",
      reminderTime: draft.fields.reminderTime ?? null,
      repeat: draft.fields.repeat ?? repeatRuleForDate("none", date),
    });
    setText("");
    setInputSource("typed");
    setVoiceState({ status: "idle", message: "语音输入" });
  }

  function updateText(value: string) {
    setInputSource("typed");
    setText(value);
    if (voiceState.status !== "listening") {
      setVoiceState({ status: "idle", message: "语音输入" });
    }
  }

  function toggleVoiceInput() {
    if (isListening) {
      recognitionRef.current?.stop();
      setVoiceState({ status: "ready", message: "已停止听写" });
      return;
    }

    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setVoiceState({
        status: "unsupported",
        message: "当前浏览器不支持语音输入",
      });
      return;
    }

    const recognition = new SpeechRecognition();
    latestTranscriptRef.current = "";
    recognitionRef.current = recognition;
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setInputSource("voice");
      setVoiceState({ status: "listening", message: "正在听写..." });
    };
    recognition.onresult = (event) => {
      const transcript = transcriptFromSpeechEvent(event);
      if (!transcript) {
        return;
      }
      latestTranscriptRef.current = transcript;
      const draft = createTaskDraftFromInput(transcript, "voice", date);
      setInputSource("voice");
      setText(draft.text);
      setVoiceState({
        status: draft.text ? "ready" : "listening",
        message: draft.text ? "已识别语音" : "正在听写...",
      });
    };
    recognition.onerror = (event) => {
      setVoiceState({
        status: "error",
        message: voiceErrorMessage(event.error),
      });
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setVoiceState((current) => {
        if (current.status === "error" || current.status === "unsupported") {
          return current;
        }
        return latestTranscriptRef.current
          ? { status: "ready", message: "已识别语音" }
          : { status: "idle", message: "语音输入" };
      });
    };
    recognition.start();
  }

  return (
    <form className="quick-add-form surface-panel" onSubmit={submit}>
      <span className="quick-add-title">添加任务</span>
      <input
        aria-label="添加任务"
        value={text}
        onChange={(event) => updateText(event.target.value)}
        placeholder="输入任务，按 Enter 添加"
        maxLength={280}
        disabled={isSaving}
      />
      <button
        className={`voice-button ${isListening ? "is-listening" : ""}`}
        type="button"
        aria-label={isListening ? "停止语音输入" : "开始语音输入"}
        aria-pressed={isListening}
        onClick={toggleVoiceInput}
        title={voiceState.message}
      >
        <MicIcon active={isListening} />
      </button>
      <button
        className="quick-add-submit"
        type="submit"
        aria-label="提交任务"
        disabled={isSaving || !text.trim()}
      >
        +
      </button>
    </form>
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

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg
      className={`mini-icon pin-icon ${pinned ? "is-pinned" : ""}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 17v5" />
      <path d="M5 17h14" />
      <path d="M8 3h8l-1 8 3 3v3H6v-3l3-3Z" />
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

function AnalyticsIcon() {
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
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16v-5" />
      <path d="M12 16V8" />
      <path d="M16 16v-9" />
    </svg>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`mini-icon mic-icon ${active ? "is-active" : ""}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
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

function buildAnalyticsSnapshot(days: DayTodos[], today: string): AnalyticsSnapshot {
  const dailyStats = [...days]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => {
      const items = orderedDayItems(day);
      const done = items.filter((item) => item.status === "done").length;
      const pending = items.length - done;
      const carryover = items.filter((item) => item.source === "carryover").length;
      const recurring = items.filter((item) => item.isRecurring).length;
      const reminders = items.filter((item) => Boolean(item.reminderTime)).length;
      return {
        carryover,
        completionRate: percentage(done, items.length),
        date: day.date,
        done,
        pending,
        recurring,
        reminders,
        total: items.length,
      };
    });

  const total = dailyStats.reduce((sum, day) => sum + day.total, 0);
  const done = dailyStats.reduce((sum, day) => sum + day.done, 0);
  const pending = dailyStats.reduce((sum, day) => sum + day.pending, 0);
  const carryover = dailyStats.reduce((sum, day) => sum + day.carryover, 0);
  const recurring = dailyStats.reduce((sum, day) => sum + day.recurring, 0);
  const reminders = dailyStats.reduce((sum, day) => sum + day.reminders, 0);
  const activeDays = dailyStats.filter((day) => day.total > 0).length;
  const completionRate = percentage(done, total);
  const carryoverRate = percentage(carryover, total);
  const reminderCoverage = percentage(reminders, total);
  const recurringRate = percentage(recurring, total);
  const bestDay =
    dailyStats
      .filter((day) => day.total > 0)
      .sort((left, right) => {
        if (right.completionRate !== left.completionRate) {
          return right.completionRate - left.completionRate;
        }
        return right.done - left.done;
      })[0] ?? null;
  const weekdayStats = buildWeekdayStats(dailyStats);

  const snapshot = {
    activeDays,
    bestDay,
    carryoverRate,
    completionRate,
    completionStreak: completionStreak(dailyStats, today),
    dailyStats,
    done,
    insights: [],
    pending,
    recurringRate,
    reminderCoverage,
    total,
    weekdayStats,
  };

  return {
    ...snapshot,
    insights: buildAnalyticsInsights(snapshot),
  };
}

function buildWeekdayStats(dailyStats: DailyAnalytics[]): WeekdayAnalytics[] {
  return WEEKDAY_NAMES.map((label, index) => {
    const matchedDays = dailyStats.filter(
      (day) => (fromDateKey(day.date).getDay() + 6) % 7 === index,
    );
    const total = matchedDays.reduce((sum, day) => sum + day.total, 0);
    const done = matchedDays.reduce((sum, day) => sum + day.done, 0);
    return {
      completionRate: percentage(done, total),
      done,
      label,
      total,
    };
  });
}

function completionStreak(dailyStats: DailyAnalytics[], today: string) {
  let streak = 0;
  for (const day of [...dailyStats].reverse()) {
    if (day.date > today || day.total === 0) {
      continue;
    }
    if (day.pending > 0) {
      break;
    }
    streak += 1;
  }
  return streak;
}

function buildAnalyticsInsights(
  snapshot: Omit<AnalyticsSnapshot, "insights">,
) {
  if (snapshot.total === 0) {
    return ["先记录几个任务，分析页会自动形成你的节奏画像。"];
  }

  const insights: string[] = [];
  if (snapshot.completionRate >= 80) {
    insights.push("完成率很稳，可以开始把重复任务和提醒做得更精细。");
  } else if (snapshot.completionRate >= 50) {
    insights.push("整体推进正常，建议每天只保留少量真正关键的待处理项。");
  } else {
    insights.push("待处理压力偏高，适合先清理低价值任务，再安排新的任务。");
  }

  if (snapshot.carryoverRate >= 35) {
    insights.push("结转任务占比偏高，说明部分任务需要拆小或重新定义完成标准。");
  }

  if (snapshot.reminderCoverage <= 20 && snapshot.pending >= 5) {
    insights.push("提醒覆盖较低，重要任务可以加提醒，降低靠记忆维护的成本。");
  }

  if (snapshot.recurringRate > 0) {
    insights.push("已有重复任务结构，后续接 Google Calendar 时适合优先同步这类任务。");
  }

  if (snapshot.bestDay) {
    insights.push(
      `${formatShortDate(snapshot.bestDay.date)} 是近期表现最好的日期，可参考那天的任务密度。`,
    );
  }

  return insights.slice(0, 4);
}

function percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function createTaskDraftFromInput(
  rawText: string,
  source: TaskDraftSource,
  date: string,
): TaskDraft {
  const text = rawText.replace(/\s+/g, " ").trim();
  // This draft contract is intentionally richer than today's create API.
  // Later the AI parser can fill fields without changing the quick-add UI.
  return {
    confidence: source === "typed" ? 1 : 0.72,
    fields: {
      reminderTime: null,
      repeat: repeatRuleForDate("none", date),
    },
    locale: "zh-CN",
    rawText,
    source,
    text,
  };
}

function getSpeechRecognitionConstructor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function transcriptFromSpeechEvent(event: SpeechRecognitionResultEventLike) {
  let transcript = "";
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    transcript += event.results[index]?.[0]?.transcript ?? "";
  }
  return transcript.trim();
}

function voiceErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "麦克风权限被拒绝";
  }
  if (error === "no-speech") {
    return "没有识别到语音";
  }
  if (error === "network") {
    return "语音服务网络异常";
  }
  return "语音输入失败";
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
