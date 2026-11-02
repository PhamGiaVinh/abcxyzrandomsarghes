export type SeriesReorderRequest={p_club_id:string;p_expected:Array<{id:string;position:number}>;p_order:string[];p_request_id:string;p_expected_actor_id:string};
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export class SeriesReorderError extends Error{constructor(message:string,public readonly unknownOutcome=false){super(message);}}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export const seriesReorderJournalKey=(actor:string)=>`vinpoker:series-reorder:v1:${actor}`;
export function readSeriesReorderJournal(raw:string,actor:string):SeriesReorderRequest{
 const r:unknown=JSON.parse(raw);
 if(!object(r)||r.p_expected_actor_id!==actor||!uuid(r.p_club_id)||!uuid(r.p_request_id)||!Array.isArray(r.p_order)||!r.p_order.length||!r.p_order.every(uuid)
  ||!Array.isArray(r.p_expected)||r.p_expected.length!==r.p_order.length||!r.p_expected.every(x=>object(x)&&uuid(x.id)&&Number.isInteger(x.position)))
  throw new SeriesReorderError('Invalid pending reorder',true);
 return r as unknown as SeriesReorderRequest;
}
function confirmed(data:unknown,request:SeriesReorderRequest,actor:string){
 if(object(data)&&data.ok===false&&typeof data.error==='string')throw new SeriesReorderError(data.error);
 if(!object(data)||data.ok!==true||data.actor_id!==actor||data.club_id!==request.p_club_id||data.request_id!==request.p_request_id
  ||JSON.stringify(data.order)!==JSON.stringify(request.p_order))throw new SeriesReorderError('Unverified reorder outcome',true);
}
async function bounded<T>(response:PromiseLike<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve(response),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new SeriesReorderError('Reorder unavailable',true)),20_000);})]);}
 finally{clearTimeout(timer);}
}
export async function recoverSeriesReorder(rpc:Rpc,request:SeriesReorderRequest,actor:string){
 try{const r=await bounded(rpc('get_club_series_reorder_receipt_v1',{...request}));if(r.error)throw r.error;confirmed(r.data,request,actor);}
 catch{throw new SeriesReorderError('Reorder outcome remains unknown',true);}
}
export async function submitSeriesReorder(rpc:Rpc,request:SeriesReorderRequest,actor:string){
 let r:{data:unknown;error:unknown};
 try{r=await bounded(rpc('reorder_club_series_images_v1',{...request}));}
 catch{return recoverSeriesReorder(rpc,request,actor);}
 if(r.error){
  const e=r.error as {code?:string};
  if(['42501','P0001','22P02','22003','23502','23503','23505','23514','55P03'].includes(e.code??''))throw new SeriesReorderError(e.code!);
  return recoverSeriesReorder(rpc,request,actor);
 }
 confirmed(r.data,request,actor);
}
