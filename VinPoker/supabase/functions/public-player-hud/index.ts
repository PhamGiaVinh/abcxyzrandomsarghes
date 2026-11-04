import {createPublicHudReadBatcher} from './readBatch.ts';
import type {PublicHudReadTiming} from './readBatch.ts';
import { handleOptions, jsonResp as baseJsonResp } from '../_shared/cors.ts';
import {readPublicHudAggregate,readPublicHudCompatibility} from './aggregate.ts';
import {readPublicTable} from './table.ts';
const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY');
// Validate fixed anonymous configuration once. Request-local adapters below
// never install a caller session or forward its Authorization header.
const publicClient=url&&key?createPublicHudReadBatcher(url,key):null;
function jsonResp(req:Request,data:unknown,status=200){
  const response=baseJsonResp(req,data,status);
  response.headers.set('Cache-Control','no-store');response.headers.set('Vary','Origin');
  return response;
}

Deno.serve(async req => {
  const started=performance.now();
  let rpcTiming:PublicHudReadTiming|undefined;
  const respond=(data:unknown,status=200)=>{
    const response=jsonResp(req,data,status);
    // Public duration only: no query, identity, credential or source data.
    response.headers.set('Server-Timing',`hud;dur=${(performance.now()-started).toFixed(3)}${rpcTiming?`, hud_rpc;dur=${rpcTiming.durationMs.toFixed(3)};desc="${rpcTiming.outcome}", hud_group;desc="${rpcTiming.groupSize}"`:''}`);
    return response;
  };
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return respond({error:'METHOD_NOT_ALLOWED'},405);
  if (!publicClient) return respond({error:'MISCONFIGURED'},500);
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 4096) return respond({error:'REQUEST_TOO_LARGE'},413);
    const body = await req.text();
    if (new TextEncoder().encode(body).length > 4096) return respond({error:'REQUEST_TOO_LARGE'},413);
    const input = JSON.parse(body);
    // Cancellation belongs to this request only. Retain the independent RPC
    // timeout and fixed anonymous credentials; never mutate a shared signal.
    const requestClient=publicClient.forRequest(req.signal,value=>{rpcTiming=value;});
    if(input.mode==='table')return respond(await readPublicTable(requestClient,input));
    // Never use service_role or forward Authorization, even for an operator caller.
    if(input.mode==='summary'||input.mode==='history') return respond(await readPublicHudAggregate(requestClient,input.tournament_id,input.player_id,input.mode,input.cursor,input.access_snapshot));
    return respond(await readPublicHudCompatibility(requestClient,input));
  } catch(error) {
    if(error instanceof Error&&error.message==='PUBLIC_HUD_RELOAD_REQUIRED')return respond({error:'PUBLIC_HUD_RELOAD_REQUIRED'},409);
    return respond({error:'PUBLIC_HUD_UNAVAILABLE'},400);
  }
});
