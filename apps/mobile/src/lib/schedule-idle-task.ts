type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type IdleGlobal = typeof globalThis & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function scheduleIdleTask(task: () => void, timeout = 1_000) {
  const idleGlobal = globalThis as IdleGlobal;
  if (idleGlobal.requestIdleCallback) {
    const handle = idleGlobal.requestIdleCallback(task, { timeout });
    return () => idleGlobal.cancelIdleCallback?.(handle);
  }

  const handle = setTimeout(task, 0);
  return () => clearTimeout(handle);
}
