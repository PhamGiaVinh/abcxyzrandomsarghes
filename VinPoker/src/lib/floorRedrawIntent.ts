import type { FloorRedrawIntent } from './floorTableControlV3';

export type FloorRedrawScope = { backendScope: string; actorId: string; tournamentId: string };
export type FloorRedrawJournal = {
  version: 1;
  backendScope: string;
  planIntent: Extract<FloorRedrawIntent, { operation: 'plan' }>;
  applyIntent?: Extract<FloorRedrawIntent, { operation: 'apply' }>;
  continueIntent?: Extract<FloorRedrawIntent, { operation: 'continue' }>;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.prototype.hasOwnProperty.call(v, k));
function validScope(scope: FloorRedrawScope) {
  return typeof scope.backendScope === 'string' && scope.backendScope.length > 0 && scope.backendScope.length <= 2048
    && uuid(scope.actorId) && uuid(scope.tournamentId);
}
export function floorRedrawJournalKey(scope: FloorRedrawScope) {
  if (!validScope(scope)) throw Error('REDRAW_SCOPE_INVALID');
  return `floor-redraw-v1:${JSON.stringify([scope.backendScope, scope.actorId, scope.tournamentId])}`;
}
export function readFloorRedrawJournal(raw: string, scope: FloorRedrawScope): FloorRedrawJournal {
  const j: unknown = JSON.parse(raw);
  const invalid = () => { throw Error('REDRAW_JOURNAL_INVALID'); };
  if (!validScope(scope) || !object(j) || j.version !== 1 || j.backendScope !== scope.backendScope
    || !keys(j, ['version', 'backendScope', 'planIntent', ...('applyIntent' in j ? ['applyIntent'] : []), ...('continueIntent' in j ? ['continueIntent'] : [])])) return invalid();
  const base = (v: unknown, operation: string, fields: string[]): v is Record<string, unknown> => object(v)
    && keys(v, ['actorId', 'tournamentId', 'requestId', 'operation', ...fields])
    && v.actorId === scope.actorId && v.tournamentId === scope.tournamentId && uuid(v.requestId) && v.operation === operation;
  const p = j.planIntent;
  if (!base(p, 'plan', ['targetMaxSeats', 'gameTableIds']) || (p.targetMaxSeats !== 8 && p.targetMaxSeats !== 9)
    || !Array.isArray(p.gameTableIds) || !p.gameTableIds.length || p.gameTableIds.length > 100
    || !p.gameTableIds.every(uuid) || new Set(p.gameTableIds.map(id => id.toLowerCase())).size !== p.gameTableIds.length) return invalid();
  const a = j.applyIntent, c = j.continueIntent;
  if ('applyIntent' in j && (!base(a, 'apply', ['batchId']) || !uuid(a.batchId))) return invalid();
  if ('continueIntent' in j && (!base(c, 'continue', ['batchId', 'expectedRedrawRevision']) || !object(a)
    || !uuid(c.batchId) || c.batchId !== a.batchId || typeof c.expectedRedrawRevision !== 'number'
    || !Number.isSafeInteger(c.expectedRedrawRevision) || c.expectedRedrawRevision < 0)) return invalid();
  // The journal records intent only; authoritative plans/results are always read from the server.
  return j as unknown as FloorRedrawJournal;
}
export function saveFloorRedrawJournal(storage: Pick<Storage, 'getItem' | 'setItem'>, scope: FloorRedrawScope,
  journal: FloorRedrawJournal, expectedRaw: string | null): string {
  const raw = JSON.stringify(journal), key = floorRedrawJournalKey(scope);
  readFloorRedrawJournal(raw, scope);
  if (storage.getItem(key) !== expectedRaw) throw Error('REDRAW_JOURNAL_CHANGED');
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw Error('REDRAW_JOURNAL_SAVE_FAILED');
  return raw;
}
export function clearFloorRedrawJournal(storage: Pick<Storage, 'getItem' | 'removeItem'>, scope: FloorRedrawScope, expectedRaw: string) {
  const key = floorRedrawJournalKey(scope);
  if (storage.getItem(key) !== expectedRaw) throw Error('REDRAW_JOURNAL_CHANGED');
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw Error('REDRAW_JOURNAL_CLEAR_FAILED');
}
