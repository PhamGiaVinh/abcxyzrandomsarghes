export interface HandHistoryLoadGuard {
  begin(onTimeout?: () => void): number;
  isCurrent(request: number): boolean;
  finish(request: number): void;
  invalidate(): void;
}

/** Keeps a late hand-history response from replacing a newer table selection. */
export function createHandHistoryLoadGuard(): HandHistoryLoadGuard {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearDeadline = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    begin: (onTimeout) => {
      clearDeadline();
      const request = ++generation;
      if (onTimeout) timer = setTimeout(() => {
        timer = null;
        generation += 1;
        onTimeout();
      }, 20_000);
      return request;
    },
    isCurrent: (request) => request === generation,
    finish: (request) => { if (request === generation) clearDeadline(); },
    invalidate: () => {
      clearDeadline();
      generation += 1;
    },
  };
}
