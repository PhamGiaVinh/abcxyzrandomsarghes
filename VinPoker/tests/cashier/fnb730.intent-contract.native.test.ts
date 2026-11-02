// Uses the existing jsdom test setup; only SQL transport runs in native Node/WSL.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {parseFnbShiftIntent,resolveFnbShiftResult,resolveFnbShiftReceipt,type FnbShiftIntent} from '../../src/lib/fnbShiftIntent';

describe.skipIf(process.env.VINPOKER_FNB730_LOCAL!=='1')('F&B actual canonical279 RPC → product intent validator',()=>{
 it('validates actual open, cancel, close and persisted lookup results, all DB changes rolled back',()=>{
  const actor=randomUUID(),club=randomUUID(),menu=randomUUID(),openKey=randomUUID(),closeKey=randomUUID(),cancelKey=randomUUID();
  const migration=(path:string)=>{
   const body=readFileSync(path,'utf8');expect(body.match(/^BEGIN;\r?$/gm)).toHaveLength(1);expect(body.match(/^COMMIT;\r?$/gm)).toHaveLength(1);
   return body.replace(/^BEGIN;\r?\n/m,'').replace(/^COMMIT;\r?\n?/m,'');
  };
  const sql=`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
   DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
    ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
    ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');END $$;
   ${migration('supabase/migrations/20270128000278_fnb_order_event_integrity_v1.sql')}
   ${migration('supabase/migrations/20270128000279_fnb_cash_shift_integrity_v1.sql')}
   INSERT INTO auth.users(id) VALUES('${actor}');
   INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${actor}','LOCAL730 RPC pact rollback TEST','TEST','approved');
   INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES('${menu}','${club}','LOCAL730 TEST',5000,true,false);
   SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;
   SELECT jsonb_build_object('case','cancel','data',public.fnb_cancel_shift_intent_v1('${club}','open',NULL,1000,NULL,'${cancelKey}','${actor}'));
   SELECT jsonb_build_object('case','cancelLookup','data',public.fnb_get_shift_intent_v1('${club}','${cancelKey}','${actor}'));
   SELECT jsonb_build_object('case','open','data',public.fnb_open_shift_v2('${club}',1000,'${openKey}','${actor}'));
   DO $$ DECLARE r jsonb;o uuid;BEGIN
    r:=public.fnb_create_order('${club}','counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id','${menu}','qty',1)),'${randomUUID()}');
    ASSERT r->>'status'='ok';o:=(r->>'order_id')::uuid;
    r:=public.fnb_mark_paid(o,'${randomUUID()}');ASSERT r->>'status'='ok';END $$;
   SELECT jsonb_build_object('case','close','data',public.fnb_close_shift_v2((SELECT id FROM public.fnb_cashier_shifts WHERE club_id='${club}'),6000,NULL,'${closeKey}','${actor}'));
   SELECT jsonb_build_object('case','openLookup','data',public.fnb_get_shift_intent_v1('${club}','${openKey}','${actor}'));
   SELECT jsonb_build_object('case','closeLookup','data',public.fnb_get_shift_intent_v1('${club}','${closeKey}','${actor}'));
   ROLLBACK;
   BEGIN READ ONLY;DO $$ BEGIN
    ASSERT to_regclass('public.fnb_cashier_shifts') IS NULL;
    ASSERT to_regclass('floor_private.fnb_shift_intents_v1') IS NULL;
    ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='${club}');
    ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${actor}');
    ASSERT md5(pg_get_functiondef('public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure))='53b74527ffe2f57df8b82ed6dc8e53b3';
    ASSERT md5(pg_get_functiondef('public.fnb_mark_paid(uuid,text)'::regprocedure))='c8d1b825e471fab2038c0552532dbc15';
   END $$;ROLLBACK;`;
  const output=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
   'PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:25000,maxBuffer:2e6});
  const rows=output.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));expect(rows).toHaveLength(6);
  const actual=(key:string)=>rows.find(row=>row.case===key).data;
  const base={actorId:actor,clubId:club,backend:'http://127.0.0.1:54329',operation:'open',shiftId:null,amount:1000,note:null};
  const intent=(key:string,extra:Partial<FnbShiftIntent>={})=>parseFnbShiftIntent(JSON.stringify({...base,requestId:key,...extra}),actor,club,base.backend);
  expect(resolveFnbShiftResult(intent(cancelKey),actual('cancel')).status).toBe('cancelled');
  expect(resolveFnbShiftReceipt(intent(cancelKey),actual('cancelLookup')).status).toBe('cancelled');
  expect(resolveFnbShiftResult(intent(openKey),actual('open')).status).toBe('applied');
  expect(resolveFnbShiftReceipt(intent(openKey),actual('openLookup')).status).toBe('applied');
  const closeIntent=intent(closeKey,{operation:'close',shiftId:actual('open').shift_id,amount:6000});
  expect(resolveFnbShiftResult(closeIntent,actual('close'))).toMatchObject({status:'applied',variance:0});
  expect(resolveFnbShiftReceipt(closeIntent,actual('closeLookup'))).toMatchObject({status:'applied',variance:0});
 },30000);
});
