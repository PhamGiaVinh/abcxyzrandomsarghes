import { z } from 'zod';
const Schema = z.object({ actorId: z.string().min(1), tokenHash: z.string().regex(/^[a-f0-9]{64}$/), groupId: z.string().uuid(), requestId: z.string().uuid() }).strict();
export type GroupInviteIntent = z.infer<typeof Schema>;
const key = (actor: string, digest: string) => `vinpoker:group-invite:v1:${encodeURIComponent(actor)}:${digest}`;
async function tokenHash(token: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), value => value.toString(16).padStart(2, '0')).join('');
}
export async function readGroupInviteIntent(storage: Pick<Storage, 'getItem'>, actor: string, token: string) {
  const digest = await tokenHash(token), raw = storage.getItem(key(actor, digest));
  if (raw === null) return null;
  const intent = Schema.parse(JSON.parse(raw));
  if (intent.actorId !== actor || intent.tokenHash !== digest) throw new Error('INVITE_INTENT_SCOPE_INVALID');
  return intent;
}
export async function persistGroupInviteIntent(storage: Pick<Storage, 'getItem' | 'setItem'>, actor: string, token: string, group: string) {
  const existing = await readGroupInviteIntent(storage, actor, token);
  if (existing) {
    if (existing.groupId !== group) throw new Error('INVITE_INTENT_PENDING');
    return existing;
  }
  const intent = Schema.parse({ actorId: actor, tokenHash: await tokenHash(token), groupId: group, requestId: crypto.randomUUID() });
  const raw = JSON.stringify(intent), scope = key(actor, intent.tokenHash);
  storage.setItem(scope, raw);
  if (storage.getItem(scope) !== raw) throw new Error('INVITE_INTENT_SAVE_FAILED');
  return intent;
}
export function clearGroupInviteIntent(storage: Pick<Storage, 'getItem' | 'removeItem'>, intent: GroupInviteIntent) {
  const parsed = Schema.parse(intent), scope = key(parsed.actorId, parsed.tokenHash), raw = storage.getItem(scope);
  if (raw === null) return;
  if (raw !== JSON.stringify(parsed)) throw new Error('INVITE_INTENT_CHANGED');
  storage.removeItem(scope);
  if (storage.getItem(scope) !== null) throw new Error('INVITE_INTENT_CLEAR_FAILED');
}
