export type User = {
  id: string;
  username: string;
  email: string;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  tokenType: "bearer";
};

export type TodoOccurrence = {
  id: string;
  taskId: string;
  rootId: string;
  taskDate: string;
  text: string;
  note: string;
  status: "pending" | "done";
  source: "manual" | "carryover" | "recurring";
  sortOrder: number;
  isPinned: boolean;
  isLowPriority: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  carryoverFromOccurrenceId: string | null;
  firstCreatedAt: string;
  reminderTime: string | null;
  reminderAt: string | null;
  isRecurring: boolean;
  isLongTerm: boolean;
  repeat: RepeatRule;
  attachments: TaskAttachment[];
};

export type DeletedTodoOccurrence = TodoOccurrence & {
  deletedAt: string | null;
};

export type TaskAttachment = {
  id: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  contentUrl: string;
};

export type DayTodos = {
  date: string;
  pending: TodoOccurrence[];
  done: TodoOccurrence[];
};

export type RangeTodos = {
  start: string;
  end: string;
  days: DayTodos[];
};

export type RepeatKind = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export type RepeatRule = {
  kind: RepeatKind;
  interval: number;
  daysOfWeek: number[];
  until: string | null;
};

export type TaskCreatePayload = {
  text: string;
  note?: string;
  isLongTerm?: boolean;
  isLowPriority?: boolean;
  reminderTime?: string | null;
  repeat?: RepeatRule;
};

export type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  googleBound: boolean;
  googleEmail: string;
  googleName: string;
  calendarAuthorized: boolean;
  canUseCalendarSync: boolean;
  syncEnabled: boolean;
  calendarId: string;
  calendarName: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string;
  syncedCount: number;
  failedCount: number;
};

export type GoogleCalendarAuthUrl = {
  authorizationUrl: string;
};

export type GoogleAuthUrl = {
  authorizationUrl: string;
};

