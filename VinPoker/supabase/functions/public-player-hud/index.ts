import { createClient } from 'npm:@supabase/supabase-js@2.105.4';
import { handleOptions, jsonResp as baseJsonResp } from '../_shared/cors.ts';
import {readPublicHudAggregate,readPublicHudCompatibility} from './aggregate.ts';
function jsonResp(req:Request,data:unknown,status=200){
  const response=baseJsonResp(req,data,status);
  response.headers.set('Cache-Control','no-store');response.headers.set('Vary','Origin');
  return response;
}

Deno.serve(async req => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return jsonResp(req, {error:'METHOD_NOT_ALLOWED'},405);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !key) return jsonResp(req,{error:'MISCONFIGURED'},500);
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 4096) return jsonResp(req,{error:'REQUEST_TOO_LARGE'},413);
    const body = await req.text();
    if (new TextEncoder().encode(body).length > 4096) return jsonResp(req,{error:'REQUEST_TOO_LARGE'},413);
    const input = JSON.parse(body);
    // Never use service_role or forward Authorization, even for an operator caller.
    const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    if(input.mode==='summary'||input.mode==='history') return jsonResp(req,await readPublicHudAggregate(client,input.tournament_id,input.player_id,input.mode,input.cursor,input.access_snapshot));
    return jsonResp(req,await readPublicHudCompatibility(client,input));
  } catch(error) {
    if(error instanceof Error&&error.message==='PUBLIC_HUD_RELOAD_REQUIRED')return jsonResp(req,{error:'PUBLIC_HUD_RELOAD_REQUIRED'},409);
    return jsonResp(req,{error:'PUBLIC_HUD_UNAVAILABLE'},400);
  }
});
