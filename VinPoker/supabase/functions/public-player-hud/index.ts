import { createClient } from 'npm:@supabase/supabase-js@2.105.4';
import { handleOptions, jsonResp as baseJsonResp } from '../_shared/cors.ts';
import {readPublicHudAggregate,readPublicHudCompatibility} from './aggregate.ts';
const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY');
// Anonymous, stateless client shared within the Edge isolate. No caller session
// or Authorization header is ever installed on this client.
const publicClient=url&&key?createClient(url,key,{accessToken:async()=>key,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):null;
function jsonResp(req:Request,data:unknown,status=200){
  const response=baseJsonResp(req,data,status);
  response.headers.set('Cache-Control','no-store');response.headers.set('Vary','Origin');
  return response;
}

Deno.serve(async req => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return jsonResp(req, {error:'METHOD_NOT_ALLOWED'},405);
  if (!publicClient) return jsonResp(req,{error:'MISCONFIGURED'},500);
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 4096) return jsonResp(req,{error:'REQUEST_TOO_LARGE'},413);
    const body = await req.text();
    if (new TextEncoder().encode(body).length > 4096) return jsonResp(req,{error:'REQUEST_TOO_LARGE'},413);
    const input = JSON.parse(body);
    // Never use service_role or forward Authorization, even for an operator caller.
    if(input.mode==='summary'||input.mode==='history') return jsonResp(req,await readPublicHudAggregate(publicClient,input.tournament_id,input.player_id,input.mode,input.cursor,input.access_snapshot));
    return jsonResp(req,await readPublicHudCompatibility(publicClient,input));
  } catch(error) {
    if(error instanceof Error&&error.message==='PUBLIC_HUD_RELOAD_REQUIRED')return jsonResp(req,{error:'PUBLIC_HUD_RELOAD_REQUIRED'},409);
    return jsonResp(req,{error:'PUBLIC_HUD_UNAVAILABLE'},400);
  }
});
