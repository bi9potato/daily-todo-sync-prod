import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type CSSProperties,
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
  ACCESS_TOKEN_KEY,
  AUTH_TOKENS_UPDATED_EVENT,
  bindGoogleAccount,
  chatWithAi,
  clearTrash,
  copyLongTermOccurrenceAsRegular,
  createTask,
  deleteTaskAttachment,
  deleteOccurrence,
  disconnectGoogleAccount,
  getGoogleCalendarStatus,
  getMe,
  getTaskAttachmentBlob,
  getRange,
  getTrash,
  login,
  register,
  REFRESH_TOKEN_KEY,
  reorderDay,
  reorderTaskAttachments,
  restoreOccurrence,
  SESSION_EXPIRED_EVENT,
  setGoogleCalendarSyncEnabled,
  startGoogleAuth,
  syncGoogleCalendarForDays,
  updateMe,
  updateOccurrence,
  uploadTaskAttachment,
  type DeletedTodoOccurrence,
  type DayTodos,
  type GoogleCalendarStatus,
  type GoogleCalendarSyncResult,
  type GoogleCalendarAccount,
  type RangeTodos,
  type RepeatKind,
  type RepeatRule,
  type TaskAttachment,
  type TodoOccurrence,
  type User,
} from "./api";
import { AnalyticsDashboard } from "./analytics";
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
import {
  AnalyticsIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  GripIcon,
  ImageIcon,
  MenuIcon,
  MicIcon,
  PinIcon,
  SendIcon,
  SparklesIcon,
  SunIcon,
  TagIcon,
  TrashIcon,
} from "./icons";

type AuthMode = "login" | "register";
type CalendarViewMode = "day" | "week" | "month";
type SpecialTaskViewMode = "long-term" | "low-priority";
type ViewMode = CalendarViewMode | SpecialTaskViewMode | "my-day" | "analytics";
type TaskDraftSource = "typed" | "voice" | "ai";
type TaskSection = "long-term" | "regular" | "low-priority";

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

type CalendarTimedItem = {
  item: TodoOccurrence;
  lane: number;
  laneCount: number;
  minutes: number;
};

type CalendarTaskBuckets = {
  allDay: TodoOccurrence[];
  timed: CalendarTimedItem[];
};

type GoogleCalendarNotice = {
  tone: "error" | "success";
  message: string;
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
  targetSection: TaskSection | null;
  width: number;
  x: number;
  y: number;
};

type PendingDrag = {
  state: DragState;
  timeoutId: number;
};

type UpdateOccurrencePayload = {
  id: string;
  done?: boolean;
  text?: string;
  note?: string;
  pinned?: boolean;
  isLongTerm?: boolean;
  isLowPriority?: boolean;
  reminderTime?: string | null;
  repeat?: RepeatRule;
};

type UpdateOccurrenceContext = {
  previousRanges: Array<[QueryKey, RangeTodos | undefined]>;
};

type DeleteTaskPayload = {
  id: string;
  text: string;
};

type TaskActionMessage = {
  message: string;
  tone: "success" | "error";
};

type CompletionOverride = {
  done: boolean;
  version: number;
};

type PinOverride = {
  pinned: boolean;
  version: number;
};

type ReorderPayload = {
  date: string;
  orderedIds: string[];
};

type ReorderContext = {
  previousRanges: Array<[QueryKey, RangeTodos | undefined]>;
};

type AttachmentUploadPayload = {
  file: File;
  occurrenceId: string;
};

type AttachmentDeletePayload = {
  attachmentId: string;
  occurrenceId: string;
};

type AttachmentReorderPayload = {
  occurrenceId: string;
  orderedIds: string[];
};

type AttachmentMutationContext = {
  previousRanges: Array<[QueryKey, RangeTodos | undefined]>;
};