export type GoogleCalendarSyncResult = {
  start: string;
  end: string;
  synced: number;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
export const ACCESS_TOKEN_KEY = "daily-todo-sync.access-token";
export const REFRESH_TOKEN_KEY = "daily-todo-sync.refresh-token";
export const AUTH_TOKENS_UPDATED_EVENT = "daily-todo-sync:tokens-updated";
export const SESSION_EXPIRED_EVENT = "daily-todo-sync:session-expired";

let refreshPromise: Promise<string> | null = null;

function formatErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => formatErrorDetail(item))
      .filter((item): item is string => Boolean(item));
    return messages.length > 0 ? messages.join("\n") : null;
  }

  if (detail && typeof detail === "object") {
    const messages = Object.values(detail)
      .map((item) => formatErrorDetail(item))
      .filter((item): item is string => Boolean(item));
    return messages.length > 0 ? messages.join("\n") : null;
  }

  return null;
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `请求失败（${response.status}）`;
  const text = await response.text();

  if (!text) {
    return fallback;
  }

  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
    return (
      formatErrorDetail(body.detail) ??
      formatErrorDetail(body.message) ??
      formatErrorDetail(body.error) ??
      fallback
    );
  } catch {
    return text;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string,
  retryOnUnauthorized = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && accessToken && retryOnUnauthorized) {
    const refreshedAccessToken = await refreshStoredToken();
    return request<T>(path, options, refreshedAccessToken, false);
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function refreshStoredToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new Error("登录已过期，请重新登录。");
  }

  refreshPromise = request<TokenPair>(
    "/auth/refresh",
    {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    },
    undefined,
    false,
  )
    .then((tokens) => {
      localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
      window.dispatchEvent(
        new CustomEvent<TokenPair>(AUTH_TOKENS_UPDATED_EVENT, { detail: tokens }),
      );
      return tokens.accessToken;
    })
    .catch((error) => {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export function register(payload: {
  username: string;
  email: string;
  password: string;
}) {
  return request<TokenPair>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: { identifier: string; password: string }) {
  return request<TokenPair>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startGoogleAuth() {
  return request<GoogleAuthUrl>("/auth/google", {
    method: "POST",
  });
}

export function getMe(accessToken: string) {
  return request<User>("/auth/me", {}, accessToken);
}

export function getDay(date: string, accessToken: string) {
  return request<DayTodos>(`/days/${date}`, {}, accessToken);
}

export function getRange(start: string, end: string, accessToken: string) {
  return request<RangeTodos>(`/range?start=${start}&end=${end}`, {}, accessToken);
}

export function createTask(date: string, payload: TaskCreatePayload, accessToken: string) {
  return request<TodoOccurrence>(
    `/days/${date}/tasks`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    accessToken,
  );
}

export function updateOccurrence(
  id: string,
  payload: {
    done?: boolean;
    text?: string;
    note?: string;
    pinned?: boolean;
    isLongTerm?: boolean;
    isLowPriority?: boolean;
    reminderTime?: string | null;
    repeat?: RepeatRule;
  },
  accessToken: string,
) {
  return request<TodoOccurrence>(
    `/occurrences/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    accessToken,
  );
}

export function copyLongTermOccurrenceAsRegular(id: string, accessToken: string) {
  return request<TodoOccurrence>(
    `/occurrences/${id}/copy-regular`,
    {
      method: "POST",
    },
    accessToken,
  );
}

export function reorderDay(date: string, orderedIds: string[], accessToken: string) {
  return request<void>(
    `/days/${date}/reorder`,
    {
      method: "PATCH",
      body: JSON.stringify({ orderedIds }),
    },
    accessToken,
  );
}

export function reorderTaskAttachments(
  occurrenceId: string,
  orderedIds: string[],
  accessToken: string,
) {
  return request<void>(
    `/occurrences/${occurrenceId}/attachments/reorder`,
    {
      method: "PATCH",
      body: JSON.stringify({ orderedIds }),
    },
    accessToken,
  );
}

export function deleteOccurrence(id: string, accessToken: string) {
  return request<void>(
    `/occurrences/${id}`,
    {
      method: "DELETE",
    },
    accessToken,
  );
}

export function getTrash(accessToken: string) {
  return request<DeletedTodoOccurrence[]>("/trash", {}, accessToken);
}

export function restoreOccurrence(id: string, accessToken: string) {
  return request<TodoOccurrence>(
    `/occurrences/${id}/restore`,
    {
      method: "POST",
    },
    accessToken,
  );
}

export function getGoogleCalendarStatus(accessToken: string) {
  return request<GoogleCalendarStatus>(
    "/integrations/google-calendar/status",
    {},
    accessToken,
  );
}

export function bindGoogleAccount(accessToken: string) {
  return request<GoogleCalendarAuthUrl>(
    "/integrations/google-account/bind",
    {
      method: "POST",
    },
    accessToken,
  );
}

export function disconnectGoogleAccount(accessToken: string) {
  return request<void>(
    "/integrations/google-account/disconnect",
    {
      method: "POST",
    },
    accessToken,
  );
}

export function authorizeGoogleCalendar(accessToken: string) {
  return request<GoogleCalendarAuthUrl>(
    "/integrations/google-calendar/authorize",
    {
      method: "POST",
    },
    accessToken,
  );
}

export function setGoogleCalendarSyncEnabled(enabled: boolean, accessToken: string) {
  return request<GoogleCalendarStatus>(
    "/integrations/google-calendar/sync-enabled",
    {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    },
    accessToken,
  );
}

export function syncGoogleCalendar(accessToken: string) {
  return syncGoogleCalendarForDays(45, accessToken);
}

export function syncGoogleCalendarForDays(days: number, accessToken: string) {
  return request<GoogleCalendarSyncResult>(
    `/integrations/google-calendar/sync?days=${encodeURIComponent(String(days))}`,
    {
      method: "POST",
    },
    accessToken,
  );
}

export function uploadTaskAttachment(
  occurrenceId: string,
  file: File,
  accessToken: string,
) {
  const formData = new FormData();
  formData.append("file", file);
  return request<TaskAttachment>(
    `/occurrences/${occurrenceId}/attachments`,
    {
      method: "POST",
      body: formData,
    },
    accessToken,
  );
}

export function deleteTaskAttachment(
  attachmentId: string,
  accessToken: string,
  occurrenceId?: string,
) {
  const query = occurrenceId ? `?occurrenceId=${encodeURIComponent(occurrenceId)}` : "";
  return request<void>(
    `/attachments/${attachmentId}${query}`,
    {
      method: "DELETE",
    },
    accessToken,
  );
}

export async function getTaskAttachmentBlob(contentUrl: string, accessToken: string) {
  let token = accessToken;
  let response = await fetch(contentUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    token = await refreshStoredToken();
    response = await fetch(contentUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.blob();
}
