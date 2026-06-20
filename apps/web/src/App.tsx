import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTask,
  deleteOccurrence,
  getDay,
  getMe,
  login,
  register,
  updateOccurrence,
} from "./api";
import { addDays, toDateKey } from "./date";

type AuthMode = "login" | "register";

const ACCESS_TOKEN_KEY = "daily-todo-sync.access-token";
const REFRESH_TOKEN_KEY = "daily-todo-sync.refresh-token";

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
  const [newText, setNewText] = useState("");
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe(accessToken),
  });

  const dayQuery = useQuery({
    queryKey: ["day", selectedDate],
    queryFn: () => getDay(selectedDate, accessToken),
  });

  const createMutation = useMutation({
    mutationFn: () => createTask(selectedDate, newText, accessToken),
    onSuccess: () => {
      setNewText("");
      queryClient.invalidateQueries({ queryKey: ["day", selectedDate] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; done?: boolean; text?: string }) => {
      const { id, ...changes } = payload;
      return updateOccurrence(id, changes, accessToken);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["day", selectedDate] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOccurrence(id, accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["day", selectedDate] }),
  });

  function addTask(event: FormEvent) {
    event.preventDefault();

    if (newText.trim()) {
      createMutation.mutate();
    }
  }

  const day = dayQuery.data;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Daily Todo Sync</p>
          <h1>{selectedDate === today ? "今天" : selectedDate}</h1>
          <p className="muted">
            {meQuery.data ? `${meQuery.data.username} 的 todolist` : "加载账户..."}
          </p>
        </div>

        <nav className="date-controls">
          <button type="button" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>
            ‹
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
          <button type="button" onClick={() => setSelectedDate(today)}>
            今天
          </button>
          <button type="button" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>
            ›
          </button>
          <button className="ghost-button" type="button" onClick={onLogout}>
            退出
          </button>
        </nav>
      </header>

      <section className="list-section">
        <div className="section-heading">
          <div>
            <h2>待处理</h2>
            <p className="muted">未完成项会在当天结束后进入下一天。</p>
          </div>
          <span className="count-pill">{day?.pending.length ?? 0}</span>
        </div>

        <form className="add-row" onSubmit={addTask}>
          <input
            value={newText}
            onChange={(event) => setNewText(event.target.value)}
            placeholder="新增待处理..."
            maxLength={280}
          />
          <button type="submit" aria-label="新增">
            +
          </button>
        </form>

        {dayQuery.isLoading ? <p className="empty-state is-visible">加载中...</p> : null}
        {day?.pending.length === 0 ? (
          <p className="empty-state is-visible">这里还没有待处理事项。</p>
        ) : null}

        <ul className="todo-list">
          {day?.pending.map((item) => (
            <li className="todo-item" key={item.id}>
              <input
                type="checkbox"
                checked={false}
                onChange={(event) =>
                  updateMutation.mutate({ id: item.id, done: event.target.checked })
                }
              />
              <div>
                <p>{item.text}</p>
                <p className="muted">创建：{new Date(item.createdAt).toLocaleString()}</p>
              </div>
              <button type="button" onClick={() => deleteMutation.mutate(item.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="list-section">
        <div className="section-heading">
          <h2>已完成</h2>
          <span className="count-pill">{day?.done.length ?? 0}</span>
        </div>
        {day?.done.length === 0 ? (
          <p className="empty-state is-visible">勾选完成后会出现在这里。</p>
        ) : null}
        <ul className="todo-list">
          {day?.done.map((item) => (
            <li className="todo-item is-done" key={item.id}>
              <input
                type="checkbox"
                checked
                onChange={(event) =>
                  updateMutation.mutate({ id: item.id, done: event.target.checked })
                }
              />
              <div>
                <p>{item.text}</p>
                <p className="muted">
                  完成：{item.completedAt ? new Date(item.completedAt).toLocaleString() : "-"}
                </p>
              </div>
              <button type="button" onClick={() => deleteMutation.mutate(item.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
