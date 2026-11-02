/** Bound one OCR read, including file conversion; never retry or create tournaments here. */
export async function observeScheduleAnalysis<T>(parent: AbortSignal, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
 const controller = new AbortController();
 let timer: ReturnType<typeof setTimeout> | undefined;
 let onAbort: (() => void) | undefined;
 try {
  return await Promise.race([
   new Promise<never>((_, reject) => {
    onAbort = () => { reject(new Error('SCHEDULE_ANALYSIS_CANCELLED')); controller.abort(); };
    if (parent.aborted) { onAbort(); return; }
    parent.addEventListener('abort', onAbort, {once:true});
    timer = setTimeout(() => {
     reject(new Error('Phân tích ảnh quá thời gian chờ. Hãy thử lại.'));
     controller.abort();
    }, 60_000);
   }),
   Promise.resolve().then(() => {
    if (controller.signal.aborted) throw new Error('SCHEDULE_ANALYSIS_CANCELLED');
    return read(controller.signal);
   }),
  ]);
 } finally {
  clearTimeout(timer);
  if (onAbort) parent.removeEventListener('abort', onAbort);
 }
}
