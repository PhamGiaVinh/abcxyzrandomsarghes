import {createAnonymousPublicHudClient} from '../../supabase/functions/public-player-hud/publicRpc';
import type {PublicHudRpcTiming} from '../../supabase/functions/public-player-hud/publicRpc';
import {readPublicHudAggregate} from '../../supabase/functions/public-player-hud/aggregate';
export {revalidatePublicHudRead,PUBLIC_HUD_REVALIDATION_WINDOW_MS} from './publicHudRevalidation';

export interface PublicHudReadInput {
  tournament_id:string;player_id:string;mode:'summary'|'history';cursor?:unknown;access_snapshot?:unknown;
}

// Browser and load harness use the same bounded reader, fixed public key,
// five-second deadline, counter validation and metric formatting. No session.
export async function readPublicHudRequest(url:string,key:string,input:PublicHudReadInput,signal:AbortSignal,send:typeof fetch=fetch){
  if(signal.aborted)throw Object.assign(Error('aborted'),{publicHudCallerCancelled:true});
  let outcome:PublicHudRpcTiming['outcome']|undefined;
  try{
    return await readPublicHudAggregate(createAnonymousPublicHudClient(url,key,send,signal,timing=>{outcome=timing.outcome;}),
      input.tournament_id,input.player_id,input.mode,input.cursor,input.access_snapshot);
  }catch(error){
    // The RPC deliberately sanitizes transport failures. Preserve caller
    // cancellation at this boundary; its internal deadline is NOT this signal.
    if(outcome==='deadline')throw Object.assign(Error('PUBLIC_HUD_UNAVAILABLE'),{publicHudDeadline:true});
    if(outcome==='cancelled'&&signal.aborted)throw Object.assign(Error('aborted'),{publicHudCallerCancelled:true});
    throw error;
  }
}
