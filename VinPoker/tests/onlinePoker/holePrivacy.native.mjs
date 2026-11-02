import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export function verifyOnlineHolePrivacy(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const [a,b,outsider,table,hand]=Array.from({length:5},()=>randomUUID());
 const before=sql(`SELECT jsonb_build_object('config',(SELECT jsonb_agg(to_jsonb(c)) FROM public.online_poker_config c),
  'tables',(SELECT count(*) FROM public.online_poker_tables),'hands',(SELECT count(*) FROM public.online_poker_hands),
  'secrets',(SELECT count(*) FROM public.online_poker_hand_secrets))::text;`);
 const claims=id=>`SET LOCAL request.jwt.claim.sub='${id}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"sub":"${id}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 const result=sql(`BEGIN;SET LOCAL statement_timeout='5s';
  INSERT INTO auth.users(id) VALUES('${a}'),('${b}'),('${outsider}');
  INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default,created_by)
   VALUES('${table}','ROLLBACK ONLY ONLINE PRIVACY TEST',25,50,0,10000,2000,'${a}');
  INSERT INTO public.online_poker_hands(id,table_id,hand_no,status,state) VALUES('${hand}','${table}',1,'betting','{}');
  INSERT INTO public.online_poker_hand_seats(hand_id,seat_no,user_id,starting_stack,stack)
   VALUES('${hand}',1,'${a}',2000,2000),('${hand}',2,'${b}',2000,2000);
  INSERT INTO public.online_poker_hand_secrets(hand_id,kind,seat_no,cards)
   VALUES('${hand}','hole',1,'["As","Ah"]'),('${hand}','hole',2,'["Ks","Kh"]');
  -- Uncommitted fixture-only gate, never a persisted runtime activation.
  INSERT INTO public.online_poker_config(id,enabled) VALUES(true,true) ON CONFLICT(id) DO UPDATE SET enabled=true;
  ${claims(a)}
  SELECT jsonb_build_object('case','a','result',public.op_get_my_hole_cards('${hand}'),
   'raw_count',(SELECT count(*) FROM public.online_poker_hand_secrets WHERE hand_id='${hand}'));
  RESET ROLE;${claims(b)}
  SELECT jsonb_build_object('case','b','result',public.op_get_my_hole_cards('${hand}'),
   'raw_count',(SELECT count(*) FROM public.online_poker_hand_secrets WHERE hand_id='${hand}'));
  RESET ROLE;${claims(outsider)}
  SELECT jsonb_build_object('case','outsider','result',public.op_get_my_hole_cards('${hand}'),
   'raw_count',(SELECT count(*) FROM public.online_poker_hand_secrets WHERE hand_id='${hand}'));
  RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
  SELECT jsonb_build_object('case','anon','raw_count',(SELECT count(*) FROM public.online_poker_hand_secrets WHERE hand_id='${hand}'),
   'public_count',(SELECT count(*) FROM public.online_poker_hands WHERE id='${hand}'),
   'hole_rpc_granted',has_function_privilege('anon','public.op_get_my_hole_cards(uuid)','EXECUTE'));
  RESET ROLE;ROLLBACK;`).split('\n').filter(Boolean).map(line=>JSON.parse(line));
 assert.equal(result.length,4);
 for(const [i,cards] of [[0,['As','Ah']],[1,['Ks','Kh']]]){
  assert.deepEqual(result[i].result,{outcome:'ok',seat:i+1,cards});assert.equal(result[i].raw_count,0);
 }
 assert.deepEqual(result[2],{case:'outsider',result:{outcome:'not_seated'},raw_count:0});
 assert.deepEqual(result[3],{case:'anon',raw_count:0,public_count:1,hole_rpc_granted:false});
 const after=sql(`SELECT jsonb_build_object('config',(SELECT jsonb_agg(to_jsonb(c)) FROM public.online_poker_config c),
  'tables',(SELECT count(*) FROM public.online_poker_tables),'hands',(SELECT count(*) FROM public.online_poker_hands),
  'secrets',(SELECT count(*) FROM public.online_poker_hand_secrets))::text;`);
 assert.equal(after,before);assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id IN('${a}','${b}','${outsider}');`),'0');
 console.log('ONLINE_HOLE_NATIVE_OWN_ONLY_OUTSIDER_ANON_RAW_DENY_ROLLBACK_PASS');
}
