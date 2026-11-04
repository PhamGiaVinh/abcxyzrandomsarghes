interface Client {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The existing anonymous DB reader retains all public/tenant/table gates. */
export async function readPublicTable(client:Client,input:Record<string,unknown>){
 if(Object.keys(input).length!==3||input.mode!=='table'||typeof input.tournament_id!=='string'||!uuid.test(input.tournament_id)||
  typeof input.table_id!=='string'||!uuid.test(input.table_id))throw Error('PUBLIC_TABLE_INPUT');
 const reply=await client.rpc('get_public_tournament_table_live_or_last_hand_v2',{
  p_tournament_id:input.tournament_id,p_tournament_table_id:input.table_id,
 });
 if(reply.error||!reply.data||typeof reply.data!=='object')throw Error('PUBLIC_TABLE_UNAVAILABLE');
 const value=reply.data as Record<string,unknown>;
 if(value.access==='public'&&value.tableId!==input.table_id)throw Error('PUBLIC_TABLE_SCOPE');
 return value;
}
