// Independent integer-layer oracle for the existing private pot validator.
// Read-only native proof; not legal-action sequencing or payout allocation.
import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {sql} from '../publicHud/nativeDb.mjs';

assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,'vinpoker_hud_test_current_undo_20261107a');
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_hud_test_current_undo_20261107a|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-owned-current-undo-20261107a');
const signature='floor_private.tracker_manual_pots_match_v1(jsonb,jsonb,integer)';
assert.equal(sql(`SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='${signature}'::regprocedure;`),'63d51392493c0d0b1e6bb6be91b32856');
const reportPath=process.env.POT_LAYER_ORACLE_REPORT;
assert.match(reportPath??'',/^D:\/Quy-trinh-hud-scale-evidence\/pot-layer-oracle-[a-z0-9-]+\.json$/);
assert.equal(existsSync(reportPath),false);
const inputs=[];
function tuples(n,max,prefix=[]){if(!n){inputs.push(prefix);return;}for(let i=1;i<=max;i++)tuples(n-1,max,[...prefix,i]);}
tuples(3,4);tuples(4,3);inputs.push([0,1,3],[10,20,30,40]);
const scenarios=[];
for(const bets of inputs)for(let mask=0;mask<2**bets.length;mask++){
 const highest=Math.max(...bets),top=bets.flatMap((v,i)=>v===highest?[i]:[]);
 const folded=bets.map((_,i)=>!!(mask&(1<<i)));
 if(top.every(i=>folded[i]))continue;
 // A unique unmatched highest contribution returns to its still-live player.
 if(top.length===1&&folded[top[0]])continue;
 const effective=[...bets],second=[...bets].sort((a,b)=>b-a)[1]??0;
 const refund=top.length===1?highest-second:0;
 if(refund)effective[top[0]]-=refund;
 const pots=[];
 for(let unit=1;unit<=Math.max(...effective);unit++){
  const contributors=effective.flatMap((amount,i)=>amount>=unit?[i]:[]);
  const eligible=contributors.filter(i=>!folded[i]).map(i=>'P'+i);
  assert.ok(eligible.length>0);
  const last=pots.at(-1);
  if(last&&JSON.stringify(last.eligible_player_ids)===JSON.stringify(eligible))last.amount+=contributors.length;
  else pots.push({amount:contributors.length,eligible_player_ids:eligible});
 }
 const total=effective.reduce((a,b)=>a+b,0);
 assert.equal(pots.reduce((a,p)=>a+p.amount,0)+refund,bets.reduce((a,b)=>a+b,0));
 const actions=bets.flatMap((amount,i)=>[{player_id:'P'+i,action_type:'bet',action_amount:amount},...(folded[i]?[{player_id:'P'+i,action_type:'fold',action_amount:0}]:[])]);
 scenarios.push({actions,pots,total,refund});
}
const q=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
let checked=0;
for(let offset=0;offset<scenarios.length;offset+=128){
 const batch=scenarios.slice(offset,offset+128);
 const query=batch.map((s,n)=>{
  const reversed=s.pots.map(p=>({...p,eligible_player_ids:[...p.eligible_player_ids].reverse()}));
  const wrong=s.pots.map((p,i)=>i?p:{...p,eligible_player_ids:['NOT_A_CONTRIBUTOR']});
  const call=(pots,total)=>`floor_private.tracker_manual_pots_match_v1(${q(s.actions)},${q(pots)},${total})`;
  return `SELECT json_build_object('case',${offset+n},'valid',${call(s.pots,s.total)},'order',${call(reversed,s.total)},'wrongEligible',${call(wrong,s.total)},'wrongTotal',${call(s.pots,s.total+1)})::text;`;
 }).join('\n');
 const rows=sql('BEGIN READ ONLY;'+query+'ROLLBACK;',{captureFailure:true}).split('\n').filter(Boolean).map(JSON.parse);
 assert.equal(rows.length,batch.length);
 for(const row of rows){assert.deepEqual(row,{case:checked,valid:true,order:true,wrongEligible:false,wrongTotal:false});checked++;}
}
const report={kind:'INDEPENDENT_NATIVE_POT_LAYER_ORACLE',passed:true,scenarios:checked,assertions:checked*4,helperBodyMd5:'63d51392493c0d0b1e6bb6be91b32856',inputs:'Three-player contributions1..4 and four-player1..3,all fold masks with a live highest contributor;plus0/1/3 and10/20/30/40.',method:'Independent per-chip layers,adjacent equal eligibility merged,unique unmatched live top refunded. No application pot-builder import.',limitations:'Numerical pot-validator boundary only;not legal betting order,hand evaluation,ending-stack allocation,AuthHTTP,committed Finish or production capacity.',readOnly:true,productionChanged:false,qualification:false};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
