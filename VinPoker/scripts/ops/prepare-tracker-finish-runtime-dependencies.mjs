import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';

// Exact current contracts for the disposable manual-Finish proof only.
// Never execute this against production or expose the bare core to callers.
const output=process.argv[2];
const beforeAudience=process.argv[3]==='--before-audience';
assert.ok(output&&isAbsolute(output)&&(process.argv.length===3||process.argv.length===4&&beforeAudience),'absolute isolated output and known preparation phase required');
const read=file=>readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
const md5=value=>createHash('md5').update(value).digest('hex');
const source95=read('20270128000095_tracker_manual_finish_intent_receipts_v1.sql');
const source183=read('20270128000183_tracker_manual_pot_boundary_v1.sql');
const source316=read('20270128000316_tracker_manual_payout_pot_eligibility_v1.sql');
const contracts=[
 {schema:'floor_private',name:'tracker_manual_pots_match_v1',args:'jsonb,jsonb,integer',source:source183,body:'63d51392493c0d0b1e6bb6be91b32856',definition:'1c2d7ac7002c77ecae33002c13110203',definer:false,volatility:'i',config:['search_path=""'],defaults:0,publicApi:false},
 {schema:'floor_private',name:'tracker_manual_payouts_match_v1',args:'jsonb,jsonb,jsonb',source:source316,body:'e6ef19fa960c52f9940a5555237f3119',definition:'480840b3cbf7fdea6ae98e3ee3d475e7',definer:false,volatility:'i',config:['search_path=""'],defaults:0,publicApi:false},
 {schema:'public',name:'record_hand',args:'uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid',source:source316,body:'c9f4658e16c901390f97a6fff0738d92',definition:'62ed37150e497f2d17eabfb305df245b',definer:true,volatility:'v',config:['search_path=""'],defaults:4,publicApi:false},
 {schema:'public',name:'record_tracker_manual_hand_v1',args:'jsonb',source:source95,body:'8ad9e426eb0388fef1276fc3ddbb2c1a',definition:'29c8223e91774dc4767ab72a334e7b56',definer:true,volatility:'v',config:['search_path=""','lock_timeout=250ms'],defaults:0,publicApi:true},
 {schema:'public',name:'get_tracker_manual_finish_receipt_v1',args:'jsonb',source:source95,body:'a9edafb8a8ee1204304f7b703441ea54',definition:'0c8908aa7ba9176653abe50aa3472025',definer:true,volatility:'s',config:['search_path=""'],defaults:0,publicApi:true},
];
for(const contract of contracts){
 const pattern=new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${contract.schema}\\.${contract.name}\\([\\s\\S]*?AS (\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1\\s*;`,'g');
 const matches=[...contract.source.matchAll(pattern)];
 assert.equal(matches.length,1,`unique canonical source required:${contract.name}`);
 assert.equal(md5(matches[0][2]),contract.body,`current source body drift:${contract.name}`);
 contract.statement=matches[0][0];
 contract.signature=`${contract.schema}.${contract.name}(${contract.args})`;
}
const core=contracts.find(c=>c.name==='record_hand');
const absent=contracts.filter(c=>c!==core).map(c=>`to_regprocedure('${c.signature}') IS NOT NULL`).join(' OR ');
const sql=`BEGIN;SET LOCAL search_path=public;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $$ DECLARE p pg_proc%ROWTYPE;BEGIN
 IF current_user<>'postgres' OR current_setting('vinpoker.isolated_tracker_finish_fixture',true) IS DISTINCT FROM 'cashier-current-manual-finish-v1'
 OR NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
  WHERE t.id='a3000000-0000-4000-8000-000000000001' AND t.name='Cashier Edge TEST Tour'
   AND c.id='a2000000-0000-4000-8000-000000000001' AND c.name='Cashier Edge TEST')
 ${beforeAudience?`OR EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND hand_number IN (9001,9002))
 OR EXISTS(SELECT 1 FROM floor_private.tracker_hand_seat_snapshots193)`:`OR (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND hand_number=9001 AND status='in_progress')<>1
 OR (SELECT count(*) FROM floor_private.tracker_hand_seat_snapshots193)<>2`}
 OR ${absent} THEN RAISE EXCEPTION 'manual_finish_requires_owned_current_tracker_fixture';END IF;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='${core.signature}'::regprocedure;
 IF md5(replace(p.prosrc,chr(13),''))<>'461c01b156921261e3d4ebc904879e9e'
 OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.pronargdefaults<>4
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
 THEN RAISE EXCEPTION 'manual_finish_captured_core_preimage_drift';END IF;
 IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='public.tracker_unified_ops_lock_tournament(uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM 'fb521733f0d1ef094aeaa81873e84586'
 OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid='floor_private.floor_table_v3_existing_receipt(uuid,text,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM 'db9fb6c36971b3d83c74b5033a52523e'
 OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid='floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)'::regprocedure),chr(13),'')) IS DISTINCT FROM '8af55a87091f15551acff90adce68040'
 THEN RAISE EXCEPTION 'manual_finish_mutex_or_receipt_dependency_drift';END IF;
 IF EXISTS(SELECT 1 FROM (VALUES
  ('public.tracker_unified_ops_lock_tournament(uuid)','cb762fb2f124c38c418837522e01435c',false,'v',ARRAY['search_path=public']::text[]),
  ('floor_private.floor_table_v3_existing_receipt(uuid,text,uuid)','b36883a4b7e4249af756400c2849cffc',true,'s',ARRAY['search_path=""']::text[]),
  ('floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)','908e103b6531f09540f4edb5d09e35ee',true,'v',ARRAY['search_path=""']::text[])
 ) e(signature,definition_hash,definer,volatility,config) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc dependency WHERE dependency.oid=e.signature::regprocedure
   AND md5(replace(pg_get_functiondef(dependency.oid),chr(13),''))=e.definition_hash
   AND dependency.proowner='postgres'::regrole AND dependency.prosecdef=e.definer
   AND dependency.provolatile::text=e.volatility AND dependency.proconfig=e.config
   AND dependency.pronargdefaults=0 AND dependency.proacl::text='{postgres=X/postgres}'))
 THEN RAISE EXCEPTION 'manual_finish_dependency_authority_drift';END IF;
