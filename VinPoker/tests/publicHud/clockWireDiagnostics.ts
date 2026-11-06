import {RealtimeClient} from '@supabase/realtime-js';
// Decode with the installed browser SDK's binary protocol. Never connect this
// codec-only client, and never retain raw frames in an artifact.
const codec=new RealtimeClient('ws://127.0.0.1:1/realtime/v1',{params:{apikey:'LOCAL_TEST_ONLY'}});
export function decodeClockWireFrame(raw: string | Uint8Array): unknown {
  if(typeof raw==='string')return JSON.parse(raw);
  let wire:unknown=null;
  codec.decode(new Uint8Array(raw).buffer,(value:unknown)=>{wire=value;});
  return wire;
}
/** Decode only the numeric/component evidence allowed in clock test artifacts. */
export function clockBroadcastSignal(wire: unknown, tournamentId: string): {components: string[]; clockRevision: string | null} | null {
  if (!wire || typeof wire !== 'object') return null;
  const row = wire as Record<string, unknown>;
  const event = Array.isArray(wire) ? wire[3] : row.event;
  const topic = Array.isArray(wire) ? wire[2] : row.topic;
  const outer = (Array.isArray(wire) ? wire[4] : row.payload) as Record<string, unknown> | null;
  if (event !== 'broadcast' || topic !== 'realtime:public:tournament-viewer-v2:' + tournamentId || outer?.event !== 'changed') return null;
  const payload = outer.payload as Record<string, unknown> | null;
  if (payload?.tournamentId !== tournamentId) return null;
  const components = Array.isArray(payload.components) ? payload.components.filter((c): c is string => typeof c === 'string' && ['tables','ranking','payout','visibility','clock'].includes(c)) : [];
  const revision = (payload.revisions as Record<string, unknown> | null)?.clock;
  return {components, clockRevision: typeof revision === 'string' && /^\d{1,32}$/.test(revision) ? revision : null};
}
