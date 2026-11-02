// Browser-cache incarnation only, never authorization. Keep bearer tokens out
// of query keys/devtools; weak ownership does not retain abandoned sessions.
let nextEpoch = 0;
const sessionEpochs = new WeakMap<object, { token: string | undefined; epoch: number }>();
export function sessionReadEpoch(session: { access_token?: string } | null | undefined): number {
  if (!session) return 0;
  const existing = sessionEpochs.get(session);
  if (existing && existing.token === session.access_token) return existing.epoch;
  const epoch = ++nextEpoch;
  sessionEpochs.set(session, { token: session.access_token, epoch });
  return epoch;
}
