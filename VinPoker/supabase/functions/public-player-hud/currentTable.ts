const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface RpcClient {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}

// Public read only. The canonical reader resolves current session and enforces
// visibility on every query; this adapter never accepts a client session/actor.
export async function readPublicCurrentTable(client:RpcClient,input:unknown):Promise<Record<string,unknown>>{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('PUBLIC_TABLE_SCOPE_INVALID');
 const args=input as Record<string,unknown>;
 if(args.mode!=='current_table'||Object.keys(args).some(k=>!['mode','tournament_id','table_id'].includes(k))||
  typeof args.tournament_id!=='string'||!uuid.test(args.tournament_id)||
  typeof args.table_id!=='string'||!uuid.test(args.table_id))throw Error('PUBLIC_TABLE_SCOPE_INVALID');
 const reply=await client.rpc('get_public_tournament_table_live_or_last_hand_v2',{
  p_tournament_id:args.tournament_id,p_tournament_table_id:args.table_id,
 });
 if(reply.error||!reply.data||typeof reply.data!=='object'||Array.isArray(reply.data))throw Error('PUBLIC_TABLE_UNAVAILABLE');
 const value=reply.data as Record<string,unknown>;
 if(value.access==='revoked')return {access:'revoked'};
 if(value.error==='table_out_of_scope')return {error:'table_out_of_scope'};
 if(value.access!=='public'||value.tableId!==args.table_id||
  (value.tournamentId!==undefined&&value.tournamentId!==args.tournament_id)||
  !['live','last_completed','waiting','inactive','closed'].includes(String(value.state)))throw Error('PUBLIC_TABLE_SCOPE_MISMATCH');
 return value;
}
