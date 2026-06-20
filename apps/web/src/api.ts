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
  status: "pending" | "done";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  carryoverFromOccurrenceId: string | null;
};

export type DayTodos = {
  date: string;
  pending: TodoOccurrence[];
  done: TodoOccurrence[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

async function request<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
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

export function getMe(accessToken: string) {
  return request<User>("/auth/me", {}, accessToken);
}

export function getDay(date: string, accessToken: string) {
  return request<DayTodos>(`/days/${date}`, {}, accessToken);
}

export function createTask(date: string, text: string, accessToken: string) {
  return request<TodoOccurrence>(
    `/days/${date}/tasks`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
    accessToken,
  );
}

export function updateOccurrence(
  id: string,
  payload: { done?: boolean; text?: string },
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

export function deleteOccurrence(id: string, accessToken: string) {
  return request<void>(
    `/occurrences/${id}`,
    {
      method: "DELETE",
    },
    accessToken,
  );
}
