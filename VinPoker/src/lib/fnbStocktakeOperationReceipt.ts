import type {StocktakeOperationIntent} from './fnbStocktakeOperationIntent';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
// Compare PostgreSQL numeric TEXT exactly; never use rounded JSON numbers as proof.
function decimal(value:unknown):{coefficient:bigint;exponent:number}|null{
  if(typeof value!=='string'||value.length>4096)return null;
  const text=value.trim().replace(/^([+-]?)\./,(_match,sign:string)=>sign+'0.');
  const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);if(!m)return null;
  let digits=(m[2]+(m[3]??'')).replace(/^0+/,''),exponent=Number(m[4]??0)-(m[3]?.length??0);
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>10000)return null;
  if(!digits)return {coefficient:0n,exponent:0};
  const stripped=digits.replace(/0+$/,'');exponent+=digits.length-stripped.length;digits=stripped;if(Math.abs(exponent)>10000)return null;
  return {coefficient:BigInt((m[1]==='-'?'-':'')+digits),exponent};
}
const equal=(a:ReturnType<typeof decimal>,b:ReturnType<typeof decimal>)=>!!a&&!!b&&a.coefficient===b.coefficient&&a.exponent===b.exponent;
export type StocktakeOperationProof={sessionId:string;status:'open'|'committed';recordedBy:string};
export function resolveStocktakeOperationReceipt(intent:StocktakeOperationIntent,session:unknown,lines?:{rows:unknown;count:unknown}):{status:'unknown'}|{status:'found';proof:StocktakeOperationProof}{
  const unknown={status:'unknown'} as const;
  if(!object(session)||!uuid(session.id)||session.club_id!==intent.clubId||session.status!=='open'&&session.status!=='committed')return unknown;
  if(session.status==='committed'&&(!uuid(session.committed_by)||!date(session.committed_at)))return unknown;
  if(intent.kind==='open'){
    if(session.client_request_id!==intent.requestId||session.created_by!==intent.actorId||session.note!==null||!date(session.created_at))return unknown;
    return {status:'found',proof:{sessionId:session.id,status:session.status as 'open'|'committed',recordedBy:session.status==='committed'?session.committed_by as string:intent.actorId}};
  }
  if(session.id!==intent.sessionId||session.status!=='committed'||!lines||!Array.isArray(lines.rows)
    ||lines.count!==Object.keys(intent.counts).length||lines.rows.length!==lines.count)return unknown;
  const seen=new Set<string>();
  for(const row of lines.rows){
    if(!object(row)||row.stocktake_id!==intent.sessionId||row.club_id!==intent.clubId||!uuid(row.ingredient_id)||seen.has(row.ingredient_id)
      ||!Object.prototype.hasOwnProperty.call(intent.counts,row.ingredient_id))return unknown;
    const counted=decimal(row.counted_qty),expected=decimal(row.expected_qty),delta=decimal(row.delta_applied),frozen=decimal(intent.counts[row.ingredient_id]);
    if(!equal(counted,frozen)||!counted||counted.coefficient<0n||!expected||!delta)return unknown;
    const exponent=Math.min(counted.exponent,expected.exponent,delta.exponent);
    if(expected.coefficient*10n**BigInt(expected.exponent-exponent)+delta.coefficient*10n**BigInt(delta.exponent-exponent)
      !==counted.coefficient*10n**BigInt(counted.exponent-exponent))return unknown;
    seen.add(row.ingredient_id);
  }
  return {status:'found',proof:{sessionId:session.id,status:'committed',recordedBy:session.committed_by as string}};
}