const LONG_PRESS_TO_DRAG_MS = 320;
const LONG_PRESS_MOVE_CANCEL_PX = 10;
const TOUCH_LONG_PRESS_MOVE_CANCEL_PX = 24;
const DRAG_EDGE_SCROLL_ZONE_PX = 84;
const DRAG_EDGE_SCROLL_MAX_PX = 18;
const CALENDAR_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const CALENDAR_MINUTES_PER_DAY = 24 * 60;
const CALENDAR_EVENT_HEIGHT = 42;
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
type GoogleCalendarSyncDays = number;

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
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  function saveTokens(tokens: { accessToken: string; refreshToken: string }) {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    setAccessToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);
    setAuthNotice(null);
  }

  function logout() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setAccessToken(null);
    setRefreshToken(null);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleAuth = params.get("googleAuth");
    if (googleAuth) {
      if (googleAuth === "success") {
        const nextAccessToken = params.get("accessToken");
        const nextRefreshToken = params.get("refreshToken");
        if (nextAccessToken && nextRefreshToken) {
          saveTokens({
            accessToken: nextAccessToken,
            refreshToken: nextRefreshToken,
          });
        }
      } else {
        setAuthNotice(params.get("message") || "Google 登录失败，请重试。");
      }
      params.delete("googleAuth");
      params.delete("accessToken");
      params.delete("refreshToken");
      params.delete("message");
      const nextSearch = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${
          window.location.hash
        }`,
      );
    }

    function handleTokensUpdated(event: Event) {
      const tokens = (event as CustomEvent<{ accessToken: string; refreshToken: string }>).detail;
      if (!tokens) {
        return;
      }
      setAccessToken(tokens.accessToken);
      setRefreshToken(tokens.refreshToken);
      setAuthNotice(null);
    }

    function handleSessionExpired() {
      setAccessToken(null);
      setRefreshToken(null);
      setAuthNotice("登录已过期，请重新登录。");
    }

    window.addEventListener(AUTH_TOKENS_UPDATED_EVENT, handleTokensUpdated);
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(AUTH_TOKENS_UPDATED_EVENT, handleTokensUpdated);
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  if (!accessToken || !refreshToken) {
    return <AuthScreen notice={authNotice} onAuthed={saveTokens} />;
  }

  return <TodoScreen accessToken={accessToken} onLogout={logout} />;
}

function AuthScreen({
  notice,
  onAuthed,
}: {
  notice: string | null;
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

  const googleAuthMutation = useMutation({
    mutationFn: () => startGoogleAuth(),
    onSuccess: (payload) => {
      window.location.href = payload.authorizationUrl;
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Google 登录失败"),
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
          {notice ? <p className="settings-note">{notice}</p> : null}
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
          <button
            className="google-auth-button"
            disabled={googleAuthMutation.isPending}
            type="button"
            onClick={() => googleAuthMutation.mutate()}
          >
            <span className="brand-mark google-mark">G</span>
            {googleAuthMutation.isPending ? "正在前往 Google..." : "使用 Google 继续"}
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
  const [viewMode, setViewMode] = useState<ViewMode>("my-day");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isSidebarPinned, setIsSidebarPinned] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLongTermSectionOpen, setIsLongTermSectionOpen] = useState(false);
  const [isLowPrioritySectionOpen, setIsLowPrioritySectionOpen] = useState(false);
  const [appUpdateNotice, setAppUpdateNotice] = useState("");
  const [googleCalendarNotice, setGoogleCalendarNotice] =
    useState<GoogleCalendarNotice | null>(null);
  const [googleCalendarSyncDays, setGoogleCalendarSyncDays] =
    useState<GoogleCalendarSyncDays>(45);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pendingDeleteTask, setPendingDeleteTask] =
    useState<DeleteTaskPayload | null>(null);
  const [undoDeleteCandidate, setUndoDeleteCandidate] =
    useState<DeleteTaskPayload | null>(null);
  const [taskActionMessage, setTaskActionMessage] =
    useState<TaskActionMessage | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [completionOverrides, setCompletionOverrides] = useState<
    Record<string, CompletionOverride>
  >({});
  const [pinOverrides, setPinOverrides] = useState<Record<string, PinOverride>>({});
  const pendingDragRef = useRef<PendingDrag | null>(null);
  const suppressOpenTaskIdRef = useRef<string | null>(null);
  const reorderAnimationFrameRef = useRef<number | null>(null);
  const dragScrollFrameRef = useRef<number | null>(null);
  const completionOverrideVersionRef = useRef(0);
  const pinOverrideVersionRef = useRef(0);
  const hasScheduledReloadRef = useRef(false);
  const undoDeleteTimerRef = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const isAnalytics = viewMode === "analytics";
  const specialTaskSection: SpecialTaskViewMode | null =
    viewMode === "long-term" || viewMode === "low-priority" ? viewMode : null;

  const visibleRange = useMemo(() => {
    if (viewMode === "analytics") {
      return { start: today, end: today };
    }
    if (viewMode === "week") {
      return { start: startOfWeek(selectedDate), end: endOfWeek(selectedDate) };
    }
    if (viewMode === "month") {
      const monthStart = startOfMonth(selectedDate);
      const monthEnd = endOfMonth(selectedDate);
      return { start: startOfWeek(monthStart), end: endOfWeek(monthEnd) };
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
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const googleCalendarStatusQuery = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: () => getGoogleCalendarStatus(accessToken),
    enabled: isSettingsOpen,
  });

  const trashQuery = useQuery({
    queryKey: ["trash"],
    queryFn: () => getTrash(accessToken),
    enabled: isSettingsOpen,
  });

  const displayRangeData = useMemo(
    () => applyPinOverridesToRange(rangeQuery.data, pinOverrides),
    [pinOverrides, rangeQuery.data],
  );

  const daysByDate = useMemo(() => {
    return new Map(displayRangeData?.days.map((day) => [day.date, day]) ?? []);
  }, [displayRangeData]);

  const todayLongTermCount = useMemo(() => {
    const day = daysByDate.get(today);
    if (!day) {
      return 0;
    }
    return [...day.pending, ...day.done].filter((item) => item.isLongTerm).length;
  }, [daysByDate, today]);

  const todayLowPriorityCount = useMemo(() => {
    const day = daysByDate.get(today);
    if (!day) {
      return 0;
    }
    return [...day.pending, ...day.done].filter(
      (item) => !item.isLongTerm && item.isLowPriority,
    ).length;
  }, [daysByDate, today]);

  const allTasks = useMemo(() => {
    return displayRangeData?.days.flatMap((day) => [...day.pending, ...day.done]) ?? [];
  }, [displayRangeData]);

  const selectedTask = allTasks.find((item) => item.id === selectedTaskId) ?? null;
  const draggedTask =
    dragState?.active ? allTasks.find((item) => item.id === dragState.id) ?? null : null;
  const isMyDay = viewMode === "my-day";
  const isSidebarExpanded =
    isSidebarPinned || isSidebarHovered || isMobileSidebarOpen;
  const isSidebarCollapsed = !isSidebarExpanded;
  const accountDisplayName = meQuery.data?.displayName ?? meQuery.data?.username ?? "账户";
  const accountInitial = accountDisplayName.trim().charAt(0).toUpperCase() || "D";

  useEffect(() => {
    if (!dragState?.active) {
      stopDragEdgeScroll();
      return undefined;
    }

    function preventNativeTouchScroll(event: TouchEvent) {
      event.preventDefault();
    }

    document.body.classList.add("is-task-dragging");
    document.addEventListener("touchmove", preventNativeTouchScroll, {
      passive: false,
    });

    return () => {
      document.body.classList.remove("is-task-dragging");
      document.removeEventListener("touchmove", preventNativeTouchScroll);
      stopDragEdgeScroll();
    };
  }, [dragState?.active]);

  useEffect(() => {
    const currentAssetSignature = [...document.querySelectorAll("script[src], link[href]")]
      .map((element) => element.getAttribute("src") || element.getAttribute("href") || "")
      .filter((value) => value.includes("/assets/"))
      .sort()
      .join("|");

    async function checkForUpdate() {
      if (hasScheduledReloadRef.current || !currentAssetSignature) {
        return;
      }
      try {
        const response = await fetch(`/?update-check=${Date.now()}`, {
          cache: "no-store",
        });
        const html = await response.text();
        const nextAssetSignature = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)]
          .map((match) => match[1])
          .sort()
          .join("|");
        if (nextAssetSignature && nextAssetSignature !== currentAssetSignature) {
          hasScheduledReloadRef.current = true;
          setAppUpdateNotice("发现新版本，正在更新界面...");
          window.setTimeout(() => window.location.reload(), 1200);
        }
      } catch {
        // The app can keep running on the current bundle if the update check fails.
      }
    }

    const intervalId = window.setInterval(checkForUpdate, 60_000);
    void checkForUpdate();
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    return () => {
      if (undoDeleteTimerRef.current !== null) {
        window.clearTimeout(undoDeleteTimerRef.current);
      }
    };
  }, []);

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
      setTaskActionMessage(null);
      queryClient.invalidateQueries({ queryKey: ["range"] });
    },
    onError: (error) => {
      setTaskActionMessage({
        tone: "error",
        message: error.message || "新增任务失败，请稍后再试。",
      });
    },
  });

  const copyLongTermMutation = useMutation<TodoOccurrence, Error, string>({
    mutationFn: (id) => copyLongTermOccurrenceAsRegular(id, accessToken),
    onSuccess: (created) => {
      setTaskActionMessage({
        tone: "success",
        message: "已复制到普通任务。",
      });
      queryClient.setQueriesData<RangeTodos>({ queryKey: ["range"] }, (data) =>
        applyOccurrenceInsert(data, created),
      );
      queryClient.invalidateQueries({ queryKey: ["range"] });
    },
    onError: (error) => {
      setTaskActionMessage({
        tone: "error",
        message: error.message || "复制长期任务失败，请稍后再试。",
      });
    },
  });

  const updateMutation = useMutation<
    TodoOccurrence,
    Error,
    UpdateOccurrencePayload,
    UpdateOccurrenceContext
  >({
    mutationFn: (payload) => {
      const { id, ...changes } = payload;
      return updateOccurrence(id, changes, accessToken);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ["range"] });
      const previousRanges = queryClient.getQueriesData<RangeTodos>({
        queryKey: ["range"],
      });

      queryClient.setQueriesData<RangeTodos>({ queryKey: ["range"] }, (data) =>
        applyOptimisticOccurrenceUpdate(data, payload),
      );

      return { previousRanges };
    },
    onError: (error, _payload, context) => {
      context?.previousRanges.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      setTaskActionMessage({
        tone: "error",
        message: error.message || "任务更新失败，请稍后再试。",
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueriesData<RangeTodos>({ queryKey: ["range"] }, (data) =>
        applyServerOccurrenceUpdate(data, updated),
      );
    },
  });

  const uploadAttachmentMutation = useMutation<
    TaskAttachment,
    Error,
    AttachmentUploadPayload
  >({
    mutationFn: ({ occurrenceId, file }) =>
      uploadTaskAttachment(occurrenceId, file, accessToken),
    onSuccess: (attachment, payload) => {
      queryClient.setQueriesData<RangeTodos>({ queryKey: ["range"] }, (data) =>
        applyAttachmentAdd(data, payload.occurrenceId, attachment),
      );
    },
  });

  const deleteAttachmentMutation = useMutation<
    void,
    Error,
    AttachmentDeletePayload,
    AttachmentMutationContext
  >({
    mutationFn: ({ attachmentId, occurrenceId }) =>
      deleteTaskAttachment(attachmentId, accessToken, occurrenceId),
    onMutate: (payload) => {
      void queryClient.cancelQueries({ queryKey: ["range"] });
      const previousRanges = queryClient.getQueriesData<RangeTodos>({
        queryKey: ["range"],
      });

      queryClient.setQueriesData<RangeTodos>({ queryKey: ["range"] }, (data) =>
        applyAttachmentRemove(data, payload.occurrenceId, payload.attachmentId),
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

  const reorderAttachmentsMutation = useMutation<
    void,
    Error,
    AttachmentReorderPayload,
    AttachmentMutationContext
  >({
    mutationFn: ({ occurrenceId, orderedIds }) =>
      reorderTaskAttachments(occurrenceId, orderedIds, accessToken),
    onMutate: (payload) => {
      void queryClient.cancelQueries({ queryKey: ["range"] });
      const previousRanges = queryClient.getQueriesData<RangeTodos>({
        queryKey: ["range"],
      });

      queryClient.setQueriesData<RangeTodos>({ queryKey: ["range"] }, (data) =>
        applyAttachmentOrder(data, payload.occurrenceId, payload.orderedIds),
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

  function updateTaskDone(id: string, done: boolean) {
    const version = completionOverrideVersionRef.current + 1;
    completionOverrideVersionRef.current = version;

    flushSync(() => {
      setCompletionOverrides((current) => ({
        ...current,
        [id]: { done, version },
      }));
    });

    window.setTimeout(() => {
      updateMutation.mutate(
        { id, done },
        {
          onSettled: () => {
            setCompletionOverrides((current) => {
              if (current[id]?.version !== version) {
                return current;
              }

              const next = { ...current };
              delete next[id];
              return next;
            });
          },
        },
      );
    }, 0);
  }

  function updateTaskPinned(id: string, pinned: boolean) {
    const item = allTasks.find((task) => task.id === id);
    const before = item ? measureTaskRects(item.taskDate) : null;
    const version = pinOverrideVersionRef.current + 1;
    pinOverrideVersionRef.current = version;

    flushSync(() => {
      setPinOverrides((current) => ({
        ...current,
        [id]: { pinned, version },
      }));
    });

    updateMutation.mutate(
      { id, pinned },
      {
        onSettled: () => {
          setPinOverrides((current) => {
            if (current[id]?.version !== version) {
              return current;
            }

            const next = { ...current };
            delete next[id];
            return next;
          });
        },
      },
    );
    if (item && before) {
      animateReorderFrom(item.taskDate, null, before);
    }
  }

  function requestDeleteTask(id: string) {
    const item = allTasks.find((task) => task.id === id);
    setPendingDeleteTask({
      id,
      text: item?.text ?? "这个任务",
    });
  }

  function confirmDeleteTask() {
    if (!pendingDeleteTask || deleteMutation.isPending) {
      return;
    }
    deleteMutation.mutate(pendingDeleteTask);
  }

  function restoreDeletedTask(id: string) {
    if (restoreMutation.isPending) {
      return;
    }
    restoreMutation.mutate(id);
  }

  const deleteMutation = useMutation<void, Error, DeleteTaskPayload>({
    mutationFn: (payload) => deleteOccurrence(payload.id, accessToken),
    onSuccess: (_data, payload) => {
      setSelectedTaskId(null);
      setPendingDeleteTask(null);
      setTaskActionMessage(null);
      setUndoDeleteCandidate(payload);
      if (undoDeleteTimerRef.current !== null) {
        window.clearTimeout(undoDeleteTimerRef.current);
      }
      undoDeleteTimerRef.current = window.setTimeout(() => {
        setUndoDeleteCandidate((current) =>
          current?.id === payload.id ? null : current,
        );
        undoDeleteTimerRef.current = null;
      }, 6500);
      queryClient.invalidateQueries({ queryKey: ["range"] });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (error) => {
      setTaskActionMessage({
        tone: "error",
        message: error.message || "删除失败，请稍后再试。",
      });
    },
  });

  const restoreMutation = useMutation<TodoOccurrence, Error, string>({
    mutationFn: (id) => restoreOccurrence(id, accessToken),
    onSuccess: (updated) => {
      setUndoDeleteCandidate(null);
      if (undoDeleteTimerRef.current !== null) {
        window.clearTimeout(undoDeleteTimerRef.current);
        undoDeleteTimerRef.current = null;
      }
      setTaskActionMessage({
        tone: "success",
        message: "任务已恢复。",
      });
      queryClient.setQueriesData<RangeTodos>({ queryKey: ["range"] }, (data) =>
        applyServerOccurrenceUpdate(data, updated),
      );
      queryClient.invalidateQueries({ queryKey: ["range"] });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (error) => {
      setTaskActionMessage({
        tone: "error",
        message: error.message || "恢复失败，请稍后再试。",
      });
    },
  });

  const clearTrashMutation = useMutation<void, Error>({
    mutationFn: () => clearTrash(accessToken),
    onSuccess: () => {
      setTaskActionMessage({
        tone: "success",
        message: "回收站已清空。",
      });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["range"] });
    },
    onError: (error) => {
      setTaskActionMessage({
        tone: "error",
        message: error.message || "清空回收站失败，请稍后再试。",
      });
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
    mutationFn: (connectionId?: string) => authorizeGoogleCalendar(accessToken, connectionId),
    onSuccess: (payload) => {
      window.location.href = payload.authorizationUrl;
    },
  });

  const disconnectGoogleAccountMutation = useMutation({
    mutationFn: (connectionId?: string) => disconnectGoogleAccount(accessToken, connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
    },
  });

  const toggleGoogleCalendarSyncMutation = useMutation({
    mutationFn: (payload: { enabled: boolean; connectionId?: string }) =>
      setGoogleCalendarSyncEnabled(payload.enabled, accessToken, payload.connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
    },
  });

  const syncGoogleCalendarMutation = useMutation({
    mutationFn: (days: GoogleCalendarSyncDays) =>
      syncGoogleCalendarForDays(days, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: (displayName: string) => updateMe({ displayName }, accessToken),
    onSuccess: (updated) => {
      queryClient.setQueryData(["me"], updated);
    },
  });

  const aiChatMutation = useMutation({
    mutationFn: (message: string) =>
      chatWithAi({ message, date: selectedDate }, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleCalendarStatus = params.get("googleCalendar");
    if (!googleCalendarStatus) {
      return;
    }

    const googleCalendarMessage = params.get("googleCalendarMessage");
    const notice = googleCalendarCallbackNotice(
      googleCalendarStatus,
      googleCalendarMessage,
    );

    setGoogleCalendarNotice(notice);
    openSettingsPanel({ preserveNotice: true });
    queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });

    params.delete("googleCalendar");
    params.delete("googleCalendarMessage");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${
      window.location.hash
    }`;
    window.history.replaceState(null, "", nextUrl);
  }, [queryClient]);

  function openSettingsPanel({
    preserveNotice = false,
  }: {
    preserveNotice?: boolean;
  } = {}) {
    if (!preserveNotice) {
      setGoogleCalendarNotice(null);
    }
    setIsSettingsOpen(true);
    setIsAccountMenuOpen(false);
    setIsMobileSidebarOpen(false);
    setIsSidebarHovered(false);
  }

  function closeSettingsPanel() {
    setIsSettingsOpen(false);
    setGoogleCalendarNotice(null);
  }

  function openMyDay() {
    setSelectedDate(today);
    setViewMode("my-day");
    setIsLongTermSectionOpen(false);
    setIsLowPrioritySectionOpen(false);
    setIsMobileSidebarOpen(false);
  }

  function openLongTermTasks() {
    setSelectedDate(today);
    setViewMode("long-term");
    setIsLongTermSectionOpen(true);
    setIsLowPrioritySectionOpen(false);
    setIsMobileSidebarOpen(false);
  }

  function openLowPriorityTasks() {
    setSelectedDate(today);
    setViewMode("low-priority");
    setIsLongTermSectionOpen(false);
    setIsLowPrioritySectionOpen(true);
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
    skippedTaskId: string | null,
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
          if (!previous || (skippedTaskId && taskId === skippedTaskId)) {
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

  function stopDragEdgeScroll() {
    if (dragScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(dragScrollFrameRef.current);
      dragScrollFrameRef.current = null;
    }
  }

  function scrollViewportDuringDrag(clientY: number) {
    if (dragScrollFrameRef.current !== null) {
      return;
    }

    dragScrollFrameRef.current = window.requestAnimationFrame(() => {
      dragScrollFrameRef.current = null;
      const viewportHeight = window.innerHeight;
      let delta = 0;
      if (clientY < DRAG_EDGE_SCROLL_ZONE_PX) {
        delta = -Math.ceil(
          ((DRAG_EDGE_SCROLL_ZONE_PX - clientY) / DRAG_EDGE_SCROLL_ZONE_PX) *
            DRAG_EDGE_SCROLL_MAX_PX,
        );
      } else if (clientY > viewportHeight - DRAG_EDGE_SCROLL_ZONE_PX) {
        delta = Math.ceil(
          ((clientY - (viewportHeight - DRAG_EDGE_SCROLL_ZONE_PX)) /
            DRAG_EDGE_SCROLL_ZONE_PX) *
            DRAG_EDGE_SCROLL_MAX_PX,
        );
      }

      if (delta !== 0) {
        window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      }
    });
  }

  function nextTargetIdAfter(
    date: string,
    hoveredId: string,
    draggedId: string,
    targetSection: TaskSection | null,
  ) {
    const items = orderedDayItems(daysByDate.get(date) ?? emptyDay(date));
    const draggedItem = items.find((item) => item.id === draggedId);
    if (!draggedItem) {
      return null;
    }
    const dragSection = targetSection ?? sectionForOccurrence(draggedItem);
    const ids = items
      .filter(
        (item) =>
          item.isPinned === draggedItem.isPinned &&
          sectionForOccurrence(item) === dragSection,
      )
      .map((item) => item.id)
      .filter((id) => id !== draggedId);
    const index = ids.indexOf(hoveredId);
    if (index === -1) {
      return null;
    }
    return ids[index + 1] ?? null;
  }

  function targetIdAtPinnedBoundary(
    date: string,
    draggedId: string,
    targetSection: TaskSection | null,
  ) {
    const items = orderedDayItems(daysByDate.get(date) ?? emptyDay(date));
    const draggedItem = items.find((item) => item.id === draggedId);
    if (!draggedItem) {
      return null;
    }
    const dragSection = targetSection ?? sectionForOccurrence(draggedItem);
    const sameGroupIds = items
      .filter(
        (item) =>
          item.id !== draggedId &&
          item.isPinned === draggedItem.isPinned &&
          sectionForOccurrence(item) === dragSection,
      )
      .map((item) => item.id);

    return draggedItem.isPinned ? null : sameGroupIds[0] ?? null;
  }

  function sectionTargetFromPointer(
    date: string,
    clientX: number,
    clientY: number,
  ) {
    const sections = document.querySelectorAll<HTMLElement>(
      `[data-day-date="${date}"][data-task-section]`,
    );
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return taskSectionFromDataset(section.dataset.taskSection);
      }
    }

    return null;
  }

  function targetFromPointer(current: DragState, clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const targetSection =
      sectionTargetFromPointer(current.date, clientX, clientY) ?? current.targetSection;
    const hoveredCard = element?.closest<HTMLElement>('[data-task-sortable="true"]');
    if (hoveredCard?.dataset.taskDate === current.date) {
      const hoveredId = hoveredCard.dataset.taskId;
      if (!hoveredId || hoveredId === current.id) {
        return { targetId: current.targetId, targetSection };
      }
      const items = orderedDayItems(daysByDate.get(current.date) ?? emptyDay(current.date));
      const draggedItem = items.find((item) => item.id === current.id);
      const hoveredItem = items.find((item) => item.id === hoveredId);
      if (!draggedItem || !hoveredItem) {
        return { targetId: current.targetId, targetSection };
      }
      const hoveredSection = sectionForOccurrence(hoveredItem);
      const dragSection = targetSection ?? sectionForOccurrence(draggedItem);
      if (hoveredSection !== dragSection) {
        return { targetId: current.targetId, targetSection };
      }
      if (draggedItem.isPinned !== hoveredItem.isPinned) {
        return {
          targetId: targetIdAtPinnedBoundary(current.date, current.id, dragSection),
          targetSection,
        };
      }
      const rect = hoveredCard.getBoundingClientRect();
      const shouldInsertAfter = clientY > rect.top + rect.height / 2;
      return {
        targetId: shouldInsertAfter
          ? nextTargetIdAfter(current.date, hoveredId, current.id, dragSection)
          : hoveredId,
        targetSection,
      };
    }

    const hoveredList = element?.closest<HTMLElement>("[data-day-date]");
    if (hoveredList?.dataset.dayDate === current.date) {
      return { targetId: null, targetSection };
    }

    return { targetId: current.targetId, targetSection };
  }

  function startTaskDrag(
    date: string,
    id: string,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    const dragElement =
      event.currentTarget.closest<HTMLElement>('[data-task-sortable="true"]') ??
      event.currentTarget;
    const rect = dragElement.getBoundingClientRect();
    const day = daysByDate.get(date) ?? emptyDay(date);
    const draggedItem = orderedDayItems(day).find((item) => item.id === id);
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
      targetSection: draggedItem ? sectionForOccurrence(draggedItem) : null,
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
      const cancelDistance =
        event.pointerType === "touch"
          ? TOUCH_LONG_PRESS_MOVE_CANCEL_PX
          : LONG_PRESS_MOVE_CANCEL_PX;
      if (Math.hypot(deltaX, deltaY) > cancelDistance) {
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

    event.preventDefault();
    scrollViewportDuringDrag(event.clientY);

    const target = targetFromPointer(dragState, event.clientX, event.clientY);
    if (target.targetSection === "long-term" && !isLongTermSectionOpen) {
      setIsLongTermSectionOpen(true);
    }
    if (target.targetSection === "low-priority" && !isLowPrioritySectionOpen) {
      setIsLowPrioritySectionOpen(true);
    }
    const nextState = {
      ...dragState,
      active: true,
      targetId: target.targetId,
      targetSection: target.targetSection,
      x: event.clientX,
      y: event.clientY,
    };

    if (
      target.targetId !== dragState.targetId ||
      target.targetSection !== dragState.targetSection
    ) {
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

    stopDragEdgeScroll();

    if (dragState.active) {
      suppressOpenTaskIdRef.current = dragState.id;
      const day = daysByDate.get(dragState.date) ?? emptyDay(dragState.date);
      const currentItems = orderedDayItems(day);
      const draggedItem = currentItems.find((item) => item.id === dragState.id);
      if (
        draggedItem &&
        dragState.targetSection !== null &&
        dragState.targetSection !== sectionForOccurrence(draggedItem)
      ) {
        const orderedIds = reorderOccurrenceItems(
          currentItems,
          dragState.id,
          dragState.targetId,
          dragState.targetSection,
        ).map((item) => item.id);
        void moveTaskToSectionAndReorder(dragState, orderedIds);
        setDragState(null);
        return;
      }
      const currentIds = currentItems.map((item) => item.id);
      const orderedIds = reorderOccurrenceItems(
        currentItems,
        dragState.id,
        dragState.targetId,
        dragState.targetSection,
      ).map((item) => item.id);
      if (orderedIds.join("|") !== currentIds.join("|")) {
        reorderMutation.mutate({ date: dragState.date, orderedIds });
      }
    }

    setDragState(null);
  }

  function cancelTaskDrag() {
    clearPendingDrag();
    stopDragEdgeScroll();
    setDragState(null);
  }

  async function moveTaskToSectionAndReorder(state: DragState, orderedIds: string[]) {
    try {
      const updated = await updateOccurrence(
        state.id,
        {
          isLongTerm: state.targetSection === "long-term",
          isLowPriority: state.targetSection === "low-priority",
        },
        accessToken,
      );
      queryClient.setQueriesData<RangeTodos>({ queryKey: ["range"] }, (data) =>
        applyServerOccurrenceUpdate(data, updated),
      );
      await reorderDay(state.date, orderedIds, accessToken);
      queryClient.setQueriesData<RangeTodos>({ queryKey: ["range"] }, (data) =>
        applyOptimisticDayOrder(data, { date: state.date, orderedIds }),
      );
      await queryClient.invalidateQueries({ queryKey: ["range"] });
    } catch {
      await queryClient.invalidateQueries({ queryKey: ["range"] });
      setTaskActionMessage({
        tone: "error",
        message: "移动任务失败，请稍后再试。",
      });
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
    if (viewMode === "analytics") {
      return "分析";
    }
    if (viewMode === "my-day") {
      return "我的一天";
    }
    if (viewMode === "long-term") {
      return "长期任务";
    }
    if (viewMode === "low-priority") {
      return "低优先级任务";
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
      {appUpdateNotice ? (
        <div className="app-update-toast" role="status" aria-live="polite">
          <span className="loading-spinner" />
          <span>{appUpdateNotice}</span>
        </div>
      ) : null}
      <button
        className="sidebar-scrim"
        type="button"
        aria-label="关闭侧边栏"
        onClick={() => setIsMobileSidebarOpen(false)}
      />
      <aside
        className="sidebar surface-panel"
        onMouseEnter={() => {
          if (!isSettingsOpen) {
            setIsSidebarHovered(true);
          }
        }}
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
              <span className="brand-mark">{accountInitial}</span>
              <span className="sidebar-label account-copy">
                <strong>{accountDisplayName}</strong>
              </span>
              <ChevronDownIcon expanded={isAccountMenuOpen} />
            </button>

            {isAccountMenuOpen ? (
              <div className="account-dropdown">
                <button
                  className="account-menu-item"
                  type="button"
                  onClick={() => openSettingsPanel()}
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
            className={viewMode === "my-day" ? "active" : ""}
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
            className={viewMode === "long-term" ? "active sidebar-subtag" : "sidebar-subtag"}
            type="button"
            onClick={openLongTermTasks}
          >
            <span className="nav-icon">
              <TagIcon />
            </span>
            <span className="nav-label">长期任务</span>
            <small className="nav-meta">{todayLongTermCount} 项</small>
          </button>
          <button
            className={viewMode === "low-priority" ? "active sidebar-subtag" : "sidebar-subtag"}
            type="button"
            onClick={openLowPriorityTasks}
          >
            <span className="nav-icon">
              <TagIcon />
            </span>
            <span className="nav-label">低优先级</span>
            <small className="nav-meta">{todayLowPriorityCount} 项</small>
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
            <small className="nav-meta">今天</small>
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
          <strong>{isAnalytics ? "今天" : selectedDate}</strong>
          <small>
            {isAnalytics
              ? `${today} · ${weekdayLabel(today)}`
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
            <strong>{accountDisplayName}</strong>
            <small>Daily Todo Sync</small>
          </div>
        </div>

        <header className="workspace-header surface-panel">
          <div>
            {isAnalytics ? (
              <p className="eyebrow">今天</p>
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
                ? `${today} · ${weekdayLabel(today)} · 只分析当天任务`
                : `${selectedDate} · ${weekdayLabel(selectedDate)}`}
            </p>
          </div>

        {!isAnalytics && !isMyDay && !specialTaskSection ? (
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

        {rangeQuery.isLoading ? <p className="empty-state is-visible">加载中...</p> : null}
        {rangeQuery.isError ? (
          <p className="empty-state is-visible">加载失败：{String(rangeQuery.error)}</p>
        ) : null}

        {!rangeQuery.isLoading && !rangeQuery.isError ? (
          isAnalytics ? (
            <AnalyticsDashboard
              days={rangeQuery.data?.days ?? []}
              today={today}
            />
          ) : isMyDay ? (
            <section className="calendar-grid view-day">
              {visibleDates.map((date) => (
                <DayColumn
                  completionOverrides={completionOverrides}
                  date={date}
                  day={daysByDate.get(date) ?? emptyDay(date)}
                  dragState={dragState}
                  copyingTaskId={
                    copyLongTermMutation.isPending
                      ? copyLongTermMutation.variables ?? null
                      : null
                  }
                  isSelected={date === selectedDate}
                  isToday={date === today}
                  hideHeading
                  isLongTermSectionOpen={isLongTermSectionOpen}
                  isLowPrioritySectionOpen={isLowPrioritySectionOpen}
                  key={date}
                  onCopyAsRegular={(id) => copyLongTermMutation.mutate(id)}
                  onDelete={requestDeleteTask}
                  onDone={updateTaskDone}
                  onPin={updateTaskPinned}
                  onCancelDrag={cancelTaskDrag}
                  onEndDrag={finishTaskDrag}
                  onMoveDrag={moveTaskDrag}
                  onOpenTask={openTaskDetails}
                  onSelectDate={setSelectedDate}
                  onStartDrag={startTaskDrag}
                  onToggleLongTermSection={() =>
                    setIsLongTermSectionOpen((value) => !value)
                  }
                  onToggleLowPrioritySection={() =>
                    setIsLowPrioritySectionOpen((value) => !value)
                  }
                />
              ))}
            </section>
          ) : specialTaskSection ? (
            <FilteredTaskView
              completionOverrides={completionOverrides}
              copyingTaskId={
                copyLongTermMutation.isPending
                  ? copyLongTermMutation.variables ?? null
                  : null
              }
              date={selectedDate}
              day={daysByDate.get(selectedDate) ?? emptyDay(selectedDate)}
              dragState={dragState}
              section={specialTaskSection}
              onCancelDrag={cancelTaskDrag}
              onCopyAsRegular={(id) => copyLongTermMutation.mutate(id)}
              onDelete={requestDeleteTask}
              onDone={updateTaskDone}
              onPin={updateTaskPinned}
              onEndDrag={finishTaskDrag}
              onMoveDrag={moveTaskDrag}
              onOpenTask={openTaskDetails}
              onStartDrag={startTaskDrag}
            />
          ) : (
            <CalendarBoard
              completionOverrides={completionOverrides}
              dates={visibleDates}
              daysByDate={daysByDate}
              dragState={dragState}
              selectedDate={selectedDate}
              today={today}
              viewMode={viewMode as CalendarViewMode}
              onCancelDrag={cancelTaskDrag}
              onDelete={requestDeleteTask}
              onDone={updateTaskDone}
              onPin={updateTaskPinned}
              onEndDrag={finishTaskDrag}
              onMoveDrag={moveTaskDrag}
              onOpenTask={openTaskDetails}
              onSelectDate={setSelectedDate}
              onStartDrag={startTaskDrag}
            />
          )
        ) : null}

        {!isAnalytics && !specialTaskSection ? (
          <QuickAddTask
            date={selectedDate}
            isAiThinking={aiChatMutation.isPending}
            isSaving={createMutation.isPending}
            lastAiReply={aiChatMutation.data?.reply ?? ""}
            onAiSubmit={(message) => aiChatMutation.mutate(message)}
            onSubmit={(payload) => createMutation.mutate(payload)}
          />
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
          accessToken={accessToken}
          attachmentError={
            uploadAttachmentMutation.error ?? deleteAttachmentMutation.error
          }
          deletingAttachmentId={
            deleteAttachmentMutation.isPending &&
            deleteAttachmentMutation.variables?.occurrenceId === selectedTask.id
              ? deleteAttachmentMutation.variables.attachmentId
              : null
          }
          item={selectedTask}
          isDeleting={deleteMutation.isPending}
          isSaving={updateMutation.isPending}
          isUploadingAttachment={
            uploadAttachmentMutation.isPending &&
            uploadAttachmentMutation.variables?.occurrenceId === selectedTask.id
          }
          onClose={() => setSelectedTaskId(null)}
          onDelete={() => requestDeleteTask(selectedTask.id)}
          onDeleteAttachment={(attachmentId) =>
            deleteAttachmentMutation.mutate({
              attachmentId,
              occurrenceId: selectedTask.id,
            })
          }
          onReorderAttachments={(orderedIds) =>
            reorderAttachmentsMutation.mutate({
              occurrenceId: selectedTask.id,
              orderedIds,
            })
          }
          onSave={async (changes) => {
            await updateMutation.mutateAsync({ id: selectedTask.id, ...changes });
          }}
          onUploadAttachment={(file) =>
            uploadAttachmentMutation.mutateAsync({
              file,
              occurrenceId: selectedTask.id,
            })
          }
        />
      ) : null}

      {isSettingsOpen ? (
        <SettingsModal
          currentUser={meQuery.data ?? null}
          notice={googleCalendarNotice}
          status={googleCalendarStatusQuery.data ?? null}
          syncResult={syncGoogleCalendarMutation.data ?? null}
          syncDays={googleCalendarSyncDays}
          isAuthorizingCalendar={authorizeGoogleCalendarMutation.isPending}
          isBindingGoogle={bindGoogleAccountMutation.isPending}
          isDisconnecting={disconnectGoogleAccountMutation.isPending}
          isLoading={googleCalendarStatusQuery.isLoading}
          isSyncing={syncGoogleCalendarMutation.isPending}
          isTogglingSync={toggleGoogleCalendarSyncMutation.isPending}
          isSavingProfile={updateProfileMutation.isPending}
          error={
            googleCalendarStatusQuery.error ??
            bindGoogleAccountMutation.error ??
            authorizeGoogleCalendarMutation.error ??
            disconnectGoogleAccountMutation.error ??
            toggleGoogleCalendarSyncMutation.error ??
            syncGoogleCalendarMutation.error ??
            trashQuery.error ??
            restoreMutation.error ??
            clearTrashMutation.error
          }
          trashItems={trashQuery.data ?? []}
          isTrashLoading={trashQuery.isLoading}
          isClearingTrash={clearTrashMutation.isPending}
          restoringTrashId={
            restoreMutation.isPending ? restoreMutation.variables ?? null : null
          }
          onClose={closeSettingsPanel}
          onAuthorizeCalendar={() => authorizeGoogleCalendarMutation.mutate(undefined)}
          onAuthorizeCalendarAccount={(id) => authorizeGoogleCalendarMutation.mutate(id)}
          onBindGoogle={() => bindGoogleAccountMutation.mutate()}
          onDisconnect={() => disconnectGoogleAccountMutation.mutate(undefined)}
          onDisconnectAccount={(id) => disconnectGoogleAccountMutation.mutate(id)}
          onClearTrash={() => clearTrashMutation.mutate()}
          onRestoreTrash={restoreDeletedTask}
          onSaveProfile={(displayName) => updateProfileMutation.mutate(displayName)}
          onChangeSyncDays={setGoogleCalendarSyncDays}
          onSync={() => syncGoogleCalendarMutation.mutate(googleCalendarSyncDays)}
          onToggleSync={(enabled) => toggleGoogleCalendarSyncMutation.mutate({ enabled })}
          onToggleAccountSync={(connectionId, enabled) =>
            toggleGoogleCalendarSyncMutation.mutate({ connectionId, enabled })
          }
        />
      ) : null}

      {pendingDeleteTask ? (
        <ConfirmDeleteModal
          isDeleting={deleteMutation.isPending}
          task={pendingDeleteTask}
          onCancel={() => setPendingDeleteTask(null)}
          onConfirm={confirmDeleteTask}
        />
      ) : null}

      {undoDeleteCandidate ? (
        <UndoDeleteToast
          isRestoring={
            restoreMutation.isPending &&
            restoreMutation.variables === undoDeleteCandidate.id
          }
          task={undoDeleteCandidate}
          onDismiss={() => setUndoDeleteCandidate(null)}
          onUndo={() => restoreDeletedTask(undoDeleteCandidate.id)}
        />
      ) : null}

      {taskActionMessage ? (
        <TaskActionToast
          message={taskActionMessage.message}
          tone={taskActionMessage.tone}
          onDismiss={() => setTaskActionMessage(null)}
        />
      ) : null}
    </main>
  );
}

function CalendarBoard({
  completionOverrides,
  dates,
  daysByDate,
  dragState,
  selectedDate,
  today,
  viewMode,
  onCancelDrag,
  onDelete,
  onDone,
  onPin,
  onEndDrag,
  onMoveDrag,
  onOpenTask,
  onSelectDate,
  onStartDrag,
}: {
  completionOverrides: Record<string, CompletionOverride>;
  dates: string[];
  daysByDate: Map<string, DayTodos>;
  dragState: DragState | null;
  selectedDate: string;
  today: string;
  viewMode: CalendarViewMode;
  onCancelDrag: () => void;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onPin: (id: string, pinned: boolean) => void;
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
  if (viewMode === "month") {
    return (
      <MonthCalendar
        completionOverrides={completionOverrides}
        dates={dates}
        daysByDate={daysByDate}
        dragState={dragState}
        selectedDate={selectedDate}
        today={today}
        onCancelDrag={onCancelDrag}
        onDelete={onDelete}
        onDone={onDone}
        onPin={onPin}
        onEndDrag={onEndDrag}
        onMoveDrag={onMoveDrag}
        onOpenTask={onOpenTask}
        onSelectDate={onSelectDate}
        onStartDrag={onStartDrag}
      />
    );
  }

  return (
    <TimeCalendar
      completionOverrides={completionOverrides}
      dates={dates}
      daysByDate={daysByDate}
      dragState={dragState}
      today={today}
      viewMode={viewMode}
      onCancelDrag={onCancelDrag}
      onDelete={onDelete}
      onDone={onDone}
      onPin={onPin}
      onEndDrag={onEndDrag}
      onMoveDrag={onMoveDrag}
      onOpenTask={onOpenTask}
      onSelectDate={onSelectDate}
      onStartDrag={onStartDrag}
    />
  );
}

function TimeCalendar({
  completionOverrides,
  dates,
  daysByDate,
  dragState,
  today,
  viewMode,
  onCancelDrag,
  onDelete,
  onDone,
  onPin,
  onEndDrag,
  onMoveDrag,
  onOpenTask,
  onSelectDate,
  onStartDrag,
}: {
  completionOverrides: Record<string, CompletionOverride>;
  dates: string[];
  daysByDate: Map<string, DayTodos>;
  dragState: DragState | null;
  today: string;
  viewMode: CalendarViewMode;
  onCancelDrag: () => void;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onPin: (id: string, pinned: boolean) => void;
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
  const gridStyle = {
    "--calendar-days": dates.length,
  } as CSSProperties;

  return (
    <section className={`calendar-board time-calendar view-${viewMode}`}>
      <div className="time-calendar-shell surface-panel">
        <div className="time-calendar-grid" style={gridStyle}>
          <div className="time-zone-cell">GMT+8</div>
          {dates.map((date) => (
            <button
              className={`calendar-day-head ${date === today ? "is-today" : ""}`}
              key={`head-${date}`}
              type="button"
              onClick={() => onSelectDate(date)}
            >
              <span>{weekdayLabel(date)}</span>
              <strong>{formatShortDate(date)}</strong>
              {date === today ? <i>今天</i> : null}
            </button>
          ))}

          <div className="all-day-label">全天</div>
          {dates.map((date) => {
            const day = daysByDate.get(date) ?? emptyDay(date);
            const items = previewDayItems(orderedDayItems(day), dragState, date);
            const buckets = buildCalendarTaskBuckets(items);
            const isReordering = dragState?.active && dragState.date === date;

            return (
              <div
                className={`all-day-cell ${isReordering ? "is-reordering" : ""}`}
                data-day-date={date}
                key={`all-day-${date}`}
              >
                {buckets.allDay.length === 0 ? (
                  <span className="calendar-empty-hint">无全天任务</span>
                ) : null}
                {buckets.allDay.map((item) => (
                  <CalendarTaskChip
                    date={date}
                    done={completionOverrides[item.id]?.done ?? item.status === "done"}
                    dragged={Boolean(dragState?.active && dragState.id === item.id)}
                    item={item}
                    key={item.id}
                    variant="all-day"
                    onCancelDrag={onCancelDrag}
                    onDelete={onDelete}
                    onDone={onDone}
                    onPin={onPin}
                    onEndDrag={onEndDrag}
                    onMoveDrag={onMoveDrag}
                    onOpen={() => onOpenTask(item.id)}
                    onStartDrag={(event) => onStartDrag(date, item.id, event)}
                  />
                ))}
              </div>
            );
          })}

          <div className="time-rail">
            {CALENDAR_HOURS.map((hour) => (
              <span key={hour}>{formatHourLabel(hour)}</span>
            ))}
          </div>
          {dates.map((date) => {
            const day = daysByDate.get(date) ?? emptyDay(date);
            const items = previewDayItems(orderedDayItems(day), dragState, date);
            const buckets = buildCalendarTaskBuckets(items);
            const isReordering = dragState?.active && dragState.date === date;

            return (
              <div
                className={`time-day-lane ${date === today ? "is-today" : ""} ${
                  isReordering ? "is-reordering" : ""
                }`}
                data-day-date={date}
                key={`lane-${date}`}
              >
                {CALENDAR_HOURS.map((hour) => (
                  <span
                    className="time-slot-line"
                    key={hour}
                    style={{ top: `${(hour / 24) * 100}%` }}
                  />
                ))}
                {buckets.timed.map(({ item, lane, laneCount, minutes }) => {
                  const top = Math.max(
                    0,
                    Math.min(CALENDAR_MINUTES_PER_DAY - 30, minutes),
                  );
                  const laneWidth = 100 / laneCount;
                  const style = {
                    minHeight: CALENDAR_EVENT_HEIGHT,
                    top: `${(top / CALENDAR_MINUTES_PER_DAY) * 100}%`,
                    left: `calc(${lane * laneWidth}% + 6px)`,
                    width: `calc(${laneWidth}% - 10px)`,
                  } as CSSProperties;

                  return (
                    <CalendarTaskChip
                      date={date}
                      done={completionOverrides[item.id]?.done ?? item.status === "done"}
                      dragged={Boolean(dragState?.active && dragState.id === item.id)}
                      item={item}
                      key={item.id}
                      style={style}
                      variant="timed"
                      onCancelDrag={onCancelDrag}
                      onDelete={onDelete}
                      onDone={onDone}
                      onPin={onPin}
                      onEndDrag={onEndDrag}
                      onMoveDrag={onMoveDrag}
                      onOpen={() => onOpenTask(item.id)}
                      onStartDrag={(event) => onStartDrag(date, item.id, event)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MonthCalendar({
  completionOverrides,
  dates,
  daysByDate,
  dragState,
  selectedDate,
  today,
  onCancelDrag,
  onDelete,
  onDone,
  onPin,
  onEndDrag,
  onMoveDrag,
  onOpenTask,
  onSelectDate,
  onStartDrag,
}: {
  completionOverrides: Record<string, CompletionOverride>;
  dates: string[];
  daysByDate: Map<string, DayTodos>;
  dragState: DragState | null;
  selectedDate: string;
  today: string;
  onCancelDrag: () => void;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onPin: (id: string, pinned: boolean) => void;
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
  const selectedMonth = fromDateKey(selectedDate).getMonth();

  return (
    <section className="calendar-board month-calendar surface-panel">
      <div className="month-weekdays">
        {WEEKDAY_NAMES.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="month-grid">
        {dates.map((date) => {
          const day = daysByDate.get(date) ?? emptyDay(date);
          const items = previewDayItems(orderedDayItems(day), dragState, date);
          const isOutsideMonth = fromDateKey(date).getMonth() !== selectedMonth;
          const isReordering = dragState?.active && dragState.date === date;
          const visibleItems = items.slice(0, 5);
          const hiddenCount = Math.max(0, items.length - visibleItems.length);

          return (
            <article
              className={[
                "month-cell",
                date === today ? "is-today" : "",
                date === selectedDate ? "is-selected" : "",
                isOutsideMonth ? "is-outside-month" : "",
                isReordering ? "is-reordering" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-day-date={date}
              key={date}
            >
              <button
                className="month-day-button"
                type="button"
                onClick={() => onSelectDate(date)}
              >
                <span>{fromDateKey(date).getDate()}</span>
                {date === today ? <strong>今天</strong> : null}
              </button>
              <div className="month-task-list">
                {visibleItems.map((item) => (
                  <CalendarTaskChip
                    date={date}
                    done={completionOverrides[item.id]?.done ?? item.status === "done"}
                    dragged={Boolean(dragState?.active && dragState.id === item.id)}
                    item={item}
                    key={item.id}
                    variant="month"
                    onCancelDrag={onCancelDrag}
                    onDelete={onDelete}
                    onDone={onDone}
                    onPin={onPin}
                    onEndDrag={onEndDrag}
                    onMoveDrag={onMoveDrag}
                    onOpen={() => onOpenTask(item.id)}
                    onStartDrag={(event) => onStartDrag(date, item.id, event)}
                  />
                ))}
                {hiddenCount > 0 ? (
                  <button
                    className="month-more-button"
                    type="button"
                    onClick={() => onSelectDate(date)}
                  >
                    还有 {hiddenCount} 项
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CalendarTaskChip({
  date,
  done,
  dragged,
  item,
  style,
  variant,
  onCancelDrag,
  onDelete,
  onDone,
  onPin,
  onEndDrag,
  onMoveDrag,
  onOpen,
  onStartDrag,
}: {
  date: string;
  done: boolean;
  dragged: boolean;
  item: TodoOccurrence;
  style?: CSSProperties;
  variant: "all-day" | "month" | "timed";
  onCancelDrag: () => void;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onPin: (id: string, pinned: boolean) => void;
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
    <div
      className={`calendar-task-chip is-${variant} ${done ? "is-done" : ""} ${
        dragged ? "is-dragging" : ""
      } ${item.isPinned ? "is-pinned" : ""} ${
        item.isLowPriority && !item.isLongTerm ? "is-low-priority" : ""
      }`}
      data-task-date={date}
      data-task-id={item.id}
      data-task-sortable="true"
      onClick={onOpen}
      onPointerCancel={onCancelDrag}
      onPointerDown={startDrag}
      onPointerMove={onMoveDrag}
      onPointerUp={endDrag}
      style={style}
    >
      <input
        className="mini-checkbox"
        type="checkbox"
        checked={done}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDone(item.id, !done);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onChange={() => undefined}
      />
      <span className="calendar-chip-title">{item.text}</span>
      {item.reminderTime ? <time>{item.reminderTime}</time> : null}
      <button
        className={`calendar-chip-delete pin-task-button ${item.isPinned ? "is-pinned" : ""}`}
        type="button"
        aria-label={item.isPinned ? "取消置顶任务" : "置顶任务"}
        onClick={(event) => {
          event.stopPropagation();
          onPin(item.id, !item.isPinned);
        }}
      >
        <PinIcon pinned={item.isPinned} />
      </button>
      <button
        className="calendar-chip-delete"
        type="button"
        aria-label="删除任务"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(item.id);
        }}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function FilteredTaskView({
  completionOverrides,
  copyingTaskId,
  date,
  day,
  dragState,
  section,
  onCancelDrag,
  onCopyAsRegular,
  onDelete,
  onDone,
  onPin,
  onEndDrag,
  onMoveDrag,
  onOpenTask,
  onStartDrag,
}: {
  completionOverrides: Record<string, CompletionOverride>;
  copyingTaskId?: string | null;
  date: string;
  day: DayTodos;
  dragState: DragState | null;
  section: SpecialTaskViewMode;
  onCancelDrag: () => void;
  onCopyAsRegular?: (id: string) => void;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onPin: (id: string, pinned: boolean) => void;
  onEndDrag: () => void;
  onMoveDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onOpenTask: (id: string) => void;
  onStartDrag: (
    date: string,
    id: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
}) {
  const items = previewDayItems(orderedDayItems(day), dragState, date).filter((item) =>
    section === "long-term"
      ? item.isLongTerm
      : !item.isLongTerm && item.isLowPriority,
  );
  const isReordering = dragState?.active && dragState.date === date;
  const isDropTarget =
    dragState?.active && dragState.date === date && dragState.targetSection === section;
  const emptyText =
    section === "long-term" ? "暂无长期任务" : "暂无低优先级任务";

  return (
    <section className="calendar-grid view-day">
      <article className="day-column surface-panel is-selected filtered-task-column">
        <section
          className={[
            section === "long-term"
              ? "long-term-task-section is-open"
              : "low-priority-task-section is-open",
            isDropTarget ? "is-drop-target" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-day-date={date}
          data-task-section={section}
        >
          <ul
            className={[
              "todo-list",
              section === "long-term" ? "long-term-list" : "low-priority-list",
              isReordering ? "is-reordering" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {items.length === 0 ? (
              <li className="empty-state is-visible">{emptyText}</li>
            ) : null}
            {items.map((item) => (
              <TodoCard
                copying={section === "long-term" && copyingTaskId === item.id}
                date={date}
                done={completionOverrides[item.id]?.done ?? item.status === "done"}
                dragged={Boolean(dragState?.active && dragState.id === item.id)}
                item={item}
                key={item.id}
                onCancelDrag={onCancelDrag}
                onCopyAsRegular={onCopyAsRegular}
                onDelete={onDelete}
                onDone={onDone}
                onPin={onPin}
                onEndDrag={onEndDrag}
                onMoveDrag={onMoveDrag}
                onOpen={() => onOpenTask(item.id)}
                onStartDrag={(event) => onStartDrag(date, item.id, event)}
              />
            ))}
          </ul>
        </section>
      </article>
    </section>
  );
}

function DayColumn({
  completionOverrides,
  copyingTaskId,
  date,
  day,
  dragState,
  hideHeading,
  hideSpecialSections = false,
  isLongTermSectionOpen = false,
  isLowPrioritySectionOpen = false,
  isSelected,
  isToday,
  onCancelDrag,
  onCopyAsRegular,
  onDelete,
  onDone,
  onPin,
  onEndDrag,
  onMoveDrag,
  onOpenTask,
  onSelectDate,
  onStartDrag,
  onToggleLongTermSection,
  onToggleLowPrioritySection,
}: {
  completionOverrides: Record<string, CompletionOverride>;
  copyingTaskId?: string | null;
  date: string;
  day: DayTodos;
  dragState: DragState | null;
  hideHeading: boolean;
  hideSpecialSections?: boolean;
  isLongTermSectionOpen?: boolean;
  isLowPrioritySectionOpen?: boolean;
  isSelected: boolean;
  isToday: boolean;
  onCancelDrag: () => void;
  onCopyAsRegular?: (id: string) => void;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onPin: (id: string, pinned: boolean) => void;
  onEndDrag: () => void;
  onMoveDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onOpenTask: (id: string) => void;
  onSelectDate: (date: string) => void;
  onStartDrag: (
    date: string,
    id: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onToggleLongTermSection?: () => void;
  onToggleLowPrioritySection?: () => void;
}) {
  const items = previewDayItems(orderedDayItems(day), dragState, date);
  const longTermItems = hideSpecialSections ? [] : items.filter((item) => item.isLongTerm);
  const lowPriorityItems = hideSpecialSections
    ? []
    : items.filter((item) => !item.isLongTerm && item.isLowPriority);
  const regularItems = items.filter((item) => !item.isLongTerm && !item.isLowPriority);
  const isReordering = dragState?.active && dragState.date === date;
  const isLongTermDropTarget =
    dragState?.active && dragState.date === date && dragState.targetSection === "long-term";
  const isRegularDropTarget =
    dragState?.active && dragState.date === date && dragState.targetSection === "regular";
  const isLowPriorityDropTarget =
    dragState?.active &&
    dragState.date === date &&
    dragState.targetSection === "low-priority";

  return (
    <article className={`day-column surface-panel ${isSelected ? "is-selected" : ""}`}>
      {!hideHeading ? (
        <button className="day-heading" type="button" onClick={() => onSelectDate(date)}>
          <span>{weekdayLabel(date)}</span>
          <strong>{formatShortDate(date)}</strong>
          {isToday ? <span className="today-pill">今天</span> : null}
        </button>
      ) : null}

      {!hideSpecialSections ? (
      <section
        className={[
          "long-term-task-section",
          isLongTermSectionOpen ? "is-open" : "",
          isLongTermDropTarget ? "is-drop-target" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-day-date={date}
        data-task-section="long-term"
      >
        <button
          className="long-term-section-header"
          type="button"
          onClick={onToggleLongTermSection}
        >
          <span>
            <strong>长期任务</strong>
            {isLongTermSectionOpen ? <small>{longTermItems.length} 项</small> : null}
          </span>
          <ChevronDownIcon expanded={isLongTermSectionOpen} />
        </button>
        {isLongTermSectionOpen ? (
          <ul className={`todo-list long-term-list ${isReordering ? "is-reordering" : ""}`}>
            {longTermItems.length === 0 ? (
              <li className="empty-state is-visible">把任务拖到这里，就会变成长期任务</li>
            ) : null}
            {longTermItems.map((item) => (
              <TodoCard
                copying={copyingTaskId === item.id}
                date={date}
                done={completionOverrides[item.id]?.done ?? item.status === "done"}
                dragged={Boolean(dragState?.active && dragState.id === item.id)}
                item={item}
                key={item.id}
                onCancelDrag={onCancelDrag}
                onCopyAsRegular={onCopyAsRegular}
                onDelete={onDelete}
                onDone={onDone}
                onPin={onPin}
                onEndDrag={onEndDrag}
                onMoveDrag={onMoveDrag}
                onOpen={() => onOpenTask(item.id)}
                onStartDrag={(event) => onStartDrag(date, item.id, event)}
              />
            ))}
          </ul>
        ) : null}
      </section>
      ) : null}

      <ul
        className={`todo-list card-list ${isReordering ? "is-reordering" : ""} ${
          isRegularDropTarget ? "is-drop-target" : ""
        }`}
        data-day-date={date}
        data-task-section="regular"
      >
        {regularItems.length === 0 ? (
          <li className="empty-state is-visible">暂无任务</li>
        ) : null}
        {regularItems.map((item) => (
          <TodoCard
            copying={false}
            date={date}
            done={completionOverrides[item.id]?.done ?? item.status === "done"}
            dragged={Boolean(dragState?.active && dragState.id === item.id)}
            item={item}
            key={item.id}
            onCancelDrag={onCancelDrag}
            onCopyAsRegular={onCopyAsRegular}
            onDelete={onDelete}
            onDone={onDone}
            onPin={onPin}
            onEndDrag={onEndDrag}
            onMoveDrag={onMoveDrag}
            onOpen={() => onOpenTask(item.id)}
            onStartDrag={(event) => onStartDrag(date, item.id, event)}
          />
        ))}
      </ul>

      {!hideSpecialSections ? (
      <section
        className={[
          "low-priority-task-section",
          isLowPrioritySectionOpen ? "is-open" : "",
          isLowPriorityDropTarget ? "is-drop-target" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-day-date={date}
        data-task-section="low-priority"
      >
        <button
          className="long-term-section-header"
          type="button"
          onClick={onToggleLowPrioritySection}
        >
          <span>
            <strong>低优先级任务</strong>
            {isLowPrioritySectionOpen ? <small>{lowPriorityItems.length} 项</small> : null}
          </span>
          <ChevronDownIcon expanded={isLowPrioritySectionOpen} />
        </button>
        {isLowPrioritySectionOpen ? (
          <ul className={`todo-list low-priority-list ${isReordering ? "is-reordering" : ""}`}>
            {lowPriorityItems.length === 0 ? (
              <li className="empty-state is-visible">把任务拖到这里，就会变成低优先级任务</li>
            ) : null}
            {lowPriorityItems.map((item) => (
              <TodoCard
                copying={false}
                date={date}
                done={completionOverrides[item.id]?.done ?? item.status === "done"}
                dragged={Boolean(dragState?.active && dragState.id === item.id)}
                item={item}
                key={item.id}
                onCancelDrag={onCancelDrag}
                onCopyAsRegular={onCopyAsRegular}
                onDelete={onDelete}
                onDone={onDone}
                onPin={onPin}
                onEndDrag={onEndDrag}
                onMoveDrag={onMoveDrag}
                onOpen={() => onOpenTask(item.id)}
                onStartDrag={(event) => onStartDrag(date, item.id, event)}
              />
            ))}
          </ul>
        ) : null}
      </section>
      ) : null}
    </article>
  );
}

function TodoCard({
  copying = false,
  date,
  done = false,
  dragged,
  item,
  onCancelDrag,
  onCopyAsRegular,
  onDelete,
  onDone,
  onPin,
  onEndDrag,
  onMoveDrag,
  onOpen,
  onStartDrag,
}: {
  copying?: boolean;
  date: string;
  done?: boolean;
  dragged: boolean;
  item: TodoOccurrence;
  onCancelDrag: () => void;
  onCopyAsRegular?: (id: string) => void;
  onDelete: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  onPin: (id: string, pinned: boolean) => void;
  onEndDrag: () => void;
  onMoveDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onOpen: () => void;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const checkboxPressRef = useRef<{
    canceled: boolean;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

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

  function startCheckboxPress(event: ReactPointerEvent<HTMLInputElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    checkboxPressRef.current = {
      canceled: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    onStartDrag(event);
  }

  function moveCheckboxPress(event: ReactPointerEvent<HTMLInputElement>) {
    const press = checkboxPressRef.current;
    if (!press || press.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - press.startX;
    const deltaY = event.clientY - press.startY;
    if (Math.hypot(deltaX, deltaY) > TOUCH_LONG_PRESS_MOVE_CANCEL_PX) {
      press.canceled = true;
    }
    onMoveDrag(event);
  }

  function finishCheckboxPress(event: ReactPointerEvent<HTMLInputElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const press = checkboxPressRef.current;
    checkboxPressRef.current = null;
    if (dragged) {
      onEndDrag();
      return;
    }
    onEndDrag();
    if (!press || press.pointerId !== event.pointerId || press.canceled) {
      return;
    }
    onDone(item.id, !done);
  }

  function cancelCheckboxPress(event: ReactPointerEvent<HTMLInputElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    checkboxPressRef.current = null;
    onCancelDrag();
  }

  return (
    <li
      className={`todo-item task-card ${done ? "is-done" : ""} ${
        dragged ? "is-dragging" : ""
      } ${item.isPinned ? "is-pinned" : ""} ${item.isLongTerm ? "is-long-term" : ""} ${
        item.isLowPriority && !item.isLongTerm ? "is-low-priority" : ""
      }`}
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
        onPointerCancel={cancelCheckboxPress}
        onPointerDown={startCheckboxPress}
        onPointerMove={moveCheckboxPress}
        onPointerUp={finishCheckboxPress}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onChange={() => undefined}
      />
      <div className="task-body">
        <p>{item.text}</p>
        <span className="task-meta-row">
          {item.isPinned ? (
            <small className="task-kicker pinned-kicker">
              <PinIcon pinned />
              置顶
            </small>
          ) : null}
          {item.isLongTerm ? <small className="task-kicker">长期任务</small> : null}
          {!item.isLongTerm && item.isLowPriority ? (
            <small className="task-kicker">低优先级</small>
          ) : null}
        </span>
      </div>
      {item.isLongTerm ? (
        <button
          className="icon-button copy-task-button"
          type="button"
          aria-label="复制到普通任务"
          disabled={copying}
          onClick={(event) => {
            event.stopPropagation();
            onCopyAsRegular?.(item.id);
          }}
        >
          {copying ? <span className="loading-spinner" /> : <CopyIcon />}
        </button>
      ) : null}
      <button
        className={`icon-button pin-task-button ${item.isPinned ? "is-pinned" : ""}`}
        type="button"
        aria-label={item.isPinned ? "取消置顶任务" : "置顶任务"}
        onClick={(event) => {
          event.stopPropagation();
          onPin(item.id, !item.isPinned);
        }}
      >
        <PinIcon pinned={item.isPinned} />
      </button>
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

function SettingsModal({
  currentUser,
  error,
  isAuthorizingCalendar,
  isBindingGoogle,
  isClearingTrash,
  isDisconnecting,
  isLoading,
  isSyncing,
  isTrashLoading,
  isTogglingSync,
  isSavingProfile,
  notice,
  onAuthorizeCalendar,
  onAuthorizeCalendarAccount,
  onBindGoogle,
  onChangeSyncDays,
  onClose,
  onClearTrash,
  onDisconnect,
  onDisconnectAccount,
  onRestoreTrash,
  onSaveProfile,
  onSync,
  onToggleSync,
  onToggleAccountSync,
  restoringTrashId,
  status,
  syncDays,
  syncResult,
  trashItems,
}: {
  currentUser: User | null;
  error: Error | null;
  isAuthorizingCalendar: boolean;
  isBindingGoogle: boolean;
  isClearingTrash: boolean;
  isDisconnecting: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  isTrashLoading: boolean;
  isTogglingSync: boolean;
  isSavingProfile: boolean;
  notice: GoogleCalendarNotice | null;
  onAuthorizeCalendar: () => void;
  onAuthorizeCalendarAccount: (connectionId: string) => void;
  onBindGoogle: () => void;
  onChangeSyncDays: (days: GoogleCalendarSyncDays) => void;
  onClose: () => void;
  onClearTrash: () => void;
  onDisconnect: () => void;
  onDisconnectAccount: (connectionId: string) => void;
  onRestoreTrash: (id: string) => void;
  onSaveProfile: (displayName: string) => void;
  onSync: () => void;
  onToggleSync: (enabled: boolean) => void;
  onToggleAccountSync: (connectionId: string, enabled: boolean) => void;
  restoringTrashId: string | null;
  status: GoogleCalendarStatus | null;
  syncDays: GoogleCalendarSyncDays;
  syncResult: GoogleCalendarSyncResult | null;
  trashItems: DeletedTodoOccurrence[];
}) {
  const [displayName, setDisplayName] = useState(currentUser?.displayName ?? "");
  const isGoogleBound = Boolean(status?.googleBound);
  const isCalendarAuthorized = Boolean(status?.calendarAuthorized);
  const isConfigured = Boolean(status?.configured);
  const syncEnabled = Boolean(status?.syncEnabled);
  const toggleDisabled =
    !isConfigured || !isGoogleBound || isAuthorizingCalendar || isTogglingSync;
  const busyMessage = isBindingGoogle
    ? "正在准备 Google 登录..."
    : isAuthorizingCalendar
      ? "正在准备 Google Calendar 授权..."
      : isSyncing
        ? `正在同步未来 ${syncDays} 天...`
        : isTogglingSync
          ? "正在更新同步开关..."
          : "";

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

  useEffect(() => {
    setDisplayName(currentUser?.displayName ?? "");
  }, [currentUser?.displayName]);

  return (
    <ModalShell title="Settings" onClose={onClose}>
      <div className="settings-body">
        {notice ? (
          <p className={`settings-callback-notice is-${notice.tone}`}>
            {notice.message}
          </p>
        ) : null}
        {busyMessage ? (
          <div className="settings-busy" role="status" aria-live="polite">
            <span className="loading-spinner" />
            <span>{busyMessage}</span>
          </div>
        ) : null}

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="eyebrow">Profile</p>
              <h3>修改昵称</h3>
            </div>
          </div>
          <label className="settings-input-row">
            昵称
            <input
              value={displayName}
              maxLength={150}
              placeholder={currentUser?.username ?? "账户昵称"}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <div className="settings-actions">
            <button
              className="primary-button"
              type="button"
              disabled={!displayName.trim() || isSavingProfile}
              onClick={() => onSaveProfile(displayName)}
            >
              {isSavingProfile ? "保存中..." : "保存昵称"}
            </button>
          </div>
        </section>

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
            {isGoogleBound ? (
              <button
                className="primary-button"
                type="button"
                disabled={!isConfigured || isBindingGoogle}
                onClick={onBindGoogle}
              >
                {isBindingGoogle ? "正在跳转..." : "绑定新的 Google 账户"}
              </button>
            ) : null}
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

        {status?.accounts?.length ? (
          <section className="settings-card">
            <div className="settings-card-header">
              <div>
                <p className="eyebrow">Google Accounts</p>
                <h3>已绑定账户</h3>
              </div>
            </div>
            <div className="google-account-list">
              {status.accounts.map((account) => (
                <GoogleAccountRow
                  account={account}
                  isAuthorizing={isAuthorizingCalendar}
                  isDisconnecting={isDisconnecting}
                  isToggling={isTogglingSync}
                  key={account.id}
                  onAuthorize={() => onAuthorizeCalendarAccount(account.id)}
                  onDisconnect={() => onDisconnectAccount(account.id)}
                  onToggleSync={(enabled) => onToggleAccountSync(account.id, enabled)}
                />
              ))}
            </div>
          </section>
        ) : null}

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
            开启后，所有任务会写入专用 Google Calendar。没有提醒时间的任务会作为全天事件，
            Google Calendar 里的修改不会反向覆盖 Todo。
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
                <strong>{status.calendarName || status.calendarId}</strong>
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
            <label className="compact-select">
              同步范围
              <input
                type="number"
                min={1}
                max={180}
                value={syncDays}
                disabled={!syncEnabled || isSyncing}
                onChange={(event) =>
                  onChangeSyncDays(clampSyncDays(Number(event.target.value)))
                }
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={!syncEnabled || isSyncing}
              onClick={onSync}
            >
              {isSyncing ? "同步中..." : `同步未来 ${syncDays} 天`}
            </button>
            {isAuthorizingCalendar ? (
              <span className="settings-inline-status">正在前往 Google 授权...</span>
            ) : null}
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="eyebrow">Trash</p>
              <h3>回收站</h3>
            </div>
            <span className="integration-status is-muted">
              {isTrashLoading ? "读取中" : `${trashItems.length} 项`}
            </span>
          </div>
          <p className="muted">删除后的任务会先留在这里，可以恢复到原来的日期。</p>

          {trashItems.length > 0 ? (
            <div className="settings-actions">
              <button
                className="ghost-button danger-action"
                type="button"
                disabled={isClearingTrash || isTrashLoading}
                onClick={() => {
                  if (window.confirm("确定清空回收站吗？这一步不能撤销。")) {
                    onClearTrash();
                  }
                }}
              >
                {isClearingTrash ? "清空中..." : "清空回收站"}
              </button>
            </div>
          ) : null}

          {isTrashLoading ? (
            <div className="settings-busy" role="status" aria-live="polite">
              <span className="loading-spinner" />
              <span>正在读取回收站...</span>
            </div>
          ) : trashItems.length === 0 ? (
            <p className="settings-note">回收站是空的。</p>
          ) : (
            <div className="trash-list">
              {trashItems.map((item) => (
                <article className="trash-row" key={item.id}>
                  <div>
                    <strong>{item.text}</strong>
                    <small>
                      {item.taskDate} 删除
                      {item.deletedAt
                        ? ` · ${new Date(item.deletedAt).toLocaleString()}`
                        : ""}
                    </small>
                  </div>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={restoringTrashId === item.id}
                    onClick={() => onRestoreTrash(item.id)}
                  >
                    {restoringTrashId === item.id ? "恢复中..." : "恢复"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </ModalShell>
  );
}

function GoogleAccountRow({
  account,
  isAuthorizing,
  isDisconnecting,
  isToggling,
  onAuthorize,
  onDisconnect,
  onToggleSync,
}: {
  account: GoogleCalendarAccount;
  isAuthorizing: boolean;
  isDisconnecting: boolean;
  isToggling: boolean;
  onAuthorize: () => void;
  onDisconnect: () => void;
  onToggleSync: (enabled: boolean) => void;
}) {
  const canToggle = account.calendarAuthorized && !isToggling;
  return (
    <article className="google-account-row">
      <span className="brand-mark google-mark">G</span>
      <div>
        <strong>{account.googleName || "Google 账户"}</strong>
        <small>{account.googleEmail || "已绑定"}</small>
        {account.lastError ? <em>{account.lastError}</em> : null}
      </div>
      <button
        className={`toggle-switch ${account.syncEnabled ? "is-on" : ""}`}
        type="button"
        aria-label={account.syncEnabled ? "关闭此账户同步" : "开启此账户同步"}
        aria-pressed={account.syncEnabled}
        disabled={!canToggle}
        onClick={() => onToggleSync(!account.syncEnabled)}
      >
        <span />
      </button>
      {!account.calendarAuthorized ? (
        <button
          className="ghost-button"
          type="button"
          disabled={isAuthorizing}
          onClick={onAuthorize}
        >
          授权日历
        </button>
      ) : null}
      <button
        className="ghost-button"
        type="button"
        disabled={isDisconnecting}
        onClick={onDisconnect}
      >
        取消绑定
      </button>
    </article>
  );
}

function QuickAddTask({
  date,
  isAiThinking,
  isSaving,
  lastAiReply,
  onAiSubmit,
  onSubmit,
}: {
  date: string;
  isAiThinking: boolean;
  isSaving: boolean;
  lastAiReply: string;
  onAiSubmit: (message: string) => void;
  onSubmit: (payload: {
    date: string;
    text: string;
    note: string;
    reminderTime: string | null;
    repeat: RepeatRule;
  }) => void;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"task" | "ai">("task");
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
    const trimmed = text.trim();
    if (mode === "ai") {
      if (!trimmed || isAiThinking) {
        return;
      }
      onAiSubmit(trimmed);
      setText("");
      return;
    }

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
    setInputSource(mode === "ai" ? "ai" : "typed");
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

  function changeMode(nextMode: "task" | "ai") {
    recognitionRef.current?.abort();
    setInputSource(nextMode === "ai" ? "ai" : "typed");
    setVoiceState({ status: "idle", message: "语音输入" });
    setMode(nextMode);
  }

  const isSubmitting = mode === "ai" ? isAiThinking : isSaving;
  const placeholder =
    mode === "ai"
      ? "用对话管理任务，例如：分析今天、整理待处理、添加明天提醒"
      : "添加任务，按 Enter 保存";

  return (
    <section className={`composer-panel surface-panel ${mode === "ai" ? "is-ai-mode" : ""}`}>
      <form className="composer-form" onSubmit={submit}>
        <button
          className={`composer-mode-button ${mode === "ai" ? "is-active" : ""}`}
          type="button"
          aria-label={mode === "ai" ? "切回普通添加任务" : "切换到 AI native 模式"}
          aria-pressed={mode === "ai"}
          onClick={() => changeMode(mode === "ai" ? "task" : "ai")}
          title={mode === "ai" ? "AI native 模式" : "普通添加任务"}
        >
          <SparklesIcon />
        </button>
      <input
        aria-label={mode === "ai" ? "AI native 输入" : "添加任务"}
        value={text}
        onChange={(event) => updateText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={placeholder}
        maxLength={mode === "ai" ? 800 : 280}
        disabled={isSubmitting}
      />
        {mode === "task" ? (
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
        ) : null}
      <button
        className="composer-send-button"
        type="submit"
        aria-label={mode === "ai" ? "发送 AI 指令" : "添加任务"}
        disabled={isSubmitting || !text.trim()}
        title={mode === "ai" ? "发送" : "添加任务"}
      >
        <SendIcon />
      </button>
      </form>
      {mode === "ai" && lastAiReply ? (
        <p className="ai-command-reply">{lastAiReply}</p>
      ) : null}
    </section>
  );
}

function TaskDetailsModal({
  accessToken,
  attachmentError,
  deletingAttachmentId,
  item,
  isDeleting,
  isSaving,
  isUploadingAttachment,
  onClose,
  onDelete,
  onDeleteAttachment,
  onReorderAttachments,
  onSave,
  onUploadAttachment,
}: {
  accessToken: string;
  attachmentError: Error | null;
  deletingAttachmentId: string | null;
  item: TodoOccurrence;
  isDeleting: boolean;
  isSaving: boolean;
  isUploadingAttachment: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDeleteAttachment: (attachmentId: string) => void;
  onReorderAttachments: (orderedIds: string[]) => void;
  onSave: (changes: {
    text: string;
    note: string;
    isLongTerm: boolean;
    isLowPriority: boolean;
    reminderTime: string | null;
    repeat: RepeatRule;
  }) => Promise<void>;
  onUploadAttachment: (file: File) => Promise<unknown>;
}) {
  const [text, setText] = useState(item.text);
  const [note, setNote] = useState(item.note);
  const [isLongTerm, setIsLongTerm] = useState(item.isLongTerm);
  const [isLowPriority, setIsLowPriority] = useState(item.isLowPriority);
  const [reminderTime, setReminderTime] = useState(item.reminderTime ?? "");
  const [repeatKind, setRepeatKind] = useState<RepeatKind>(item.repeat.kind);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [localSaving, setLocalSaving] = useState(false);
  const [localUploading, setLocalUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setText(item.text);
    setNote(item.note);
    setIsLongTerm(item.isLongTerm);
    setIsLowPriority(item.isLowPriority && !item.isLongTerm);
    setReminderTime(item.reminderTime ?? "");
    setRepeatKind(item.isLongTerm ? "daily" : item.repeat.kind);
    setSaveMessage("");
    setUploadMessage("");
  }, [
    item.id,
    item.isLongTerm,
    item.isLowPriority,
    item.note,
    item.reminderTime,
    item.repeat.kind,
    item.text,
  ]);

  useEffect(() => {
    if (isLongTerm) {
      setIsLowPriority(false);
      setRepeatKind("daily");
    }
  }, [isLongTerm]);

  async function uploadFiles(fileList: FileList | File[]) {
    const imageFiles = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }

    setUploadMessage(imageFiles.length > 1 ? "正在顺序上传图片..." : "正在上传图片...");
    setLocalUploading(true);
    try {
      for (const file of imageFiles) {
        const prepared = await prepareImageForUpload(file);
        if (prepared.wasCompressed) {
          setUploadMessage("图片超过 8MB，已压缩后上传。");
        }
        await onUploadAttachment(prepared.file);
      }
      setUploadMessage("图片已上传。");
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "图片上传失败。");
    } finally {
      setLocalUploading(false);
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      uploadFiles(event.target.files);
    }
    event.target.value = "";
  }

  function handleNoteDragOver(event: DragEvent<HTMLDivElement>) {
    if ([...event.dataTransfer.items].some((item) => item.type.startsWith("image/"))) {
      event.preventDefault();
      setIsDraggingImage(true);
    }
  }

  function handleNoteDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingImage(false);
    uploadFiles(event.dataTransfer.files);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      return;
    }
    setSaveMessage("保存中，关闭后仍会继续保存。");
    setLocalSaving(true);
    try {
      await onSave({
        text,
        note,
        isLongTerm,
        isLowPriority: isLowPriority && !isLongTerm,
        reminderTime: reminderTime || null,
        repeat: repeatRuleForDate(repeatKind, item.taskDate),
      });
      setSaveMessage("已保存。");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setLocalSaving(false);
    }
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
        <div
          className={`note-drop-zone ${isDraggingImage ? "is-dragging" : ""}`}
          onDragEnter={handleNoteDragOver}
          onDragLeave={() => setIsDraggingImage(false)}
          onDragOver={handleNoteDragOver}
          onDrop={handleNoteDrop}
        >
          <span>备注</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="补充细节、链接、上下文；也可以把图片拖到这里。"
            rows={5}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            multiple
            onChange={handleFileInputChange}
          />
          <div className="note-upload-row">
            <button
              className="icon-button tiny-icon-button"
              type="button"
              aria-label="上传图片"
              disabled={isUploadingAttachment || localUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon />
            </button>
            <small>{uploadMessage || "图片可拖到备注里，也可以点图标上传。"}</small>
          </div>
        </div>
        <TaskAttachmentGallery
          accessToken={accessToken}
          attachments={item.attachments}
          deletingAttachmentId={deletingAttachmentId}
          isUploading={isUploadingAttachment || localUploading}
          onDelete={onDeleteAttachment}
          onReorder={onReorderAttachments}
        />
        {attachmentError ? (
          <p className="settings-error">{attachmentError.message}</p>
        ) : null}
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
          <div className="toggle-field task-type-toggle">
            <span>
              <strong>长期任务</strong>
              <small>内容从当前日期开始同步到之后的任务</small>
            </span>
            <button
              className={`toggle-switch ${isLongTerm ? "is-on" : ""}`}
              type="button"
              aria-pressed={isLongTerm}
              onClick={() => {
                setIsLongTerm((value) => {
                  const next = !value;
                  if (next) {
                    setIsLowPriority(false);
                  }
                  return next;
                });
              }}
            >
              <span />
            </button>
          </div>
          <div className="toggle-field task-type-toggle low-priority-toggle-field">
            <span>
              <strong>低优先级任务</strong>
              <small>收进底部折叠栏，适合不紧急但想保留的任务</small>
            </span>
            <button
              className={`toggle-switch low-priority-toggle ${isLowPriority ? "is-on" : ""}`}
              type="button"
              aria-pressed={isLowPriority}
              onClick={() => {
                setIsLowPriority((value) => {
                  const next = !value;
                  if (next) {
                    setIsLongTerm(false);
                  }
                  return next;
                });
              }}
            >
              <span />
            </button>
          </div>
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
              disabled={isLongTerm}
              onChange={(event) => setRepeatKind(event.target.value as RepeatKind)}
            >
              {REPEAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {isLongTerm ? <small>长期任务会自动每天重复。</small> : null}
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
          {saveMessage ? (
            <span className="modal-save-status" role="status" aria-live="polite">
              {saveMessage}
            </span>
          ) : null}
          <span className="modal-spacer" />
          <button className="ghost-button" type="button" onClick={onClose}>
            关闭
          </button>
          <button className="primary-button" disabled={isSaving || localSaving} type="submit">
            {isSaving || localSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ConfirmDeleteModal({
  isDeleting,
  onCancel,
  onConfirm,
  task,
}: {
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  task: DeleteTaskPayload;
}) {
  return (
    <ModalShell title="删除任务" onClose={isDeleting ? () => undefined : onCancel}>
      <div className="confirm-delete-body">
        <p>确定要删除这条任务吗？删除后可以在几秒内撤销，也可以去 Settings 的回收站恢复。</p>
        <div className="delete-preview">
          <TrashIcon />
          <span>{task.text}</span>
        </div>
        <div className="modal-actions">
          <button
            className="ghost-button"
            type="button"
            disabled={isDeleting}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="primary-button danger-primary-button"
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? "删除中..." : "确认删除"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function UndoDeleteToast({
  isRestoring,
  onDismiss,
  onUndo,
  task,
}: {
  isRestoring: boolean;
  onDismiss: () => void;
  onUndo: () => void;
  task: DeleteTaskPayload;
}) {
  return (
    <div className="floating-action-toast" role="status" aria-live="polite">
      <div>
        <strong>已删除</strong>
        <span>{task.text}</span>
      </div>
      <button className="ghost-button" type="button" disabled={isRestoring} onClick={onUndo}>
        {isRestoring ? "恢复中..." : "撤销"}
      </button>
      <button className="icon-button tiny-icon-button" type="button" aria-label="关闭提示" onClick={onDismiss}>
        x
      </button>
    </div>
  );
}

function TaskActionToast({
  message,
  onDismiss,
  tone,
}: {
  message: string;
  onDismiss: () => void;
  tone: "success" | "error";
}) {
  return (
    <div
      className={`task-action-toast is-${tone}`}
      role="status"
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <span>{message}</span>
      <button className="icon-button tiny-icon-button" type="button" aria-label="关闭提示" onClick={onDismiss}>
        x
      </button>
    </div>
  );
}

function TaskAttachmentGallery({
  accessToken,
  attachments,
  deletingAttachmentId,
  isUploading,
  onDelete,
  onReorder,
}: {
  accessToken: string;
  attachments: TaskAttachment[];
  deletingAttachmentId: string | null;
  isUploading: boolean;
  onDelete: (attachmentId: string) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const [draggedAttachmentId, setDraggedAttachmentId] = useState<string | null>(null);

  if (attachments.length === 0 && !isUploading) {
    return null;
  }

  function reorderAttachmentBefore(targetId: string) {
    if (!draggedAttachmentId || draggedAttachmentId === targetId) {
      setDraggedAttachmentId(null);
      return;
    }
    const ids = attachments.map((attachment) => attachment.id);
    onReorder(reorderIds(ids, draggedAttachmentId, targetId));
    setDraggedAttachmentId(null);
  }

  return (
    <div className="attachment-section">
      <div className="attachment-section-header">
        <span>图片</span>
        {isUploading ? <small>上传中...</small> : null}
      </div>
      <div className="attachment-grid">
        {attachments.map((attachment) => (
          <TaskAttachmentThumb
            accessToken={accessToken}
            attachment={attachment}
            dragged={draggedAttachmentId === attachment.id}
            isDeleting={deletingAttachmentId === attachment.id}
            key={attachment.id}
            onDelete={() => onDelete(attachment.id)}
            onDragEnd={() => setDraggedAttachmentId(null)}
            onDragOver={() => reorderAttachmentBefore(attachment.id)}
            onDragStart={() => setDraggedAttachmentId(attachment.id)}
          />
        ))}
        {isUploading ? (
          <div className="attachment-tile attachment-uploading">
            <span className="loading-spinner" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const attachmentObjectUrlCache = new Map<string, string>();

function TaskAttachmentThumb({
  accessToken,
  attachment,
  dragged,
  isDeleting,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
}: {
  accessToken: string;
  attachment: TaskAttachment;
  dragged: boolean;
  isDeleting: boolean;
  onDelete: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDragStart: () => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cachedObjectUrl = attachmentObjectUrlCache.get(attachment.contentUrl);

    setLoadError(false);
    if (cachedObjectUrl) {
      setObjectUrl(cachedObjectUrl);
      return () => {
        cancelled = true;
      };
    }

    setObjectUrl(null);
    getTaskAttachmentBlob(attachment.contentUrl, accessToken)
      .then((blob) => {
        if (cancelled) {
          return;
        }
        const nextObjectUrl = URL.createObjectURL(blob);
        attachmentObjectUrlCache.set(attachment.contentUrl, nextObjectUrl);
        setObjectUrl(nextObjectUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, attachment.contentUrl]);

  return (
    <figure
      className={`attachment-tile ${dragged ? "is-dragging" : ""}`}
      draggable
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDragStart={onDragStart}
    >
      {objectUrl ? (
        <img src={objectUrl} alt={attachment.originalFilename} />
      ) : (
        <div className="attachment-placeholder">
          {loadError ? "加载失败" : <span className="loading-spinner" />}
        </div>
      )}
      <figcaption title={attachment.originalFilename}>
        {attachment.originalFilename}
      </figcaption>
      <button
        className="icon-button tiny-icon-button attachment-delete"
        type="button"
        aria-label="删除图片"
        disabled={isDeleting}
        onClick={onDelete}
      >
        {isDeleting ? <span className="loading-spinner" /> : <TrashIcon />}
      </button>
    </figure>
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

function emptyDay(date: string): DayTodos {
  return { date, pending: [], done: [] };
}

function orderedDayItems(day: DayTodos) {
  return [...day.pending, ...day.done].sort(compareOccurrences);
}

function sectionForOccurrence(item: TodoOccurrence): TaskSection {
  if (item.isLongTerm) {
    return "long-term";
  }
  if (item.isLowPriority) {
    return "low-priority";
  }
  return "regular";
}

function taskSectionFromDataset(value: string | undefined): TaskSection | null {
  if (value === "long-term" || value === "regular" || value === "low-priority") {
    return value;
  }
  return null;
}

function buildCalendarTaskBuckets(items: TodoOccurrence[]): CalendarTaskBuckets {
  const allDay: TodoOccurrence[] = [];
  const byMinute = new Map<number, TodoOccurrence[]>();

  items.forEach((item) => {
    const minutes = parseReminderMinutes(item.reminderTime);
    if (minutes === null) {
      allDay.push(item);
      return;
    }

    byMinute.set(minutes, [...(byMinute.get(minutes) ?? []), item]);
  });

  const timed = [...byMinute.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([minutes, group]) =>
      group.sort(compareOccurrences).map((item, lane) => ({
        item,
        lane,
        laneCount: group.length,
        minutes,
      })),
    );

  return { allDay, timed };
}

function parseReminderMinutes(reminderTime: string | null) {
  if (!reminderTime) {
    return null;
  }

  const match = /^(\d{1,2}):(\d{2})/.exec(reminderTime);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function formatHourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function googleCalendarCallbackNotice(
  status: string,
  message: string | null,
): GoogleCalendarNotice {
  if (status === "bound") {
    return {
      tone: "success",
      message: "Google 账户绑定成功。你现在可以开启 Calendar 单向同步。",
    };
  }

  if (status === "authorized") {
    return {
      tone: "success",
      message: "Google Calendar 授权成功，单向同步已开启。",
    };
  }

  return {
    tone: "error",
    message: message || "Google 授权失败，请确认账号已加入测试用户后再试。",
  };
}

function clampSyncDays(value: number) {
  if (!Number.isFinite(value)) {
    return 45;
  }
  return Math.min(180, Math.max(1, Math.round(value)));
}

async function prepareImageForUpload(file: File) {
  if (file.size <= MAX_IMAGE_UPLOAD_BYTES) {
    return { file, wasCompressed: false };
  }
  if (file.type === "image/gif") {
    throw new Error("GIF 超过 8MB 暂不支持自动压缩，请换一张更小的图片。");
  }

  const compressed = await compressImageFile(file);
  if (compressed.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error("图片压缩后仍超过 8MB，请换一张更小的图片。");
  }
  return { file: compressed, wasCompressed: true };
}

async function compressImageFile(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const maxSide = 1920;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("当前浏览器无法压缩图片。");
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const outputType = file.type === "image/png" ? "image/jpeg" : file.type || "image/jpeg";
    let quality = 0.86;
    let blob = await canvasToBlob(canvas, outputType, quality);
    while (blob.size > MAX_IMAGE_UPLOAD_BYTES && quality > 0.46) {
      quality -= 0.1;
      blob = await canvasToBlob(canvas, outputType, quality);
    }

    const extension = outputType === "image/webp" ? "webp" : "jpg";
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${baseName}-compressed.${extension}`, {
      type: outputType,
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("当前浏览器无法压缩图片。"));
        }
      },
      type,
      quality,
    );
  });
}


function applyPinOverridesToRange(
  data: RangeTodos | undefined,
  overrides: Record<string, PinOverride>,
) {
  const entries = Object.entries(overrides);
  if (!data || entries.length === 0) {
    return data;
  }

  return entries.reduce<RangeTodos | undefined>(
    (current, [id, override]) =>
      applyOptimisticOccurrenceUpdate(current, { id, pinned: override.pinned }),
    data,
  );
}

function applyOptimisticOccurrenceUpdate(
  data: RangeTodos | undefined,
  payload: UpdateOccurrencePayload,
) {
  if (!data) {
    return data;
  }

  let changed = false;

  const days = data.days.map((day) => {
    const items = [...day.pending, ...day.done];
    if (!items.some((item) => item.id === payload.id)) {
      return day;
    }

    changed = true;
    const nextItems = items.map((item) => {
      if (item.id !== payload.id) {
        return item;
      }

      const nextItem = { ...item };
      const now = new Date().toISOString();

      if ("done" in payload && payload.done !== undefined) {
        nextItem.status = payload.done ? "done" : "pending";
        nextItem.completedAt = payload.done ? now : null;
      }
      if ("text" in payload && payload.text !== undefined) {
        nextItem.text = payload.text;
      }
      if ("note" in payload && payload.note !== undefined) {
        nextItem.note = payload.note;
      }
      if ("pinned" in payload && payload.pinned !== undefined) {
        nextItem.isPinned = payload.pinned;
      }
      if ("isLongTerm" in payload && payload.isLongTerm !== undefined) {
        nextItem.isLongTerm = payload.isLongTerm;
        if (payload.isLongTerm) {
          nextItem.isLowPriority = false;
          nextItem.repeat = {
            kind: "daily",
            interval: 1,
            daysOfWeek: [],
            until: null,
          };
          nextItem.isRecurring = true;
        }
      }
      if ("isLowPriority" in payload && payload.isLowPriority !== undefined) {
        nextItem.isLowPriority = payload.isLowPriority;
        if (payload.isLowPriority) {
          nextItem.isLongTerm = false;
        }
      }
      if (
        ("pinned" in payload && payload.pinned !== undefined) ||
        ("isLowPriority" in payload && payload.isLowPriority !== undefined)
      ) {
        nextItem.sortOrder = nextOptimisticSortOrder(
          items,
          nextItem,
          payload.pinned === false ? "start" : "end",
        );
      }
      if ("reminderTime" in payload) {
        nextItem.reminderTime = payload.reminderTime ?? null;
      }
      if ("repeat" in payload && payload.repeat !== undefined) {
        nextItem.repeat = payload.repeat;
        nextItem.isRecurring = payload.repeat.kind !== "none";
      }

      nextItem.updatedAt = now;
      return nextItem;
    });

    return {
      ...day,
      pending: nextItems
        .filter((item) => item.status === "pending")
        .sort(compareOccurrences),
      done: nextItems
        .filter((item) => item.status === "done")
        .sort(compareOccurrences),
    };
  });

  return changed ? { ...data, days } : data;
}

function nextOptimisticSortOrder(
  items: TodoOccurrence[],
  updatedItem: TodoOccurrence,
  placement: "start" | "end",
) {
  const group = items.filter(
    (item) =>
      item.id !== updatedItem.id &&
      item.isPinned === updatedItem.isPinned &&
      item.isLowPriority === updatedItem.isLowPriority &&
      sectionForOccurrence(item) === sectionForOccurrence(updatedItem),
  );

  if (placement === "start") {
    const currentMin = group.reduce(
      (min, item) => Math.min(min, item.sortOrder),
      Number.POSITIVE_INFINITY,
    );
    return Number.isFinite(currentMin) ? Math.max(currentMin - 1000, 0) : 1000;
  }

  const currentMax = group.reduce(
    (max, item) => Math.max(max, item.sortOrder),
    0,
  );

  return currentMax + 1000;
}

function applyServerOccurrenceUpdate(
  data: RangeTodos | undefined,
  updated: TodoOccurrence,
) {
  if (!data) {
    return data;
  }

  let changed = false;
  const days = data.days.map((day) => {
    const items = [...day.pending, ...day.done];
    if (!items.some((item) => item.id === updated.id)) {
      return day;
    }

    changed = true;
    const nextItems = items.map((item) => (item.id === updated.id ? updated : item));
    return {
      ...day,
      pending: nextItems
        .filter((item) => item.status === "pending")
        .sort(compareOccurrences),
      done: nextItems
        .filter((item) => item.status === "done")
        .sort(compareOccurrences),
    };
  });

  return changed ? { ...data, days } : data;
}

function applyOccurrenceInsert(
  data: RangeTodos | undefined,
  created: TodoOccurrence,
) {
  if (!data) {
    return data;
  }

  let changed = false;
  const days = data.days.map((day) => {
    if (day.date !== created.taskDate) {
      return day;
    }
    if ([...day.pending, ...day.done].some((item) => item.id === created.id)) {
      return day;
    }
    changed = true;
    const targetKey = created.status === "done" ? "done" : "pending";
    return {
      ...day,
      [targetKey]: [...day[targetKey], created].sort(compareOccurrences),
    };
  });

  return changed ? { ...data, days } : data;
}

function applyAttachmentAdd(
  data: RangeTodos | undefined,
  occurrenceId: string,
  attachment: TaskAttachment,
) {
  if (!data) {
    return data;
  }

  let changed = false;
  const days = data.days.map((day) => {
    const updateItems = (items: TodoOccurrence[]) =>
      items.map((item) => {
        if (item.id !== occurrenceId) {
          return item;
        }
        changed = true;
        if (item.attachments.some((current) => current.id === attachment.id)) {
          return item;
        }
        return { ...item, attachments: [...item.attachments, attachment] };
      });

    return {
      ...day,
      pending: updateItems(day.pending),
      done: updateItems(day.done),
    };
  });

  return changed ? { ...data, days } : data;
}

function applyAttachmentRemove(
  data: RangeTodos | undefined,
  occurrenceId: string,
  attachmentId: string,
) {
  if (!data) {
    return data;
  }

  let changed = false;
  const days = data.days.map((day) => {
    const updateItems = (items: TodoOccurrence[]) =>
      items.map((item) => {
        if (item.id !== occurrenceId) {
          return item;
        }
        changed = true;
        return {
          ...item,
          attachments: item.attachments.filter((attachment) => attachment.id !== attachmentId),
        };
      });

    return {
      ...day,
      pending: updateItems(day.pending),
      done: updateItems(day.done),
    };
  });

  return changed ? { ...data, days } : data;
}

function applyAttachmentOrder(
  data: RangeTodos | undefined,
  occurrenceId: string,
  orderedIds: string[],
) {
  if (!data) {
    return data;
  }

  const orderById = new Map(orderedIds.map((id, index) => [id, index]));
  let changed = false;
  const days = data.days.map((day) => {
    const updateItems = (items: TodoOccurrence[]) =>
      items.map((item) => {
        if (item.id !== occurrenceId) {
          return item;
        }
        changed = true;
        return {
          ...item,
          attachments: [...item.attachments].sort(
            (left, right) =>
              (orderById.get(left.id) ?? 10_000) - (orderById.get(right.id) ?? 10_000),
          ),
        };
      });

    return {
      ...day,
      pending: updateItems(day.pending),
      done: updateItems(day.done),
    };
  });

  return changed ? { ...data, days } : data;
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
  if (left.isPinned !== right.isPinned) {
    return left.isPinned ? -1 : 1;
  }
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

  if (!items.some((item) => item.id === dragState.id)) {
    return items;
  }

  return reorderOccurrenceItems(
    items,
    dragState.id,
    dragState.targetId,
    dragState.targetSection,
  );
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

function reorderOccurrenceItems(
  items: TodoOccurrence[],
  draggedId: string,
  targetId: string | null,
  targetSection?: TaskSection | null,
) {
  const draggedItem = items.find((item) => item.id === draggedId);
  if (!draggedItem) {
    return items;
  }

  const dragSection = targetSection ?? sectionForOccurrence(draggedItem);
  const previewDraggedItem: TodoOccurrence = targetSection
    ? {
        ...draggedItem,
        isLongTerm: targetSection === "long-term",
        isLowPriority: targetSection === "low-priority",
      }
    : draggedItem;
  const group = [
    ...items.filter(
      (item) =>
        item.id !== draggedId &&
        item.isPinned === draggedItem.isPinned &&
        sectionForOccurrence(item) === dragSection,
    ),
    previewDraggedItem,
  ];
  const groupById = new Map(group.map((item) => [item.id, item]));
  const orderedGroup = reorderIds(
    group.map((item) => item.id),
    draggedId,
    targetId,
  )
    .map((id) => groupById.get(id))
    .filter((item): item is TodoOccurrence => Boolean(item));

  const nextGroup = [...orderedGroup];
  return items.map((item) => {
    if (
      item.isPinned === draggedItem.isPinned &&
      (item.id === draggedId || sectionForOccurrence(item) === dragSection)
    ) {
      return nextGroup.shift() ?? item;
    }
    return item;
  });
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
