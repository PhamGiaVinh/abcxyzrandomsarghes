/** Bound read-only context observation; never retry a mutation on a read timeout. */
export async function observeTrackerContextRead<T>(response: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(response),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("tracker_context_read_timeout")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
