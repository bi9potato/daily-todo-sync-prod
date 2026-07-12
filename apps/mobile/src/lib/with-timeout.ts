// Rejects with `message` if `promise` does not settle within `ms`. Used to
// keep one-shot device operations (GPS fix, geocoding, place search) from
// hanging a spinner forever when the underlying service stalls.
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