END $$;
${contracts.map(c=>`${c.statement}
ALTER FUNCTION ${c.signature} OWNER TO postgres;
REVOKE ALL ON FUNCTION ${c.signature} FROM PUBLIC,anon,authenticated,service_role;
${c.publicApi?`GRANT EXECUTE ON FUNCTION ${c.signature} TO authenticated;`:''}`).join('\n')}
DO $$ DECLARE p pg_proc%ROWTYPE;BEGIN
${contracts.map(c=>` SELECT * INTO STRICT p FROM pg_proc WHERE oid='${c.signature}'::regprocedure;
 IF md5(replace(p.prosrc,chr(13),''))<>'${c.body}' OR md5(replace(pg_get_functiondef(p.oid),chr(13),''))<>'${c.definition}'
 OR p.proowner<>'postgres'::regrole OR p.prosecdef IS DISTINCT FROM ${c.definer}
 OR p.provolatile<>'${c.volatility}' OR p.pronargdefaults<>${c.defaults}
 OR p.proconfig IS DISTINCT FROM ARRAY[${c.config.map(v=>`'${v}'`).join(',')}]::text[]
 OR p.proacl::text IS DISTINCT FROM '${c.publicApi?'{postgres=X/postgres,authenticated=X/postgres}':'{postgres=X/postgres}'}'
 OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE')
 OR has_function_privilege('authenticated',p.oid,'EXECUTE') IS DISTINCT FROM ${c.publicApi}
 THEN RAISE EXCEPTION 'manual_finish_restored_contract_drift:${c.name}';END IF;`).join('\n')}
END $$;
NOTIFY pgrst,'reload schema';COMMIT;
`;
writeFileSync(output,sql);
