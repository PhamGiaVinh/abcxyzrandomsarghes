/** Read-only refresh lifecycle. Callers own errors and fence results to their scope. */
export function startLiveReportRefresh(read: () => Promise<void>, intervalMs = 5_000) {
  let active = true;
  let busy = false;
  let queued = false;
  const run = async () => {
    if (!active) return;
    if (busy) { queued = true; return; }
    busy = true;
    try { await read(); }
    finally {
      busy = false;
      if (active && queued) { queued = false; void run(); }
    }
  };
  const refresh = () => {
    if (document.visibilityState !== 'hidden') void run();
  };
  void run();
  // Slow polling must leave a settled read visible until the next tick.
  // Explicit focus/online signals still coalesce through refresh().
  const timer = window.setInterval(() => { if (!busy) refresh(); }, intervalMs);
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    active = false;
    window.clearInterval(timer);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('online', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}
