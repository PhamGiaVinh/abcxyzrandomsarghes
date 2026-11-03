import { createClient } from 'npm:@supabase/supabase-js@2.105.4';
import { handleOptions, jsonResp } from '../_shared/cors.ts';
import { readPublicPlayerHud } from './handler.ts';

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
    return jsonResp(req,await readPublicPlayerHud(client,input.tournament_id,input.player_id));
  } catch {
    return jsonResp(req,{error:'PUBLIC_HUD_UNAVAILABLE'},400);
  }
});
