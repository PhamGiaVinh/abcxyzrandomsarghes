import {createAnonymousPublicHudClient} from '../../supabase/functions/public-player-hud/publicRpc';
import {readPublicHudAggregate} from '../../supabase/functions/public-player-hud/aggregate';

export interface PublicHudReadInput {
  tournament_id:string;player_id:string;mode:'summary'|'history';cursor?:unknown;access_snapshot?:unknown;
}

// Browser and load harness use the same bounded reader, fixed public key,
// five-second deadline, counter validation and metric formatting. No session.
export async function readPublicHudRequest(url:string,key:string,input:PublicHudReadInput,signal:AbortSignal,send:typeof fetch=fetch){
  if(signal.aborted)throw Error('aborted');
  return readPublicHudAggregate(createAnonymousPublicHudClient(url,key,send,signal),
    input.tournament_id,input.player_id,input.mode,input.cursor,input.access_snapshot);
}
