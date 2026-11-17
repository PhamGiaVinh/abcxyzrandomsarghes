import { AssistantError, parseQuestion, record, UUID, VERSION } from './contracts.ts';
import { planQuestion } from './geminiPlanner.ts';
import { SePayReader } from './sepayRead.ts';

export type Environment = {
  url: string; anonKey: string; serviceKey: string; enabled: boolean;
  geminiKey: string; geminiModel: string; freeTierConfirmed: boolean;
};
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

export function createHandler(env: Environment, fetcher: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (!env.enabled) return json({ error: 'ASSISTANT_NOT_ENABLED' }, 503);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    const timer = setTimeout(abort, 20_000);
    const signal = controller.signal;
    try {
      const auth = request.headers.get('Authorization');
      if (!auth?.startsWith('Bearer ')) throw new AssistantError('UNAUTHORIZED', 401);
      // Bound the request before parsing or sending anything to a provider.
      const reader = request.body?.getReader();
      if (!reader) throw new AssistantError('INVALID_REQUEST');
      const cancelBody = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancelBody, { once: true });
      if (signal.aborted) cancelBody();
      let text = '', size = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8192) throw new AssistantError('INVALID_REQUEST', 413);
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { signal.removeEventListener('abort', cancelBody); await reader.cancel(); }
      if (signal.aborted) throw new AssistantError('REQUEST_TIMEOUT', 504);
      let input;
      try { input = parseQuestion(JSON.parse(text)); }
      catch { throw new AssistantError('INVALID_REQUEST'); }
      const authResponse = await fetcher(`${env.url}/auth/v1/user`, {
        headers: { Authorization: auth, apikey: env.anonKey }, signal, redirect: 'error',
      });
      if (!authResponse.ok) throw new AssistantError('UNAUTHORIZED', 401);
      const user = record(await authResponse.json());
      if (typeof user.id !== 'string' || !UUID.test(user.id)) throw new AssistantError('UNAUTHORIZED', 401);
      const rpc = async (name: string, body: unknown, service = false) => {
        const result = await fetcher(`${env.url}/rest/v1/rpc/${name}`, {
          method: 'POST', redirect: 'error', signal,
          headers: { Authorization: service ? `Bearer ${env.serviceKey}` : auth, apikey: service ? env.serviceKey : env.anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!result.ok) throw new AssistantError(result.status === 401 || result.status === 403 ? 'FORBIDDEN' : 'SOURCE_UNAVAILABLE', result.status === 401 || result.status === 403 ? 403 : 503);
        return result.json();
      };
      const checkOwner = async () => {
        if (await rpc('is_club_owner', { _user_id: user.id, _club_id: input.clubId }) !== true) throw new AssistantError('FORBIDDEN', 403);
      };
      await checkOwner();
      const config = record(await rpc('sepay_get_club_payment_config', { p_club_id: input.clubId }));
      if (config.error) throw new AssistantError('FORBIDDEN', 403);
      if (config.status !== 'ok' || config.provider !== 'sepay' || config.is_active !== true || config.has_api_token !== true
        || typeof config.master_account_number !== 'string') throw new AssistantError('SEPAY_NOT_CONNECTED', 409);
      if (!env.freeTierConfirmed || !env.geminiKey || !env.geminiModel) throw new AssistantError('FREE_TIER_NOT_CONFIGURED', 503);
      const reservation = record(await rpc('owner_sepay_reserve_request_v1', { p_actor_id: user.id, p_club_id: input.clubId, p_request_id: input.requestId }, true));
      if (reservation.allowed !== true) throw new AssistantError(reservation.duplicate === true ? 'REQUEST_ALREADY_USED' : 'RATE_LIMITED', reservation.duplicate === true ? 409 : 429);
      const plan = await planQuestion(input.question, { apiKey: env.geminiKey, model: env.geminiModel, freeTierConfirmed: env.freeTierConfirmed }, signal, fetcher);
      if (plan.intent === 'unsupported') return json({ version: VERSION, clubId: input.clubId, requestId: input.requestId, plan, evidence: null });
      await checkOwner();
      const token = await rpc('sepay_get_club_api_token', { p_club_id: input.clubId }, true);
      if (typeof token !== 'string' || !token) throw new AssistantError('SEPAY_NOT_CONNECTED', 409);
      const source = new SePayReader(token, fetcher);
      const account = await source.resolveAccount(config.master_account_number as string, signal);
      const evidence = await source.read(account, plan, signal);
      // Do not disclose a response after ownership/config was revoked or changed during the read.
      await checkOwner();
      const finalConfig = record(await rpc('sepay_get_club_payment_config', { p_club_id: input.clubId }));
      if (finalConfig.error || finalConfig.is_active !== true || finalConfig.master_account_number !== config.master_account_number
        || finalConfig.has_api_token !== true) throw new AssistantError('SCOPE_CHANGED', 403);
      return json({ version: VERSION, clubId: input.clubId, requestId: input.requestId, plan, evidence });
    } catch (error) {
      if (controller.signal.aborted) return json({ error: 'REQUEST_TIMEOUT' }, 504);
      return error instanceof AssistantError ? json({ error: error.code }, error.status) : json({ error: 'SOURCE_UNAVAILABLE' }, 503);
    } finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', abort);
    }
  };
}
