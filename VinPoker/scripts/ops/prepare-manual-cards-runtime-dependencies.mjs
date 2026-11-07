// Exact existing card APIs for the owned HTTP fixture only. No connection/apply.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
const output=process.argv[2];
assert.equal(process.argv.length,3);
assert.ok(output&&isAbsolute(output)&&output.endsWith('/manual-cards-dependencies.sql'));
const source=readFileSync(new URL('../../supabase/migrations/20270128000075_tracker_manual_cards_receipts_v1.sql',import.meta.url),'utf8').replace(/\r\n?/g,'\n');
assert.equal(createHash('sha256').update(source).digest('hex'),'4f52194e0c0721552519660abb844e3ccb5e6dba307f45203de08a2a6b6f9a4a');
const start=source.indexOf('CREATE TABLE floor_private.tracker_manual_card_receipts_v1 (');
assert.ok(start>0);
const payload=source.slice(start,source.lastIndexOf('COMMIT;'));
assert.equal((payload.match(/CREATE FUNCTION /g)||[]).length,4);
assert.ok(!/CREATE OR REPLACE|schema_migrations/.test(payload));
const pinned=(file,hash)=>{const text=readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8').replace(/\r\n?/g,'\n');assert.equal(createHash('sha256').update(text).digest('hex'),hash);return text;};
const original=pinned('20270114000001_tracker_voice_hole_cards_atomic_confirm_v0.sql','38e363f9c1fa72fb6e334cf3b0df62241b9f6a8533a50d1ee10cc3de4e2510af');
const batch=pinned('20270128000056_tracker_card_batch_integrity_v1.sql','bfdd54961f66da91b54fafa825926c9f6b362917fb8b7b315c897c676d4bf4e1');
const voice=pinned('20270128000070_tracker_voice_card_actor_epoch_fences_v1.sql','5a25a790d88f06969a13ad3a801998869b260f8fb69e71cbb08691e922c9aea2');
const once=(text,from,to)=>{assert.equal(text.split(from).length,2,'Unique canonical patch anchor required');return text.replace(from,()=>to);};
let body=original.match(/CREATE OR REPLACE FUNCTION public\.show_hole_cards\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/)?.[1];assert.ok(body);
assert.equal(createHash('md5').update(body).digest('hex'),'4f73608ff9d408b20be72dc4f88d6189');
const validation=batch.match(/v_validation:=\$validate\$([\s\S]*?)\$validate\$;/)?.[1];assert.ok(validation);
body=once(body,"  IF jsonb_typeof(p_player_hole_cards) <> 'array' THEN","  IF jsonb_typeof(p_player_hole_cards) IS DISTINCT FROM 'array' THEN");
body=once(body,'  v_entry_count INTEGER := 0;','  v_entry_count INTEGER := 0;\n  v_seen_entries TEXT[] := ARRAY[]::TEXT[];\n  v_seen_cards TEXT[] := ARRAY[]::TEXT[];\n  v_entry_key TEXT;');
const loop='  FOR v_item IN SELECT value FROM jsonb_array_elements(p_player_hole_cards) LOOP';body=once(body,loop,validation+'\n'+loop);
const authority=voice.match(/definition:=left\(definition,start_at-1\)\|\|\$authority\$([\s\S]*?)\$authority\$/)?.[1];assert.ok(authority);
const from=body.indexOf('  IF NOT public.is_club_tracker'),until=body.indexOf('  IF v_hand.status');assert.ok(from>=0&&until>from);
body=body.slice(0,from)+authority+body.slice(from,until)+'  END IF;\n'+body.slice(until);
body=once(body,'  v_hand RECORD;','  v_hand RECORD;\n  v_context JSONB;');
body=once(body,'h.tournament_id, h.table_id,','h.tournament_id, h.table_id, h.table_session_id,');
body=once(body,'\nBEGIN\n',"\nBEGIN\n  IF p_voice IS NULL OR (p_voice AND current_user <> 'postgres') THEN RETURN jsonb_build_object('ok',false,'error','voice_delegation_required'); END IF;\n");
const helper=`CREATE FUNCTION public._tracker_card_hole_source_v1(p_hand_id uuid,p_player_hole_cards jsonb,p_user_id uuid,p_voice boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$${body}$function$;
REVOKE ALL ON FUNCTION public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean) TO authenticated;`;
// Reuse the original exact function/table postchecks, without replaying the
// historical migration guard or ledger. Pin current direct dependencies instead.
const sql=`BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 IF current_user<>'postgres' OR current_database()<>'postgres'
 OR current_setting('vinpoker.isolated_manual_cards',true) IS DISTINCT FROM 'current-http-showdown-only'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='a3000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST Tour')
 THEN RAISE EXCEPTION 'manual_cards_owned_fixture_required';END IF;
 IF to_regclass('floor_private.tracker_manual_card_receipts_v1') IS NOT NULL
 OR to_regprocedure('floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)') IS NOT NULL
 OR to_regprocedure('public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)') IS NOT NULL
 OR to_regprocedure('floor_private.tracker_manual_card_receipt_v1(text,jsonb)') IS NOT NULL
 OR to_regprocedure('public.get_tracker_manual_card_receipt_v1(text,jsonb)') IS NOT NULL
 OR to_regprocedure('floor_private.tracker_manual_card_receipt_v1(text)') IS NOT NULL
 OR to_regprocedure('public.get_tracker_manual_card_receipt_v1(text)') IS NOT NULL
 THEN RAISE EXCEPTION 'manual_cards_fixture_catalog_collision';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.is_club_tracker(uuid,uuid)')
  AND md5(replace(pg_get_functiondef(oid),chr(13),''))='754a878cd17019d6cb0b27aad6a10e84'
  AND proowner='postgres'::regrole AND NOT prosecdef AND provolatile='s')
 OR to_regprocedure('public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean)') IS NOT NULL
 THEN RAISE EXCEPTION 'manual_cards_fixture_dependency_drift';END IF;
END $$;
${helper}
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean)')
  AND md5(replace(pg_get_functiondef(oid),chr(13),''))='53374e21fe6d323affa8a074402f4b85'
  AND proowner='postgres'::regrole AND NOT prosecdef AND provolatile='v'
  AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres,authenticated=X/postgres}')
 THEN RAISE EXCEPTION 'manual_cards_fixture_dependency_drift';END IF;
END $$;
${payload}
NOTIFY pgrst,'reload schema';COMMIT;
`;
writeFileSync(output,sql,{flag:'wx'});
console.log(JSON.stringify({kind:'OWNED_CURRENT_MANUAL_CARD_DEPENDENCIES_NOT_RUNTIME_PROOF',functions:5,emptyPrivateReceiptTables:1,productionChanged:false}));
