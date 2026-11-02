import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { parsePrizePaymentIntent, resolvePrizePaymentResult, resolvePrizePaymentReceipt } from '../../src/lib/prizePaymentIntent.ts';
import { createPaidJourneyFixture,createPaidCompletedHandFixture } from './paidJourney.fixture.mjs';
import {parseMultiDayBaggingState,validBaggingReceipt} from '../../src/ops/chip-ops/multiDayBaggingState.ts';
import {singleDayBrowserHands} from './singleDayBrowserHands.fixture.mjs';

// Only the isolated, already-qualified local database. Never accept a URL.
assert.equal(process.env.VINPOKER_NATIVE_PAYOUT, '1');
const distro = 'PokerVision-P16-4C-Eval';
const parent = '/tmp/vinpoker-sol-local-20261016-0e79a729';
const database = 'vinpoker_ops_cash115_qualified_c';
const wsl = (...args) => execFileSync('wsl', ['-d', distro, '--', ...args],
  { encoding: 'utf8', timeout: 30000, maxBuffer: 2e6 }).trim();
assert.equal(wsl('realpath', `${parent}/data`), `${parent}/data`);
assert.equal(wsl('cat', `${parent}/data/PG_VERSION`), '17');
const pgctl = ['runuser', '-u', 'postgres', '--', '/usr/lib/postgresql/17/bin/pg_ctl', '-D', `${parent}/data`];
const status = spawnSync('wsl', ['-d', distro, '--', ...pgctl, 'status'], { encoding: 'utf8', timeout: 30000 });
assert.ok(status.status === 0 || status.status === 3, status.stderr || 'pg_ctl status failed');
let owned = false;
const sql = (query) => execFileSync('wsl', ['-d', distro, '--', 'env', 'PGHOST=127.0.0.1',
  'PGPORT=55441', 'PGUSER=postgres', `PGDATABASE=${database}`, 'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
{ input: query, encoding: 'utf8', timeout: 30000, maxBuffer: 2e6 }).trim();
const verifyCorrectionManifest=manifest=>{
  for(const key of ['tour','club','actor','hand','table'])assert.match(manifest[key],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  assert.ok(Number.isSafeInteger(Number(manifest.sourceRevision))&&Number(manifest.sourceRevision)>0);
  const proof=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('revision',h.source_revision,
    'status',h.status,'owned',h.created_by=c.owner_id AND c.owner_id='${manifest.actor}' AND c.id='${manifest.club}',
    'hashScope','historical_display','currentDisplayProofs',(SELECT count(*) FROM public.tournament_settlement_outcomes o
      WHERE o.hand_id=h.id AND o.verification_scope='historical_display' AND o.status='verified'
        AND o.source_revision=(s.snapshot->>'sourceRevision')::bigint AND o.source_chain_hash=s.snapshot->>'sourceChainHash'))
    FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
    CROSS JOIN LATERAL (SELECT public.get_tracker_historical_display_snapshot(h.id,t.id) AS snapshot) s
    WHERE h.id='${manifest.hand}' AND t.id='${manifest.tour}' AND h.tournament_table_id='${manifest.table}'
      AND t.name='Cash identity local TEST';ROLLBACK;`));
  assert.equal(proof.owned,true);assert.equal(proof.status,'completed');assert.equal(Number(proof.revision),Number(manifest.sourceRevision));
  assert.equal(proof.currentDisplayProofs,1,'standalone fresh-connection historical-display revision/hash proof');
  const publicHistory=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.role='anon';
    SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
    SELECT public.get_public_tournament_table_history_v2('${manifest.tour}','${manifest.table}',20,NULL,NULL);ROLLBACK;`));
  const publicItems=publicHistory.items.filter(item=>item.handId===manifest.hand);
  assert.equal(publicItems.length,1);assert.equal(publicItems[0].result.status,'verified');
  assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname LIKE 'correction_ui_%';"),'0');
  console.log('CORRECTION_PARENT_EXACT_MANIFEST_POSTCHECK_PASS',JSON.stringify({manifest,proof,anonymousProjection:'verified_once'}));
};
function session(name) {
  const child = spawn('wsl', ['-d', distro, '--', 'env', 'PGHOST=127.0.0.1', 'PGPORT=55441',
    'PGUSER=postgres', `PGDATABASE=${database}`, `PGAPPNAME=${name}`,
    'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
  let output = '', errors = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { errors += data; });
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(errors || `session exit ${code}`)));
  });
  // Attach a handler immediately; the awaited original promise still rejects.
  void closed.catch(() => {});
  return { child, closed, output: () => output };
}
async function until(check) {
  const end = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < end, 'concurrency barrier timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
try {
  if (status.status === 3) {
    // Same retained-data recovery budget as the browser owner. SQL keeps30s.
    execFileSync('wsl',['-d',distro,'--',...pgctl,'-l',`${parent}/server.log`,'-o',
      `-h 127.0.0.1 -p 55441 -k ${parent}/socket -c shared_buffers=16MB -c work_mem=1MB -c maintenance_work_mem=16MB -c max_connections=10 -c max_worker_processes=0 -c max_parallel_workers=0 -c autovacuum=off -c wal_buffers=1MB -c max_wal_size=64MB -c min_wal_size=32MB`,'-t','110','-w','start'],{encoding:'utf8',timeout:120000,maxBuffer:2e6});
    owned = true;
  }
  assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"), `${database}|127.0.0.1|55441|17`);
  assert.equal(sql('SHOW data_directory;'), `${parent}/data`);
  assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"), 'f');
  if(process.argv.includes('--qualify180'))sql(readFileSync('supabase/migrations/20270128000180_tournament_finalizer_one_survivor_v1.sql','utf8'));
  if(process.argv.includes('--qualify181'))sql(readFileSync('supabase/migrations/20270128000181_tournament_finalizer_serialization_v1.sql','utf8'));
  if(process.argv.includes('--qualify182'))sql(readFileSync('supabase/migrations/20270128000182_tournament_finalizer_server_only_v1.sql','utf8'));
  if(process.argv.includes('--qualify183'))sql(readFileSync('supabase/migrations/20270128000183_tracker_manual_pot_boundary_v1.sql','utf8'));
  if(process.argv.includes('--qualify189'))sql(readFileSync('supabase/migrations/20270128000189_tracker_action_stack_bound_v1.sql','utf8'));
  if(process.argv.includes('--qualify190'))sql(readFileSync('supabase/migrations/20270128000190_dealer_scores_scoped_read_v1.sql','utf8'));
  if(process.argv.includes('--qualify191'))sql(readFileSync('supabase/migrations/20270128000191_tracker_finish_existing_action_noop_v1.sql','utf8'));
  if(process.argv.includes('--qualify192'))sql(readFileSync('supabase/migrations/20270128000192_tracker_void_current_seat_v1.sql','utf8'));
  if(process.argv.includes('--qualify193'))sql(readFileSync('supabase/migrations/20270128000193_tracker_hand_seat_snapshot_v1.sql','utf8'));
  if(process.argv.includes('--qualify194'))sql(readFileSync('supabase/migrations/20270128000194_tracker_start_exact_context_v1.sql','utf8'));
  if(process.argv.includes('--qualify198'))sql(readFileSync('supabase/migrations/20270128000198_tracker_undo_receipt_read_v1.sql','utf8'));
  if(process.argv.includes('--refresh189-legacy-local')){
    // Iterate this unreleased candidate only on its exact already-qualified
    // local predecessor. Never reapply a migration folder or alter its ledger.
    const source=readFileSync('supabase/migrations/20270128000189_tracker_action_stack_bound_v1.sql','utf8');
    const part=source.match(/CREATE FUNCTION floor_private\.guard_tracker_action_stack189\(\)[\s\S]+?END \$\$;/)?.[0];
    assert.ok(part);assert.equal(source.split(part).length,2);
    sql(`BEGIN;DO $$ BEGIN
      ASSERT md5(replace(pg_get_functiondef('floor_private.guard_tracker_action_stack189()'::regprocedure),chr(13),''))='8be972dc9b0190f8a9523054c7e3f8d5';
      ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000189');
      END $$;${part.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')}COMMIT;`);
  }
  if (process.argv.includes('--qualify')) {
    sql(readFileSync('supabase/migrations/20270128000124_payout_confirmation_integrity_v1.sql', 'utf8'));
    console.log('PAYOUT124_LOCAL_QUALIFIED_NOT_LIVE');
  }
  if (process.argv.includes('--qualify125')) {
    sql(readFileSync('supabase/migrations/20270128000125_payout_liability_business_period_v2.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify126')) {
    sql(readFileSync('supabase/migrations/20270128000126_payout_participation_display_v1.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify127')) {
    sql(readFileSync('supabase/migrations/20270128000127_multiday_canonical_final_seating_v1.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify128')) {
    sql(readFileSync('supabase/migrations/20270128000128_multiday_final_participation_name_v1.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify129')) {
    sql(readFileSync('supabase/migrations/20270128000129_multiday_final_playable_stack_v1.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify130')) {
    sql(readFileSync('supabase/migrations/20270128000130_multiday_final_roster_read_v1.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify131')) {
    sql(readFileSync('supabase/migrations/20270128000131_multiday_initial_draw_plan_v1.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify132')) {
    sql(readFileSync('supabase/migrations/20270128000132_multiday_initial_draw_apply_v1.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify133')) {
    sql(readFileSync('supabase/migrations/20270128000133_multiday_initial_draw_cancel_v1.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify134')) {
    sql(readFileSync('supabase/migrations/20270128000134_multiday_initial_draw_tv_hold_v1.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify139')) {
    sql(readFileSync('supabase/migrations/20270128000139_cashier_paid_stack_projection_v1.sql', 'utf8'));
  }
  if (process.argv.includes('--qualify140')) {
    sql(readFileSync('supabase/migrations/20270128000140_payroll_preview_private_defaults_v1.sql','utf8'));
  }
  if(process.argv.includes('--qualify143'))sql(readFileSync('supabase/migrations/20270128000143_multiday_floor_roundtrip_v1.sql','utf8'));
  if(process.argv.includes('--qualify144'))sql(readFileSync('supabase/migrations/20270128000144_multiday_reseat_entry_projection_v1.sql','utf8'));
  if(process.argv.includes('--qualify145'))sql(readFileSync('supabase/migrations/20270128000145_multiday_verified_payment_boundary_v1.sql','utf8'));
  if(process.argv.includes('--qualify146'))sql(readFileSync('supabase/migrations/20270128000146_multiday_live_paid_accounting_v1.sql','utf8'));
  if(process.argv.includes('--qualify147'))sql(readFileSync('supabase/migrations/20270128000147_multiday_frozen_obligation_payment_v1.sql','utf8'));
  if(process.argv.includes('--qualify148'))sql(readFileSync('supabase/migrations/20270128000148_multiday_club_liability_accounting_v1.sql','utf8'));
  if(process.argv.includes('--qualify149'))sql(readFileSync('supabase/migrations/20270128000149_fnb_club_scope_self_only_v1.sql','utf8'));
  if(process.argv.includes('--qualify150'))sql(readFileSync('supabase/migrations/20270128000150_fnb_create_intent_binding_v1.sql','utf8'));
  if(process.argv.includes('--qualify151'))sql(readFileSync('supabase/migrations/20270128000151_direct_chat_participant_integrity_v1.sql','utf8'));
  if(process.argv.includes('--qualify152'))sql(readFileSync('supabase/migrations/20270128000152_tracker_source_revision_monotonic_v1.sql','utf8'));
  if(process.argv.includes('--qualify153'))sql(readFileSync('supabase/migrations/20270128000153_multiday_bust_restore_seed_identity_v1.sql','utf8'));
  if(process.argv.includes('--qualify154'))sql(readFileSync('supabase/migrations/20270128000154_group_message_update_integrity_v1.sql','utf8'));
  if(process.argv.includes('--qualify155'))sql(readFileSync('supabase/migrations/20270128000155_chat_group_soft_delete_owner_rpc_v1.sql','utf8'));
  if(process.argv.includes('--qualify156'))sql(readFileSync('supabase/migrations/20270128000156_active_group_membership_scope_v1.sql','utf8'));
  if(process.argv.includes('--qualify157'))sql(readFileSync('supabase/migrations/20270128000157_staking_release_atomic_commit_v1.sql','utf8'));
  if(process.argv.includes('--qualify158'))sql(readFileSync('supabase/migrations/20270128000158_staking_release_effect_outbox_v1.sql','utf8'));
  if(process.argv.includes('--qualify159'))sql(readFileSync('supabase/migrations/20270128000159_staking_release_publication_snapshot_v1.sql','utf8'));
  if(process.argv.includes('--qualify160'))sql(readFileSync('supabase/migrations/20270128000160_staking_release_authoritative_preview_v1.sql','utf8'));
  if(process.argv.includes('--qualify161'))sql(readFileSync('supabase/migrations/20270128000161_staking_release_legacy_entrypoint_fence_v1.sql','utf8'));
  if(process.argv.includes('--qualify162'))sql(readFileSync('supabase/migrations/20270128000162_staking_release_effect_status_v1.sql','utf8'));
  if(process.argv.includes('--qualify163'))sql(readFileSync('supabase/migrations/20270128000163_staking_release_request_atomic_v1.sql','utf8'));
  if(process.argv.includes('--qualify164'))sql(readFileSync('supabase/migrations/20270128000164_staking_release_cosign_atomic_v1.sql','utf8'));
  if(process.argv.includes('--qualify165'))sql(readFileSync('supabase/migrations/20270128000165_group_invite_accept_receipt_v2.sql','utf8'));
  if(process.argv.includes('--qualify166'))sql(readFileSync('supabase/migrations/20270128000166_payroll_save_server_amount_integrity_v1.sql','utf8'));
  if(process.argv.includes('--qualify167'))sql(readFileSync('supabase/migrations/20270128000167_payroll_save_preserve_historical_years_v1.sql','utf8'));
  if(process.argv.includes('--qualify168'))sql(readFileSync('supabase/migrations/20270128000168_payroll_save_durable_receipt_v2.sql','utf8'));
  if(process.argv.includes('--qualify169'))sql(readFileSync('supabase/migrations/20270128000169_payroll_save_cancel_unresolved_request_v2.sql','utf8'));
  if(process.argv.includes('--qualify170'))sql(readFileSync('supabase/migrations/20270128000170_staff_checkout_serialized_close_v1.sql','utf8'));
  if(process.argv.includes('--qualify171'))sql(readFileSync('supabase/migrations/20270128000171_chip_setup_create_bind_receipts_v1.sql','utf8'));
  if(process.argv.includes('--qualify172'))sql(readFileSync('supabase/migrations/20270128000172_dealer_prediction_actor_scope_v1.sql','utf8'));
  if(process.argv.includes('--qualify173'))sql(readFileSync('supabase/migrations/20270128000173_dealer_prediction_session_projection_v1.sql','utf8'));
  if(process.argv.includes('--qualify174'))sql(readFileSync('supabase/migrations/20270128000174_d2_continue_terminal_receipt_v1.sql','utf8'));
  if(process.argv.includes('--qualify175'))sql(readFileSync('supabase/migrations/20270128000175_multiday_reversible_payment_projection_v1.sql','utf8'));
  if(process.argv.includes('--qualify176'))sql(readFileSync('supabase/migrations/20270128000176_chip_template_save_receipts_v1.sql','utf8'));
  if(process.argv.includes('--qualify177'))sql(readFileSync('supabase/migrations/20270128000177_chip_setup_metadata_receipts_v1.sql','utf8'));
  if(process.argv.includes('--qualify178'))sql(readFileSync('supabase/migrations/20270128000178_dealer_manual_swing_plan_completion_v1.sql','utf8'));
  if(process.argv.includes('--qualify179'))sql(readFileSync('supabase/migrations/20270128000179_dealer_operator_next_outgoing_identity_v1.sql','utf8'));
  if (process.argv.includes('--qualify141')) {
    sql(readFileSync('supabase/migrations/20270128000141_payroll_club_preview_tenant_v1.sql','utf8'));
  }
  if (process.argv.includes('--qualify-receipt')) {
    assert.equal(sql("SELECT to_regprocedure('public.get_tournament_prize_payment_receipt_v2(uuid)') IS NULL;"), 't');
    const migration = readFileSync('supabase/migrations/20270128000124_payout_confirmation_integrity_v1.sql', 'utf8');
    sql(migration.slice(migration.indexOf('CREATE FUNCTION public.get_tournament_prize_payment_receipt_v2'), migration.lastIndexOf('COMMIT;')));
  }
  if(process.argv.includes('--pool256-phone-overlap')){
    const {pool256PhoneOverlap}=await import('../dealerSwing/pool255.concurrent.native.mjs');
    await pool256PhoneOverlap({sql,session,until});
  } else if(process.argv.includes('--pool255-concurrency')){
    const {pool255Concurrency}=await import('../dealerSwing/pool255.concurrent.native.mjs');
    await pool255Concurrency({sql,session,until});
  } else if(process.argv.includes('--bank-color-overlap')){
    const {runBankColorUpOverlap}=await import('../chipOps/bankColorUpOverlap.native.mjs');
    await runBankColorUpOverlap({sql,session,until});
  } else if(process.argv.includes('--inspect-retained-short-allin')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('activeHands',(SELECT count(*) FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND status='in_progress'),
      'lastHand',(SELECT jsonb_build_object('id',id,'number',hand_number,'status',status,'voided',is_voided) FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' ORDER BY hand_number DESC LIMIT 1),
      'seatTotal',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND is_active),
      'auto',(SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'),
      'proof4',(SELECT jsonb_agg(jsonb_build_object('source_revision',source_revision,'status',status)) FROM public.tournament_settlement_outcomes WHERE hand_id='4ce3c57e-4521-48eb-813c-993d75d6a7e9'));
      COMMIT;`));
  } else if(process.argv.includes('--short-allin-edge')){
    const {probeShortAllinEdge}=await import('../trackerVoice/shortAllinEdge.existing.native.mjs');
    await probeShortAllinEdge(sql);
  } else if(process.argv.includes('--dealer-score-read')){
    console.log(sql(readFileSync('tests/cashier/dealerScoresRead.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--inspect-dealer-score-contract')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('view',to_regclass('public.dealer_scores'),'overrides',to_regclass('public.dealer_score_overrides'),'metrics',to_regclass('public.dealer_shift_metrics'));
      SELECT jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl) FROM pg_class c WHERE c.oid IN('public.dealers'::regclass,'public.dealer_attendance'::regclass,'public.dealer_shift_metrics'::regclass,'public.dealer_score_overrides'::regclass);
      SELECT jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'cmd',cmd,'using',qual,'check',with_check) FROM pg_policies WHERE schemaname='public' AND tablename IN('dealers','dealer_attendance','dealer_shift_metrics','dealer_score_overrides') ORDER BY tablename,policyname;
      SELECT jsonb_build_object('table',table_name,'column',column_name,'type',data_type) FROM information_schema.columns WHERE table_schema='public' AND table_name IN('dealer_shift_metrics','dealer_score_overrides') ORDER BY table_name,ordinal_position;
      COMMIT;`));
  } else if (process.argv.includes('--schedule-batch')) {
    const path='supabase/migrations/20270128000137_tournament_schedule_batch_receipts_v1.sql';
    const source=readFileSync(path,'utf8');
    if(process.argv.includes('--refresh-schedule-batch-candidate')) {
      assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_tournament_schedule_batch_v1(jsonb,uuid,uuid)'::regprocedure;"),'4eba5b556eba9b741b600e095d1ca5b9');
      sql(source.replaceAll('CREATE FUNCTION public.','CREATE OR REPLACE FUNCTION public.'));
    }
    if(sql("SELECT to_regprocedure('public.create_tournament_schedule_batch_v1(jsonb,uuid,uuid)') IS NULL;")==='t') {
      assert.equal(sql("SELECT to_regprocedure('public.get_tournament_schedule_batch_receipt_v1(jsonb,uuid,uuid)') IS NULL;"),'t');
      sql(source);
    }
    for(const match of source.matchAll(/CREATE FUNCTION public\.(\w+)\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$/g)) {
      assert.equal(sql(`SELECT prosrc FROM pg_proc WHERE oid='public.${match[1]}(jsonb,uuid,uuid)'::regprocedure;`).trim(),match[2].trim());
    }
    if(process.argv.includes('--schedule-batch-cancel')) {
      const cancelSource=readFileSync('supabase/migrations/20270128000138_tournament_schedule_batch_cancel_v1.sql','utf8');
      if(sql("SELECT to_regprocedure('public.cancel_tournament_schedule_batch_v1(jsonb,uuid,uuid)') IS NULL;")==='t')sql(cancelSource);
      const body=cancelSource.match(/AS \$function\$([\s\S]*?)\$function\$/)[1];
      assert.equal(sql("SELECT prosrc FROM pg_proc WHERE oid='public.cancel_tournament_schedule_batch_v1(jsonb,uuid,uuid)'::regprocedure;").trim(),body.trim());
    }
    if(process.argv.includes('--inspect-schedule-batch')) {
      console.log(sql("SELECT jsonb_build_object('column',column_name,'default',column_default,'nullable',is_nullable) FROM information_schema.columns WHERE table_schema='public' AND table_name='tournaments' AND column_name IN('rake_amount','guarantee_amount','minutes_per_level','late_reg_close_level','status');"));
      console.log(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_tournament_schedule_batch_v1(jsonb,uuid,uuid)'::regprocedure;"));
    } else {const {runScheduleBatchNative}=await import('./scheduleBatch.native.mjs');await runScheduleBatchNative(sql,{session,until});}
  } else if (process.argv.includes('--verify-existing-d2-mode-receipt')) {
    const tour='43f3e35c-2c0a-4085-9318-da081568d343',actor='065801a0-565e-4bd6-9c2d-ee252b7e6494';
    const table='de9b74b3-c742-4db1-887e-a10494e3b6f2',sessionId='fe2a2ac8-00cc-49a4-a9ab-fa922354a3cb';
    const key='2056f47e-3880-4a32-ab60-48fed1e60730',modeRow='d78f12db-c6df-4429-a163-001d14422726';
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
      WHERE t.id='${tour}' AND t.name='Multi-day Final local TEST' AND c.owner_id='${actor}');`),'t');
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM floor_private.table_mode_requests_v1 WHERE id='${modeRow}'
      AND table_session_id='${sessionId}' AND tournament_table_id='${table}' AND actor_id='${actor}' AND status='applied');`),'t');
    const snapshot=()=>sql(`SELECT jsonb_build_object('session',(SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${sessionId}'),
      'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM floor_private.table_mode_requests_v1 r WHERE table_session_id='${sessionId}'),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s WHERE tournament_id='${tour}'))::text;`);
    const before=snapshot();
    const call=mode=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;
      SELECT public.floor_request_table_control_mode_v4('${table}','${sessionId}','${mode}',3,1,'${key}');ROLLBACK;`));
    const replay=call('tracker');assert.equal(replay.ok,true);assert.equal(replay.outcome,'applied');assert.equal(replay.request_id,modeRow);
    assert.equal(call('manual').error,'IDEMPOTENCY_CONFLICT');assert.equal(snapshot(),before);
    console.log('EXISTING_D2_MODE_RECEIPT_REPLAY_ROW_ID_CONFLICT_NO_DELTA_PASS',JSON.stringify({key,modeRow}));
  } else if (process.argv.includes('--prepare-existing-d2-tables')) {
    const event=process.argv[process.argv.indexOf('--prepare-existing-d2-tables')+1];
    assert.match(event??'',/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    const f=JSON.parse(sql(`SELECT jsonb_build_object('tour',e.final_tournament_id,'club',e.club_id,'actor',c.owner_id)
      FROM public.tournament_events e JOIN public.clubs c ON c.id=e.club_id
      JOIN public.multi_day_qualification_locks_v1 q ON q.event_id=e.id
      WHERE e.id='${event}' AND e.name='Multi-day SELECT_LARGEST local TEST' AND c.name='Cash identity local TEST';`));
    assert.ok(f?.tour);assert.equal(sql(`SELECT count(*) FROM public.tournament_tables WHERE tournament_id='${f.tour}';`),'0');
    const gates=sql("SELECT jsonb_agg(to_jsonb(g))::text FROM public.centerpoint_tournament_ops_release g;");
    try {
      sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${f.club}'::uuid] WHERE id;`);
      for(const number of [20,21,22]) {
        const physical=randomUUID();
        sql(`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
          VALUES('${physical}','${f.club}','Browser journey D2 TEST ${number}',${number},'tournament','inactive','available');`);
        const opened=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL ROLE authenticated;
          SELECT public.floor_open_tournament_table_v3('${f.tour}','${physical}','manual','${randomUUID()}');COMMIT;`));
        assert.equal(opened.ok,true);
      }
      assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`),'0');
      assert.equal(sql(`SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'0');
      console.log('EXISTING_EVENT_CANONICAL_D2_THREE_TABLES_NO_ENTRIES_PASS',JSON.stringify(f));
    }finally {
      const [g]=JSON.parse(gates);assert.ok(g);
      sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=${g.enabled},allowed_club_ids=ARRAY[${g.allowed_club_ids.map(id=>`'${id}'::uuid`).join(',')}]::uuid[] WHERE id;`);
      assert.equal(sql("SELECT jsonb_agg(to_jsonb(g))::text FROM public.centerpoint_tournament_ops_release g;"),gates);
    }
  } else if (process.argv.includes('--bag-receipt-v2')) {
    const exists=sql("SELECT to_regprocedure('public.multi_day_get_bagging_receipt_v2(uuid,uuid,jsonb)') IS NOT NULL;")==='t';
    if(!exists)sql(readFileSync('supabase/migrations/20270128000136_multiday_bag_receipt_payload_v2.sql','utf8'));
    const rows=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(x)) FROM (
      SELECT r.request_id,r.flight_tournament_id,r.actor_id,r.receipt,
       jsonb_build_object('p_flight_tournament_id',r.flight_tournament_id,'p_player_id',r.player_id,
        'p_bag_code',b.bag_code,'p_total_value',(r.receipt->>'bagTotal')::bigint,
        'p_expected_revision',r.result_revision-1) payload
      FROM public.multi_day_bag_requests_v1 r JOIN public.chip_bag b ON b.id=r.bag_id
      JOIN public.tournaments t ON t.id=r.flight_tournament_id WHERE r.action='edit' AND t.name LIKE 'Multi-day Flight % local TEST'
      ORDER BY r.created_at DESC LIMIT 1) x;`));
    assert.equal(rows?.length,1);
    const row=rows[0],raw=JSON.stringify(row.payload).replaceAll("'","''");
    const claims=`SET LOCAL request.jwt.claim.sub='${row.actor_id}';SET LOCAL ROLE authenticated;`;
    const result=JSON.parse(sql(`BEGIN;${claims}SELECT public.multi_day_get_bagging_receipt_v2('${row.flight_tournament_id}','${row.request_id}','${raw}'::jsonb);ROLLBACK;`));
    assert.deepEqual(result.payload,row.payload);assert.deepEqual(result.result,row.receipt);
    const wrong=JSON.stringify({...row.payload,p_bag_code:'DIFFERENT-CODE'}).replaceAll("'","''");
    let conflict=false;
    try{sql(`BEGIN;${claims}SELECT public.multi_day_get_bagging_receipt_v2('${row.flight_tournament_id}','${row.request_id}','${wrong}'::jsonb);ROLLBACK;`);}
    catch(error){conflict=String(error.stderr??error).includes('multi_day_receipt_payload_conflict');}
    assert.equal(conflict,true);
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
      'bags',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.chip_bag b WHERE b.tournament_id='${row.flight_tournament_id}'),
      'day',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.day_close d WHERE d.tournament_id='${row.flight_tournament_id}'),
      'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.request_id) FROM public.multi_day_bag_requests_v1 r WHERE r.flight_tournament_id='${row.flight_tournament_id}'),
      'ledger',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.tournament_prize_payments m WHERE m.tournament_id='${row.flight_tournament_id}'))::text);`);
    const before=fingerprint();
    const sealed=JSON.parse(sql(`SELECT jsonb_build_object('request_id',request_id,'receipt',receipt,
      'payload',jsonb_build_object('p_flight_tournament_id',flight_tournament_id,'p_player_id',player_id,'p_expected_revision',result_revision-1))
      FROM public.multi_day_bag_requests_v1 WHERE flight_tournament_id='${row.flight_tournament_id}' AND action='seal' AND actor_id='${row.actor_id}' LIMIT 1;`));
    const closed=JSON.parse(sql(`SELECT jsonb_build_object('request_id',request_id,'receipt',receipt,
      'payload',jsonb_build_object('p_flight_tournament_id',flight_tournament_id,'p_expected_day_version',expected_day_version))
      FROM public.multi_day_close_requests_v1 WHERE flight_tournament_id='${row.flight_tournament_id}' AND actor_id='${row.actor_id}' LIMIT 1;`));
    const snapshot=parseMultiDayBaggingState(JSON.parse(sql(`BEGIN;${claims}SELECT public.multi_day_bagging_state_v1('${row.flight_tournament_id}');ROLLBACK;`)));
    assert.equal(snapshot.status,'locked');
    for(const [name,receipt] of [['multi_day_record_bag_v1',row],['multi_day_seal_bag_v1',sealed],['multi_day_close_bagging_v1',closed]]) {
      const payload=JSON.stringify(receipt.payload).replaceAll("'","''");
      const actual=JSON.parse(sql(`BEGIN;${claims}SELECT public.multi_day_get_bagging_receipt_v2('${row.flight_tournament_id}','${receipt.request_id}','${payload}'::jsonb);ROLLBACK;`));
      assert.deepEqual(actual.result,receipt.receipt);assert.equal(validBaggingReceipt(name,receipt.payload,snapshot,actual.result),true);
    }
    const missing=JSON.parse(sql(`BEGIN;${claims}SELECT public.multi_day_get_bagging_receipt_v2('${row.flight_tournament_id}','${randomUUID()}','{}');ROLLBACK;`));
    assert.deepEqual(missing,{found:false});
    let denied=false;
    try{sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${randomUUID()}';SET LOCAL ROLE authenticated;SELECT public.multi_day_get_bagging_receipt_v2('${row.flight_tournament_id}','${row.request_id}','${raw}');ROLLBACK;`);}
    catch(error){denied=String(error.stderr??error).includes('multi_day_receipt_actor_not_allowed');}
    assert.equal(denied,true);
    assert.equal(sql("SELECT has_function_privilege('anon','public.multi_day_get_bagging_receipt_v2(uuid,uuid,jsonb)','EXECUTE');"),'f');
    assert.equal(sql("SELECT has_function_privilege('service_role','public.multi_day_get_bagging_receipt_v2(uuid,uuid,jsonb)','EXECUTE');"),'f');
    assert.equal(fingerprint(),before);
    console.log('NATIVE_BAG_RECEIPT136_EDIT_SEAL_CLOSE_UI_VALIDATION_ACL_NO_DELTA_PASS');
  } else if (process.argv.includes('--bag-receipt')) {
    const exists=sql("SELECT to_regprocedure('public.multi_day_get_bagging_receipt_v1(uuid,uuid)') IS NOT NULL;")==='t';
    assert.ok(!exists||process.argv.includes('--refresh-bag-receipt-candidate'),'explicit local candidate refresh required');
    sql(readFileSync('supabase/migrations/20270128000135_multiday_bag_receipt_read_v1.sql','utf8')
      .replace('CREATE FUNCTION public.multi_day_get_bagging_receipt_v1','CREATE OR REPLACE FUNCTION public.multi_day_get_bagging_receipt_v1'));
    const rows=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(x)) FROM (
      SELECT r.request_id,r.flight_tournament_id,r.actor_id,r.receipt FROM public.multi_day_bag_requests_v1 r
      JOIN public.tournaments t ON t.id=r.flight_tournament_id WHERE t.name LIKE 'Multi-day Flight % local TEST'
      ORDER BY r.created_at DESC LIMIT 2) x;`));
    assert.ok(rows?.length===2,'existing real TEST bag receipts required');
    for(const row of rows) {
      assert.equal(sql(`SELECT status FROM public.day_close WHERE tournament_id='${row.flight_tournament_id}';`),'locked');
      const result=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${row.actor_id}';SET LOCAL ROLE authenticated;
        SELECT public.multi_day_get_bagging_receipt_v1('${row.flight_tournament_id}','${row.request_id}');ROLLBACK;`));
      assert.equal(result.found,true);assert.equal(result.actorId,row.actor_id);assert.deepEqual(result.result,row.receipt);
      assert.equal(result.requestId,row.request_id);
    }
    let denied=false;
    try{sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${randomUUID()}';SET LOCAL ROLE authenticated;
      SELECT public.multi_day_get_bagging_receipt_v1('${rows[0].flight_tournament_id}','${rows[0].request_id}');ROLLBACK;`);}
    catch(error){denied=String(error.stderr??error).includes('multi_day_receipt_actor_not_allowed');}
    assert.equal(denied,true,'unrelated actor must be denied, including NULL action authorization');
    assert.equal(sql("SELECT has_function_privilege('anon','public.multi_day_get_bagging_receipt_v1(uuid,uuid)','EXECUTE');"),'f');
    assert.equal(sql("SELECT has_table_privilege('authenticated','public.multi_day_bag_requests_v1','SELECT');"),'f');
    console.log('NATIVE_BAG_RECEIPT135_EXISTING_CLOSED_FLIGHT_READ_PASS');
  } else if (process.argv.includes('--d2-history-existing')) {
    const hand=process.argv[process.argv.indexOf('--d2-history-existing')+1];
    assert.match(hand??'',/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    const parent=JSON.parse(sql(`SELECT jsonb_build_object('actor',c.owner_id,'tour',t.id,'club',c.id,'event',t.event_id,'plan',p.id)
      FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
      JOIN private.multi_day_initial_draw_plans_v1 p ON p.final_tournament_id=t.id
      JOIN private.multi_day_initial_draw_applications_v1 a ON a.plan_id=p.id
      WHERE h.id='${hand}' AND t.name='Multi-day Final local TEST' AND c.name='Cash identity local TEST';`));
    assert.ok(parent?.plan);
    const result=spawnSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{
      encoding:'utf8',timeout:120000,maxBuffer:2e6,env:{...process.env,
       PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,VINPOKER_NATIVE_CROSS_FLOW:'1',
       VINPOKER_HISTORY_PARENT_HAND:hand,VINPOKER_HISTORY_PARENT_D2:JSON.stringify(parent)}});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0);
  } else if (process.argv.includes('--inspect-single-day-progress')) {
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('hand',to_jsonb(h),
      'proofs',(SELECT jsonb_agg(jsonb_build_object('revision',source_revision,'status',status,'scope',verification_scope) ORDER BY settlement_revision)
       FROM public.tournament_settlement_outcomes WHERE hand_id=h.id),
      'entries',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id=h.tournament_id),
      'seats',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id=h.tournament_id AND is_active),
      'projections',(SELECT sum(chip_count) FROM public.tournament_chip_counts WHERE tournament_id=h.tournament_id),
      'money',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=h.tournament_id))
      FROM public.tournament_hands h WHERE h.id='0ba64dcd-f572-4cd5-9ba0-d7a52f3a931e'
       AND h.tournament_id='b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f';ROLLBACK;`));
  } else if (process.argv.includes('--inspect-hand2-history-guard')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('tour',t.name,'event',t.event_id,'club',t.club_id,'owner',c.owner_id,'hand',h.id,'creator',h.created_by,'revision',h.source_revision,'pot',h.pot_size,'board',h.community_cards)
      FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id WHERE h.id='f883abef-7fed-4aef-b2fc-22842d8eb106';
      SELECT jsonb_build_object('player',hp.player_id,'entry_number',hp.entry_number,'entry',e.id,'initial_receipts',(SELECT jsonb_agg(jsonb_build_object('id',r.id,'type',r.draw_type,'status',r.status)) FROM public.seat_draw_receipts r WHERE r.entry_id=e.id),
       'payments',(SELECT jsonb_agg(jsonb_build_object('amount',m.applied_amount,'direction',m.direction,'method',m.method)) FROM public.cashier_buyin_movements m WHERE m.registration_id=e.registration_id AND m.tournament_id=e.tournament_id))
      FROM public.hand_players hp LEFT JOIN public.tournament_entries e ON e.player_id=hp.player_id AND e.entry_no=hp.entry_number AND e.tournament_id='b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f' WHERE hp.hand_id='f883abef-7fed-4aef-b2fc-22842d8eb106';ROLLBACK;`));
  } else if (process.argv.includes('--retry-single-day-dead-button-history')) {
    console.log(sql(readFileSync('tests/trackerSettlement/retryDeadButton.existing.pg17.sql','utf8')));
  } else if (process.argv.includes('--inspect-single-day-history-failures')) {
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_agg(jsonb_build_object('hand',h.hand_number,'id',h.id,'revision',h.source_revision,
      'queue',q.status,'error',q.last_error_code,'button',h.button_seat,'sb',h.tracker_sb_position,'bb',h.tracker_bb_position))
      FROM public.tournament_hands h LEFT JOIN public.tracker_historical_display_queue q ON q.hand_id=h.id AND q.source_revision=h.source_revision
      WHERE h.tournament_id='b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f';ROLLBACK;`));
  } else if (process.argv.includes('--single-day-remaining-history')) {
    for(const hand of singleDayBrowserHands){
      const result=spawnSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{
        encoding:'utf8',timeout:120000,maxBuffer:2e6,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,
         VINPOKER_NATIVE_CROSS_FLOW:'1',VINPOKER_HISTORY_PARENT_SINGLE_DAY:'1',VINPOKER_HISTORY_SINGLE_DAY_REPLAY:String(hand.number),VINPOKER_HISTORY_PARENT_HAND:hand.id}});
      process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0,`browser hand${hand.number}`);
      console.log(`ACTUAL_BROWSER_HAND_${hand.number}_CURRENT_HISTORY_PROOF_PUBLIC_PASS`);
    }
  } else if (process.argv.includes('--single-day-second-history')) {
    const result=spawnSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{
      encoding:'utf8',timeout:120000,maxBuffer:2e6,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,
       VINPOKER_NATIVE_CROSS_FLOW:'1',VINPOKER_HISTORY_PARENT_SINGLE_DAY:'1',VINPOKER_HISTORY_SINGLE_DAY_HAND2:'1',VINPOKER_HISTORY_PARENT_HAND:'f883abef-7fed-4aef-b2fc-22842d8eb106'}});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0);
  } else if (process.argv.includes('--single-day-first-history')) {
    const result=spawnSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified',
      ...(process.argv.includes('--single-day-correction')?['--single-day-correction']:[])],{
      encoding:'utf8',timeout:120000,maxBuffer:2e6,env:{...process.env,
       PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,VINPOKER_NATIVE_CROSS_FLOW:'1',
       VINPOKER_HISTORY_PARENT_HAND:'0ba64dcd-f572-4cd5-9ba0-d7a52f3a931e',VINPOKER_HISTORY_PARENT_SINGLE_DAY:'1'}});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0);
  } else if (process.argv.includes('--staff-attendance-overlap')) {
    const {runStaffAttendanceOverlap}=await import('./staffAttendanceOverlap.native.mjs');
    await runStaffAttendanceOverlap({sql,session,until});
  } else if (process.argv.includes('--staff-checkout170-postcheck')) {
    const source=readFileSync('supabase/migrations/20270128000170_staff_checkout_serialized_close_v1.sql','utf8');
    const body=source.match(/AS \$function\$([\s\S]*?)\$function\$/)[1];
    assert.equal(sql("SELECT prosrc FROM pg_proc WHERE oid='public.staff_check_out(uuid)'::regprocedure;").trim(),body.trim());
    assert.equal(sql("SELECT prosecdef AND proconfig=ARRAY['search_path=\"\"']::text[] AND pg_get_userbyid(proowner)='postgres' FROM pg_proc WHERE oid='public.staff_check_out(uuid)'::regprocedure;"),'t');
    assert.equal(sql("SELECT NOT has_function_privilege('anon','public.staff_check_out(uuid)','EXECUTE') AND has_function_privilege('authenticated','public.staff_check_out(uuid)','EXECUTE');"),'t');
    const before=sql("SELECT md5(pg_get_functiondef('public.staff_check_out(uuid)'::regprocedure));");
    assert.throws(()=>sql(source),/staff_checkout170_definition_or_acl_drift/);
    assert.equal(sql("SELECT md5(pg_get_functiondef('public.staff_check_out(uuid)'::regprocedure));"),before);
    console.log('STAFF170_EXACT_BODY_OWNER_PATH_ACL_REAPPLY_DRIFT_DENIED_PASS');
  } else if (process.argv.includes('--chip-setup-atomic-overlap')) {
    const {runChipSetupAtomicOverlap}=await import('./chipSetupAtomic.native.mjs');await runChipSetupAtomicOverlap({sql,session,until});
  } else if (process.argv.includes('--chip-setup-atomic')) {
    const {runChipSetupAtomic}=await import('./chipSetupAtomic.native.mjs');runChipSetupAtomic(sql);
  } else if (process.argv.includes('--chip-setup-partial-repro')) {
    const {runChipSetupReceipts}=await import('./chipSetupReceipts.native.mjs');runChipSetupReceipts(sql,{partialRepro:true});
  } else if (process.argv.includes('--inspect-chip-atomic-preconditions')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('function',oid::regprocedure::text,'hash',md5(replace(prosrc,chr(13),'')),'owner',pg_get_userbyid(proowner),'acl',proacl) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('chip_ops_create_chip_set','chip_ops_bind_tournament_chip_set');
      SELECT jsonb_build_object('column',column_name,'type',data_type,'nullable',is_nullable) FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_chip_set' ORDER BY ordinal_position;
      SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.tournament_chip_set'::regclass;
      SELECT nspname||':'||pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='private';
      ROLLBACK;`));
  } else if(process.argv.includes('--chip-metadata-overlap')) {
    const {runChipMetadataOverlap}=await import('./chipMetadataOverlap.native.mjs');await runChipMetadataOverlap({sql,session,until});
  } else if(process.argv.includes('--chip-metadata-receipts')) {
    const {runChipMetadataReceipts}=await import('./chipMetadataReceipts.native.mjs');runChipMetadataReceipts(sql);
  } else if(process.argv.includes('--prepare-chip-metadata-browser')) {
    const {prepareChipMetadataBrowser}=await import('./chipMetadataOverlap.native.mjs');prepareChipMetadataBrowser(sql);
  } else if(process.argv.includes('--chip-template-overlap')) {
    const {runChipTemplateOverlap}=await import('./chipTemplateOverlap.native.mjs');await runChipTemplateOverlap({sql,session,until});
  } else if (process.argv.includes('--chip-setup-receipts')||process.argv.includes('--chip-template-replay-repro')||process.argv.includes('--chip-template-receipts')||process.argv.some(arg=>arg.startsWith('--chip-metadata-replay-repro='))) {
    const repro=process.argv.find(arg=>arg.startsWith('--chip-metadata-replay-repro='))?.split('=')[1];assert.ok(!repro||['add','delete'].includes(repro));
    const {runChipSetupReceipts}=await import('./chipSetupReceipts.native.mjs');runChipSetupReceipts(sql,{templateReplayRepro:process.argv.includes('--chip-template-replay-repro'),templateV2:process.argv.includes('--chip-template-receipts'),metadataReplayRepro:repro});
  } else if (process.argv.includes('--inspect-chip-setup-receipts')) {
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('function',oid::regprocedure::text,'body_md5',md5(replace(prosrc,chr(13),'')),'owner',pg_get_userbyid(proowner),'config',proconfig,'acl',proacl) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('chip_ops_save_stack_template','chip_ops_bind_tournament_chip_set','chip_ops_add_denomination','chip_ops_delete_denomination');ROLLBACK;`));
    console.log(sql(`BEGIN READ ONLY;SELECT proname||':'||prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
      'chip_ops_create_chip_set','chip_ops_bind_tournament_chip_set','chip_ops_add_denomination','chip_ops_delete_denomination','chip_ops_save_stack_template') ORDER BY proname;ROLLBACK;`));
  } else if (process.argv.includes('--inspect-staff-attendance-contract')) {
    console.log(sql(`BEGIN READ ONLY;SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('staff_check_in','staff_check_out') ORDER BY proname;ROLLBACK;`));
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('function',oid::regprocedure::text,'body_md5',md5(prosrc),'owner',pg_get_userbyid(proowner),'acl',proacl,'config',proconfig) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('staff_check_in','staff_check_out');
      SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='staff_attendance';
      SELECT tgname||':'||pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.staff_attendance'::regclass AND NOT tgisinternal;
      ROLLBACK;`));
  } else if (process.argv.includes('--staff-self-salary-read')) {
    const prefix=randomUUID().slice(0,8);
    console.log(sql(readFileSync('tests/cashier/staffSelfSalary.existing.pg17.sql','utf8').replaceAll('e2a90000',prefix)));
  } else if (process.argv.includes('--dealer-self-salary-read')) {
    console.log(sql(readFileSync('tests/cashier/dealerSelfSalary.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--qualify186-tv-fallback-read')){
    console.log(sql(readFileSync('supabase/migrations/20270128000186_tv_layout_fallback_brand_read_v1.sql','utf8')));
    console.log('TV_FALLBACK_BRAND186_LOCAL_QUALIFIED_NO_LEDGER_PROMOTION');
  } else if(process.argv.includes('--qualify185-tv-brand-read')){
    console.log(sql(readFileSync('supabase/migrations/20270128000185_tv_layout_configured_brand_read_v1.sql','utf8')));
    console.log('TV_CONFIGURED_BRAND185_LOCAL_QUALIFIED_NO_LEDGER_PROMOTION');
  } else if (process.argv.includes('--inspect-tv-native-state')) {
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
      'owner',pg_get_userbyid(proowner),'config',proconfig,'acl',proacl,'definition',pg_get_functiondef(p.oid))
      FROM pg_proc p WHERE p.oid='public.get_tv_tournament_branding_v1(uuid)'::regprocedure;
      SELECT jsonb_build_object('ledger185',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000185'),
        'ledger186',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000186'));ROLLBACK;`));
    console.log(sql(`BEGIN READ ONLY;SELECT to_jsonb(g) FROM public.centerpoint_tournament_ops_release g;
      SELECT jsonb_build_object('tv_helper',to_regprocedure('centerpoint_private.tournament_ops_release_allowed_v1(uuid)') IS NOT NULL,
        'storage_helper',to_regprocedure('centerpoint_private.tv_branding_storage_insert_allowed_v1(text,text)') IS NOT NULL);
      ROLLBACK;`));
  } else if (process.argv.includes('--correction-browser-worker')) {
    const manifest=JSON.parse(process.env.VINPOKER_HISTORY_BROWSER_CORRECTION_MANIFEST);
    for(const key of ['tour','club','actor','hand','table'])assert.match(manifest[key],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    assert.equal(manifest.sourceRevision,11);
    const env={...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,
      VINPOKER_NATIVE_CORRECTION_UI:'1',VINPOKER_NATIVE_BROWSER:'1',VINPOKER_HISTORY_PARENT_HAND:manifest.hand};
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${manifest.hand}'),
      'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='${manifest.hand}'),
      'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY source_revision) FROM public.tracker_historical_display_queue q WHERE hand_id='${manifest.hand}'))::text);`);
    for(const key of ['hand','sourceRevision']){
      const before=fingerprint();
      const denied=spawnSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],
        {env:{...env,VINPOKER_HISTORY_BROWSER_CORRECTION_MANIFEST:JSON.stringify({...manifest,[key]:key==='hand'?randomUUID():10})},
          encoding:'utf8',timeout:10000,maxBuffer:1000000});
      assert.notEqual(denied.status,0,'wrong browser correction manifest denied');
      assert.match(denied.stderr,/AssertionError/);assert.equal(fingerprint(),before);
    }
    console.log('BROWSER_CORRECTION_WORKER_WRONG_HAND_REVISION_NO_DELTA_PASS');
    const result=spawnSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],
      {env,encoding:'utf8',timeout:45000,maxBuffer:2000000});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0);
    verifyCorrectionManifest(manifest);
  } else if (process.argv.includes('--correction-proof-readback')) {
    verifyCorrectionManifest(JSON.parse(process.env.VINPOKER_CORRECTION_MANIFEST));
  } else if (process.argv.includes('--correction-ui-postcheck')) {
    assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname LIKE 'correction_ui_%';"),'0');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
    console.log('CORRECTION_UI_NO_TEMP_SERVICE_ROLES_OR_NETWORK_EXTENSION_PASS');
  } else if (process.argv.includes('--correction-ui-regression')) {
    const env={...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,VINPOKER_NATIVE_CORRECTION_UI:'1'};
    for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!env[key]);
    const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/trackerSettlement/paidCorrectionRecovery.native.test.tsx',
      ...(process.argv.includes('--correction-parent-only')?['-t','runs the full parent']:[]),
      '--maxWorkers=1','--minWorkers=1','--no-file-parallelism','--testTimeout=45000','--hookTimeout=30000'],
      {env,encoding:'utf8',timeout:150000,maxBuffer:2e6});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0,'Correction actual parent/Edge/PG recovery regression');
    const manifestLine=result.stdout.match(/CORRECTION_PARENT_NATIVE_MANIFEST (\{[^\r\n]+\})/);
    assert.ok(manifestLine,'exact successful parent manifest required');
    verifyCorrectionManifest(JSON.parse(manifestLine[1]));
  } else if (process.argv.includes('--tv-publish-metadata')) {
    const env={...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,VINPOKER_NATIVE_TV_UI:'1'};
    for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!env[key]);
    console.log(execFileSync(process.execPath,['tests/trackerSettlement/tvStorage.bootstrap.mjs'],{env,encoding:'utf8',timeout:30000}));
    const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/trackerSettlement/paidTvPublish.native.test.tsx',
      '--maxWorkers=1','--minWorkers=1','--testTimeout=60000','--hookTimeout=30000'],{env,encoding:'utf8',timeout:90000,maxBuffer:2e6});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0,'TV native metadata recovery regression');
  } else if(process.argv.includes('--prepare-dealer-browser')) {
    const {runCloseSwingOverlap}=await import('../dealerSwing/closeSwingOverlap.native.mjs');
    const fixture=await runCloseSwingOverlap({sql,session,until,prepareBrowser:true});console.log('DEALER_BROWSER_CANARY',JSON.stringify(fixture));
  } else if(process.argv.includes('--manual-swing-hook-integration')||process.argv.includes('--manual-swing-hook-baseline')) {
    const {runCloseSwingOverlap}=await import('../dealerSwing/closeSwingOverlap.native.mjs');
    const fixture=await runCloseSwingOverlap({sql,session,until,prepareUi:true});
    const env={...process.env,VINPOKER_NATIVE_SWING_178_UI:'1',VINPOKER_SWING178_FIXTURE:JSON.stringify(fixture),
      VINPOKER_NATIVE_SWING_178_BASELINE:process.argv.includes('--manual-swing-hook-baseline')?'1':'0',
      PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database};
    for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!env[key]);
    const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/dealerSwing/manualSwingRecovery.native.test.tsx',
      '--maxWorkers=1','--minWorkers=1','--testTimeout=30000','--hookTimeout=15000'],{env,encoding:'utf8',timeout:60000,maxBuffer:2e6});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0,'actual manual Swing hook integration');
  } else if(process.argv.includes('--close-swing-overlap')||process.argv.includes('--operator-next-worker')||process.argv.includes('--worker-close-overlap')) {
    const {runCloseSwingOverlap}=await import('../dealerSwing/closeSwingOverlap.native.mjs');await runCloseSwingOverlap({sql,session,until,
      workerNextOnly:process.argv.includes('--operator-next-worker'),workerOverlaps:process.argv.includes('--worker-close-overlap')});
  } else if (process.argv.includes('--swing-health-lifecycle')) {
    const base=readFileSync('tests/dealerSwing/operationalInventory.pg17.sql','utf8');
    const extension=readFileSync('tests/dealerSwing/healthLifecycle.existing.pg17.sql','utf8');
    const anchor="SELECT set_config('request.jwt.claim.role','service_role',true);";
    assert.equal(base.split(anchor).length,2);assert.equal(base.split('ROLLBACK;').length,2);
    const prefix=randomUUID().slice(0,8);
    const test=base.replace('BEGIN;','BEGIN;GRANT USAGE ON SCHEMA auth TO authenticated;')
      .replace(anchor,`INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('e1700000-0000-4000-8000-000000000002',true);\n${anchor}`)
      .replace('ROLLBACK;',()=>extension+'\nROLLBACK;').replaceAll('e1700000',prefix)
      .replaceAll("'exact-key'",`'health-${prefix}-exact-key'`).replaceAll("'cross-club-key'",`'health-${prefix}-cross-club-key'`)
      .replaceAll("'closed-key'",`'health-${prefix}-closed-key'`).replaceAll("'health-late-key'",`'health-${prefix}-late-key'`);
    console.log(sql(test));
  } else if (process.argv.includes('--prediction-session')||process.argv.includes('--prediction-capacity')||process.argv.includes('--prediction-tournament-capacity')) {
    const base=readFileSync('tests/dealerSwing/operationalInventory.pg17.sql','utf8');
    const capacity=process.argv.includes('--prediction-capacity');
    const tournamentCapacity=process.argv.includes('--prediction-tournament-capacity');
    const extension=readFileSync(tournamentCapacity?'tests/dealerSwing/predictionTournamentCapacity.existing.pg17.sql':capacity?'tests/dealerSwing/predictionCapacity.existing.pg17.sql':'tests/dealerSwing/predictionSession.existing.pg17.sql','utf8');
    assert.equal(base.split('ROLLBACK;').length,2);
    const prefix=randomUUID().slice(0,8);
    const authUsage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
    const anchor="SELECT set_config('request.jwt.claim.role','service_role',true);";assert.equal(base.split(anchor).length,2);
    const proof=sql(base.replace('BEGIN;','BEGIN;GRANT USAGE ON SCHEMA auth TO authenticated;')
      .replace(anchor,`SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);\n${anchor}`)
      .replace('ROLLBACK;',()=>extension+'\nROLLBACK;').replaceAll('e1700000',prefix)
      .replaceAll("'exact-key'",`'prediction-${prefix}-exact-key'`).replaceAll("'cross-club-key'",`'prediction-${prefix}-cross-club-key'`)
      .replaceAll("'closed-key'",`'prediction-${prefix}-closed-key'`));
    const marker=tournamentCapacity?'PREDICTION_TOURNAMENT40_MIXED_POOL_CLOSE_REOPEN_ROLLBACK_PASS ':capacity?'PREDICTION_CAPACITY40_LOCAL_PASS ':'PREDICTION_EXACT_SESSION_QUARANTINE_AND_NEXT_ATTENDANCE_ROLLBACK_PASS';
    assert.ok(proof.includes(marker));
    assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id='${prefix}-0000-4000-8000-000000000001';`),'0');
    assert.equal(sql("SELECT has_schema_privilege('authenticated','auth','USAGE');"),authUsage);
    console.log(capacity||tournamentCapacity?proof.split('\n').find(row=>row.startsWith(marker)):marker);
  } else if(process.argv.includes('--inspect-close-swing-contract')) {
    console.log(sql(`BEGIN READ ONLY;SELECT pg_get_functiondef(oid) FROM pg_proc WHERE oid IN
      ('public.operator_close_club_table_v2(uuid,bigint,uuid)'::regprocedure,
       'public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure);ROLLBACK;`));
  } else if(process.argv.includes('--inspect-operator-next179')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('signature',oid::regprocedure::text,'digest',md5(replace(pg_get_functiondef(oid),chr(13),'')),
       'owner',pg_get_userbyid(proowner),'definer',prosecdef,'path',proconfig,'acl',proacl,'defaults',pronargdefaults)
      FROM pg_proc WHERE oid IN('public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid)'::regprocedure,
       'public.worker_execute_rotation_slot_v1(uuid,integer,uuid,uuid,integer,uuid,timestamptz,integer,boolean,integer)'::regprocedure);
      SELECT jsonb_build_object('schedule',r.id,'outgoing',r.out_attendance_id,'actual_outgoing',a.attendance_id,'status',r.status,
        'same_session',a.table_session_id='3a87ee71-0000-4000-8000-000000000021'::uuid,'assignment_still_live',a.released_at IS NULL)
      FROM public.dealer_rotation_schedule r JOIN public.dealer_assignments a ON a.id=r.assignment_id
      WHERE r.id='559ce7c6-19b4-4774-9fe9-96362ed53c41';
      SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000179';ROLLBACK;`));
  } else if(process.argv.includes('--inspect-manual-swing178')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('signature',oid::regprocedure::text,'digest',md5(replace(pg_get_functiondef(oid),chr(13),'')),
       'owner',pg_get_userbyid(proowner),'definer',prosecdef,'path',proconfig,'acl',proacl,'defaults',pronargdefaults)
      FROM pg_proc WHERE oid IN('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure,'public.complete_rotation_slot(uuid,uuid)'::regprocedure);
      SELECT count(*) AS remaining_fault_objects FROM pg_proc WHERE pronamespace='floor_private'::regnamespace AND proname LIKE 'test_manual178_%';
      SELECT count(*) AS ledger178_rows FROM supabase_migrations.schema_migrations WHERE version='20270128000178';
      ROLLBACK;`));
  } else if(process.argv.includes('--inspect-manual-swing-plan')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('schedule',to_jsonb(r),'assignment',to_jsonb(a),'club',c.id)
      FROM public.dealer_rotation_schedule r JOIN public.clubs c ON c.id=r.club_id
      LEFT JOIN public.dealer_assignments a ON a.id=r.assignment_id
      WHERE c.name='Operational TEST' AND r.solver_version='operator_next_intent_v1' ORDER BY r.created_at;
      SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='execute_rotation_slot';
      SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='dealer_rotation_schedule' ORDER BY ordinal_position;
      ROLLBACK;`));
  } else if (process.argv.includes('--inspect-swing-health-contract')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT pg_get_functiondef('public.get_dealer_swing_health(uuid[])'::regprocedure);
      SELECT jsonb_build_object('signature',oid::regprocedure::text,'digest',md5(replace(prosrc,chr(13),'')),
        'path',proconfig,'acl',proacl) FROM pg_proc WHERE oid='public.get_dealer_swing_health(uuid[])'::regprocedure;
      ROLLBACK;`));
  } else if (process.argv.includes('--inspect-swing-duration-contract')) {
    console.log(sql(`BEGIN READ ONLY;SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('worker_perform_swing','perform_swing','atomic_dealer_ready_check') ORDER BY proname;ROLLBACK;`));
  } else if (process.argv.includes('--canonical-fill')) {
    const {runCanonicalFillNative}=await import('../dealerSwing/fillCanonical.native.mjs');
    await runCanonicalFillNative(sql);
  } else if (process.argv.includes('--inspect-payroll-save-contract')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'digest',md5(replace(p.prosrc,chr(13),'')),
        'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'path',p.proconfig,'acl',p.proacl,
        'body',CASE WHEN p.proname='save_payroll_period_secure' THEN p.prosrc END)
      FROM pg_proc p WHERE p.oid IN('public.save_payroll_period_secure(uuid,integer,integer,date,date,jsonb)'::regprocedure,
        'public.save_payroll_period(uuid,integer,integer,date,date,jsonb,uuid)'::regprocedure,
        'public.calculate_club_payroll(uuid,date,date)'::regprocedure);
      SELECT jsonb_build_object('index',indexname,'definition',indexdef) FROM pg_indexes WHERE schemaname='public' AND tablename='payroll_periods';
      SELECT jsonb_build_object('authority',p.oid::regprocedure::text,'body',p.prosrc) FROM pg_proc p
        WHERE p.oid IN('public.is_club_accountant(uuid,uuid)'::regprocedure,'public._is_payroll_accountant(uuid)'::regprocedure);COMMIT;`));
  } else if (process.argv.includes('--inspect-payroll-receipt-contract')) {
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'digest',md5(replace(p.prosrc,chr(13),'')),'owner',pg_get_userbyid(p.proowner),'path',p.proconfig,'acl',p.proacl)
      FROM pg_proc p WHERE p.oid IN('public.save_payroll_period_v2(uuid,integer,integer,date,date,jsonb,uuid)'::regprocedure,'public.get_payroll_save_receipt_v2(uuid,uuid)'::regprocedure);COMMIT;`));
  } else if (process.argv.includes('--payroll-cancel-overlap')) {
    const {runPayrollCancelOverlap}=await import('./payrollSaveOverlap.native.mjs');
    await runPayrollCancelOverlap({sql,session,until});
  } else if (process.argv.includes('--payroll-receipt-overlap')) {
    const {runPayrollReceiptOverlap}=await import('./payrollSaveOverlap.native.mjs');
    await runPayrollReceiptOverlap({sql,session,until});
  } else if (process.argv.includes('--payroll-save-receipt')) {
    console.log(sql(readFileSync('tests/cashier/payrollSaveReceipt.existing.pg17.sql','utf8')));
  } else if (process.argv.includes('--inspect-payroll-saved-row')) {
    console.log(sql(`BEGIN READ ONLY;SELECT to_jsonb(d) FROM public.dealer_payroll d JOIN public.payroll_periods p ON p.id=d.period_id
      WHERE p.club_id='9755fe63-669c-49d0-bea9-75177a3d30fc' AND p.period_year=2026 AND p.period_month=10;ROLLBACK;`));
  } else if (process.argv.includes('--inspect-payroll-canary-periods')) {
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('id',p.id,'year',p.period_year,'month',p.period_month,'status',p.status,
      'rows',(SELECT count(*) FROM public.dealer_payroll d WHERE d.period_id=p.id),
      'payments',(SELECT count(*) FROM public.payment_records r WHERE r.period_id=p.id))
      FROM public.payroll_periods p WHERE p.club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND p.period_year=2099 AND p.period_month IN(7,8,9) ORDER BY p.period_month;COMMIT;`));
  } else if (process.argv.includes('--payroll-source-overlap')) {
    const {runPayrollSourceOverlap}=await import('./payrollSaveOverlap.native.mjs');
    await runPayrollSourceOverlap({sql,session,until});
  } else if (process.argv.includes('--payroll-save-overlap')) {
    const {runPayrollSaveOverlap}=await import('./payrollSaveOverlap.native.mjs');
    await runPayrollSaveOverlap({sql,session,until});
  } else if (process.argv.includes('--payroll-save-integrity')) {
    console.log(sql(readFileSync('tests/cashier/payrollSaveIntegrity.existing.pg17.sql','utf8')));
  } else if (process.argv.includes('--payroll-preview-existing')) {
    console.log(sql(readFileSync('tests/cashier/payrollPreviewSecurity.existing.pg17.sql','utf8')));
  } else if (process.argv.includes('--inspect-single-day-payroll-preview')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('direct_authenticated',has_function_privilege('authenticated','public.calculate_dealer_payroll(uuid,date,date,integer)','EXECUTE'),
       'direct_anon',has_function_privilege('anon','public.calculate_dealer_payroll(uuid,date,date,integer)','EXECUTE'));
      SET LOCAL request.jwt.claim.sub='065801a0-565e-4bd6-9c2d-ee252b7e6494';
      SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494"}';SET LOCAL ROLE authenticated;
      SELECT public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-18')->'dealers'->'0d617281-35e5-43cc-87f2-86e5094bc403';
      ROLLBACK;`));
  } else if (process.argv.includes('--inspect-payroll-patch-baseline')) {
    console.log(sql(`SELECT jsonb_build_object('function',oid::regprocedure::text,'source',md5(prosrc),'owner',pg_get_userbyid(proowner),'config',proconfig,'acl',proacl::text)
      FROM pg_proc WHERE oid IN('public.calculate_dealer_payroll(uuid,date,date,integer)'::regprocedure,'public.calculate_club_payroll(uuid,date,date)'::regprocedure);`));
  } else if (process.argv.includes('--inspect-payroll-read-relations')) {
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid))
      FROM pg_constraint WHERE conrelid='public.payroll_adjustments'::regclass AND contype='f';COMMIT;`));
  } else if (process.argv.includes('--inspect-dealer-payroll-contract')) {
    console.log(sql(`BEGIN READ ONLY;SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('calculate_dealer_payroll','calculate_club_payroll') ORDER BY proname;ROLLBACK;`));
  } else if (process.argv.includes('--single-day-release-rest-fence')) {
    const before=sql(`SELECT md5(jsonb_build_object('sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s),
      'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a),
      'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
      'settings',(SELECT jsonb_agg(to_jsonb(s) ORDER BY club_id) FROM public.club_settings s))::text);`);
    const probe=sql(`BEGIN;DO $$ DECLARE opened jsonb;result jsonb;new_session uuid;blocked boolean:=false;BEGIN
      IF NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='255f7c3c-8330-4b9d-a517-12cf6457f874'
       AND status='completed' AND released_at>now()-interval '15 minutes' AND released_at<=now()) THEN
       RAISE EXCEPTION 'real_rest_window_elapsed_no_time_fabrication';END IF;
      IF NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='e6ea17c9-6f20-4f5c-ad19-00ae62e57923'
       AND current_state='available' AND last_released_at IS NULL) THEN RAISE EXCEPTION 'observed_release_fixture_changed';END IF;
      PERFORM set_config('request.jwt.claim.sub','065801a0-565e-4bd6-9c2d-ee252b7e6494',true);
      PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494"}',true);
      SET LOCAL ROLE authenticated;
      opened:=public.floor_open_tournament_table_v3('b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f','0bf5ddae-3337-4991-a1db-1dd02c1ba4f0','manual',gen_random_uuid());
      RESET ROLE;
      IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'rest_probe_reopen_failed: %',opened;END IF;
      SELECT id INTO STRICT new_session FROM public.table_sessions WHERE game_table_id='0bf5ddae-3337-4991-a1db-1dd02c1ba4f0' AND closed_at IS NULL;
      IF new_session='18156634-f25f-40bf-a815-696d8bd776f1'::uuid THEN RAISE EXCEPTION 'rest_probe_reused_old_session';END IF;
      INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',true)
       ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=true;
      PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);
      PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
      PERFORM set_config('request.headers','{}',true);
      BEGIN
       SET LOCAL ROLE service_role;
       result:=public.worker_assign_dealer_to_session_v1('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','0bf5ddae-3337-4991-a1db-1dd02c1ba4f0',
        new_session,
        'e6ea17c9-6f20-4f5c-ad19-00ae62e57923',now()+interval '45 minutes','autostaff_real_close_rest_probe');
       RESET ROLE;
      EXCEPTION WHEN OTHERS THEN
       IF SQLERRM='DEALER_REST_REQUIRED' THEN blocked:=true;ELSE RAISE;END IF;
      END;
      IF NOT blocked THEN RAISE EXCEPTION 'closed_dealer_rest_not_blocked: %',result;END IF;
      RESET ROLE;
      IF EXISTS(SELECT 1 FROM public.dealer_assignments WHERE attendance_id='e6ea17c9-6f20-4f5c-ad19-00ae62e57923' AND released_at IS NULL) THEN RAISE EXCEPTION 'failed_acquisition_left_assignment';END IF;
     END $$;SELECT 'ACTUAL_CLOSED_DEALER_NULL_MARKER_HISTORY_REST_FENCE_PASS';ROLLBACK;`);
    assert.match(probe,/ACTUAL_CLOSED_DEALER_NULL_MARKER_HISTORY_REST_FENCE_PASS/);
    const after=sql(`SELECT md5(jsonb_build_object('sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s),
      'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a),
      'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
      'settings',(SELECT jsonb_agg(to_jsonb(s) ORDER BY club_id) FROM public.club_settings s))::text);`);
    assert.equal(after,before);console.log(probe);
  } else if (process.argv.includes('--single-day-initial-assign')) {
    const {runPaidTourInitialAssignments}=await import('../dealerSwing/paidTourInitialAssign.native.mjs');
    const f={tour:'b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f',club:'9ef80c7a-cb97-4acc-b81c-5bf34d49317f',actor:'065801a0-565e-4bd6-9c2d-ee252b7e6494',player:'50e5437a-9b82-4b60-8f70-dac066deecc9'};
    const tables=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'table_session_id',table_session_id) ORDER BY table_number)
      FROM public.tournament_tables WHERE tournament_id='${f.tour}' AND status='active' AND table_number IN(30,31);`));
    const ids=['19085eff-2224-4acf-8ac7-9bf8d0a4a237','6516ca92-6573-468a-83ae-417403b0722b','0d617281-35e5-43cc-87f2-86e5094bc403','8ace41f3-b71e-404b-8953-6d3f493bc248'];
    process.env.VINPOKER_NATIVE_PAID_TOUR='1';
    await runPaidTourInitialAssignments(sql,f,tables,ids);
  } else if (process.argv.includes('--single-day-ready-off')) {
    const {verifySingleDayReadyOffNative}=await import('./singleDayParticipants.native.mjs');
    await verifySingleDayReadyOffNative(sql);
  } else if (process.argv.includes('--inspect-single-day-dealer')) {
    console.log(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;
      SELECT jsonb_build_object('inventory',coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb))
       FROM public.get_dealer_operational_tables_v1('9ef80c7a-cb97-4acc-b81c-5bf34d49317f')t;
      RESET ROLE;
      SELECT jsonb_build_object('attendance',a.id,'dealer',d.full_name,'state',a.current_state,'status',a.status,
       'shift_date',a.shift_date,'assignments',(SELECT jsonb_agg(jsonb_build_object('session',x.table_session_id,'status',x.status,'due',x.swing_due_at))
        FROM public.dealer_assignments x WHERE x.attendance_id=a.id AND x.released_at IS NULL))
       FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id
       WHERE d.club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND a.status='checked_in' ORDER BY d.full_name;
      SELECT jsonb_build_object('auto',auto_swing_enabled) FROM public.club_settings
       WHERE club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f';ROLLBACK;`));
  } else if (process.argv.includes('--single-day-four-dealer-checkin')) {
    const {runSingleDayDealerCheckinsNative}=await import('./singleDayParticipants.native.mjs');
    runSingleDayDealerCheckinsNative(sql);
  } else if (process.argv.includes('--single-day-eight-paid')) {
    const {runSingleDayParticipantsNative}=await import('./singleDayParticipants.native.mjs');
    await runSingleDayParticipantsNative(sql);
  } else if (process.argv.includes('--repair-existing-paid-projection')) {
    const source=readFileSync('tests/cashier/paidSeatProjection.repairExisting.pg17.sql','utf8');
    assert.match(source,/-- LOCAL_REPAIR_END\s+ROLLBACK;\s*$/);
    sql(source);
    console.log('EXISTING_PROJECTION_REPAIR_REHEARSAL_ROLLED_BACK');
    if(process.argv.includes('--commit-exact-local-repair')) {
      sql(source.replace(/-- LOCAL_REPAIR_END\s+ROLLBACK;\s*$/,'COMMIT;'));
      sql(source); // Idempotent replay, rolled back; never creates another row.
      sql(readFileSync('tests/cashier/paidSeatProjection.existing.pg17.sql','utf8'));
      console.log('EXACT_LOCAL_PROJECTION_REPAIR_COMMITTED_REPLAY_PASS');
    }
  } else if (process.argv.includes('--inspect-existing-paid-projection')) {
    // Read only: preserve the original browser failure until repair evidence
    // has been reviewed. Do not substitute a newly passing fixture for it.
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('table',table_name,'columns',jsonb_agg(column_name ORDER BY ordinal_position))
      FROM information_schema.columns WHERE table_schema='public'
        AND (table_name LIKE '%audit%' OR table_name IN ('seat_draw_receipts','tournament_chip_counts'))
      GROUP BY table_name ORDER BY table_name;
      SELECT jsonb_build_object('kind','entry','row',to_jsonb(e)) FROM public.tournament_entries e
       WHERE id='80680722-d93c-4fdb-b01f-db2390e979ee';
      SELECT jsonb_build_object('kind','seat','row',to_jsonb(s)) FROM public.tournament_seats s
       WHERE entry_id='80680722-d93c-4fdb-b01f-db2390e979ee';
      SELECT jsonb_build_object('kind','receipt','row',to_jsonb(r)) FROM public.seat_draw_receipts r
       WHERE registration_id='20116ca5-c1e9-4de6-94fe-24b77efa9cd0';
      SELECT jsonb_build_object('kind','registration','row',to_jsonb(r)) FROM public.tournament_registrations r
       WHERE id='20116ca5-c1e9-4de6-94fe-24b77efa9cd0';
      SELECT jsonb_build_object('kind','movement','row',to_jsonb(m)) FROM public.cashier_buyin_movements m
       WHERE registration_id='20116ca5-c1e9-4de6-94fe-24b77efa9cd0';
      SELECT jsonb_build_object('kind','hand_count','count',count(*)) FROM public.tournament_hands
       WHERE tournament_id='b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f';
      SELECT jsonb_build_object('kind','audit','row',to_jsonb(a)) FROM public.audit_logs a
       WHERE entity_id IN ('80680722-d93c-4fdb-b01f-db2390e979ee','20116ca5-c1e9-4de6-94fe-24b77efa9cd0',
        'b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f')
        OR payload::text LIKE '%80680722-d93c-4fdb-b01f-db2390e979ee%';
      SELECT jsonb_build_object('kind','projection','row',to_jsonb(c)) FROM public.tournament_chip_counts c
       WHERE tournament_id='b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f';
      SELECT jsonb_build_object('kind','seat_history','row',to_jsonb(h)) FROM public.seat_assignment_history h
       WHERE entry_id='80680722-d93c-4fdb-b01f-db2390e979ee';
      SELECT jsonb_build_object('kind','pending_move','row',to_jsonb(q)) FROM public.floor_pending_tracker_moves q
       WHERE entry_id='80680722-d93c-4fdb-b01f-db2390e979ee';
      ROLLBACK;`));
  } else if (process.argv.includes('--paid-seat-projection')) {
    const {runPaidSeatProjectionNative}=await import('./paidSeatProjection.native.mjs');
    await runPaidSeatProjectionNative(sql,{session,until});
  } else if (process.argv.includes('--member-cancel-paid')) {
    const {verifyMemberCancellation}=await import('./memberCancel.native.mjs');verifyMemberCancellation(sql);
  } else if (process.argv.includes('--member-proof')) {
    const {verifyMemberProof}=await import('./memberProof.native.mjs');verifyMemberProof(sql);
  } else if (process.argv.includes('--inspect-local-db-size')) {
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('bytes',pg_database_size(current_database()),
      'otherConnections',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()));ROLLBACK;`));
  } else if (process.argv.includes('--redraw-read-contract')) {
    const final='d66cce0e-4225-4765-8b8c-9462e69153e1';
    assert.equal(sql(`SELECT count(*) FROM public.tournament_events WHERE id='b8ebfbc7-ff78-4515-8812-7d748b828d0b'
      AND final_tournament_id='${final}' AND name='Multi-day SELECT_LARGEST local TEST';`),'1');
    const snapshot=()=>sql(`SELECT jsonb_build_object('batches',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]') FROM public.tournament_redraw_batches b WHERE tournament_id='${final}'),
      'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.table_sessions s WHERE tournament_id='${final}'));`);
    const before=snapshot();
    const value=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SET LOCAL ROLE anon;
      SELECT public.get_public_tournament_redraw_v1('${final}');ROLLBACK;`));
    assert.deepEqual(value,{batch_id:null,moves:[]});assert.equal(snapshot(),before);
    console.log('REDRAW_ACTUAL_ANON_ENDED_D2_EXPLICIT_EMPTY_NO_HOLD_SESSION_DELTA_PASS');
  } else if (process.argv.includes('--d2-continue-replay')) {
    console.log(sql(`SELECT jsonb_build_object('body',md5(prosrc),'owner',pg_get_userbyid(proowner),'path',proconfig,'definer',prosecdef,
      'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),
      'slot174',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000174'))
      FROM pg_proc WHERE oid='public.floor_continue_tournament_redraw_v1(uuid,bigint,uuid)'::regprocedure;`));
    const final='d66cce0e-4225-4765-8b8c-9462e69153e1';
    const original=JSON.parse(sql(`SELECT jsonb_build_object('actor',r.actor_id,'request',r.request_id,'fingerprint',r.request_fingerprint::jsonb,'result',r.result)
      FROM public.table_operation_receipts r JOIN public.tournament_redraw_batches b ON b.id=(r.result->>'batch_id')::uuid
      WHERE r.operation_type='floor_continue_tournament_redraw_v1' AND b.tournament_id='${final}' ORDER BY r.created_at DESC LIMIT 1;`)||'null');
    assert.ok(original,'existing TEST Continue receipt required');
    const f=original.fingerprint;
    const snapshot=()=>sql(`SELECT jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${final}'),
      'batches',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]') FROM public.tournament_redraw_batches b WHERE tournament_id='${final}'),
      'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.table_sessions s WHERE tournament_id='${final}'),
      'receiptsHash',(SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.actor_id,r.operation_type,r.request_id),'[]')::text) FROM public.table_operation_receipts r));`);
    const before=snapshot();
    const invoke=(actor,revision,request)=>JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='5s';
      SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
      SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
      SELECT public.floor_continue_tournament_redraw_v1('${f.batch_id}',${revision},'${request}');ROLLBACK;`));
    const result=invoke(original.actor,f.expected_redraw_revision,original.request);
    assert.deepEqual(result,original.result,'replay must recover original committed Continue even after TEST tournament completion');
    assert.deepEqual(invoke(original.actor,f.expected_redraw_revision,original.request),original.result);
    assert.equal(invoke(original.actor,f.expected_redraw_revision+1,original.request).error,'IDEMPOTENCY_CONFLICT');
    assert.equal(invoke(original.actor,f.expected_redraw_revision,randomUUID()).error,'tournament_not_open');
    assert.equal(invoke(randomUUID(),f.expected_redraw_revision,original.request).error,'actor_not_allowed');
    assert.equal(snapshot(),before);
    console.log('D2_CONTINUE_ORIGINAL_RECEIPT_TERMINAL_REPLAY_CONFLICT_OUTSIDER_NO_DELTA_PASS');
  } else if (process.argv.includes('--multiday-committed-recovery')||process.argv.includes('--multiday-payment-reversal-recovery')) {
    const {verifyCommittedMultiDayRecovery}=await import('./multiDayCommittedRecovery.native.mjs');
    verifyCommittedMultiDayRecovery(sql,{paymentReversal:process.argv.includes('--multiday-payment-reversal-recovery')});
  } else if (process.argv.includes('--multiday-approval-recovery')) {
    const {verifyMultiDayApproval}=await import('./multiDayApproval.native.mjs');verifyMultiDayApproval(sql);
  } else if(process.argv.includes('--dealer-control-inventory-read')){
    const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
    const acl=sql("SELECT nspacl::text FROM pg_namespace WHERE nspname='auth';");
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
      'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.game_tables t WHERE club_id='${club}'),
      'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s WHERE club_id='${club}'),
      'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE club_id='${club}'))::text);`);
    const before=fingerprint();
    const catalog=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'private_sessions_select',has_table_privilege('authenticated','public.table_sessions','SELECT'),
      'digest',md5(pg_get_functiondef(p.oid))) FROM pg_proc p
      WHERE p.oid='public.get_club_table_inventory(uuid)'::regprocedure;ROLLBACK;`));
    assert.equal(catalog.authenticated,true);assert.equal(catalog.anon,false);assert.equal(catalog.private_sessions_select,false);
    const read=who=>JSON.parse(sql(`BEGIN;GRANT USAGE ON SCHEMA auth TO authenticated;
      SET LOCAL request.jwt.claim.sub='${who}';SET LOCAL request.jwt.claims='{"sub":"${who}","role":"authenticated"}';SET LOCAL ROLE authenticated;
      SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.get_club_table_inventory('${club}') i;ROLLBACK;`));
    const inventory=read(actor);assert.ok(inventory.length>0);
    console.log('DEALER_INVENTORY_NATIVE_COUNTS',JSON.stringify({
      availability:Object.fromEntries([...new Set(inventory.map(t=>t.availability_status))].map(s=>[s,inventory.filter(t=>t.availability_status===s).length])),
      physical:JSON.parse(sql(`SELECT jsonb_build_object('total',count(*),'nonInactive',count(*) FILTER(WHERE status<>'inactive'),
        'openSessions',(SELECT count(*) FROM public.table_sessions WHERE club_id='${club}' AND closed_at IS NULL)) FROM public.game_tables WHERE club_id='${club}';`)),
    }));
    if(process.argv.includes('--dealer-control-inventory-parser')){
      const scopedRows=JSON.parse(sql(`BEGIN;GRANT USAGE ON SCHEMA auth TO authenticated;
        SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
        SELECT jsonb_build_object(
         'game_tables',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT id,table_name,table_type,status FROM public.game_tables WHERE club_id='${club}' ORDER BY table_name LIMIT 200)q),
         'dealers',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT id,full_name,tier FROM public.dealers WHERE club_id='${club}' AND deleted_at IS NULL ORDER BY full_name LIMIT 500)q),
         'dealer_assignments',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT id,table_id,table_session_id,dealer_id,swing_due_at,status,needs_replacement,assigned_at FROM public.dealer_assignments WHERE club_id='${club}' AND status='assigned' ORDER BY assigned_at DESC)q),
         'dealer_attendance',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT dealer_id,current_state,check_in_time FROM public.dealer_attendance WHERE status='checked_in' AND dealer_id IN(SELECT id FROM public.dealers WHERE club_id='${club}' AND deleted_at IS NULL) ORDER BY check_in_time DESC)q)
        );ROLLBACK;`));
      console.log('DEALER_ADAPTER_NATIVE_READ_SCOPE',JSON.stringify({
        role:JSON.parse(sql(`SELECT jsonb_build_object('dealerOperator',floor_private.floor_table_v3_actor_is_dealer_operator('${actor}','${club}'),
          'floorOperator',floor_private.floor_table_v3_actor_is_tournament_operator('${actor}','${club}'),
          'owner',EXISTS(SELECT 1 FROM public.clubs WHERE id='${club}' AND owner_id='${actor}'));`)),
        tables:scopedRows.game_tables.length,dealers:scopedRows.dealers.length,assignments:scopedRows.dealer_assignments.length,
      }));
      execFileSync(process.execPath,['node_modules/vitest/vitest.mjs','run',
        'src/ops/dealer-control/dealerControlReadAdapter.test.ts','-t','retained native inventory',
        '--maxWorkers=1','--no-file-parallelism'],{
        encoding:'utf8',timeout:30000,maxBuffer:2e6,
        env:{...process.env,VINPOKER_DEALER_INVENTORY_GZIP:gzipSync(JSON.stringify({inventory,rows:scopedRows})).toString('base64')},
        stdio:['ignore','inherit','inherit'],
      });
    }
    assert.equal(new Set(inventory.map(t=>t.game_table_id)).size,inventory.length);
    for(const table of inventory){assert.ok(typeof table.availability_status==='string');
      if(table.availability_status==='in_use')assert.ok(table.table_session_id);}
    assert.deepEqual(read('00000000-0000-4000-8000-000000000001'),[]);
    assert.equal(fingerprint(),before);assert.equal(sql("SELECT nspacl::text FROM pg_namespace WHERE nspname='auth';"),acl);
    console.log('DEALER_CONTROL_CANONICAL_INVENTORY_READ_PASS',JSON.stringify({tables:inventory.length,catalog,unchanged:true,outsiderDenied:true}));
  } else if(process.argv.includes('--multiday-payout-label-read')){
    const {parseD2Roster}=await import('../../src/ops/floor/multiDayInitialDraw.ts');
    const event='b8ebfbc7-ff78-4515-8812-7d748b828d0b',actor='f16aa171-4390-4c7c-9ea7-d16e4144092e';
    const acl=sql("SELECT nspacl::text FROM pg_namespace WHERE nspname='auth';");
    const snapshot=()=>sql(`SELECT md5(jsonb_build_object(
      'qualification',(SELECT to_jsonb(l) FROM public.multi_day_qualification_locks_v1 l WHERE event_id='${event}'),
      'finalization',(SELECT to_jsonb(f) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='${event}'),
      'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p))::text);`);
    const before=snapshot();
    const read=name=>JSON.parse(sql(`BEGIN;GRANT USAGE ON SCHEMA auth TO authenticated;
      SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
      SELECT public.${name}('${event}');ROLLBACK;`));
    const roster=parseD2Roster(read('multi_day_final_roster_v1'),event),current=read('multi_day_payout_postfinal_state_v1'),floor=read('multi_day_floor_read_v1');
    assert.equal(roster.qualificationHash,floor.qualification.sourceHash);
    assert.equal(roster.players.length,8);assert.equal(current.obligations.length,8);
    const players=new Map(roster.players.map(p=>[p.participationId,p]));
    for(const row of current.obligations){const player=players.get(row.participationId);assert.ok(player);
      assert.equal(player.playerId,row.playerId);assert.ok(typeof player.name==='string'&&player.name.trim());}
    assert.equal(snapshot(),before);assert.equal(sql("SELECT nspacl::text FROM pg_namespace WHERE nspname='auth';"),acl);
    console.log('MULTIDAY_CANONICAL_ROSTER_PAYOUT_LABEL_IDENTITY_READ_PASS',JSON.stringify({event,
      players:roster.players.length,obligations:current.obligations.length,allNamesVerified:true,matchingParticipationAndPlayer:true,unchanged:true}));
  } else if (process.argv.includes('--multiday-read-contract')) {
    const {verifyMultiDayNativeRead}=await import('./multiDayRead.native.mjs');verifyMultiDayNativeRead(sql);
  } else if (process.argv.includes('--inspect-prediction-catalog')) {
    console.log(sql(`BEGIN READ ONLY;SELECT coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
      'definition',pg_get_functiondef(p.oid),'bodyHash',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'path',p.proconfig,'definer',p.prosecdef,
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service',has_function_privilege('service_role',p.oid,'EXECUTE'))),'[]'::jsonb)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN('get_table_assignments_with_next','predict_next_dealers');ROLLBACK;`));
  } else if (process.argv.includes('--prediction-scope')) {
    const {verifyPredictionScope}=await import('../dealerSwing/predictionScope.native.mjs');verifyPredictionScope(sql);
  } else if (process.argv.includes('--online-hole-privacy')) {
    const {verifyOnlineHolePrivacy}=await import('../onlinePoker/holePrivacy.native.mjs');verifyOnlineHolePrivacy(sql);
  } else if (process.argv.includes('--inspect-online-poker')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('functions',coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
        'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'path',p.proconfig,
        'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
        'service',has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY p.oid::regprocedure::text),'[]'::jsonb))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'op\\_%' ESCAPE '\\';
      SELECT jsonb_build_object('tables',coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
        'anon_select',has_table_privilege('anon',c.oid,'SELECT'),'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT')) ORDER BY c.relname),'[]'::jsonb))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'online_poker_%' AND c.relkind='r';
      SELECT jsonb_build_object('policies',coalesce(jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname),'[]'::jsonb)) FROM pg_policies p
       WHERE schemaname='public' AND tablename IN('online_poker_hand_secrets','online_poker_player_accounts','online_poker_hands');
      SELECT jsonb_build_object('hole_reader',pg_get_functiondef('public.op_get_my_hole_cards(uuid)'::regprocedure));
      ROLLBACK;`));
  } else if(process.argv.includes('--push-worker-local')){
    const {runPushWorkerNative}=await import('./notificationPushWorker.native.mjs');
    await runPushWorkerNative(sql);
  } else if(process.argv.includes('--push-outbox-local')){
    const before=sql(`SELECT md5(jsonb_build_object('notifications',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.notifications n),
      'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text);`);
    if(process.argv.includes('--qualify197')){
      assert.equal(sql("SELECT to_regclass('private.notification_push_outbox_v1') IS NULL;"),'t','new candidate only, no replay');
      console.log(sql(readFileSync('supabase/migrations/20270128000197_notification_push_outbox_v1.sql','utf8')));
    }
    console.log(sql(readFileSync('tests/cashier/notificationPushOutbox.pg17.sql','utf8')));
    const {runPushOverlap}=await import('./notificationPushOverlap.native.mjs');
    await runPushOverlap(sql,{session,until});
    assert.equal(sql(`SELECT md5(jsonb_build_object('notifications',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.notifications n),
      'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text);`),before,'queue probe changed retained notifications/cash');
    console.log('PUSH_OUTBOX_RETAINED_NOTIFICATION_CASH_FINGERPRINT_UNCHANGED');
  } else if(process.argv.includes('--inspect-push-delivery-contract')){
    // Booleans/digests only: a dispatch body may contain legacy credentials.
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('database',current_database(),
       'slot197',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000197'),
       'queue_exists',to_regclass('private.notification_push_outbox_v1') IS NOT NULL,
       'claim_exists',to_regprocedure('public.claim_notification_push_v1(uuid)') IS NOT NULL,
       'notification_types',(SELECT jsonb_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid='public.notification_type'::regtype),
       'queue_rls',(SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('private.notification_push_outbox_v1')),
       'worker_rpcs',(SELECT coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
        'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,
        'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
        'service',has_function_privilege('service_role',p.oid,'EXECUTE'))),'[]'::jsonb)
        FROM pg_proc p WHERE p.oid IN(to_regprocedure('public.claim_notification_push_v1(uuid)'),to_regprocedure('public.finish_notification_push_v1(uuid,uuid,text,uuid)'))),
       'dispatch',(
       SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
        'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,
        'http',p.prosrc ~* 'http_post|http_request',
        'internal_header',p.prosrc LIKE '%x-vinpoker-internal-secret%',
        'idempotency_header',p.prosrc LIKE '%x-idempotency-key%',
        'push_target',p.prosrc LIKE '%send-push-notification%',
        'runtime_config',p.prosrc ~* 'current_setting|vault[.]|app_settings|runtime_config',
        'payload_user_id',p.prosrc LIKE '%user_id%')
       FROM pg_proc p WHERE p.oid='public.fn_dispatch_push()'::regprocedure),
       'notification_triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,
        'function',tgfoid::regprocedure::text)),'[]'::jsonb) FROM pg_trigger WHERE tgrelid='public.notifications'::regclass AND NOT tgisinternal),
       'profile_webhook_callers',(SELECT count(*) FROM pg_proc p WHERE p.prokind='f' AND p.prosrc LIKE '%profile-update-notify%'),
       'profile_log_table',to_regclass('public.profile_update_log') IS NOT NULL,
       'profile_log_function',(SELECT jsonb_build_object('digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
         'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig)
         FROM pg_proc p WHERE p.oid=to_regprocedure('public.fn_log_profile_update()')),
       'profile_triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,
         'function',tgfoid::regprocedure::text)),'[]'::jsonb) FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal));
      ROLLBACK;`));
  } else if (process.argv.includes('--inspect-buyin-delivery-catalog')) {
    // Metadata only: never print function bodies, HTTP headers, addresses or secrets.
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object(
       'database',current_database(),
       'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'signature',p.oid::regprocedure::text,'digest',md5(pg_get_functiondef(p.oid)),
        'receipt',p.prosrc ~* 'seat_draw_receipts|receipt_code',
        'notification',p.prosrc ~* 'notifications|notify_',
        'email',p.prosrc ~* 'send.email|resend|email_outbox|email_delivery|invoice',
        'http',p.prosrc ~* 'http_post|http_request|functions/v1',
        'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,
        'config',p.proconfig) ORDER BY p.oid::regprocedure::text),'[]'::jsonb)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname NOT IN('pg_catalog','information_schema') AND p.prokind='f'
         AND (p.prosrc ~* 'seat_draw_receipts|receipt_code|send.email|resend|email_outbox|email_delivery|invoice'
          OR p.proname IN('fn_dispatch_push','_enqueue_staking_release_effects_v1'))),
       'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,
        'function',t.tgfoid::regprocedure::text) ORDER BY t.tgrelid::regclass::text,t.tgname),'[]'::jsonb)
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname='public'
         AND c.relname IN('bank_transactions','tournament_registrations','tournament_entries',
          'seat_draw_receipts','notifications','cashier_buyin_movements','staking_release_receipts_v1')),
       'delivery_relations',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'schema',n.nspname,'name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity)
        ORDER BY n.nspname,c.relname),'[]'::jsonb)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN('pg_catalog','information_schema') AND c.relkind IN('r','p','v','m')
         AND c.relname ~* 'outbox|email|invoice|receipt|notification|release_effects'));
      ROLLBACK;`));
  } else if (process.argv.includes('--buyin-receipt-read')) {
    const {readNativeBuyinReceipt}=await import('./buyinReceipt.native.mjs');
    await readNativeBuyinReceipt(sql);
  } else if (process.argv.includes('--verified-bank-overlap264')) {
    const {runVerifiedBankOverlap264}=await import('./verifiedBankOverlap264.native.mjs');
    await runVerifiedBankOverlap264(sql,{session,until,resume:process.argv.includes('--resume264')});
  } else if (process.argv.includes('--sepay-webhook-overlap263')) {
    const {runSePayWebhookOverlap263}=await import('./sepayWebhookOverlap263.native.mjs');
    await runSePayWebhookOverlap263(sql,{session,until});
  } else if (process.argv.includes('--sepay-pull-total-local')) {
    if(process.argv.includes('--qualify196')){
      assert.equal(sql("SELECT to_regprocedure('public.sepay_claim_pull_v2(uuid,uuid)') IS NULL;"),'t','no candidate replay');
      console.log(sql(readFileSync('supabase/migrations/20270128000196_sepay_pull_total_fence_v2.sql','utf8')));
    }
    console.log(sql(readFileSync('tests/cashier/sepayPullTotal.pg17.sql','utf8')));
  } else if (process.argv.includes('--sepay-pull-progress-local')) {
    if(process.argv.includes('--qualify195')) {
      assert.equal(sql("SELECT to_regclass('private.sepay_pull_progress_v1') IS NULL;"),'t','new local candidate only, no replay');
      console.log(sql(readFileSync('supabase/migrations/20270128000195_sepay_pull_progress_v1.sql','utf8')));
    }
    console.log(sql(readFileSync('tests/cashier/sepayPullProgress.pg17.sql','utf8')));
    if(process.argv.includes('--overlap')){
      const {runSePayPullOverlap}=await import('./sepayPullOverlap.native.mjs');
      await runSePayPullOverlap(sql,{session,until});
    }
  } else if (process.argv.includes('--inspect-sepay-pull-progress')) {
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('slot195',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000195'),
      'slot196',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000196'),
      'v2',to_regprocedure('public.sepay_claim_pull_v2(uuid,uuid)'),
      'progress',to_regclass('private.sepay_pull_progress_v1'),'claim',to_regprocedure('public.sepay_claim_pull_v1(uuid,uuid)'));
      SELECT column_name||':'||data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='club_payment_config' AND column_name IN('club_id','master_account_number','last_pull_at','is_active','api_token_vault_key');ROLLBACK;`));
  } else if (process.argv.includes('--inspect-sepay-retry')) {
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('function',pg_get_functiondef('public.cashier_retry_paid_seating_v1(boolean,integer)'::regprocedure),
      'digest',md5(pg_get_functiondef('public.cashier_retry_paid_seating_v1(boolean,integer)'::regprocedure)));ROLLBACK;`));
  } else if (process.argv.includes('--sepay-catalog-plan')) {
    const {inspectSePayCatalogPlan}=await import('./sepayCatalogPlan.native.mjs');
    inspectSePayCatalogPlan(sql);
  } else if (process.argv.includes('--inspect-chip-writer-canary')) {
    const manifest=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id,'actor',c.owner_id,'entry',e.id,'player',e.player_id,
      'registration',e.registration_id,'seedHand',h.id,'table',tt.id,'session',tt.table_session_id)
      FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id JOIN public.tournament_hands h ON h.tournament_id=t.id
      JOIN public.hand_players hp ON hp.hand_id=h.id AND hp.seat_number=2
      JOIN public.tournament_entries e ON e.tournament_id=t.id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      JOIN public.tournament_tables tt ON tt.id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND tt.tournament_id=t.id
      WHERE t.id='46cab483-91e7-4220-aacf-e17bdf05269c' AND c.id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
      AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND h.hand_number=1 AND h.status='completed' AND NOT h.is_voided
      AND h.pot_size=200 AND tt.id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND tt.table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'
      AND EXISTS(SELECT 1 FROM public.cashier_buyin_movements m WHERE m.registration_id=e.registration_id AND m.applied_amount=100000);`)||'null');
    if(!manifest)console.log(sql(`SELECT jsonb_build_object('id',h.id,'number',h.hand_number,'status',h.status,'void',h.is_voided,'pot',h.pot_size,
      'table',h.tournament_table_id,'legacyTable',h.table_id,'players',(SELECT jsonb_agg(jsonb_build_object('player',p.player_id,'entry',p.entry_number,'seat',p.seat_number)) FROM public.hand_players p WHERE p.hand_id=h.id))
      FROM public.tournament_hands h WHERE h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND h.hand_number=1;`));
    assert.ok(manifest);console.log('CHIP_WRITER_EXISTING_CANARY_MANIFEST',JSON.stringify(manifest));
  } else if (process.argv.includes('--sepay-provider-pages')) {
    const {runSePayPullPagingNative}=await import('./sepayPullPaging.native.mjs');
    await runSePayPullPagingNative(sql,{crash:process.argv.includes('--crash-before-checkpoint'),loseCheckpointResponse:process.argv.includes('--lose-checkpoint-response'),insertBackdated:process.argv.includes('--insert-backdated')});
  } else if (process.argv.includes('--sepay-handler')||process.argv.includes('--sepay-backlog')||process.argv.includes('--sepay-webhook-chain')||process.argv.includes('--sepay-waiting-chain')) {
    const {runSePayReconcileNative}=await import('./sepayReconcile.native.mjs');
    await runSePayReconcileNative(sql,{backlog:process.argv.includes('--sepay-backlog'),webhook:process.argv.includes('--sepay-webhook-chain')||process.argv.includes('--sepay-waiting-chain'),waiting:process.argv.includes('--sepay-waiting-chain'),session,until});
  } else if (process.argv.includes('--inspect-d2')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('name',p.oid::regprocedure::text,
        'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
        'acl',p.proacl::text,'config',p.proconfig)
      FROM pg_proc p WHERE p.proname IN('multi_day_seat_final_v1','floor_open_tournament_table_v3','multi_day_apply_initial_draw_v1','get_public_tournament_redraw_v1','floor_redraw_apply_clock_hold_v1');
      SELECT jsonb_build_object('table',table_name,'column',column_name,'type',data_type)
      FROM information_schema.columns WHERE table_schema='public' AND table_name IN
        ('table_sessions','tournament_table_seat_locks','floor_pending_tracker_moves','tournament_tables')
      ORDER BY table_name,ordinal_position;
      COMMIT;`));
  } else if(process.argv.includes('--staking-effect-claim-overlap')){
    const request=sql(`SELECT r.id FROM public.staking_release_requests r JOIN public.staking_deals d ON d.id=r.deal_id
      WHERE d.custom_event_name='LOCAL TEST release overlap' AND d.status='completed'
      AND (SELECT count(*) FROM public.staking_release_effects_v1 WHERE release_request_id=r.id AND state='pending')=3
      AND (SELECT count(*) FROM public.staking_release_receipts_v1 WHERE release_request_id=r.id)=1
      ORDER BY r.requested_at DESC,r.id LIMIT 1;`);
    assert.match(request,/^[a-f0-9-]{36}$/,'run the isolated release concurrency fixture first');
    const suffix=randomUUID().slice(0,8),first=session(`effect_claim_a_${suffix}`),second=session(`effect_claim_b_${suffix}`);
    const claim=`BEGIN;SET LOCAL ROLE service_role;SELECT public.claim_staking_release_effect_v1('${request}');\n`;
    try{
      first.child.stdin.write(claim);await until(()=>first.output().includes('"lease_token"'));
      second.child.stdin.write(claim);await until(()=>second.output().includes('"lease_token"'));
      // Second completed its claim while first still holds uncommitted row lock.
      const parse=value=>JSON.parse(value.split('\n').find(line=>line.startsWith('{')));
      const a=parse(first.output()),b=parse(second.output());assert.notEqual(a.id,b.id);assert.notEqual(a.lease_token,b.lease_token);
      first.child.stdin.end('ROLLBACK;\n');second.child.stdin.end('ROLLBACK;\n');await Promise.all([first.closed,second.closed]);
      assert.equal(sql(`SELECT count(*) FROM public.staking_release_effects_v1 WHERE release_request_id='${request}' AND state='pending';`),'3');
      console.log('TWO_LIVE_SESSION_EFFECT_SKIP_LOCKED_DISTINCT_JOB_TOKEN_ROLLBACK_PASS',JSON.stringify({request,jobs:[a.id,b.id]}));
    }finally{
      if(!first.child.stdin.destroyed)first.child.stdin.end('ROLLBACK;\n');
      if(!second.child.stdin.destroyed)second.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([first.closed,second.closed]);
    }
  } else if(process.argv.includes('--staking-release-handler-native')){
    const {runStakingReleaseHandlerNative}=await import('./stakingRelease.handler.native.mjs');
    await runStakingReleaseHandlerNative(sql);
  } else if(process.argv.includes('--staking-request-overlap')){
    const actor='f16aa171-4390-4c7c-9ea7-d16e4144092e',deal=randomUUID(),purchase=randomUUID(),role=randomUUID();
    const club=sql(`SELECT club_id FROM public.tournaments WHERE id='d66cce0e-4225-4765-8b8c-9462e69153e1' AND name='Multi-day Final local TEST';`);
    assert.match(club,/^[a-f0-9-]{36}$/);
    sql(`BEGIN;INSERT INTO public.user_roles(id,user_id,role) VALUES('${role}','${actor}','super_admin') ON CONFLICT DO NOTHING;
      INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,percentage_sold,markup,buy_in_amount_vnd,status,
        filled_percent,result_prize_vnd,backer_payout_vnd,player_payout_vnd,platform_fee_vnd,platform_archive_fee)
      VALUES('${deal}','${actor}','${club}','LOCAL TEST request overlap',now(),10,1,1000000,'result_verified',10,1000000,80100,720900,199000,199000);
      INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
      VALUES('${purchase}','${deal}','${actor}',10,1,100000,'funded','${purchase}');COMMIT;`);
    const suffix=randomUUID().slice(0,8),aName=`request_a_${suffix}`,bName=`request_b_${suffix}`,a=session(aName),b=session(bName);
    const command=`BEGIN;SET LOCAL ROLE service_role;SELECT public.request_staking_release_v1('${actor}','${deal}',80100,720900,'LOCAL OVERLAP');\n`;
    try{
      a.child.stdin.write(command);await until(()=>a.output().includes('"release_request_id"'));
      b.child.stdin.write(command);
      await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${bName}' AND cardinality(pg_blocking_pids(pid))>0);`)==='t');
      a.child.stdin.end('COMMIT;\n');await a.closed;b.child.stdin.end('COMMIT;\n');
      await assert.rejects(b.closed,/staking_request_retry_snapshot/);
      const first=JSON.parse(a.output().split('\n').find(line=>line.startsWith('{')));
      const replay=JSON.parse(sql(`BEGIN;SET LOCAL ROLE service_role;SELECT public.request_staking_release_v1('${actor}','${deal}',80100,720900,'LOCAL OVERLAP');COMMIT;`));
      assert.equal(replay.release_request_id,first.release_request_id);assert.equal(replay.existing,true);
      assert.equal(sql(`SELECT count(*) FROM public.staking_release_requests WHERE deal_id='${deal}';`),'1');
      assert.equal(sql(`SELECT count(*) FROM public.staking_audit_logs WHERE deal_id='${deal}' AND action='release_requested';`),'1');
      assert.equal(sql(`SELECT count(*) FROM public.staking_ledger WHERE deal_id='${deal}';`),'0');
      console.log('TWO_LIVE_SESSION_REQUEST_CREATE_RACE_EXPLICIT_RETRY_SAME_ID_ONE_AUDIT_PASS',JSON.stringify({deal,request:first.release_request_id}));
    }finally{
      if(!a.child.stdin.destroyed)a.child.stdin.end('ROLLBACK;\n');if(!b.child.stdin.destroyed)b.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([a.closed,b.closed]);
      sql(`DELETE FROM public.user_roles WHERE id='${role}' AND user_id='${actor}' AND role='super_admin';`);
    }
  } else if(process.argv.includes('--staking-cosign-overlap')){
    const actor='f16aa171-4390-4c7c-9ea7-d16e4144092e',role=randomUUID(),cashierRole=randomUUID();
    const request=sql(`SELECT r.id FROM public.staking_release_requests r JOIN public.staking_deals d ON d.id=r.deal_id
      WHERE d.custom_event_name='LOCAL TEST request overlap' AND d.player_id='${actor}' AND d.status='release_requested'
      AND r.status='pending_cosign' AND r.requested_by_admin_id='${actor}' ORDER BY r.requested_at DESC,r.id LIMIT 1;`);
    assert.match(request,/^[a-f0-9-]{36}$/,'run request overlap fixture first');
    sql(`INSERT INTO public.user_roles(id,user_id,role) VALUES('${role}','${actor}','super_admin'),('${cashierRole}','${actor}','cashier') ON CONFLICT DO NOTHING;`);
    const suffix=randomUUID().slice(0,8),bName=`cosign_b_${suffix}`,a=session(`cosign_a_${suffix}`),b=session(bName);
    const command=`BEGIN;SET LOCAL ROLE service_role;SELECT public.cosign_staking_release_v1('${actor}','${request}','LOCAL COSIGN OVERLAP');\n`;
    try{
      a.child.stdin.write(command);await until(()=>a.output().includes('"release_request_id"'));b.child.stdin.write(command);
      await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${bName}' AND cardinality(pg_blocking_pids(pid))>0);`)==='t');
      a.child.stdin.end('COMMIT;\n');await a.closed;await until(()=>b.output().includes('"release_request_id"'));b.child.stdin.end('COMMIT;\n');await b.closed;
      const parse=value=>JSON.parse(value.split('\n').find(line=>line.startsWith('{')));
      const first=parse(a.output()),second=parse(b.output());assert.equal(first.release_request_id,second.release_request_id);assert.equal(second.existing,true);
      assert.equal(sql(`SELECT count(*) FROM public.staking_audit_logs WHERE metadata->>'release_request_id'='${request}' AND action='release_cosigned';`),'1');
      assert.equal(sql(`SELECT count(*) FROM public.staking_ledger WHERE release_request_id='${request}';`),'0');
      console.log('TWO_LIVE_SESSION_COSIGN_SAME_INTENT_ONE_AUDIT_REPLAY_PASS',JSON.stringify({request}));
    }finally{
      if(!a.child.stdin.destroyed)a.child.stdin.end('ROLLBACK;\n');if(!b.child.stdin.destroyed)b.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([a.closed,b.closed]);sql(`DELETE FROM public.user_roles WHERE id IN('${role}','${cashierRole}') AND user_id='${actor}';`);
    }
  } else if(process.argv.includes('--staking-request-cosign-handlers')){
    const {runStakingRequestCosignNative}=await import('./stakingRequestCosign.handler.native.mjs');
    await runStakingRequestCosignNative(sql);
  } else if(process.argv.includes('--staking-cosign-integrity')){
    console.log(sql(readFileSync('tests/cashier/stakingCosign.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--staking-request-integrity')){
    console.log(sql(readFileSync('tests/cashier/stakingRequest.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--staking-release-integrity')){
    console.log(sql(readFileSync('tests/cashier/stakingRelease.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--staking-release-concurrency')){
    // Committed synthetic TEST evidence retained: never DELETE append-only ledger.
    const actor=randomUUID(),roleId=randomUUID();
    assert.equal(sql("SELECT string_agg(column_name,',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='auth' AND table_name='users';"),'id');
    sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${actor}');
      INSERT INTO public.user_roles(id,user_id,role) VALUES('${roleId}','${actor}','super_admin');COMMIT;`);
    const club=sql('SELECT id FROM public.clubs ORDER BY id LIMIT 1;');
    try {
    for(const conflict of [false,true]) {
      const deal=randomUUID(),request=randomUUID(),purchase=randomUUID();
      sql(`BEGIN;
        INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,percentage_sold,markup,buy_in_amount_vnd,status,
          filled_percent,result_prize_vnd,backer_payout_vnd,player_payout_vnd,platform_fee_vnd,platform_archive_fee)
        VALUES('${deal}','${actor}','${club}','LOCAL TEST release overlap',now(),10,1,1000000,'cosigned',10,1000000,80100,720900,199000,199000);
        INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
        VALUES('${purchase}','${deal}','${actor}',10,1,100000,'funded','${purchase}');
        INSERT INTO public.staking_release_requests(id,deal_id,requested_by_admin_id,cosigned_by_admin_id,status)
        VALUES('${request}','${deal}','${actor}','${actor}','approved');COMMIT;`);
      const preview=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;
        SELECT public.get_staking_release_preview_v1('${deal}');COMMIT;`));
      const payload={release_request_id:request,preview_hash:preview.preview_hash,player_paid:true,backer_payouts:[{purchase_id:purchase,paid:true,payout_method:'cash'}]};
      const call=(body)=>`SELECT public.commit_staking_release_v2('${actor}','${JSON.stringify(body)}'::jsonb);`;
      const suffix=randomUUID().slice(0,8),name1=`staking_first_${suffix}`,name2=`staking_second_${suffix}`;
      const first=session(name1),second=session(name2);
      try {
        first.child.stdin.write(`BEGIN;SET LOCAL ROLE service_role;${call(payload)}\n`);
        await until(()=>first.output().includes('"success": true'));
        second.child.stdin.write(`BEGIN;SET LOCAL ROLE service_role;${call(conflict?{...payload,note:'conflicting-payload'}:payload)}COMMIT;\n`);
        await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name2}' AND wait_event_type='Lock');`)==='t');
        first.child.stdin.end('COMMIT;\n');await first.closed;
        second.child.stdin.end();
        if(conflict) await assert.rejects(second.closed,/staking_release_payload_conflict/);
        else {
          await second.closed;
          const parse=(value)=>JSON.parse(value.split('\n').find(line=>line.startsWith('{')));
          assert.deepEqual(parse(first.output()),parse(second.output()));
        }
        const facts=JSON.parse(sql(`SELECT jsonb_build_object('ledger',count(*),'amount',sum(amount_vnd),
          'recipients',(SELECT count(*) FROM public.payout_recipients WHERE deal_id='${deal}'),
          'receipts',(SELECT count(*) FROM public.staking_release_receipts_v1 WHERE release_request_id='${request}'),
          'audits',(SELECT count(*) FROM public.staking_audit_logs WHERE deal_id='${deal}' AND action='payout_executed'))
          FROM public.staking_ledger WHERE deal_id='${deal}';`));
        assert.deepEqual(facts,{ledger:2,amount:801000,recipients:2,receipts:1,audits:1});
        console.log('TWO_SESSION_STAKING_RELEASE_LOCK_ONE_LEDGER_SET_PASS',JSON.stringify({conflict,deal,request,...facts}));
      } finally {
        if(!first.child.stdin.destroyed)first.child.stdin.end('ROLLBACK;\n');
        if(!second.child.stdin.destroyed)second.child.stdin.end('ROLLBACK;\n');
        await Promise.allSettled([first.closed,second.closed]);
      }
    }
    }finally{
      // Remove only the role created above. Keep TEST actor referenced by audit/ledger.
      sql(`DELETE FROM public.user_roles WHERE id='${roleId}' AND user_id='${actor}' AND role='super_admin';`);
    }
  } else if(process.argv.includes('--probe-staking-ledger-duplicate')){
    console.log(sql(`BEGIN;
      CREATE TEMP TABLE staking_probe_ids AS SELECT gen_random_uuid() AS deal,gen_random_uuid() AS request,gen_random_uuid() AS actor,gen_random_uuid() AS purchase;
      INSERT INTO public.staking_ledger(deal_id,release_request_id,entry_type,amount_vnd,user_id,performed_by,metadata)
      SELECT deal,request,'escrow_out_backer',80100,actor,actor,jsonb_build_object('purchase_id',purchase,'test','rollback-only-duplicate-probe') FROM staking_probe_ids;
      INSERT INTO public.staking_ledger(deal_id,release_request_id,entry_type,amount_vnd,user_id,performed_by,metadata)
      SELECT deal,request,'escrow_out_backer',80100,actor,actor,jsonb_build_object('purchase_id',purchase,'test','rollback-only-duplicate-probe') FROM staking_probe_ids;
      SELECT jsonb_build_object('diagnostic','UNSAFE_DUPLICATE_RELEASE_LEDGER_ACCEPTED','rows',count(*),'amount',sum(amount_vnd)) FROM public.staking_ledger WHERE release_request_id=(SELECT request FROM staking_probe_ids);
      ROLLBACK;`));
  } else if(process.argv.includes('--inspect-staking-release')){
    console.log(sql(`SELECT jsonb_pretty(jsonb_build_object(
      'columns',(SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('staking_ledger','staking_release_requests','staking_deals','staking_purchases','payout_recipients') ORDER BY table_name,ordinal_position)c),
      'constraints',(SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT conrelid::regclass::text AS table_name,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('public.staking_ledger'::regclass,'public.staking_release_requests'::regclass,'public.payout_recipients'::regclass))c),
      'triggers',(SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT tgrelid::regclass::text AS table_name,tgname,pg_get_triggerdef(oid) AS definition,pg_get_functiondef(tgfoid) AS function_body FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.staking_ledger'::regclass,'public.staking_release_requests'::regclass,'public.staking_deals'::regclass,'public.payout_recipients'::regclass))c)
    ));`));
  } else if(process.argv.includes('--inspect-group-chat-security')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'grants',c.relacl)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
       AND c.relname IN('chat_groups','chat_group_members','chat_group_messages');
      SELECT jsonb_build_object('policy',policyname,'table',tablename,'roles',roles,'cmd',cmd,'using',qual,'check',with_check)
      FROM pg_policies WHERE schemaname='public' AND tablename IN('chat_groups','chat_group_members','chat_group_messages') ORDER BY tablename,policyname;
      SELECT p.oid::regprocedure,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN('is_group_member','is_group_owner','is_group_admin');
      SELECT jsonb_build_object('table',c.relname,'trigger',t.tgname,'definition',pg_get_triggerdef(t.oid))
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN('chat_groups','chat_group_members','chat_group_messages');
      COMMIT;`));
  } else if(process.argv.includes('--inspect-group-helper-digest')){
    console.log(sql(`SELECT jsonb_build_object('digest',md5(replace(prosrc,chr(13),'')),'acl',proacl,'path',proconfig)
      FROM pg_proc WHERE oid='public.is_group_member(uuid,uuid)'::regprocedure;`));
  } else if(process.argv.includes('--inspect-group-chat-shape')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('table',table_name,'column',column_name,'default',column_default,'nullable',is_nullable)
      FROM information_schema.columns WHERE table_schema='public' AND table_name IN('chat_groups','chat_group_members','chat_group_messages') ORDER BY table_name,ordinal_position;
      SELECT p.oid::regprocedure,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN('is_group_creator','trg_chat_group_bump','trg_chat_group_add_creator','fn_chat_message_notify');COMMIT;`));
  } else if(process.argv.includes('--inspect-group-invite-contract')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('function',oid::regprocedure::text,'digest',md5(replace(prosrc,chr(13),'')),'owner',proowner::regrole::text,'acl',proacl,'config',proconfig)
      FROM pg_proc WHERE oid IN('public.get_invite_preview(text)'::regprocedure,'public.accept_group_invite(text)'::regprocedure);
      SELECT jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'default',column_default)
      FROM information_schema.columns WHERE table_schema='public' AND table_name IN('chat_group_members','chat_group_invites') ORDER BY table_name,ordinal_position;
      SELECT jsonb_build_object('trigger',tgname,'table',tgrelid::regclass::text,'body',pg_get_functiondef(tgfoid)) FROM pg_trigger
      WHERE tgrelid IN('public.chat_group_members'::regclass,'public.chat_group_invites'::regclass) AND NOT tgisinternal;COMMIT;`));
  } else if(process.argv.includes('--group-invite-overlap')){
    const owner='a364de8e-06b1-4428-a20d-ac614ec406e5',actorB='62ead6ed-2bef-45ca-92ee-ed963baa1018',actorC=randomUUID();
    const group=randomUUID(),token=randomUUID(),requestB=randomUUID(),requestC=randomUUID(),suffix=randomUUID().slice(0,8),bName=`invite_last_${suffix}`;
    sql(`BEGIN;INSERT INTO public.chat_groups(id,name,created_by,is_public) VALUES('${group}','LOCAL TEST invite final slot','${owner}',false);
      INSERT INTO public.chat_group_invites(group_id,token,created_by,max_uses) VALUES('${group}','${token}','${owner}',1);COMMIT;`);
    const a=session(`invite_first_${suffix}`),b=session(bName);
    const command=(actor,key)=>`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;
      SELECT public.accept_group_invite_v2('${token}','${key}');\n`;
    try{
      a.child.stdin.write(command(actorB,requestB));await until(()=>a.output().includes('"outcome"'));b.child.stdin.end(command(actorC,requestC));
      await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${bName}' AND cardinality(pg_blocking_pids(pid))>0);`)==='t');
      a.child.stdin.end('COMMIT;\n');await a.closed;await assert.rejects(b.closed,/group_invite_exhausted/);
      const replay=JSON.parse(sql(`${command(actorB,requestB)}COMMIT;`));assert.equal(replay.outcome,'replayed');
      const facts=JSON.parse(sql(`SELECT jsonb_build_object('uses',(SELECT uses FROM public.chat_group_invites WHERE token='${token}'),
        'joined',(SELECT count(*) FROM public.chat_group_members WHERE group_id='${group}' AND user_id='${actorB}'),
        'loser',(SELECT count(*) FROM public.chat_group_members WHERE group_id='${group}' AND user_id='${actorC}'),
        'receipts',(SELECT count(*) FROM public.chat_group_invite_accept_receipts_v2 WHERE group_id='${group}'));`));
      assert.deepEqual(facts,{uses:1,joined:1,loser:0,receipts:1});
      console.log('TWO_LIVE_SESSION_INVITE_FINAL_SLOT_ONE_MEMBER_ONE_USE_ONE_RECEIPT_PASS',JSON.stringify({group,facts}));
    }finally{
      if(!a.child.stdin.destroyed&&!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');if(!b.child.stdin.destroyed&&!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([a.closed,b.closed]);
    }
  } else if(process.argv.includes('--group-invite-integrity')){
    console.log(sql(readFileSync('tests/cashier/groupInviteIntegrity.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--probe-group-invite-replay')){
    console.log(sql(`BEGIN;GRANT USAGE ON SCHEMA auth TO authenticated;
      DO $$DECLARE a uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';b uuid:='62ead6ed-2bef-45ca-92ee-ed963baa1018';
        g uuid:=gen_random_uuid();invite_token text:=gen_random_uuid()::text;v uuid;n integer;members integer;denied boolean:=false;
      BEGIN
        INSERT INTO public.chat_groups(id,name,created_by,is_public) VALUES(g,'LOCAL rollback invite replay',a,false);
        INSERT INTO public.chat_group_invites(group_id,token,created_by,max_uses) VALUES(g,invite_token,a,2);
        PERFORM set_config('request.jwt.claim.sub',b::text,true);
        PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',b)::text,true);
        PERFORM set_config('role','authenticated',true);
        v:=public.accept_group_invite(invite_token);IF v<>g THEN RAISE EXCEPTION 'wrong_group_first_accept';END IF;
        v:=public.accept_group_invite(invite_token);IF v<>g THEN RAISE EXCEPTION 'wrong_group_second_accept';END IF;
        BEGIN PERFORM public.accept_group_invite(invite_token);EXCEPTION WHEN OTHERS THEN denied:=true;END;
        PERFORM set_config('role','postgres',true);
        SELECT uses INTO n FROM public.chat_group_invites WHERE token=invite_token;
        SELECT count(*) INTO members FROM public.chat_group_members WHERE group_id=g AND user_id=b;
        IF n<>2 OR members<>1 OR NOT denied THEN RAISE EXCEPTION 'invite_diagnostic_does_not_match_expected_bug';END IF;
        RAISE NOTICE 'CONFIRMED_LOCAL_INVITE_DUPLICATE_ACCEPT_CONSUMES_TWO_USES_ONE_MEMBER_RETRY_DENIED';
      END $$;ROLLBACK;`));
  } else if(process.argv.includes('--group-chat-integrity')){
    console.log(sql(readFileSync('tests/cashier/groupChatIntegrity.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--inspect-d2-restore-contract')){
    console.log(sql(`BEGIN READ ONLY;SELECT p.oid::regprocedure,md5(replace(p.prosrc,chr(13),'')),pg_get_functiondef(p.oid)
      FROM pg_proc p WHERE p.oid IN('public.get_floor_restorable_entries_v3(uuid)'::regprocedure,
        'floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)'::regprocedure);
      SELECT jsonb_build_object('entry',e.id,'status',e.status,'source',e.source,'registration',e.registration_id,
        'qualified',floor_private.is_qualified_final_entry_v1(e.id),'tourStatus',t.status,
        'seat',(SELECT to_jsonb(s) FROM public.tournament_seats s WHERE s.entry_id=e.id AND s.is_active))
      FROM public.tournament_entries e JOIN public.tournaments t ON t.id=e.tournament_id
      WHERE e.id='44f38cd5-c8a3-424c-99e5-803b7692a71a';COMMIT;`));
  } else if(process.argv.includes('--d2-restore-concurrency')){
    const actor='62ead6ed-2bef-45ca-92ee-ed963baa1018',entry='44f38cd5-c8a3-424c-99e5-803b7692a71a';
    const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
    const src=JSON.parse(sql(`SELECT jsonb_build_object('seat',s.id,'tab',s.tournament_table_id,'session',x.id,
      'revision',x.revision,'epoch',x.control_epoch,'stack',s.chip_count,'number',s.seat_number)
      FROM public.tournament_seats s JOIN public.table_sessions x ON x.id=s.table_session_id
      WHERE s.entry_id='${entry}' AND s.tournament_id='7a5a5738-1654-4597-9b8a-597944591e41' AND s.is_active AND x.closed_at IS NULL;`));
    assert.equal(src?.seat,'554c8fc6-6fd1-4153-bd54-f3f809c59178');assert.equal(src.stack,20000);
    const busted=JSON.parse(sql(`BEGIN;${claims}SELECT public.floor_bust_player_v3('${entry}',${src.revision},${src.epoch},20000,'${randomUUID()}','TEST concurrent D2 restore');COMMIT;`));
    assert.equal(busted.ok,true);
    const key=randomUUID(),label='d2restore_'+randomUUID().replaceAll('-','');
    const call=`SELECT public.floor_restore_busted_player_to_seat_v5('${entry}','${src.tab}',${src.number},${busted.revision},${src.epoch},'${key}','${src.session}');`;
    const first=session(label+'_a'),second=session(label+'_b');
    try{
      first.child.stdin.write(`BEGIN;${claims}${call}SELECT 'RESTORE_A_READY';\n`);
      await until(()=>first.output().includes('RESTORE_A_READY'));
      second.child.stdin.end(`BEGIN;${claims}${call}COMMIT;\n`);
      await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${label}_b' AND wait_event_type='Lock');`)==='t');
      first.child.stdin.end('COMMIT;\n');
      const results=(await Promise.all([first.closed,second.closed])).map(out=>JSON.parse(out.split('\n').find(line=>line.startsWith('{'))));
      assert.equal(results[0].ok,true);assert.equal(results[0].seat_id,src.seat);assert.deepEqual(results[1],results[0]);
      assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${entry}';`),'1');
      assert.equal(sql(`SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='7a5a5738-1654-4597-9b8a-597944591e41';`),'0');
      console.log('TWO_SESSION_D2_RESTORE_REAL_LOCK_SAME_KEY_SAME_RECEIPT_ONE_SEED_PASS',JSON.stringify({entry,key,seat:src.seat}));
    }finally{
      if(!first.child.stdin.destroyed)first.child.stdin.end('ROLLBACK;\n');
      if(!second.child.stdin.destroyed)second.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([first.closed,second.closed]);
    }
  } else if(process.argv.includes('--d2-restore-browser-post')){
    const facts=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('entry',e.id,'status',e.status,
      'stack',e.current_stack,'bustOrder',e.bust_order,'place',e.finished_place,'registration',e.registration_id,
      'seed',s.seat_id,'pointer',e.seat_id,'seatCount',(SELECT count(*) FROM public.tournament_seats WHERE entry_id=e.id),
      'active',(SELECT count(*) FROM public.tournament_seats x WHERE x.entry_id=e.id AND x.id=s.seat_id
        AND x.is_active AND x.chip_count=20000 AND x.seat_number=1),
      'cash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id=e.tournament_id),
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id=e.tournament_id))
      FROM public.tournament_entries e JOIN public.multi_day_final_seatings_v1 s ON s.entry_id=e.id
      WHERE e.id='44f38cd5-c8a3-424c-99e5-803b7692a71a' AND e.tournament_id='7a5a5738-1654-4597-9b8a-597944591e41';COMMIT;`));
    assert.deepEqual(facts,{entry:'44f38cd5-c8a3-424c-99e5-803b7692a71a',status:'seated',stack:20000,bustOrder:null,
      place:null,registration:null,seed:'554c8fc6-6fd1-4153-bd54-f3f809c59178',pointer:'554c8fc6-6fd1-4153-bd54-f3f809c59178',
      seatCount:1,active:1,cash:0,entries:8});
    console.log('ACTUAL_BROWSER_D2_MISTAKEN_BUST_RESTORE_SAME_SEED_STACK_NO_CASH_PASS',JSON.stringify(facts));
  } else if(process.argv.includes('--d2-restore-regression')){
    let script=readFileSync('tests/cashier/d2Restore.existing.pg17.sql','utf8');
    if(process.argv.includes('--writer-probe'))script=script.replace('BEGIN;',"BEGIN;SET LOCAL vinpoker.restore_writer_probe='on';");
    console.log(sql(script));
  } else if(process.argv.includes('--main-event-final-checkpoint')){
    const {mainEventBrowser:f}=await import('./mainEventBrowser.fixture.mjs');
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('status',t.status,
      'ranks',(SELECT jsonb_agg(e.finished_place ORDER BY tt.table_number,s.seat_number)
        FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id
        JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id WHERE e.tournament_id=t.id),
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id=t.id),
      'entryStack',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id=t.id),
      'historicalSeatStack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id=t.id),
      'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id=t.id AND is_active),
      'sessions',(SELECT count(*) FROM public.table_sessions WHERE tournament_id=t.id AND closed_at IS NULL),
      'pending',(SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id=t.id AND status='pending'),
      'finalCash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id=t.id),
      'flightCash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id IN('${f.firstFlight}','${f.secondFlight}')),
      'payments',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id=t.id),
      'finalizations',(SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${f.event}'),
      'obligations',(SELECT jsonb_array_length(obligations) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${f.event}'),
      'obligationTotal',(SELECT sum((x.value->>'totalVnd')::bigint) FROM public.multi_day_payout_finalizations_v1 p,
        LATERAL jsonb_array_elements(p.obligations) x(value) WHERE p.event_id='${f.event}'))
      FROM public.tournaments t WHERE id='${f.final}';COMMIT;`));
    // Manual nonzero bust deliberately zeros the entry's playable stack while
    // preserving its inactive seat chip_count as evidence; it is not a hand
    // transfer to the winner. Assert that distinction, not a fictitious 160k winner.
    assert.deepEqual(state,{status:'completed',ranks:[8,7,6,5,4,3,2,1],entries:8,entryStack:20000,historicalSeatStack:160000,
      seats:0,sessions:0,pending:0,finalCash:0,flightCash:1600000,payments:0,finalizations:1,obligations:8,obligationTotal:1600000});
    console.log('SAME_MAIN_EVENT_BROWSER_OFFICIAL_CLOSE_RANKS_FINALIZED_OBLIGATIONS_NO_PAYMENT_PASS',JSON.stringify(state));
  } else if(process.argv.includes('--main-event-first-hand-checkpoint')){
    const {mainEventBrowser:f}=await import('./mainEventBrowser.fixture.mjs');
    const hand='4ea6875c-a198-4c5e-9101-7c0dc4cf65f1';
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'handCount',(SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${f.final}'),
      'status',h.status,'revision',h.source_revision,'pot',h.pot_size,
      'blinds',jsonb_build_array(h.tracker_small_blind,h.tracker_big_blind),
      'actions',(SELECT count(*) FROM public.hand_actions WHERE hand_id=h.id),
      'stack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.final}' AND is_active),
      'entries',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${f.final}'),
      'endStacks',(SELECT jsonb_agg(ending_stack ORDER BY seat_number) FROM public.hand_players WHERE hand_id=h.id),
      'proofs',(SELECT count(*) FROM public.tournament_settlement_outcomes o WHERE o.hand_id=h.id
        AND o.source_revision=h.source_revision AND o.status='verified' AND o.verification_scope='historical_display'),
      'cash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${f.final}'))
      FROM public.tournament_hands h WHERE h.id='${hand}' AND h.tournament_id='${f.final}';COMMIT;`));
    assert.equal(state.handCount,1);assert.equal(state.status,'completed');assert.ok(state.revision>0);
    assert.equal(state.pot,300);assert.deepEqual(state.blinds,[100,200]);assert.equal(state.actions,4);
    assert.equal(state.stack,160000);assert.equal(state.entries,160000);
    assert.deepEqual(state.endStacks,[20000,19900,20100]);assert.equal(state.proofs,1);assert.equal(state.cash,0);
    console.log('MAIN_EVENT_ACTUAL_BROWSER_FIRST_HAND_FINISH_CURRENT_PROOF_CONSERVATION_PASS',JSON.stringify({hand,...state}));
  } else if(process.argv.includes('--main-event-seated-checkpoint')){
    const {mainEventBrowser:f}=await import('./mainEventBrowser.fixture.mjs');
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.final}'),
      'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${f.final}' AND is_active),
      'entryStack',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${f.final}'),
      'seatStack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.final}' AND is_active),
      'cash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${f.final}'),
      'distribution',(SELECT jsonb_object_agg(table_number,n) FROM(SELECT tt.table_number,count(s.id) n
        FROM public.tournament_tables tt JOIN public.tournament_seats s ON s.tournament_table_id=tt.id AND s.is_active
        WHERE tt.tournament_id='${f.final}' GROUP BY tt.table_number)t),
      'holds',(SELECT count(*) FROM public.table_sessions WHERE tournament_id='${f.final}' AND redraw_hold_batch_id IS NOT NULL),
      'plans',(SELECT count(*) FROM private.multi_day_initial_draw_plans_v1 WHERE event_id='${f.event}'),
      'applications',(SELECT count(*) FROM private.multi_day_initial_draw_applications_v1 a
        JOIN private.multi_day_initial_draw_plans_v1 p ON p.id=a.plan_id WHERE p.event_id='${f.event}'));
      COMMIT;`));
    assert.deepEqual(state,{entries:8,seats:8,entryStack:160000,seatStack:160000,cash:0,
      distribution:{20:3,21:3,22:2},holds:0,plans:1,applications:1});
    console.log('MAIN_EVENT_BROWSER_D2_LOST_RESPONSE_RECEIPT_CONTINUE_CONSERVATION_PASS',JSON.stringify(state));
  } else if(process.argv.includes('--main-event-qualified-checkpoint')){
    const {mainEventBrowser:f}=await import('./mainEventBrowser.fixture.mjs');
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'flights',(SELECT count(*) FROM public.tournaments WHERE event_id='${f.event}' AND phase='flight'),
      'locked',(SELECT count(*) FROM public.day_close WHERE tournament_id IN('${f.firstFlight}','${f.secondFlight}') AND status='locked'),
      'bags',(SELECT count(*) FROM public.chip_bag WHERE tournament_id IN('${f.firstFlight}','${f.secondFlight}') AND sealed),
      'bagTotal',(SELECT sum(total_value) FROM public.chip_bag WHERE tournament_id IN('${f.firstFlight}','${f.secondFlight}')),
      'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id IN('${f.firstFlight}','${f.secondFlight}')),
      'qualified',(SELECT count(*) FROM public.multi_day_final_participations_v1 WHERE event_id='${f.event}'),
      'carry',(SELECT sum(carried_stack) FROM public.multi_day_final_participations_v1 WHERE event_id='${f.event}'),
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.final}'),
      'finalCash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${f.final}'),
      'prizes',(SELECT sum(amount) FROM public.tournament_prizes WHERE tournament_id='${f.final}'));
      COMMIT;`));
    assert.deepEqual(state,{flights:2,locked:2,bags:16,bagTotal:320000,cash:1600000,
      qualified:8,carry:160000,entries:0,finalCash:0,prizes:400000});
    console.log('MAIN_EVENT_TWO_BROWSER_FLIGHTS_QUALIFIED_NO_D2_BUYIN_PASS',JSON.stringify(state));
  } else if(process.argv.includes('--main-event-browser-checkpoint')){
    const {mainEventBrowser:f}=await import('./mainEventBrowser.fixture.mjs');
    console.log('MAIN_EVENT_CHECKPOINT_CATALOG',sql(`SELECT jsonb_object_agg(table_name,columns) FROM(
      SELECT table_name,jsonb_agg(column_name ORDER BY ordinal_position) columns FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN('chip_bag','multi_day_qualification_rules_v1') GROUP BY table_name)t;`));
    const state=JSON.parse(sql(`SELECT jsonb_build_object('event',e.id,'final',e.final_tournament_id,'itm',e.itm_percent,
      'policy',(SELECT policy FROM public.multi_day_qualification_rules_v1 WHERE event_id=e.id),
      'history',(SELECT player_history_enabled FROM public.club_settings WHERE club_id=e.club_id),
      'auto',(SELECT auto_swing_enabled FROM public.club_settings WHERE club_id=e.club_id),
      'prizes',(SELECT count(*) FROM public.tournament_prizes WHERE tournament_id=e.final_tournament_id),
      'prizeSum',(SELECT sum(amount) FROM public.tournament_prizes WHERE tournament_id=e.final_tournament_id),
      'bagCount',(SELECT count(*) FROM public.chip_bag WHERE tournament_id='${f.firstFlight}'),
      'sealed',(SELECT count(*) FROM public.chip_bag WHERE tournament_id='${f.firstFlight}' AND sealed),
      'bagTotal',(SELECT sum(total_value) FROM public.chip_bag WHERE tournament_id='${f.firstFlight}'),
      'locked',(SELECT status FROM public.day_close WHERE tournament_id='${f.firstFlight}'),
      'flightCash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.firstFlight}'),
      'finalEntries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id=e.final_tournament_id))
      FROM public.tournament_events e WHERE e.id='${f.event}' AND e.club_id='${f.club}';`));
    assert.deepEqual(state,{event:f.event,final:f.final,itm:25,policy:'SELECT_LARGEST',history:true,auto:false,
      prizes:4,prizeSum:400000,bagCount:8,sealed:8,bagTotal:160000,locked:'locked',flightCash:800000,finalEntries:0});
    console.log('PRIZED_MAIN_EVENT_FIRST_BROWSER_FLIGHT_LOCKED_DB_CHECKPOINT_PASS',JSON.stringify(state));
  } else if(process.argv.includes('--inspect-main-event-continuations')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('event',e.id,'name',e.name,'itm',e.itm_percent,
      'final',e.final_tournament_id,'finalStatus',t.status,
      'flights',(SELECT count(*) FROM public.tournaments f WHERE f.event_id=e.id AND f.phase='flight'),
      'lockedFlights',(SELECT count(*) FROM public.day_close d JOIN public.tournaments f ON f.id=d.tournament_id WHERE f.event_id=e.id AND d.status='locked'),
      'qualificationLocks',(SELECT count(*) FROM public.multi_day_qualification_locks_v1 WHERE event_id=e.id),
      'finalEntries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id=e.final_tournament_id),
      'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id=e.final_tournament_id AND is_active),
      'playableStack',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id=e.final_tournament_id),
      'hands',(SELECT count(*) FROM public.tournament_hands WHERE tournament_id=e.final_tournament_id))
      FROM public.tournament_events e JOIN public.tournaments t ON t.id=e.final_tournament_id
      WHERE e.name IN('Multi-day SELECT_LARGEST local TEST','Multi-day SUM_STACKS local TEST')
      AND (e.itm_percent=25 OR e.id='544613dd-5978-47a7-9502-61214afcdadc') ORDER BY e.created_at;COMMIT;`));
    console.log('MAIN_EVENT_VALID_CONTINUATION_DETAIL',sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('event',e.id,'final',e.final_tournament_id,'club',e.club_id,'actor',c.owner_id,
        'rules',(SELECT to_jsonb(r) FROM public.multi_day_qualification_locks_v1 r WHERE r.event_id=e.id),
        'tables',(SELECT jsonb_agg(jsonb_build_object('table',tt.id,'session',s.id,'physical',tt.game_table_id,
          'number',tt.table_number,'mode',s.control_mode,'epoch',s.control_epoch,'revision',s.revision,'closed',s.closed_at,
          'seats',(SELECT count(*) FROM public.tournament_seats ts WHERE ts.tournament_table_id=tt.id AND ts.is_active)))
          FROM public.tournament_tables tt JOIN public.table_sessions s ON s.id=tt.table_session_id WHERE tt.tournament_id=e.final_tournament_id),
        'stack',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id=e.final_tournament_id),
        'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements m JOIN public.tournaments t ON t.id=m.tournament_id WHERE t.event_id=e.id),
        'prizes',(SELECT jsonb_agg(jsonb_build_object('place',position,'amount',amount)) FROM public.tournament_prizes WHERE tournament_id=e.final_tournament_id),
        'levels',(SELECT count(*) FROM public.tournament_levels WHERE tournament_id=e.final_tournament_id),
        'pendingMoves',(SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id=e.final_tournament_id AND status='pending'))
      FROM public.tournament_events e JOIN public.clubs c ON c.id=e.club_id WHERE e.id='bf5bb71d-e9f1-45da-919a-ee9f8c0e29ad'
      AND e.itm_percent=25 AND e.name='Multi-day SELECT_LARGEST local TEST';COMMIT;`));
  } else if(process.argv.includes('--local-read-latency')){
    console.log(sql(readFileSync('tests/cashier/localReadLatency.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--inspect-finalizer-boundary')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('digest',md5(replace(pg_get_functiondef(oid),chr(13),'')),
      'owner',pg_get_userbyid(proowner),'definer',prosecdef,'path',proconfig,'acl',proacl,
      'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),
      'service',has_function_privilege('service_role',oid,'EXECUTE'),'postgres',has_function_privilege('postgres',oid,'EXECUTE'))
      FROM pg_proc WHERE oid='public.finalize_tournament_results(uuid)'::regprocedure;
      SELECT jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef) ORDER BY p.oid)
      FROM pg_proc p WHERE p.prosrc ILIKE '%finalize_tournament_results%' AND p.oid<>'public.finalize_tournament_results(uuid)'::regprocedure;
      SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN('20270128000180','20270128000181','20270128000182');ROLLBACK;`));
  } else if(process.argv.includes('--inspect-finalizer-lifecycle')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('name',oid::regprocedure::text,'digest',md5(replace(pg_get_functiondef(oid),chr(13),'')),
      'definition',pg_get_functiondef(oid)) FROM pg_proc WHERE oid IN('public.close_tournament(uuid,text)'::regprocedure,
      'public.cashier_create_app_registration_v1(uuid,uuid)'::regprocedure,
      'public.resolve_cashier_cash_buyin_intent_v1(jsonb,text)'::regprocedure);
      SELECT jsonb_build_object('name',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'acl',p.proacl,
        'definition',pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.prosrc ILIKE '%finalize_tournament_results%'
        AND p.oid<>'public.finalize_tournament_results(uuid)'::regprocedure;ROLLBACK;`));
  } else if(process.argv.includes('--inspect-payout-finalizer')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('signature',oid::regprocedure::text,'definition',pg_get_functiondef(oid),
      'digest',md5(replace(pg_get_functiondef(oid),chr(13),'')),'owner',pg_get_userbyid(proowner),'definer',prosecdef,'path',proconfig,'acl',proacl)
      FROM pg_proc WHERE oid='public.finalize_tournament_results(uuid)'::regprocedure;
      SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN('20270128000180','20270128000181','20270128000182');ROLLBACK;`));
  } else if(process.argv.includes('--finalizer-canonical-regressions')||process.argv.includes('--restore-history-canonical')){
    for(const [file,args,gate] of [
      ['crossFlowItm.native.mjs',[],'VINPOKER_NATIVE_CROSS_FLOW'],
      ['officialResultsClose.native.mjs',['--overlap'],'VINPOKER_NATIVE_OFFICIAL_CLOSE'],
      ['restoreHistoryOrder.native.mjs',[],'VINPOKER_NATIVE_RESTORE_HISTORY']]){
      if(process.argv.includes('--restore-history-canonical')&&file!=='restoreHistoryOrder.native.mjs')continue;
      const result=spawnSync(process.execPath,[`tests/cashier/${file}`,...args],{
        encoding:'utf8',timeout:90000,maxBuffer:2e6,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,[gate]:'1'}});
      process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0,`canonical finalization regression ${file}`);
    }
  } else if(process.argv.includes('--finalizer-recovery-probe')){
    const before=sql(`SELECT jsonb_build_object('body',pg_get_functiondef(oid),'acl',proacl) FROM pg_proc WHERE oid='public.finalize_tournament_results(uuid)'::regprocedure;`);
    const recovery=readFileSync('docs/emergency_rollbacks/20270128000181_finalizer_suspend_direct_calls.sql','utf8');
    assert.match(recovery,/COMMIT;\s*$/);
    const result=JSON.parse(sql(recovery.replace(/COMMIT;\s*$/,`SELECT jsonb_build_object(
      'anon',has_function_privilege('anon','public.finalize_tournament_results(uuid)','EXECUTE'),
      'authenticated',has_function_privilege('authenticated','public.finalize_tournament_results(uuid)','EXECUTE'),
      'service',has_function_privilege('service_role','public.finalize_tournament_results(uuid)','EXECUTE'),
      'postgres',has_function_privilege('postgres','public.finalize_tournament_results(uuid)','EXECUTE'));ROLLBACK;`)));
    assert.deepEqual(result,{anon:false,authenticated:false,service:false,postgres:true});
    assert.equal(sql(`SELECT jsonb_build_object('body',pg_get_functiondef(oid),'acl',proacl) FROM pg_proc WHERE oid='public.finalize_tournament_results(uuid)'::regprocedure;`),before);
    console.log('FINALIZER181_SUSPEND_DIRECT_CALLS_ROLLBACK_BODY_ACL_PRESERVED_PASS');
  } else if(process.argv.includes('--finalizer-close-lock-regression')){
    assert.equal(sql(`SELECT has_function_privilege('authenticated','public.finalize_tournament_results(uuid)','EXECUTE');`),'t',
      'historical181 direct-client lock probe requires pre182 catalog; current server-only catalog uses --finalizer-canonical-regressions');
    for(const order of ['--finalizer-first','--close-first']){
      const result=spawnSync(process.execPath,['tests/cashier/officialResultsClose.native.mjs',order],{
        encoding:'utf8',timeout:60000,maxBuffer:2e6,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,VINPOKER_NATIVE_OFFICIAL_CLOSE:'1'}});
      process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0,`finalizer/close lock regression ${order}`);
    }
  } else if(process.argv.includes('--finalizer-registration-overlap')||process.argv.includes('--finalizer-registration-after')){
    if(process.argv.includes('--finalizer-registration-overlap'))assert.equal(sql(`SELECT has_function_privilege('authenticated','public.finalize_tournament_results(uuid)','EXECUTE');`),'t',
      'historical181 direct-client overlap probe requires pre182 catalog; use --finalizer-registration-after for current denied-client boundary');
    const f=createPaidJourneyFixture(sql,{playerHistoryEnabled:true});
    const claims=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
    const registration=()=>{
      const player=randomUUID();sql(`INSERT INTO auth.users(id) VALUES('${player}');`);
      const result=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;
        SELECT public.cashier_create_app_registration_v1('${f.tour}','${player}');COMMIT;`));
      assert.equal(result.ok,true,JSON.stringify(result));return result.registration_id;
    };
    const payment=registrationId=>`SELECT public.resolve_cashier_cash_buyin_intent_v1('${JSON.stringify({actor_id:f.actor,club_id:f.club,tournament_id:f.tour,registration_id:registrationId,amount:100000,request_id:randomUUID()})}'::jsonb,'record');`;
    const second=JSON.parse(sql(`BEGIN;${claims}${payment(registration())}COMMIT;`));
    assert.equal(second.status,'recorded');
    const seat=JSON.parse(sql(`SELECT jsonb_build_object('revision',x.revision,'epoch',x.control_epoch,'stack',s.chip_count)
      FROM public.tournament_seats s JOIN public.table_sessions x ON x.id=s.table_session_id WHERE s.entry_id='${f.entry}' AND s.is_active;`));
    const bust=JSON.parse(sql(`BEGIN;${claims}SELECT public.floor_bust_player_v3('${f.entry}',${seat.revision},${seat.epoch},${seat.stack},'${randomUUID()}','TEST finalizer registration overlap');COMMIT;`));
    assert.equal(bust.ok,true);assert.equal(bust.players_remaining,1);
    const thirdRegistration=registration();
    if(process.argv.includes('--finalizer-registration-after')){
      const direct=sql(`SELECT has_function_privilege('authenticated','public.finalize_tournament_results(uuid)','EXECUTE');`)==='t';
      const before=sql(`SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) FROM public.tournament_entries e WHERE tournament_id='${f.tour}';`);
      let finalizer;
      if(direct)finalizer=JSON.parse(sql(`BEGIN;${claims}SELECT public.finalize_tournament_results('${f.tour}');COMMIT;`));
      else{
        for(const role of ['anon','authenticated','service_role']){
          assert.throws(()=>sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"${role}","sub":"${f.actor}"}';SET LOCAL ROLE ${role};SELECT public.finalize_tournament_results('${f.tour}');COMMIT;`),/permission denied for function finalize_tournament_results/);
        }
        assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) FROM public.tournament_entries e WHERE tournament_id='${f.tour}';`),before);
        finalizer={directExecuteDenied:true};
      }
      const paid=JSON.parse(sql(`BEGIN;${claims}${payment(thirdRegistration)}COMMIT;`));
      const state=JSON.parse(sql(`SELECT jsonb_build_object('entries',count(*),'survivors',count(*) FILTER(WHERE status<>'busted'),
        'ranked',count(finished_place)) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`));
      console.log('FINALIZER_THEN_CANONICAL_PAYMENT_OBSERVED',JSON.stringify({fixture:f,thirdRegistration,finalizer,paid,state}));
      assert.ok(state.survivors<=1||state.ranked===0,'a late canonical payment must not leave committed final places while multiple players remain alive');
      console.log('FINALIZER_THEN_CANONICAL_PAYMENT_RESULT_INVARIANT_PASS');
    }else{
    const suffix=randomUUID().slice(0,8),holder=session(`finalizer_reg_holder_${suffix}`),waiterName=`finalizer_reg_waiter_${suffix}`;
    let waiter,observedWait=false,earlyResult=false;
    try{
      holder.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';${claims}${payment(thirdRegistration)}SELECT 'CANONICAL_PAYMENT_HELD';\n`);
      await until(()=>holder.output().includes('CANONICAL_PAYMENT_HELD'));
      assert.equal(JSON.parse(holder.output().split('\n').find(line=>line.startsWith('{'))).status,'recorded');
      waiter=session(waiterName);
      waiter.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='15s';${claims}SELECT public.finalize_tournament_results('${f.tour}');COMMIT;\n`);
      await until(()=>{
        observedWait=sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${waiterName}' AND cardinality(pg_blocking_pids(pid))>0);`)==='t';
        earlyResult=waiter.output().split('\n').some(line=>line.startsWith('{'));
        return observedWait||earlyResult;
      });
      holder.child.stdin.end('COMMIT;\n');
      const [,waiterOutput]=await Promise.all([holder.closed,waiter.closed]);
      const result=JSON.parse(waiterOutput.split('\n').find(line=>line.startsWith('{')));
      const state=JSON.parse(sql(`SELECT jsonb_build_object('entries',count(*),'survivors',count(*) FILTER(WHERE status<>'busted'),
        'ranked',count(finished_place)) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`));
      console.log('FINALIZER_CANONICAL_REGISTRATION_OVERLAP_OBSERVED',JSON.stringify({fixture:f,thirdRegistration,observedWait,earlyResult,result,state}));
      assert.equal(observedWait,true,'direct finalizer must wait for the canonical paid-registration tournament lock');
      assert.deepEqual(result,{ok:false,error:'tournament_not_finished',survivors:2});
      assert.deepEqual(state,{entries:3,survivors:2,ranked:0});
      console.log('FINALIZER_CANONICAL_REGISTRATION_TRUE_OVERLAP_PASS');
    }finally{
      if(!holder.child.stdin.destroyed)holder.child.stdin.end('ROLLBACK;\n');
      if(waiter&&!waiter.child.stdin.destroyed)waiter.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([holder.closed,...(waiter?[waiter.closed]:[])]);
    }
    }
  } else if(process.argv.includes('--payout-zero-survivor')){
    const f=createPaidJourneyFixture(sql,{playerHistoryEnabled:true});
    const serverOnly=sql(`SELECT has_function_privilege('authenticated','public.finalize_tournament_results(uuid)','EXECUTE');`)==='f';
    const probeFingerprint=()=>sql(`SELECT md5(jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${f.tour}'),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'))::text);`);
    const probeBefore=probeFingerprint();
    if(serverOnly){
      for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.finalize_tournament_results('${f.tour}');ROLLBACK;`),/permission denied for function finalize_tournament_results/);
      assert.equal(probeFingerprint(),probeBefore);
      console.log('FINALIZER182_DIRECT_ROLE_DENIALS_PASS_INTERNAL_ALGORITHM_PROBE_FOLLOWS_AS_POSTGRES');
    }
    const boundaryRows=sql(`BEGIN;
      SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claims='{"role":"authenticated"}';${serverOnly?'':'SET LOCAL ROLE authenticated;'}
      SELECT public.finalize_tournament_results('${f.tour}');
      RESET ROLE;SET LOCAL request.jwt.claim.sub='${randomUUID()}';SET LOCAL request.jwt.claims='{"role":"authenticated"}';${serverOnly?'':'SET LOCAL ROLE authenticated;'}
      SELECT public.finalize_tournament_results('${f.tour}');
      RESET ROLE;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';${serverOnly?'':'SET LOCAL ROLE authenticated;'}
      SELECT public.finalize_tournament_results('${f.tour}');ROLLBACK;`).split('\n').filter(row=>row.startsWith('{')).map(row=>JSON.parse(row));
    assert.deepEqual(boundaryRows.map(row=>row.error),['unauthorized','actor_not_allowed','no_bust_order_captured']);
    assert.equal(probeFingerprint(),probeBefore,'actor rejection and one-survivor/no-history guard must not mutate entries or seats');
    const seat=JSON.parse(sql(`SELECT jsonb_build_object('revision',x.revision,'epoch',x.control_epoch,'stack',s.chip_count)
      FROM public.tournament_seats s JOIN public.table_sessions x ON x.id=s.table_session_id
      WHERE s.entry_id='${f.entry}' AND s.is_active;`));
    const rows=sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';
      SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;
      SELECT public.floor_bust_player_v3('${f.entry}',${seat.revision},${seat.epoch},${seat.stack},'${randomUUID()}','TEST rollback zero-survivor invariant');
      ${serverOnly?'RESET ROLE;':''}
      SELECT public.finalize_tournament_results('${f.tour}');
      RESET ROLE;SELECT jsonb_build_object('survivors',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND status<>'busted'),
        'places',(SELECT jsonb_agg(finished_place ORDER BY id) FROM public.tournament_entries WHERE tournament_id='${f.tour}'));
      ROLLBACK;`).split('\n').filter(row=>row.startsWith('{')).map(row=>JSON.parse(row));
    console.log('ZERO_SURVIVOR_CANONICAL_ROLLBACK_OBSERVATION',JSON.stringify({fixture:f,rows}));
    assert.equal(probeFingerprint(),probeBefore,'probe must rollback entry and seat mutations');
    assert.equal(rows.length,3);assert.equal(rows[0].ok,true,'canonical bust was rejected; investigate actual guard instead');
    assert.equal(rows[2].survivors,0);assert.equal(rows[1].ok,false,'zero-survivor finalizer must not fabricate a winner');
    assert.deepEqual(rows[2].places,[null]);
    console.log('ZERO_SURVIVOR_FINALIZER_FAIL_CLOSED_ROLLBACK_PASS');
  } else if(process.argv.includes('--qualify-tv211')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
      pg_get_functiondef('public.get_tv_display_state_v4(text,boolean)'::regprocedure),
      (SELECT proacl::text FROM pg_proc WHERE oid='public.get_tv_display_state_v4(text,boolean)'::regprocedure),
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.tv_displays d),
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_events e),
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l))::text);`);
    const before=fingerprint(),body=file=>readFileSync(file,'utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
    try{console.log(sql(`BEGIN;${body('supabase/migrations/20270128000211_tv_main_event_guarantee_projection_v1.sql')}
      ${readFileSync('tests/cashier/mainEvent165.tv.pg17.sql','utf8')}
      ${body('docs/emergency_rollbacks/20270128000211_restore_tv_main_event_projection.sql')}
      DO $$ BEGIN ASSERT md5(pg_get_functiondef('public.get_tv_display_state_v4(text,boolean)'::regprocedure))='2923e291fa01da3dca8adbc8991a8a89'; END $$;
      ROLLBACK;`));}finally{assert.equal(fingerprint(),before,'TV211 qualification must leave exact catalog and data unchanged');}
    console.log('TV211_GTD_PROJECTION_RECOVERY_ROLLBACK_PASS');
  } else if(process.argv.includes('--main-event167-rules-form')){
    execFileSync(process.execPath,['--max-old-space-size=192','--max-semi-space-size=4','node_modules/vitest/vitest.mjs','run','tests/cashier/mainEvent167.rules.native.test.tsx','--pool=threads','--maxWorkers=1','--no-file-parallelism'],{
      stdio:'inherit',timeout:60000,env:{...process.env,VINPOKER_NATIVE_MAIN_EVENT_RULES:'1'}});
  } else if(process.argv.includes('--main-event165-tv-render')){
    execFileSync(process.execPath,['--max-old-space-size=192','--max-semi-space-size=4','node_modules/vitest/vitest.mjs','run','tests/cashier/mainEvent165.tv.native.test.tsx','--pool=threads','--maxWorkers=1','--no-file-parallelism'],{
      stdio:'inherit',timeout:60000,env:{...process.env,VINPOKER_NATIVE_MAIN_EVENT_TV:'1'}});
  } else if(process.argv.includes('--recover-tv211-rollback')){
    const before=sql(`SELECT md5(pg_get_functiondef('public.get_tv_display_state_v4(text,boolean)'::regprocedure));`);
    const body=readFileSync('docs/emergency_rollbacks/20270128000211_restore_tv_main_event_projection.sql','utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
    try{sql(`BEGIN;${body}DO $$ BEGIN ASSERT md5(pg_get_functiondef('public.get_tv_display_state_v4(text,boolean)'::regprocedure))='2923e291fa01da3dca8adbc8991a8a89'; END $$;ROLLBACK;`);}
    finally{assert.equal(sql(`SELECT md5(pg_get_functiondef('public.get_tv_display_state_v4(text,boolean)'::regprocedure));`),before);}
    console.log('TV211_EXACT_RECOVERY_REHEARSAL_ROLLBACK_PASS');
  } else if(process.argv.includes('--retain-tv211-local')){
    assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000211';"),'0');
    sql(readFileSync('supabase/migrations/20270128000211_tv_main_event_guarantee_projection_v1.sql','utf8'));
    console.log('TV211_RETAINED_LOCAL_NO_LEDGER',sql(`SELECT md5(pg_get_functiondef('public.get_tv_display_state_v4(text,boolean)'::regprocedure));`));
  } else if(process.argv.includes('--main-event165-tv')){
    console.log(sql(`BEGIN;${readFileSync('tests/cashier/mainEvent165.tv.pg17.sql','utf8')}ROLLBACK;`));
  } else if(process.argv.includes('--main-event164-form')){
    execFileSync(process.execPath,['--max-old-space-size=192','--max-semi-space-size=4','node_modules/vitest/vitest.mjs','run','tests/cashier/mainEvent164.form.native.test.tsx','--pool=threads','--maxWorkers=1','--no-file-parallelism'],{
      stdio:'inherit',timeout:60000,env:{...process.env,VINPOKER_NATIVE_MAIN_EVENT:'1'}});
  } else if(process.argv.includes('--qualify-main-event210')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
      (SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_events' AND column_name='guarantee_amount'),
      pg_get_functiondef('public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure),
      to_regprocedure('private.guard_main_event_guarantee210()'),to_regprocedure('private.lock_main_event_registration210()'),
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_events e),
      (SELECT count(*) FROM public.tournaments),(SELECT count(*) FROM public.tournament_registrations),
      (SELECT count(*) FROM public.table_operation_receipts))::text);`);
    const before=fingerprint(),body=file=>readFileSync(file,'utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
    try{console.log(sql(`BEGIN;${body('supabase/migrations/20270128000210_main_event_shared_create_config_v1.sql')}
      ${readFileSync('tests/cashier/mainEvent163.existing.pg17.sql','utf8')}
      ${readFileSync('tests/cashier/mainEvent164.existing.pg17.sql','utf8')}
      ${body('docs/emergency_rollbacks/20270128000210_suspend_main_event_shared_config.sql')}
      DO $$ BEGIN
       ASSERT NOT has_function_privilege('authenticated','public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE');
       ASSERT has_function_privilege('authenticated','public.get_tournament_event_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE');
      END $$;ROLLBACK;`));}finally{assert.equal(fingerprint(),before);}
    console.log('MAIN_EVENT210_CONFIG_GTD_RECOVERY_ROLLBACK_PASS');
  } else if(process.argv.includes('--retain-main-event210-local')){
    assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000210';"),'0');
    sql(readFileSync('supabase/migrations/20270128000210_main_event_shared_create_config_v1.sql','utf8'));
    console.log('MAIN_EVENT210_RETAINED_LOCAL_NO_LEDGER');
  } else if(process.argv.includes('--qualify-main-event209')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
      to_regprocedure('public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid)'),
      to_regprocedure('public.get_tournament_event_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid)'),
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_events e),
      (SELECT count(*) FROM public.tournaments),(SELECT count(*) FROM public.tournament_levels),
      (SELECT count(*) FROM public.table_operation_receipts))::text);`);
    const before=fingerprint(),body=file=>readFileSync(file,'utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
    try{console.log(sql(`BEGIN;${body('supabase/migrations/20270128000209_main_event_create_receipt_v1.sql')}
      ${readFileSync('tests/cashier/mainEvent163.existing.pg17.sql','utf8')}
      ${body('docs/emergency_rollbacks/20270128000209_suspend_main_event_create.sql')}
      DO $$ BEGIN
       ASSERT NOT has_function_privilege('authenticated','public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE');
       ASSERT has_function_privilege('authenticated','public.get_tournament_event_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE');
      END $$;ROLLBACK;`));}finally{assert.equal(fingerprint(),before);}
    console.log('MAIN_EVENT209_QUALIFICATION_RECOVERY_ROLLBACK_PASS');
  } else if(process.argv.includes('--retain-main-event209-local')){
    assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000209';"),'0');
    sql(readFileSync('supabase/migrations/20270128000209_main_event_create_receipt_v1.sql','utf8'));
    console.log('MAIN_EVENT209_RETAINED_LOCAL_NO_LEDGER');
  } else if(process.argv.includes('--main-event163-concurrency')){
    const {mainEvent163Concurrency}=await import('./mainEvent163.concurrent.native.mjs');
    await mainEvent163Concurrency({sql,session,until});
  } else if(process.argv.includes('--main-event164-guarantee-concurrency')){
    const {mainEvent164GuaranteeConcurrency}=await import('./mainEvent163.concurrent.native.mjs');
    await mainEvent164GuaranteeConcurrency({sql,session,until});
  } else if(process.argv.includes('--private-chat160-sdk')){
    execFileSync(process.execPath,['--max-old-space-size=192','--max-semi-space-size=4','node_modules/vitest/vitest.mjs','run','tests/cashier/privateChatStorage160.native.test.tsx','--pool=threads','--maxWorkers=1','--no-file-parallelism'],{
      stdio:'inherit',timeout:115000,env:{...process.env,VINPOKER_NATIVE_PRIVATE_CHAT:'1',PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}});
  } else if(process.argv.includes('--retain-private-chat207-local')){
    assert.equal(sql(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000207';`),'0');
    sql(readFileSync('supabase/migrations/20270128000207_private_chat_attachment_bucket_v1.sql','utf8'));
    console.log('PRIVATE_CHAT207_LOCAL_BOUNDARY_RETAINED_NO_LEDGER',sql(`SELECT jsonb_build_object('public',public,'fileSizeLimit',file_size_limit,'helper',to_regprocedure('private.can_read_chat_attachment_v1(text)')) FROM storage.buckets WHERE id='chat-private-v1';`));
  } else if(process.argv.includes('--qualify-private-chat207')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM storage.buckets b),(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM storage.objects o),(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='storage'),(SELECT has_schema_privilege('authenticated','auth','USAGE')),to_regprocedure('private.can_read_chat_attachment_v1(text)'))::text);`);
    const before=fingerprint(),body=file=>readFileSync(file,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
    try{console.log(sql(`BEGIN;${body('supabase/migrations/20270128000207_private_chat_attachment_bucket_v1.sql')}
     ${readFileSync('tests/cashier/privateChat207.existing.pg17.sql','utf8')}
     ${body('docs/emergency_rollbacks/20270128000207_suspend_private_chat_uploads.sql')}
     SET LOCAL request.jwt.claim.sub='a364de8e-06b1-4428-a20d-ac614ec406e5';
     SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}';SET LOCAL ROLE authenticated;
     DO $$ BEGIN
      ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id='chat-private-v1' AND name=current_setting('test.private207_dm'))=1;
      BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('chat-private-v1',replace(current_setting('test.private207_dm'),'.png','-after-suspend.png'));RAISE EXCEPTION 'private207_recovery_still_allows_upload';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
     END $$;RESET ROLE;SELECT 'PRIVATE_CHAT207_RECOVERY_STOPS_NEW_UPLOADS_PRESERVES_READ_PASS';ROLLBACK;`));}finally{assert.equal(fingerprint(),before);}
    console.log('PRIVATE_CHAT207_METADATA_QUALIFICATION_ROLLED_BACK_NO_BYTES');
  } else if(process.argv.includes('--direct-image157-storage')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM storage.buckets b),(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM storage.objects o),(SELECT has_schema_privilege('authenticated','auth','USAGE')))::text);`);
    const before=fingerprint();
    try{console.log(sql(readFileSync('tests/cashier/directImageStorage157.existing.pg17.sql','utf8')));}finally{assert.equal(fingerprint(),before);}
  } else if(process.argv.includes('--history156-pagination')){
    execFileSync(process.execPath,['--max-old-space-size=192','--max-semi-space-size=4','--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs',
      '--verified','--canonical-observer','--pagination156'],{stdio:'inherit',timeout:120000,env:{...process.env,
        PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}});
  } else if(process.argv.includes('--history-correction-lock-observer')){
    const result=spawnSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs',
      '--verified','--correction-edge','--correction-overlap','--history-correction-locks','--expect-history-lock-fixed'],{
      encoding:'utf8',timeout:120000,maxBuffer:2e6,env:{...process.env,
        PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0);
  } else if(process.argv.includes('--inspect-canonical-observer')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT pg_get_functiondef('public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid)'::regprocedure);
      WITH target AS (SELECT hand_id FROM public.tournament_settlement_outcomes WHERE correction_reason='TEST correct persisted board' ORDER BY created_at DESC LIMIT 1)
      SELECT jsonb_build_object('hand',to_jsonb(h),'proofs',(SELECT jsonb_agg(jsonb_build_object('id',o.id,'revision',o.source_revision,
        'scope',o.verification_scope,'status',o.status,'public',o.public_outcome)) FROM public.tournament_settlement_outcomes o WHERE o.hand_id=h.id),
        'history',public.get_public_tournament_table_history_v2(h.tournament_id,h.tournament_table_id,20,NULL,NULL))
      FROM public.tournament_hands h JOIN target t ON t.hand_id=h.id;ROLLBACK;`));
  } else if(process.argv.includes('--history-canonical-observer')){
    const retained=()=>sql(`SELECT md5(jsonb_build_object(
      'tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'),
      'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'),
      'proof',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'))::text);`);
    const before=retained();
    try{
      const result=spawnSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified','--canonical-observer'],{
        encoding:'utf8',timeout:120000,maxBuffer:2e6,env:{...process.env,
          PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}});
      process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0);
    }finally{assert.equal(retained(),before,'finalized journey was modified by independent observer test');}
    console.log('RETAINED_FINALIZED_SINGLE_DAY_UNCHANGED_PASS');
  } else if(process.argv.includes('--read149-operator')){
    const {runOperatorReadTransport149}=await import('./operatorReadTransport149.native.mjs');
    await runOperatorReadTransport149({sql});
  } else if(process.argv.includes('--qualify-dealer206')){
    const signature='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)';
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('function',pg_get_functiondef('${signature}'::regprocedure),'metadata',(SELECT to_jsonb(p) FROM pg_proc p WHERE oid='${signature}'::regprocedure))::text);`);
    const before=fingerprint();
    const body=file=>readFileSync(file,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
    try{console.log(sql(`BEGIN;${body('supabase/migrations/20270128000206_dealer_fallback_rest_compensation_v1.sql')}
      SELECT 'DEALER206_FORWARD_METADATA_PASS';
      ${body('docs/emergency_rollbacks/20270128000206_restore_dealer_fallback_rest.sql')}
      SELECT 'DEALER206_EXACT_RECOVERY_PASS';ROLLBACK;`));}finally{assert.equal(fingerprint(),before);}
    console.log('DEALER206_QUALIFICATION_ROLLED_BACK');
  } else if(process.argv.includes('--retain-dealer206-local')){
    assert.equal(sql(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000206';`),'0');
    sql(readFileSync('supabase/migrations/20270128000206_dealer_fallback_rest_compensation_v1.sql','utf8'));
    console.log('DEALER206_RETAINED_LOCAL_NO_LEDGER',sql(`SELECT jsonb_build_object('digest',md5(replace(pg_get_functiondef(oid),chr(13),'')),'acl',proacl,'config',proconfig) FROM pg_proc WHERE oid='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure;`));
  } else if(process.argv.includes('--retain-history205-local')){
    const file='supabase/migrations/20270128000205_public_history_avoid_short_query_jit_v1.sql';
    assert.equal(sql(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000205';`),'0');
    sql(readFileSync(file,'utf8'));
    console.log('HISTORY205_LOCAL_CONFIG_RETAINED_NO_LEDGER',sql(`SELECT jsonb_build_object('digest',md5(replace(pg_get_functiondef(oid),chr(13),'')),'config',proconfig,'acl',proacl,'sourceHash',md5(prosrc)) FROM pg_proc WHERE oid='public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid)'::regprocedure;`));
  } else if(process.argv.includes('--qualify-history205')){
    const migration=readFileSync('supabase/migrations/20270128000205_public_history_avoid_short_query_jit_v1.sql','utf8');
    assert.equal((migration.match(/^BEGIN;$/gm)||[]).length,1);assert.equal((migration.match(/^COMMIT;$/gm)||[]).length,1);
    const ddl=migration.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
    const signature='public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid)';
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('function',pg_get_functiondef('${signature}'::regprocedure),'row',(SELECT to_jsonb(p) FROM pg_proc p WHERE oid='${signature}'::regprocedure),'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf'),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text);`);
    const before=fingerprint();
    try{console.log(sql(`BEGIN;SET LOCAL statement_timeout='30s';SET LOCAL jit=on;
      CREATE TEMP TABLE history205_metadata AS SELECT * FROM pg_proc WHERE oid='${signature}'::regprocedure;
      CREATE TEMP TABLE history205_before AS WITH inputs(label,tour,tbl,lim,cursor_time,cursor_id) AS(VALUES
       ('full','46cab483-91e7-4220-aacf-e17bdf05269c'::uuid,'d294f4a4-082b-4efc-a6ca-1f96579ea344'::uuid,20,NULL::timestamptz,NULL::uuid),
       ('page','46cab483-91e7-4220-aacf-e17bdf05269c'::uuid,'d294f4a4-082b-4efc-a6ca-1f96579ea344'::uuid,2,NULL::timestamptz,NULL::uuid),
       ('invalid',NULL::uuid,NULL::uuid,0,NULL::timestamptz,NULL::uuid),
       ('missing','00000000-0000-4000-8000-000000000000'::uuid,'d294f4a4-082b-4efc-a6ca-1f96579ea344'::uuid,20,NULL::timestamptz,NULL::uuid),
       ('cross_scope','46cab483-91e7-4220-aacf-e17bdf05269c'::uuid,'00000000-0000-4000-8000-000000000000'::uuid,20,NULL::timestamptz,NULL::uuid))
       SELECT *,public.get_public_tournament_table_history_v2(tour,tbl,lim,cursor_time,cursor_id) AS value FROM inputs;
      INSERT INTO history205_before SELECT 'cursor',tour,tbl,2,(value#>>'{nextCursor,createdAt}')::timestamptz,(value#>>'{nextCursor,id}')::uuid,
       public.get_public_tournament_table_history_v2(tour,tbl,2,(value#>>'{nextCursor,createdAt}')::timestamptz,(value#>>'{nextCursor,id}')::uuid)
       FROM history205_before WHERE label='page';
      ${ddl}
      ${readFileSync('tests/cashier/historyJit205.existing.pg17.sql','utf8')}
      ${readFileSync('docs/emergency_rollbacks/20270128000205_restore_history_jit_default.sql','utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')}
      SELECT 'HISTORY205_RECOVERY_RESTORES_EXACT_OLD_DEFINITION_PASS';
      ROLLBACK;`));}finally{assert.equal(fingerprint(),before,'history205 qualification must roll back catalog and retained facts');}
    console.log('HISTORY205_QUALIFICATION_ROLLED_BACK');
  } else if(process.argv.includes('--read148-plan')){
    const signature='public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid)';
    console.log('READ148_CATALOG',sql(`SELECT jsonb_build_object('digest',md5(replace(pg_get_functiondef(oid),chr(13),'')),'config',proconfig,'owner',pg_get_userbyid(proowner),'acl',proacl) FROM pg_proc WHERE oid='${signature}'::regprocedure;`));
    let body=sql(`SELECT prosrc FROM pg_proc WHERE oid='${signature}'::regprocedure;`);
    for(const [key,value] of Object.entries({p_tournament_id:"'46cab483-91e7-4220-aacf-e17bdf05269c'::uuid",p_tournament_table_id:"'d294f4a4-082b-4efc-a6ca-1f96579ea344'::uuid",p_limit:'20',p_before_created_at:'NULL::timestamptz',p_before_id:'NULL::uuid'}))body=body.replace(new RegExp(`\\b${key}\\b`,'g'),value);
    const plan=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='15s';SET LOCAL jit=on;EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${body} ROLLBACK;`))[0];
    console.log('READ148_EXPANDED_OWNER_BODY_PLAN',JSON.stringify({estimatedCost:plan.Plan['Total Cost'],executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],jit:plan.JIT,sharedHits:plan.Plan['Shared Hit Blocks'],sharedReads:plan.Plan['Shared Read Blocks']}));
  } else if(process.argv.includes('--read148-jit-compare')){
    const results=[];
    for(const jit of ['on','off']){
      const started=performance.now();
      const rows=sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='15s';SET LOCAL track_functions='all';SET LOCAL jit=${jit};SET LOCAL ROLE anon;
        WITH r AS MATERIALIZED(SELECT public.get_public_tournament_table_history_v2('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',20,NULL,NULL) AS value)
        SELECT jsonb_build_object('digest',md5(value::text),'items',jsonb_array_length(value->'items')) FROM r;
        RESET ROLE;SELECT jsonb_build_object('function',funcname,'calls',calls,'totalMs',round(total_time::numeric,2),'selfMs',round(self_time::numeric,2))
        FROM pg_stat_xact_user_functions WHERE calls>0 ORDER BY total_time DESC LIMIT 4;ROLLBACK;`);
      results.push({jit,transportMs:Math.round(performance.now()-started),rows:rows.split('\n').map(line=>JSON.parse(line))});
    }
    assert.equal(results[0].rows[0].digest,results[1].rows[0].digest);
    console.log('READ148_JIT_COMPARE_IDENTICAL_PUBLIC_JSON',JSON.stringify(results));
  } else if(process.argv.includes('--read148-profile')){
    console.log(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='15s';SET LOCAL track_functions='all';
      SET LOCAL ROLE anon;
      SELECT jsonb_array_length(public.get_public_tournament_table_history_v2('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',20,NULL,NULL)->'items');
      RESET ROLE;
      SELECT jsonb_build_object('function',funcname,'calls',calls,'totalMs',round(total_time::numeric,2),'selfMs',round(self_time::numeric,2))
        FROM pg_stat_xact_user_functions WHERE calls>0 ORDER BY total_time DESC LIMIT 15;ROLLBACK;`));
  } else if(process.argv.includes('--read147-transport')){
    const {runLocalReadTransport147}=await import('./localReadTransport147.native.mjs');
    await runLocalReadTransport147({sql});
  } else if(process.argv.includes('--history155-read-contract')){
    const {parsePublicTableHistoryPage}=await import('../../src/components/cashier/tournament-live/viewer-hub/publicTableHistory.ts');
    const tour='829e61fe-0ac8-4ced-950d-ab76cb8dadc5';
    const table=sql(`SELECT tournament_table_id FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND tournament_id='${tour}' AND status='completed';`);
    assert.match(table,/^[a-f0-9-]{36}$/);
    const expected=JSON.parse(sql(`SELECT jsonb_agg(id ORDER BY created_at DESC,id DESC) FROM public.tournament_hands WHERE tournament_id='${tour}' AND tournament_table_id='${table}' AND status='completed' AND NOT COALESCE(is_voided,false);`));
    assert.ok(expected.length>2,'existing multi-page fixture required');
    const fingerprint=()=>sql(`SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY id)::text) FROM public.tournament_hands h WHERE tournament_id='${tour}';`);
    const before=fingerprint(),seen=[],cursors=new Set();let cursor=null,pages=0;
    const literal=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
    try{do{
      assert.ok(++pages<=expected.length,'pagination must terminate');
      const raw=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SET LOCAL ROLE anon;SELECT public.get_public_tournament_table_history_v2('${tour}','${table}',2,${literal(cursor?.createdAt??null)}::timestamptz,${literal(cursor?.handId??null)}::uuid);ROLLBACK;`));
      const parsed=parsePublicTableHistoryPage(raw,tour,table);
      assert.ok(parsed);assert.equal(parsed.access,'public');
      for(const hand of parsed.items){assert.ok(!seen.includes(hand.handId));seen.push(hand.handId);}
      cursor=parsed.nextCursor;
      if(cursor){assert.ok(!cursors.has(cursor.handId),'real RPC cursor must progress');cursors.add(cursor.handId);}
    }while(cursor);
    assert.deepEqual(seen,expected);
    console.log('HISTORY155_ACTUAL_ANON_PG_PARSER_KEYSET_READ_PASS',JSON.stringify({tour,table,pages,hands:seen.length}));
    }finally{assert.equal(fingerprint(),before);}
  } else if(process.argv.includes('--history-pagination')){
    console.log(sql(readFileSync('tests/cashier/historyPagination.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--inspect-history-observer')){
    console.log(sql(`BEGIN READ ONLY;SELECT pg_database_size(current_database());
      SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='correct_tracker_historical_hand_blinds';
      SELECT jsonb_build_object('hand',h.id,'revision',h.source_revision,'table',h.tournament_table_id,
       'level',h.tracker_level_id,'level_number',h.tracker_level_number,'sb',h.tracker_small_blind,'bb',h.tracker_big_blind,'bba',h.tracker_bba)
      FROM public.tournament_hands h WHERE h.id='83d02eb2-8f65-4172-a94f-fa34c322e271';ROLLBACK;`));
  } else if(process.argv.includes('--card-authority')){
    console.log(sql(readFileSync('tests/cashier/cardAuthority.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--history-writer-revision')){
    console.log(sql(readFileSync('tests/cashier/historyWriterRevision.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--history-revision-monotonic')){
    console.log(sql(readFileSync('tests/cashier/historyRevisionMonotonic.existing.pg17.sql','utf8')));
    console.log('VERIFIED_BROWSER_HAND_SOURCE_REVISION_MONOTONIC_PASS');
  } else if(process.argv.includes('--inspect-card-authority')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN('update_community_cards','show_hole_cards','_tracker_card_board_source_v1','_tracker_card_hole_source_v1',
        'tracker_update_community_cards_v1','tracker_show_hole_cards_v1','get_tracker_voice_runtime_context') ORDER BY p.proname;
      SELECT jsonb_build_object('table',tablename,'policy',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check)
      FROM pg_policies WHERE schemaname='public' AND tablename IN('tournament_hands','hand_actions','hand_players');
      COMMIT;
      BEGIN;SET LOCAL request.jwt.claim.sub='a364de8e-06b1-4428-a20d-ac614ec406e5';
      SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}';SET LOCAL ROLE authenticated;
      SELECT public.get_tracker_voice_runtime_context('829e61fe-0ac8-4ced-950d-ab76cb8dadc5','8369beb2-7249-4ca8-9cc1-bc9a41f49f50');ROLLBACK;`));
  } else if(process.argv.includes('--inspect-history-writers')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('table',c.relname,'trigger',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),
        'function',p.proname,'digest',md5(p.prosrc),'body',CASE WHEN p.proname IN('tracker_bump_hand_source_revision','bump_hand_identity_revision_v1','tracker_enqueue_historical_display_trigger') THEN p.prosrc END)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE c.oid IN('public.tournament_hands'::regclass,'public.hand_actions'::regclass,'public.hand_players'::regclass) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;
      SELECT jsonb_build_object('writer_candidate',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
        'definer',p.prosecdef,'digest',md5(p.prosrc),'acl',p.proacl,
        'tables',array(SELECT name FROM unnest(ARRAY['tournament_hands','hand_actions','hand_players']) name
          WHERE p.prosrc ~* ('(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?'||name||'\\y')))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
        AND p.prosrc ~* '(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?(tournament_hands|hand_actions|hand_players)\\y'
      ORDER BY p.proname;
      SELECT jsonb_build_object('review',p.proname,'definition',pg_get_functiondef(p.oid)) FROM pg_proc p
      WHERE p.oid='public.cleanup_orphan_hands(interval)'::regprocedure;
      COMMIT;`));
  } else if(process.argv.includes('--qualify184-action-source')){
    console.log(sql(readFileSync('supabase/migrations/20270128000184_tracker_finish_recorded_actions_complete_v1.sql','utf8')));
    const {probeRetainedSidepot}=await import('../trackerSettlement/sidepotRetained.rollback.native.mjs');
    await probeRetainedSidepot(sql,{sourceOmission:true});
  } else if(process.argv.includes('--retained-sidepot-history')||process.argv.includes('--retained-short-stack-history')){
    const shortStack=process.argv.includes('--retained-short-stack-history');
    if(process.argv.includes('--restore-retained-correction-scope-only')){
      assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE id='08730ce1-9a83-4439-96f9-ac005ae3d734' AND source_revision=24 AND status='completed';`),'1');
      assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='08730ce1-9a83-4439-96f9-ac005ae3d734' AND correction_reason='TEST correct persisted board';`),'0');
      console.log(sql(`UPDATE public.tracker_correction_uat_scopes SET enabled=false
        WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'
        AND tournament_table_id='009305c5-308b-4e67-81b1-f1e1e8cc5747' AND user_id='675fe35e-60a8-4452-bb90-e79486d54da6'
        AND capability='correct_completed_hand' AND enabled RETURNING jsonb_build_object('scope',id,'enabled',enabled);`));
    }
    const output=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{
      encoding:'utf8',timeout:120000,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,
        VINPOKER_NATIVE_PAID_TOUR:'1',VINPOKER_HISTORY_RETAINED_SIDEPOT:shortStack?'hand3':'1',
        VINPOKER_HISTORY_PARENT_HAND:shortStack?'ba840f18-085a-430a-918a-6fca24d8c9ca':'08730ce1-9a83-4439-96f9-ac005ae3d734',
        VINPOKER_HISTORY_PARENT_BASELINE:JSON.stringify({tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',
          actor:'675fe35e-60a8-4452-bb90-e79486d54da6',player:'533feda3-28c5-4194-bdf3-53a07c41305b',entry:'9384eec9-8014-4d38-a1b0-03a35d264aa9',
          registration:'39b9d553-f5b2-4d50-8cfc-4d138fd77cbc'})}});
    assert.match(output,shortStack?/ACTUAL_RETAINED_BROWSER_SHORT_STACK_REV19_WORKER_PUBLIC_VERIFIED_PASS/:/ACTUAL_RETAINED_BROWSER_SIDEPOT_REV24_WORKER_MAIN_SIDE_REFUND_PUBLIC_VERIFIED_PASS/);
    process.stdout.write(output);
  } else if(process.argv.includes('--source184-recovery-check')){
    const containment=readFileSync('docs/emergency_rollbacks/20270128000184_suspend_manual_finish.sql','utf8');
    assert.match(containment,/COMMIT;\s*$/);
    console.log(sql(containment.replace(/COMMIT;\s*$/,()=>`DO $$ BEGIN
      IF has_function_privilege('authenticated','public.record_tracker_manual_hand_v1(jsonb)','EXECUTE') THEN
        RAISE EXCEPTION 'CONTAINMENT_DID_NOT_REVOKE_MANUAL_FINISH';END IF;
      PERFORM set_config('role','authenticated',true);
      BEGIN PERFORM public.record_tracker_manual_hand_v1('{}'::jsonb);
        RAISE EXCEPTION 'CONTAINMENT_CALL_UNEXPECTEDLY_ALLOWED';
      EXCEPTION WHEN insufficient_privilege THEN NULL;END;
      PERFORM set_config('role','none',true);
    END $$;ROLLBACK;
    DO $$ BEGIN
      IF NOT has_function_privilege('authenticated','public.record_tracker_manual_hand_v1(jsonb)','EXECUTE') THEN
        RAISE EXCEPTION 'CONTAINMENT_ROLLBACK_DID_NOT_RESTORE_ACL';END IF;
      IF md5(replace(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))<>'c27453912f2d503d87e0be18412dc92e' THEN
        RAISE EXCEPTION 'CONTAINMENT_CHANGED_SAFE_CORE';END IF;
    END $$;`)));
    console.log('SOURCE184_CONTAINMENT_DENIES_AUTHENTICATED_CALL_ROLLBACK_RESTORES_ACL_SAFE_CORE_PASS');
  } else if(process.argv.includes('--inspect-action-source-boundary')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
        'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl,
        'body',CASE WHEN p.proname='record_hand' AND ${process.argv.includes('--include-body')?'true':'false'} THEN p.prosrc END)
      FROM pg_proc p WHERE p.oid IN('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure,
        'public.record_tracker_manual_hand_v1(jsonb)'::regprocedure,'floor_private.tracker_manual_pots_match_v1(jsonb,jsonb,integer)'::regprocedure);
      SELECT jsonb_build_object('ledger184',count(*)) FROM supabase_migrations.schema_migrations WHERE version='20270128000184';
      ROLLBACK;`));
  } else if(process.argv.includes('--inspect-manual-finish-contract')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
       'definer',p.prosecdef,'acl',p.proacl,'body',CASE WHEN p.proname='record_tracker_manual_hand_v1' THEN p.prosrc END)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
       AND p.proname IN('record_tracker_manual_hand_v1','record_hand');
      SELECT jsonb_build_object('caller',p.oid::regprocedure::text,'body',p.prosrc)
      FROM pg_proc p WHERE p.prosrc LIKE '%record_hand(%' AND p.proname<>'record_hand';
      SELECT jsonb_build_object('metadata',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,
       'config',p.proconfig,'acl',p.proacl,'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')))
      FROM pg_proc p WHERE p.oid IN('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure,
       to_regprocedure('floor_private.tracker_manual_pots_match_v1(jsonb,jsonb,integer)'));
      SELECT jsonb_build_object('localLedger183',count(*)) FROM supabase_migrations.schema_migrations WHERE version='20270128000183';
      ROLLBACK;`));
  } else if(process.argv.includes('--pot183-history-regression')){
    const result=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{encoding:'utf8',timeout:120000,
      env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}});
    assert.match(result,/ACTUAL_HISTORY_WORKER_VERIFIER_PAID_FOLD_OUTCOME_PUBLIC_VERIFIED_PASS/);
    process.stdout.write(result);
  } else if(process.argv.includes('--pot183-deferred-regressions')){
    const result=execFileSync(process.execPath,['tests/cashier/paidDeferredCancel.concurrent.mjs'],{encoding:'utf8',timeout:120000,
      env:{...process.env,VINPOKER_NATIVE_DEFERRED_CANCEL:'1',PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}});
    process.stdout.write(result);
  } else if(process.argv.includes('--pot183-paid-regressions')){
    for(const verified of [false,true]){
      const {fixture,hand}=createPaidCompletedHandFixture(sql,{verified});
      assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${hand}';`),'completed');
      assert.equal(Number(sql(`SELECT pot_size FROM public.tournament_hands WHERE id='${hand}';`)),verified?200:0);
      assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${fixture.tour}' AND is_active;`),'3|60000');
      console.log('POT183_CANONICAL_PAID_WAIT_FINISH_MODE_SEAT_REGRESSION_PASS',JSON.stringify({verified,tour:fixture.tour,hand}));
    }
  } else if(process.argv.includes('--floor-alert-transition-retry')){
    const {createFloorAlertBrowser}=await import('../trackerVoice/floorAlertBrowser.local.mjs');
    const scope={club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour:'46cab483-91e7-4220-aacf-e17bdf05269c',
      table:'d294f4a4-082b-4efc-a6ca-1f96579ea344',session:'ee2b9393-0c96-42f9-8667-7f306edeb9bc'};
    const actor='675fe35e-60a8-4452-bb90-e79486d54da6',log=[];
    const priorBrowser=process.env.VINPOKER_NATIVE_BROWSER,priorFloor=process.env.VINPOKER_FLOOR_ALERT_BROWSER;
    let bridge;
    try{
      process.env.VINPOKER_NATIVE_BROWSER='1';process.env.VINPOKER_FLOOR_ALERT_BROWSER='1';
      bridge=await createFloorAlertBrowser({sql,scope,actor,log});
      const report={p_tournament_id:scope.tour,p_tournament_table_id:scope.table,p_hand_id:bridge.manifest.hand,
        p_expected_source_revision:bridge.manifest.revision,p_request_id:randomUUID()};
      const url=name=>new URL('http://127.0.0.1:54329/rest/v1/rpc/'+name);
      assert.equal((await bridge.handle(url('report_tracker_wrong_hand_v1'),'POST',report)).status,503);
      const reported=await bridge.handle(url('report_tracker_wrong_hand_v1'),'POST',report);
      assert.equal(reported.status,200);assert.equal(reported.value.ok,true);
      const intent={p_alert_id:reported.value.alert_id,p_expected_version:1,p_transition:'acknowledge',p_note:null,
        p_idempotency_key:'floor-alert:'+randomUUID()};
      const first=await bridge.handle(url('transition_tracker_floor_alert'),'POST',intent);
      assert.deepEqual(first.value,{ok:true,alert_id:intent.p_alert_id,status:'acknowledged',version:2,duplicate:false});
      const duplicate=await bridge.handle(url('transition_tracker_floor_alert'),'POST',intent);
      assert.deepEqual(duplicate.value,{...first.value,duplicate:true});
      const mismatch=await bridge.handle(url('transition_tracker_floor_alert'),'POST',{...intent,p_transition:'start'});
      assert.deepEqual(mismatch.value,{ok:false,error:'idempotency_mismatch'});
      const listed=await bridge.handle(url('list_tracker_floor_alerts'),'POST',{p_tournament_id:scope.tour,p_status:null});
      const row=listed.value.alerts.find(a=>a.id===intent.p_alert_id);
      assert.equal(row.version,2);assert.equal(row.status,'acknowledged');
      console.log('LOCAL_FLOOR_ALERT_TRANSITION_RETRY_ROLLBACK_PASS',JSON.stringify({duplicate:true,payloadConflict:true,
        version:row.version,status:row.status,actualRpcCalls:3,transaction:'ROLLBACK_ONLY'}));
    }finally{
      try{if(bridge)await bridge.cleanup();}finally{
        if(priorBrowser===undefined)delete process.env.VINPOKER_NATIVE_BROWSER;else process.env.VINPOKER_NATIVE_BROWSER=priorBrowser;
        if(priorFloor===undefined)delete process.env.VINPOKER_FLOOR_ALERT_BROWSER;else process.env.VINPOKER_FLOOR_ALERT_BROWSER=priorFloor;
      }
    }
  } else if(process.argv.includes('--floor-alert-transition-catalog')){
    console.log('LOCAL_FLOOR_ALERT_TRANSITION_CATALOG',sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('database',current_database(),'digest',md5(pg_get_functiondef(p.oid)),
       'security_definer',p.prosecdef,'config',p.proconfig,
       'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
       'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
       'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
       'receipt_before_version',strpos(pg_get_functiondef(p.oid),'v_stored :=')>0 AND
         strpos(pg_get_functiondef(p.oid),'v_stored :=')<strpos(pg_get_functiondef(p.oid),'IF v_alert.version'),
       'receipt_match_guard',strpos(pg_get_functiondef(p.oid),'idempotency_mismatch')>0,
       'receipt_fields',strpos(pg_get_functiondef(p.oid),'''alert_id'', v_alert.id')>0 AND
         strpos(pg_get_functiondef(p.oid),'''version'', v_alert.version + 1')>0,
       'floor_authorization',strpos(pg_get_functiondef(p.oid),'is_club_floor(v_actor, v_alert.club_id)')>0)
      FROM pg_proc p WHERE p.oid=to_regprocedure('public.transition_tracker_floor_alert(uuid,integer,text,text,text)');
      SELECT jsonb_build_object('alerts_with_receipts',count(*) FILTER(WHERE transition_receipts<>'{}'::jsonb),
        'receipt_count',coalesce(sum((SELECT count(*) FROM jsonb_object_keys(transition_receipts))),0)) FROM public.tracker_floor_alerts;
      ROLLBACK;`));
  } else if(process.argv.includes('--tracker-alert-read')){
    const {readTrackerAlertCounts}=await import('../trackerVoice/trackerBrowserEdge.local.mjs');
    const tour='46cab483-91e7-4220-aacf-e17bdf05269c',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournaments WHERE id='${tour}' AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');`),'t');
    const fingerprint=()=>sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'[]')) FROM public.tracker_floor_alerts a;`);
    const before=fingerprint();
    const oldOptIn=process.env.VINPOKER_NATIVE_BROWSER;
    try {
      process.env.VINPOKER_NATIVE_BROWSER='1';
      const url=new URL(`http://127.0.0.1:54329/rest/v1/tracker_floor_alerts?select=physical_table_id&tournament_id=eq.${tour}&status=in.(open,acknowledged,in_progress)`);
      const query=statement=>JSON.parse(sql(`BEGIN;GRANT USAGE ON SCHEMA auth TO authenticated;
        SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
        SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
        ${statement}ROLLBACK;`));
      const rows=readTrackerAlertCounts({url,fixture:{tour},query});
      const expected=JSON.parse(sql(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT physical_table_id FROM public.tracker_floor_alerts WHERE tournament_id='${tour}' AND status IN ('open','acknowledged','in_progress'))t;`));
      assert.deepEqual(rows,expected);
      console.log('TRACKER_ALERT_AUTHENTICATED_REAL_PG_READ_PASS',JSON.stringify({tour,rows:rows.length}));
    } finally {
      if(oldOptIn===undefined)delete process.env.VINPOKER_NATIVE_BROWSER;else process.env.VINPOKER_NATIVE_BROWSER=oldOptIn;
      assert.equal(fingerprint(),before,'alert projection cannot mutate canonical alerts');
    }
  } else if(process.argv.includes('--verify193-recovery-rollback')){
    const recovery=readFileSync('docs/emergency_rollbacks/20270128000193_restore_reviewed_start_void.sql','utf8');
    assert.match(recovery,/COMMIT;\s*$/);
    sql(recovery.replace(/COMMIT;\s*$/,'ROLLBACK;'));
    assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),chr(13),''));"),'278caed40725bfe99b97d2cc61887037');
    assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)'::regprocedure),chr(13),''));"),'599d94b5e9acd99192008ba79f75cae6');
    console.log('SNAPSHOT193_EXACT_FUNCTION_RECOVERY_ROLLBACK_PASS');
  } else if(process.argv.includes('--verify192-recovery-rollback')){
    const recovery=readFileSync('docs/emergency_rollbacks/20270128000192_restore_reviewed_void.sql','utf8');
    assert.match(recovery,/COMMIT;\s*$/);
    sql(recovery.replace(/COMMIT;\s*$/,'ROLLBACK;'));
    assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),chr(13),''));"),'1672a3d20b25be4ca2283e6dc781e1be');
    console.log('VOID192_EXACT_PREDECESSOR_RECOVERY_ROLLBACK_PASS');
  } else if(process.argv.includes('--void192-recover-child')){
    const source=readFileSync('tests/trackerVoice/voidCurrentSeat192.existing.pg17.sql','utf8').replaceAll('\r','');
    const footer="ROLLBACK;\nSELECT 'VOID192_RETAINED_CHILD_CURRENT_SEAT_HISTORY_PRESERVED_ROLLBACK_PASS';";
    assert.equal(source.split(footer).length,2);
    console.log(sql(source.replace(footer,"COMMIT;SELECT 'VOID192_RETAINED_CHILD_CANONICAL_RECOVERY_COMMIT_PASS';")));
  } else if(process.argv.includes('--void192-probe')){
    console.log(sql(readFileSync('tests/trackerVoice/voidCurrentSeat192.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--browser18-canary-recover')||process.argv.includes('--browser19-canary-recover')||process.argv.includes('--browser21-canary-recover')||process.argv.includes('--browser22-canary-recover')){
    const canary19=process.argv.includes('--browser19-canary-recover');
    const canary21=process.argv.includes('--browser21-canary-recover');
    const canary22=process.argv.includes('--browser22-canary-recover');
    const canaryId=canary22?'acd3dc86-185d-4268-8cea-49ffa09244e0':canary21?'f84357f2-6b9d-4ca7-8e0d-c39d4f9ad626':canary19?'1bbc8da7-0ee7-4f50-8e5f-9a8a283324c8':'8058d466-ad03-490a-ab2c-35f6f7a25f9d';
    const canaryNumber=canary22?22:canary21?21:canary19?19:18;
    const usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
    console.log(sql(`BEGIN;${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
      DO $$ DECLARE r jsonb;h public.tournament_hands;cash_before text;proof_before text;old_seat_before text;BEGIN
       ASSERT md5(replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),chr(13),''))='278caed40725bfe99b97d2cc61887037';
       SELECT * INTO STRICT h FROM public.tournament_hands WHERE id='${canaryId}';
       ASSERT h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND h.hand_number=${canaryNumber} AND h.pot_size=200;
       SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id)::text,'[]')) INTO cash_before
        FROM public.cashier_buyin_movements m WHERE tournament_id=h.tournament_id;
       SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY id)::text,'[]')) INTO proof_before
        FROM public.tournament_settlement_outcomes o WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb';
       SELECT md5(to_jsonb(s)::text) INTO old_seat_before FROM public.tournament_seats s WHERE id='d5b6eaeb-1616-493c-9da1-6dea18c97d1f';
       IF NOT h.is_voided THEN
        ASSERT h.status='completed';
        PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
        PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}',true);
        PERFORM set_config('role','authenticated',true);
        r:=public.void_last_hand(h.id);ASSERT r->>'status'='success',r::text;
        PERFORM set_config('role','none',true);
       END IF;
       ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id=h.id AND is_voided AND status='voided');
       ASSERT (SELECT count(*)=2 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id=h.tournament_id AND is_active);
       ASSERT (SELECT jsonb_agg(chip_count ORDER BY seat_number)='[59400,600]'::jsonb FROM public.tournament_seats WHERE tournament_id=h.tournament_id AND is_active);
       ASSERT cash_before=(SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id)::text,'[]')) FROM public.cashier_buyin_movements m WHERE tournament_id=h.tournament_id);
       ASSERT proof_before=(SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY id)::text,'[]')) FROM public.tournament_settlement_outcomes o WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb');
       ASSERT old_seat_before=(SELECT md5(to_jsonb(s)::text) FROM public.tournament_seats s WHERE id='d5b6eaeb-1616-493c-9da1-6dea18c97d1f');
      END $$;
      ${usage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}
      COMMIT;SELECT 'HAND${canaryNumber}_CANONICAL_CANARY_RECOVERY_PASS_NOT_BROWSER_CONFIRM_PASS';`));
  } else if(process.argv.includes('--browser19-canary-read')||process.argv.includes('--browser21-canary-read')||process.argv.includes('--browser22-canary-read')){
    const canaryId=process.argv.includes('--browser22-canary-read')?'acd3dc86-185d-4268-8cea-49ffa09244e0':process.argv.includes('--browser21-canary-read')?'f84357f2-6b9d-4ca7-8e0d-c39d4f9ad626':'1bbc8da7-0ee7-4f50-8e5f-9a8a283324c8';
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('id',h.id,'number',h.hand_number,'status',h.status,'voided',h.is_voided,'pot',h.pot_size,
       'revision',h.source_revision,'actions',(SELECT count(*) FROM public.hand_actions WHERE hand_id=h.id),
       'outcomes',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id=h.id),
       'snapshots',(SELECT count(*) FROM floor_private.tracker_hand_seat_snapshots193 WHERE hand_id=h.id),
       'active_chips',(SELECT jsonb_agg(chip_count ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_id=h.tournament_id AND is_active),
       'cash_hash',(SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id)::text,'[]')) FROM public.cashier_buyin_movements m WHERE tournament_id=h.tournament_id),
       'proof10_hash',(SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY id)::text,'[]')) FROM public.tournament_settlement_outcomes o WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb'),
       'old_seat_hash',(SELECT md5(to_jsonb(s)::text) FROM public.tournament_seats s WHERE id='d5b6eaeb-1616-493c-9da1-6dea18c97d1f'))
      FROM public.tournament_hands h WHERE h.id='${canaryId}' AND h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c';
      ROLLBACK;`));
    if(process.argv.includes('--browser22-canary-read')){
      const proof=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.role='service_role';
        SET LOCAL request.jwt.claims='{"role":"service_role"}';
        SELECT jsonb_build_object('voided',h.is_voided,'revision',h.source_revision,
         'proof_count',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id=h.id),
         'proof_revision',o.source_revision,'scope',o.verification_scope,'proof_status',o.status,
         'hash_matches',CASE WHEN NOT h.is_voided THEN o.source_chain_hash=public.get_tracker_historical_display_snapshot(h.id,h.tournament_id)->>'sourceChainHash' ELSE NULL END,
         'public',public.get_public_tournament_settlement(h.id))
        FROM public.tournament_hands h JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id
        WHERE h.id='${canaryId}';ROLLBACK;`));
      assert.equal(proof.proof_count,1);assert.equal(proof.proof_revision,9);assert.equal(proof.scope,'historical_display');
      if(!proof.voided){assert.equal(proof.revision,9);assert.equal(proof.hash_matches,true);assert.equal(proof.public?.status,'verified');}
      else {assert.equal(proof.revision,10);assert.notEqual(proof.public?.status,'verified');}
      console.log('HAND22_CURRENT_DISPLAY_PROOF_OR_AUDITED_VOID_INVALIDATION_PASS',JSON.stringify(proof));
    }
  } else if(process.argv.includes('--browser193-read')){
    console.log(sql(`SELECT jsonb_build_object('hand',jsonb_build_object('id',h.id,'number',h.hand_number,'status',h.status,'voided',h.is_voided,'revision',h.source_revision,'pot',h.pot_size),
      'hand18',(SELECT jsonb_build_object('id',id,'number',hand_number,'status',status,'voided',is_voided,'pot',pot_size) FROM public.tournament_hands WHERE id='8058d466-ad03-490a-ab2c-35f6f7a25f9d'),
      'actions',(SELECT count(*) FROM public.hand_actions WHERE hand_id=h.id),
      'snapshots',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seat_number) FROM floor_private.tracker_hand_seat_snapshots193 x WHERE hand_id=h.id),
      'active_seats',(SELECT jsonb_agg(jsonb_build_object('id',id,'entry',entry_id,'seat',seat_number,'chips',chip_count,'status',status) ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_id=h.tournament_id AND is_active),
      'eliminations',(SELECT count(*) FROM public.tournament_eliminations WHERE hand_id=h.id),
      'old_seat_hash',(SELECT md5(to_jsonb(s)::text) FROM public.tournament_seats s WHERE id='d5b6eaeb-1616-493c-9da1-6dea18c97d1f'),
      'proof10_hash',(SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY id)::text,'[]')) FROM public.tournament_settlement_outcomes o WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb'),
      'cash_hash',(SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id)::text,'[]')) FROM public.cashier_buyin_movements m WHERE tournament_id=h.tournament_id))
      FROM public.tournament_hands h WHERE h.id='cfe5519b-e762-4ea4-9dca-40d1a8ed253e' AND h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c';`));
  } else if(process.argv.includes('--dealer-wall-clock-post')){
    // Independent read-back of the completed real-clock run, not another soak.
    const club='bca41f8b-acae-4373-9a49-482f668a2c2b';
    const result=execFileSync('wsl',['-d',distro,'--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
      'PGDATABASE=vinpoker_ops_ready_capacity_ci','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{
      encoding:'utf8',timeout:30000,maxBuffer:2e6,input:`BEGIN READ ONLY;
      SELECT jsonb_build_object('database',current_database(),'auto',(SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${club}'),
       'assignments',(SELECT count(*) FROM public.dealer_assignments WHERE club_id='${club}'),
       'released',(SELECT count(*) FROM public.dealer_assignments WHERE club_id='${club}' AND released_at IS NOT NULL),
       'active',(SELECT count(*) FROM public.dealer_assignments WHERE club_id='${club}' AND status='assigned' AND released_at IS NULL),
       'active_attendances',(SELECT count(DISTINCT attendance_id) FROM public.dealer_assignments WHERE club_id='${club}' AND released_at IS NULL),
       'sessions',(SELECT jsonb_agg(s ORDER BY s) FROM(SELECT DISTINCT table_session_id s FROM public.dealer_assignments WHERE club_id='${club}' AND released_at IS NULL)x),
       'metrics',(SELECT count(*) FROM public.cron_metrics WHERE club_id='${club}' AND cron_name='process-swing-on-dealer-ready' AND status='success' AND processed_count=1),
       'rests',(SELECT jsonb_agg(extract(epoch FROM(a.assigned_at-p.released_at)) ORDER BY a.assigned_at)
        FROM public.dealer_assignments a JOIN LATERAL(SELECT max(released_at) released_at FROM public.dealer_assignments old
         WHERE old.club_id=a.club_id AND old.attendance_id=a.attendance_id AND old.released_at<=a.assigned_at)p ON p.released_at IS NOT NULL
        WHERE a.club_id='${club}'),
       'temporary_roles',(SELECT count(*) FROM pg_roles WHERE left(rolname,15)='ready_capacity_'));
      COMMIT;`});
    const state=JSON.parse(result.trim());assert.equal(state.database,'vinpoker_ops_ready_capacity_ci');
    assert.equal(state.auto,false);assert.equal(state.assignments,8);assert.equal(state.released,6);assert.equal(state.active,2);
    assert.equal(state.active_attendances,2);assert.equal(state.metrics,6);assert.equal(state.temporary_roles,0);
    assert.deepEqual(state.sessions,['16f89e81-2629-4e34-811a-7f1d545342e4','ec4fc974-a36c-4af3-8e32-433175bb9ecc']);
    assert.equal(state.rests.length,4);assert.ok(state.rests.every(seconds=>Number(seconds)>=900));
    console.log('DEALER_WALL_CLOCK_INDEPENDENT_READ_AUTO_OFF_METRICS_REST_ROLE_CLEANUP_PASS',JSON.stringify(state));
  } else if(process.argv.includes('--winner-correction-eligibility')){
    const tour='46cab483-91e7-4220-aacf-e17bdf05269c',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
      'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='${tour}'),
      'scopes',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tracker_correction_uat_scopes s WHERE tournament_id='${tour}'),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${tour}'))::text);`);
    const before=fingerprint();
    const cases=[['08730ce1-9a83-4439-96f9-ac005ae3d734','later_hand_scope_not_supported'],
      ['ba840f18-085a-430a-918a-6fca24d8c9ca','later_hand_scope_not_supported'],
      ['f738688d-b606-4af7-b16f-84c66a95a4d3','later_hand_scope_not_supported'],
      ['876a9056-b3bf-414c-a1f6-5e344fc003d3',null]];
    const result=sql(`BEGIN;GRANT USAGE ON SCHEMA auth TO authenticated;
      INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled,expires_at)
      SELECT DISTINCT t.club_id,t.id,h.tournament_table_id,'${actor}'::uuid,'correct_completed_hand',true,now()+interval '5 minutes'
      FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id WHERE t.id='${tour}'
      AND h.id IN(${cases.map(([id])=>`'${id}'::uuid`).join(',')})
      ON CONFLICT(tournament_id,tournament_table_id,user_id,capability) DO UPDATE SET enabled=true,expires_at=excluded.expires_at;
      SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;
      ${cases.map(([id])=>`SELECT jsonb_build_object('hand','${id}','result',public.authorize_tracker_completed_hand_correction_uat_v1('${tour}','${id}'));`).join('\n')}
      ROLLBACK;`).split('\n').map(line=>JSON.parse(line));
    assert.equal(fingerprint(),before,'target eligibility probe changed retained hands/scopes/seats');
    assert.equal(result.length,cases.length);
    for(const [index,[id,error]] of cases.entries()){
      assert.equal(result[index].hand,id);
      if(error){assert.equal(result[index].result.ok,false);assert.equal(result[index].result.error,error);}
      else{assert.equal(result[index].result.ok,true);assert.equal(result[index].result.source_revision,11);}
    }
    console.log('WINNER_CORRECTION102_TOURNAMENT_GLOBAL_LATEST_AUTHORITY_NO_DELTA_PASS',JSON.stringify(result));
  } else if(process.argv.includes('--repair-correction199-rehearsal')||process.argv.includes('--repair-correction199-commit')){
    let repair=readFileSync('tests/trackerSettlement/correctionEntry199.repairExisting.pg17.sql','utf8');
    if(process.argv.includes('--repair-correction199-commit')){
      const marker='-- CORRECTION199_LOCAL_REPAIR_END\nROLLBACK;';assert.equal(repair.split(marker).length,2);
      repair=repair.replace(marker,'-- CORRECTION199_LOCAL_REPAIR_END\nCOMMIT;');
    }
    sql(repair);console.log(process.argv.includes('--repair-correction199-commit')?'CORRECTION199_LOCAL_EXACT_REPAIR_COMMITTED':'CORRECTION199_LOCAL_EXACT_REPAIR_REHEARSED_ROLLED_BACK');
  } else if(process.argv.includes('--qualify-correction199')){
    const signature='public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)';
    const before=sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`);
    const migration=readFileSync('supabase/migrations/20270128000199_tracker_correction_entry_projection_v1.sql','utf8');
    // First prove the DDL/metadata/anchor preconditions without retaining it.
    const dry=migration.replace(/^BEGIN;$/m,'BEGIN;').replace(/COMMIT;\s*$/,'ROLLBACK;');assert.notEqual(dry,migration);
    sql(dry);assert.equal(sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`),before);
    sql(migration);
    try{
      const {runCorrectionEntryProjection}=await import('../trackerSettlement/correctionEntryProjection.native.mjs');
      await runCorrectionEntryProjection({sql});
    }catch(error){sql(before);assert.equal(sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`),before);throw error;}
    assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000199';"),'0');
    console.log('LOCAL_CORRECTION199_QUALIFIED_FUNCTION_ONLY_NO_LEDGER',sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`));
  } else if(process.argv.includes('--correction107-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('collision199',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000199'),
     'meta',(SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'digest',md5(replace(pg_get_functiondef(oid),chr(13),''))) FROM pg_proc WHERE oid='public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure),
     'entryUnique',(SELECT jsonb_agg(indexdef) FROM pg_indexes WHERE schemaname='public' AND tablename='tournament_entries' AND indexdef LIKE '%UNIQUE%'),
     'activeEntryUnique',(SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_tournament_seats_active_entry_v3'));ROLLBACK;`));
  } else if(process.argv.includes('--admin-status127-invalid-labels')){
    const tour='c19ee5c2-68c7-4627-842a-06a3a2348d6f';
    const before=sql(`SELECT md5(to_jsonb(t)::text) FROM public.tournaments t WHERE id='${tour}';`);
    console.log(sql(`BEGIN;SET LOCAL statement_timeout='10s';
      SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
      SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f793a5b3-6025-4766-bc1b-49f16aa1b44a"}';SET LOCAL ROLE authenticated;
      DO $$ DECLARE label text;BEGIN
       FOREACH label IN ARRAY ARRAY['scheduled','finished'] LOOP
        BEGIN UPDATE public.tournaments SET status=label WHERE id='${tour}';RAISE EXCEPTION 'expected_status_check_missing_%',label;
        EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ACTUAL_UI_STATUS_%_REJECTED_BY_CHECK_CONSTRAINT',label;END;
       END LOOP;
      END $$;ROLLBACK;SELECT 'ADMIN127_SCHEDULED_FINISHED_UI_VALUES_ACTUALLY_REJECTED_NOT_FIXED';`));
    assert.equal(sql(`SELECT md5(to_jsonb(t)::text) FROM public.tournaments t WHERE id='${tour}';`),before);
    console.log('ADMIN127_REPRO_FIXTURE_UNCHANGED');
  } else if(process.argv.includes('--admin-status127-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'statusColumns',(SELECT jsonb_agg(jsonb_build_object('column',column_name,'type',udt_name,'default',column_default)) FROM information_schema.columns WHERE table_schema='public' AND table_name='tournaments' AND column_name IN('status','live_status')),
      'checks',(SELECT jsonb_agg(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='public.tournaments'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%status%'),
      'statusWriters',(SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'body',pg_get_functiondef(oid))) FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname ILIKE '%tournament%status%' OR proname IN('ops_close_tournament','ops_start_tournament','close_tournament_v3','ops_update_tournament'))),
      'guards',(SELECT jsonb_agg(jsonb_build_object('trigger',pg_get_triggerdef(t.oid),'function',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid))) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.tournaments'::regclass AND NOT t.tgisinternal AND (p.proname ILIKE '%close%' OR p.proname ILIKE '%status%' OR p.proname ILIKE '%final%' OR p.proname ILIKE '%lifecycle%')));ROLLBACK;`));
  } else if(process.argv.includes('--edit201-post')){
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'writer',md5(pg_get_functiondef('public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)'::regprocedure)),
      'context',md5(pg_get_functiondef('public.get_tournament_edit_context_v1(uuid,uuid)'::regprocedure)),
      'receipt',md5(pg_get_functiondef('public.get_tournament_edit_receipt_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)'::regprocedure)),
      'privateSnapshotAuthenticated',has_function_privilege('authenticated','floor_private.tournament_edit_snapshot_v1(uuid)','EXECUTE'),
      'anonWriter',has_function_privilege('anon','public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)','EXECUTE'),
      'serviceWriter',has_function_privilege('service_role','public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)','EXECUTE'),
      'authenticatedWriter',has_function_privilege('authenticated','public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)','EXECUTE'),
      'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000201'),
      'mainRevision',(SELECT source_revision FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba'),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'faultHelper',to_regprocedure('public.test_edit201_fault()') IS NOT NULL);ROLLBACK;`));
    assert.equal(state.writer,'549b432cc0838f87c7dbed04743e6a94');assert.equal(state.context,'3d9e32235989d9c76674de166a9d72b6');assert.equal(state.receipt,'ad551a23de2d8d7eadca8c26302491b4');
    assert.equal(state.privateSnapshotAuthenticated,false);assert.equal(state.anonWriter,false);assert.equal(state.serviceWriter,false);assert.equal(state.authenticatedWriter,true);
    assert.equal(state.ledger,0);assert.equal(state.mainRevision,18);assert.equal(state.cash,300000);assert.equal(state.faultHelper,false);
    console.log('EDIT201_FRESH_CONNECTION_BODY_ACL_NO_LEDGER_MAIN_PRESERVED_PASS',JSON.stringify(state));
    console.log(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='f793a5b3-6025-4766-bc1b-49f16aa1b44a';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f793a5b3-6025-4766-bc1b-49f16aa1b44a"}';SET LOCAL ROLE authenticated;
      DO $$ DECLARE first jsonb;second jsonb;BEGIN
       PERFORM set_config('TimeZone','UTC',true);first:=public.get_tournament_edit_context_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f',auth.uid());
       PERFORM set_config('TimeZone','Asia/Bangkok',true);second:=public.get_tournament_edit_context_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f',auth.uid());
       IF first IS DISTINCT FROM second OR current_setting('TimeZone')<>'Asia/Bangkok' THEN RAISE EXCEPTION 'edit201_timezone_snapshot_or_session_leak';END IF;
      END $$;ROLLBACK;SELECT 'EDIT201_CONTEXT_TIMEZONE_INDEPENDENT_WITHOUT_CHANGING_CALLER_SETTING';`));
  } else if(process.argv.includes('--void202-qualify-rollback')||process.argv.includes('--void202-qualify-local')){
    // One psql transaction: source DDL and real writers are never retained by this mode.
    const migration=readFileSync('supabase/migrations/20270128000202_tracker_void_audit_snapshot_v1.sql','utf8');
    const runtime=readFileSync('tests/trackerVoice/voidAudit202.existing.pg17.sql','utf8');
    assert.match(migration,/COMMIT;\s*$/);assert.match(runtime,/^BEGIN;/);
    const fingerprint=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_object(
      'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
      'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
      'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
      'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
      'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
      'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
      'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts x),
      'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hand_audit_log x),
      'void',pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),
      'snapshotTable',to_regclass('floor_private.tracker_void_snapshots202') IS NOT NULL,
      'snapshotHelper',to_regprocedure('floor_private.capture_tracker_void_snapshot202(uuid)') IS NOT NULL
    )::text);ROLLBACK;`);
    const before=fingerprint();
    try { console.log(sql(migration.replace(/COMMIT;\s*$/,'')+runtime.replace(/^BEGIN;/,''))); }
    finally { assert.equal(fingerprint(),before,'Void202 rollback must preserve source, audit, financial and catalog state'); }
    console.log('VOID202_RUNTIME_AND_DDL_ROLLBACK_FINGERPRINT_UNCHANGED');
    if(process.argv.includes('--void202-qualify-local')){
      const facts=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_object(
        'hand',(SELECT to_jsonb(x) FROM public.tournament_hands x WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba'),
        'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
        'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
        'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
        'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts x)
      )::text);ROLLBACK;`);
      const preserved=facts();
      console.log(sql(`DO $$ BEGIN IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'void202_local_only';END IF;END $$;`+migration));
      assert.equal(facts(),preserved,'Retaining local audit DDL must not mutate operational facts');
      const retained=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
        'digest',md5(replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),chr(13),'')),
        'snapshots',(SELECT count(*) FROM floor_private.tracker_void_snapshots202),
        'forcedRls',(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='floor_private.tracker_void_snapshots202'::regclass),
        'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000202'),
        'hand30Status',(SELECT status FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba'),
        'hand30Revision',(SELECT source_revision FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba')
      );ROLLBACK;`));
      assert.notEqual(retained.digest,'278caed40725bfe99b97d2cc61887037');assert.equal(retained.snapshots,0);
      assert.equal(retained.forcedRls,true);assert.equal(retained.ledger,0);assert.equal(retained.hand30Status,'voided');assert.equal(retained.hand30Revision,31);
      console.log('VOID202_QUALIFIED_RETAINED_LOCAL_NO_LEDGER_NO_LEGACY_BACKFILL',JSON.stringify(retained));
    }
  } else if(process.argv.includes('--finish137-clean-owned-scope')){
    console.log(sql(`BEGIN;DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM public.tracker_correction_uat_scopes WHERE id='318970fa-cbcc-4719-ae24-111db3f7c912' AND tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND user_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND capability='correct_completed_hand' AND created_at='2026-10-20T14:08:52.77118+07:00' AND enabled)
      OR NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=21 AND status='completed')
      THEN RAISE EXCEPTION 'finish137_exact_failed_test_scope_guard';END IF;
      UPDATE public.tracker_correction_uat_scopes SET enabled=false WHERE id='318970fa-cbcc-4719-ae24-111db3f7c912';
    END $$;COMMIT;SELECT 'FINISH137_EXACT_FAILED_TEST_SCOPE_DISABLED_NO_HISTORY_REWRITE';`));
  } else if(process.argv.includes('--finish137-failed-preview-cleanup')){
    const {runPaidCorrectionEdge}=await import('../trackerSettlement/paidCorrectionEdge.native.mjs');
    const fixture={tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6'};
    const hand='4aa376ee-4a27-4963-9c69-dd0a2cd17abf',role='correction_cleanup137_'+randomUUID().replaceAll('-','');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='${hand}'),'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${hand}'),'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='${hand}'),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}'))::text);`);
    assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE id='${hand}' AND source_revision=21 AND status='completed';`),'1');
    assert.equal(sql(`SELECT count(*) FROM public.tracker_correction_uat_scopes WHERE tournament_id='${fixture.tour}' AND user_id='${fixture.actor}' AND enabled;`),'0');
    const before=fingerprint();sql(`CREATE ROLE ${role} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${role};`);
    try{
      await assert.rejects(runPaidCorrectionEdge({sql,service:`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE ${role};`,fixture,hand}),error=>error.code==='ERR_ASSERTION'&&error.actual===422&&error.expected===200&&error.message.includes('INCOMPLETE'));
      assert.equal(fingerprint(),before);
      assert.equal(sql(`SELECT count(*) FROM public.tracker_correction_uat_scopes WHERE tournament_id='${fixture.tour}' AND user_id='${fixture.actor}' AND enabled;`),'0');
      console.log('FINISH137_REJECTED_PREVIEW_FINALLY_RESTORES_EXACT_SCOPE_NO_HAND_PROOF_CASH_DELTA_PASS');
    }finally{sql(`DROP ROLE ${role};`);}
  } else if(process.argv.includes('--finish137-history-proof')||process.argv.includes('--finish137-corrected-proof')){
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'hand',(SELECT jsonb_build_object('id',id,'status',status,'revision',source_revision,'board',community_cards) FROM public.tournament_hands WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf'),
      'outcomes',(SELECT jsonb_agg(jsonb_build_object('scope',verification_scope,'status',status,'revision',source_revision,'hash',source_chain_hash,'reason',correction_reason,'request',idempotency_key) ORDER BY settlement_revision) FROM public.tournament_settlement_outcomes WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf'),
      'source',(SELECT public.get_tournament_settlement_source_hash('4aa376ee-4a27-4963-9c69-dd0a2cd17abf')),
      'stacks',(SELECT jsonb_agg(jsonb_build_array(s.seat_number,s.chip_count,e.current_stack) ORDER BY s.seat_number) FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id WHERE s.tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND s.is_active),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'scopes',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tracker_correction_uat_scopes s WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND user_id='675fe35e-60a8-4452-bb90-e79486d54da6'),
      'queue',(SELECT jsonb_agg(jsonb_build_object('revision',source_revision,'status',status) ORDER BY source_revision) FROM public.tracker_historical_display_queue WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf'),
      'temporaryRoles',(SELECT jsonb_agg(rolname ORDER BY rolname) FROM pg_roles WHERE rolname LIKE 'correction_browser_%')
    );ROLLBACK;`));
    console.log('FINISH137_SOURCE_PROOF_SCOPE_OBSERVED',JSON.stringify(state));
    assert.equal(state.hand.status,'completed');assert.equal(state.cash,300000);
    if(process.argv.includes('--finish137-corrected-proof')){
      assert.ok(state.hand.revision>21);assert.deepEqual(state.hand.board,['2c','3d','7s','9c','Kc']);
      assert.deepEqual(state.stacks,[[1,58800,58800],[2,1200,1200]]);
      const old=state.outcomes.filter(o=>o.revision===21&&o.scope==='historical_display');assert.equal(old.length,1);assert.equal(old[0].status,'stale');
      const current=state.outcomes.filter(o=>o.revision===state.hand.revision&&o.scope==='chain'&&o.status==='verified');assert.equal(current.length,1);
      assert.equal(current[0].hash,state.source.source_chain_hash);assert.equal(current[0].revision,state.source.source_revision);
      assert.equal(current[0].reason,'TEST browser137 river Kc correction hand32');
      const page=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_public_tournament_table_history_v2('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',20,NULL,NULL);ROLLBACK;`));
      const item=page.items.find(x=>x.handId==='4aa376ee-4a27-4963-9c69-dd0a2cd17abf');assert.equal(item.result.status,'verified');assert.deepEqual(item.board,state.hand.board);
      assert.deepEqual(item.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',400,200]]);
      if(process.argv.includes('--disposed')){
        assert.equal(state.temporaryRoles,null);assert.ok(state.scopes.every(s=>!s.enabled));
        const owned=state.scopes.find(s=>s.id==='318970fa-cbcc-4719-ae24-111db3f7c912');assert.equal(owned.enabled,false);assert.equal(owned.expires_at,null);
      }
      console.log('FINISH137_SOLE_WINNER_CORRECTION_OLD_PROOF_STALE_CURRENT_ANON_WINNER_ENTRY_SEAT_PARITY_PASS');
    }else{
      assert.equal(state.hand.revision,21);assert.equal(state.outcomes.length,1);
      assert.equal(state.outcomes[0].scope,'historical_display');assert.equal(state.outcomes[0].status,'verified');assert.equal(state.outcomes[0].revision,21);
      assert.equal(state.temporaryRoles,null);
    }
  } else if(process.argv.includes('--finish136-worker')||process.argv.includes('--finish137-worker')){
    const corrected=process.argv.includes('--finish137-worker');
    const baseline={tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',entry:'96ae5f01-7e6e-4344-895a-2b5cdbf124cd',player:'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',registration:'b0b7ac28-0d84-4d66-af43-028ed172390f'};
    const result=spawnSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{
      env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,VINPOKER_NATIVE_PAID_TOUR:'1',VINPOKER_HISTORY_FINISH136:corrected?undefined:'1',VINPOKER_HISTORY_FINISH137:corrected?'1':undefined,VINPOKER_HISTORY_PARENT_HAND:'4aa376ee-4a27-4963-9c69-dd0a2cd17abf',VINPOKER_HISTORY_PARENT_BASELINE:corrected?undefined:JSON.stringify(baseline)},
      encoding:'utf8',timeout:45000,maxBuffer:2000000});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0);
  } else if(process.argv.includes('--hand136-state')){
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'hand',(SELECT jsonb_build_object('id',id,'number',hand_number,'revision',source_revision,'status',status,'voided',is_voided,'board',community_cards,'pot',pot_size) FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=32),
      'players',(SELECT jsonb_agg(jsonb_build_object('seat',p.seat_number,'player',p.player_id,'start',p.starting_stack,'end',p.ending_stack,'cards',p.hole_cards,'seatStack',s.chip_count,'entryStack',e.current_stack) ORDER BY p.seat_number) FROM public.hand_players p JOIN public.tournament_hands h ON h.id=p.hand_id JOIN public.tournament_seats s ON s.tournament_table_id=h.tournament_table_id AND s.table_session_id=h.table_session_id AND s.player_id=p.player_id AND s.entry_number=p.entry_number AND s.is_active JOIN public.tournament_entries e ON e.id=s.entry_id WHERE h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND h.hand_number=32),
      'actions',(SELECT count(*) FROM public.hand_actions WHERE hand_id=(SELECT id FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=32)),
      'receipts',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',request_id,'operation',operation_type,'result',result)),'[]'::jsonb) FROM public.table_operation_receipts WHERE operation_type='record_tracker_manual_hand_v1' AND result->>'hand_id'=(SELECT id::text FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=32)),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c')
    );ROLLBACK;`));
    console.log('HAND136_FRESH_CONNECTION_STATE',JSON.stringify(state));
    assert.equal(state.cash,300000);assert.equal(state.hand.voided,false);assert.equal(state.actions,10);
    assert.deepEqual(state.hand.board,['2c','3d','7s','9c','Jd']);assert.equal(state.players.length,2);
    assert.deepEqual(state.players.map(p=>p.cards),[['Ks','Kh'],['As','Ah']]);
    if(process.argv.includes('--committed')){
      assert.equal(state.hand.status,'completed');assert.equal(state.hand.pot,400);assert.equal(state.receipts.length,1);
      assert.deepEqual(state.players.map(p=>p.end),[58400,1600]);
      for(const player of state.players){assert.equal(player.end,player.seatStack);assert.equal(player.end,player.entryStack);}
      console.log('HAND136_CANONICAL_FINISH_SINGLE_RECEIPT_ENTRY_SEAT_PARITY_CONSERVATION_PASS');
    }else{
      assert.equal(state.hand.status,'in_progress');assert.equal(state.receipts.length,0);
      assert.deepEqual(state.players.map(p=>p.start),[58600,1400]);
    }
  } else if(process.argv.includes('--void135-before')||process.argv.includes('--void135-post')){
    const result=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'hand',(SELECT jsonb_build_object('id',id,'status',status,'voided',is_voided,'revision',source_revision) FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=31),
      'sourceDigest',(SELECT md5(jsonb_build_object('hand',to_jsonb(h),'players',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seat_number,p.player_id,p.entry_number,p.id) FROM public.hand_players p WHERE p.hand_id=h.id),'[]'::jsonb),'actions',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.action_order,a.id) FROM public.hand_actions a WHERE a.hand_id=h.id),'[]'::jsonb))::text) FROM public.tournament_hands h WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=31),
      'actions',(SELECT count(*) FROM public.hand_actions WHERE hand_id=(SELECT id FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=31)),
      'archive',(SELECT jsonb_build_object('digest',s.snapshot_digest,'digestValid',s.snapshot_digest=md5(jsonb_build_object('hand',s.hand_snapshot,'players',s.players_snapshot,'actions',s.actions_snapshot)::text),'status',s.hand_snapshot->>'status','revision',s.source_revision,'actionCount',jsonb_array_length(s.actions_snapshot),'actor',s.actor_id) FROM floor_private.tracker_void_snapshots202 s JOIN public.tournament_hands h ON h.id=s.hand_id WHERE h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND h.hand_number=31),
      'seats',(SELECT jsonb_agg(jsonb_build_object('entry',entry_id,'stack',chip_count) ORDER BY entry_id) FROM public.tournament_seats WHERE tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND is_active),
      'entries',(SELECT jsonb_agg(jsonb_build_object('entry',id,'stack',current_stack) ORDER BY id) FROM public.tournament_entries WHERE id IN('96ae5f01-7e6e-4344-895a-2b5cdbf124cd','9384eec9-8014-4d38-a1b0-03a35d264aa9')),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'snapshotCount',(SELECT count(*) FROM floor_private.tracker_void_snapshots202)
    );ROLLBACK;`));
    console.log('VOID135_FRESH_OBSERVED',JSON.stringify(result));assert.equal(result.cash,300000);
    if(process.argv.includes('--void135-before')){
      assert.equal(result.hand.status,'in_progress');assert.equal(result.hand.voided,false);assert.equal(result.actions,2);assert.equal(result.archive,null);assert.equal(result.snapshotCount,0);
    }else{
      const expectedDigest=process.argv.find(x=>x.startsWith('--expected-void135-digest='))?.split('=')[1];
      assert.match(expectedDigest??'',/^[a-f0-9]{32}$/);assert.equal(result.hand.status,'voided');assert.equal(result.hand.voided,true);
      assert.equal(result.actions,0);assert.equal(result.snapshotCount,1);assert.equal(result.archive.digestValid,true);assert.equal(result.archive.digest,expectedDigest);
      assert.equal(result.archive.status,'in_progress');assert.equal(result.archive.actionCount,2);assert.equal(result.archive.actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
      const expected=[{entry:'9384eec9-8014-4d38-a1b0-03a35d264aa9',stack:1400},{entry:'96ae5f01-7e6e-4344-895a-2b5cdbf124cd',stack:58600}];
      assert.deepEqual(result.seats,expected);assert.deepEqual(result.entries,expected);
      console.log('VOID135_ACTUAL_BROWSER_VOID_SOURCE_ARCHIVED_EXACT_PREIMAGE_STACKS_PARITY_PASS');
    }
  } else if(process.argv.includes('--void134-forward-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'ledger202',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000202'),
      'tableExists',to_regclass('floor_private.tracker_void_snapshots202') IS NOT NULL,
      'helperExists',to_regprocedure('floor_private.capture_tracker_void_snapshot202(uuid)') IS NOT NULL,
      'voidDigest',md5(replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),chr(13),'')),
      'trustedOwnerBypassesRls',(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='postgres'));ROLLBACK;`));
  } else if(process.argv.includes('--hand134-void-audit-rows')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'handAudit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY created_at,id) FROM public.tournament_hand_audit_log a WHERE hand_id='f420f331-d986-4278-acba-dcdb7303a5ba'),
      'genericAudit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY created_at,id) FROM public.audit_logs a WHERE entity_id::text='f420f331-d986-4278-acba-dcdb7303a5ba'),
      'currentHand',(SELECT jsonb_build_object('status',status,'voided',is_voided,'revision',source_revision) FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba'));ROLLBACK;`));
  } else if(process.argv.includes('--hand134-void-audit-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'actionTriggers',(SELECT jsonb_agg(jsonb_build_object('trigger',pg_get_triggerdef(t.oid),'function',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid))) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.hand_actions'::regclass AND NOT t.tgisinternal),
      'auditRelations',(SELECT jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,'columns',columns)) FROM(SELECT table_schema,table_name,jsonb_agg(column_name ORDER BY ordinal_position) AS columns FROM information_schema.columns WHERE table_schema IN('public','floor_private') AND (table_name ILIKE '%audit%' OR table_name ILIKE '%snapshot%' OR table_name ILIKE '%history%') GROUP BY table_schema,table_name) a),
      'voidDigest',md5(replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),chr(13),'')));ROLLBACK;`));
  } else if(process.argv.includes('--hand134-void-post')){
    const result=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'hand',(SELECT jsonb_build_object('id',id,'number',hand_number,'voided',is_voided,'revision',source_revision,'status',status) FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba'),
      'actions',(SELECT count(*) FROM public.hand_actions WHERE hand_id='f420f331-d986-4278-acba-dcdb7303a5ba'),
      'seats',(SELECT jsonb_agg(jsonb_build_object('entry',entry_id,'stack',chip_count) ORDER BY entry_id) FROM public.tournament_seats WHERE tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND is_active),
      'entries',(SELECT jsonb_agg(jsonb_build_object('entry',id,'stack',current_stack) ORDER BY id) FROM public.tournament_entries WHERE id IN('96ae5f01-7e6e-4344-895a-2b5cdbf124cd','9384eec9-8014-4d38-a1b0-03a35d264aa9')),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'lostFinishReceipts',(SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND operation_type='record_tracker_manual_hand_v1' AND request_id='b6034a3e-20e6-47de-822a-5d3b8191bb27'));ROLLBACK;`));
    console.log('HAND134_POST_OBSERVED_NOT_ACCEPTANCE',JSON.stringify(result));
    assert.equal(result.hand.voided,true);assert.equal(result.hand.number,30);assert.ok(result.hand.revision>18);assert.equal(result.actions,10);
    const expected=[{entry:'9384eec9-8014-4d38-a1b0-03a35d264aa9',stack:1400},{entry:'96ae5f01-7e6e-4344-895a-2b5cdbf124cd',stack:58600}];
    assert.deepEqual(result.seats,expected);assert.deepEqual(result.entries,expected);assert.equal(result.cash,300000);assert.equal(result.lostFinishReceipts,0);
    console.log('HAND134_BROWSER_CANONICAL_VOID_COMMITTED_HISTORY_RETAINED_ENTRY_SEAT_PARITY_NO_FAKE_FINISH_RECEIPT_PASS',JSON.stringify(result));
  } else if(process.argv.includes('--hand134-void-rehearsal')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h),'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e),'cash',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r))::text);`);
    const before=fingerprint();console.log(sql(readFileSync('tests/trackerVoice/hand134VoidRecovery.existing.pg17.sql','utf8')));
    assert.equal(fingerprint(),before);console.log('HAND134_REHEARSAL_GLOBAL_HAND_SEAT_ENTRY_CASH_RECEIPT_FINGERPRINT_UNCHANGED');
  } else if(process.argv.includes('--edit132-post')||process.argv.includes('--edit133-post')){
    const wireStage=process.argv.includes('--edit133-post');
    const tour='8c028928-da11-4002-b0c3-87356ea9adb8';
    const result=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'config',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${tour}'),
      'levels',(SELECT jsonb_agg(jsonb_build_object('id',id,'small',small_blind,'big',big_blind) ORDER BY level_number) FROM public.tournament_levels WHERE tournament_id='${tour}'),
      'editKeys',(SELECT jsonb_agg(request_id ORDER BY request_id) FROM public.table_operation_receipts WHERE actor_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND operation_type='edit_tournament_with_levels_v1' AND result->>'tournament_id'='${tour}'),
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}'),
      'registrations',(SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='${tour}'),
      'cash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${tour}'),
      'mainRevision',(SELECT source_revision FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba'),
      'mainCash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'));ROLLBACK;`));
    assert.equal(result.config.name,'Tour edit132 browser local TEST');assert.equal(result.config.description,wireStage?'TEST browser133 body loss after headers — giữ giá và blind':'TEST browser132 recovery — một commit, giữ giá và blind');
    for(const [field,value] of Object.entries({buy_in:100000,rake_amount:10000,service_fee_amount:5000,starting_stack:20000,minutes_per_level:20,late_reg_close_level:6}))assert.equal(result.config[field],value,field);
    assert.deepEqual(result.levels,[{id:'17cc4a0d-dae4-4912-8690-edae2692c0c1',small:100,big:200},{id:'b2d51a3f-26d0-477d-b2d3-6692f2470a02',small:200,big:400}]);
    assert.deepEqual(result.editKeys,(wireStage?['3491577f-b9d2-4790-8725-dd734b9a9cc2','ec935e4a-0148-4e44-9c18-4de744ca6168','e7aacab4-4ca6-4da4-ae6b-7e685221cb4d','948ac455-8a1f-4b56-8ff2-7f07327984da']:['3491577f-b9d2-4790-8725-dd734b9a9cc2','ec935e4a-0148-4e44-9c18-4de744ca6168']).sort());
    assert.equal(result.entries,0);assert.equal(result.registrations,0);assert.equal(result.cash,0);assert.equal(result.mainRevision,18);assert.equal(result.mainCash,300000);
    console.log(wireStage?'EDIT133_BOTH_TRANSPORT_LOSS_STAGES_FOUR_UNIQUE_INTENT_RECEIPTS_NO_DUPLICATE_COMMIT_PRICES_LEVEL_IDS_MAIN_PRESERVED_PASS':'EDIT132_BROWSER_REAL_DB_RELOAD_AND_RECEIPT_RECOVERY_TWO_UNIQUE_KEYS_PRICES_LEVEL_IDS_MAIN_PRESERVED_PASS');
  } else if(process.argv.includes('--edit132-prepare')){
    const actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',name='Tour edit132 browser local TEST',key=randomUUID();
    assert.equal(sql(`SELECT count(*) FROM public.clubs WHERE id='${club}' AND owner_id='${actor}';`),'1');
    assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE name='${name}';`),'0','retain one canonical canary; never rerun after success');
    const financial=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r))::text);`);
    const before=financial(),config={name,start_time:'2026-12-20T12:00:00+07:00',buy_in:100000,rake_amount:10000,service_fee_amount:5000,starting_stack:20000,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6};
    const levels=[{level_number:1,small_blind:100,big_blind:200,ante:0,duration_minutes:20,is_break:false},{level_number:2,small_blind:200,big_blind:400,ante:0,duration_minutes:20,is_break:false}];
    const result=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;SELECT public.create_tournament_with_levels_v1('${club}','${JSON.stringify(config)}'::jsonb,'${JSON.stringify(levels)}'::jsonb,'${key}','${actor}');COMMIT;`));
    assert.equal(result.ok,true);assert.equal(financial(),before);
    console.log('EDIT132_CANONICAL_BROWSER_CANARY_CREATED_NO_CASH_OR_REGISTRATION_DELTA',JSON.stringify({tour:result.tournament_id,club,actor,createRequestId:key}));
  } else if(process.argv.includes('--edit129-commit-overlap')){
    assert.equal(sql(`SELECT md5(pg_get_functiondef('public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)'::regprocedure));`),'549b432cc0838f87c7dbed04743e6a94');
    const tour='c19ee5c2-68c7-4627-842a-06a3a2348d6f',club='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',actor='f793a5b3-6025-4766-bc1b-49f16aa1b44a',key=randomUUID();
    const receiptCount=()=>Number(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='edit_tournament_with_levels_v1' AND result->>'tournament_id'='${tour}';`));
    assert.equal(receiptCount(),0,'one retained COMMIT proof only; do not rerun after success');
    const claims=`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
    const context=JSON.parse(sql(`${claims}SELECT public.get_tournament_edit_context_v1('${tour}','${actor}');ROLLBACK;`));assert.equal(context.ok,true);
    const unchanged=()=>sql(`SELECT md5(jsonb_build_object(
      'tours',(SELECT jsonb_agg(CASE WHEN id='${tour}' THEN to_jsonb(t)-'updated_at' ELSE to_jsonb(t) END ORDER BY id) FROM public.tournaments t),
      'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l),
      'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
      'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r))::text);`);
    const before=unchanged(),state=JSON.stringify(context.state).replaceAll("'","''"),config=JSON.stringify(context.state.config).replaceAll("'","''");
    const args=`'${tour}','${club}','${state}'::jsonb,'${config}'::jsonb,NULL,'${key}','${actor}'`;
    const a=session('edit129_commit_a'),b=session('edit129_commit_b');
    try{
      a.child.stdin.write(`${claims}SELECT public.edit_tournament_with_levels_v1(${args});SELECT 'EDIT129_A_READY';\n`);
      await until(()=>a.output().includes('EDIT129_A_READY'));
      b.child.stdin.write(`${claims}SELECT 'EDIT129_B_STARTED';SELECT public.edit_tournament_with_levels_v1(${args});SELECT 'EDIT129_B_DONE';\n`);
      await until(()=>b.output().includes('EDIT129_B_STARTED'));
      await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='edit129_commit_b' AND a.application_name='edit129_commit_a' AND b.wait_event='advisory');")==='t');
      assert.equal(b.output().includes('EDIT129_B_DONE'),false);
      a.child.stdin.end('COMMIT;\n');await a.closed;await until(()=>b.output().includes('EDIT129_B_DONE'));
      b.child.stdin.end('COMMIT;\n');await b.closed;
      const parseResult=output=>output.split(/\r?\n/).filter(line=>line.trim().startsWith('{')).map(line=>JSON.parse(line.trim())).find(value=>value.request_id===key);
      const first=parseResult(a.output()),second=parseResult(b.output());assert.equal(first?.ok,true);assert.deepEqual(second,first);
      const fresh=JSON.parse(sql(`${claims}SELECT public.get_tournament_edit_receipt_v1(${args});COMMIT;`));assert.deepEqual(fresh,first);
      assert.equal(receiptCount(),1);assert.equal(unchanged(),before);
      console.log('EDIT129_REAL_TWO_COMMIT_SAME_KEY_REPLAY_FRESH_CONNECTION_RECEIPT_PASS',JSON.stringify({tour,club,actor,requestId:key,levels:first.state.levels.length,configUnchanged:true,expectedDelta:'target updated_at and one durable receipt; existing audit/projection triggers retained'}));
    }finally{
      if(!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');if(!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([a.closed,b.closed]);
    }
  } else if(process.argv.includes('--qualify-blind203')||process.argv.includes('--qualify-blind204')){
    const legacy204=process.argv.includes('--qualify-blind204');
    const migration=readFileSync(legacy204?'supabase/migrations/20270128000204_tournament_blind_legacy_lock_order_v1.sql':'supabase/migrations/20270128000203_tournament_blind_parent_lock_v1.sql','utf8');
    const runtime=readFileSync(legacy204?'tests/floorTableControlV3/blindLegacy204.existing.pg17.sql':'tests/floorTableControlV3/blindParent203.existing.pg17.sql','utf8');
    assert.match(migration,/COMMIT;\s*$/);assert.match(runtime,/^BEGIN;/);
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('legacy',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(oid),'acl',proacl) ORDER BY oid) FROM pg_proc WHERE oid IN('public.update_blind_structure(uuid,jsonb)'::regprocedure,'public.import_blind_structure(uuid,text)'::regprocedure,'public.update_tournament_blinds(uuid,jsonb)'::regprocedure)),'helper',to_regprocedure('public._lock_tournament_blind_parent_v1(uuid)') IS NOT NULL,'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l),'tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='c19ee5c2-68c7-4627-842a-06a3a2348d6f'),'users',(SELECT jsonb_agg(id ORDER BY id) FROM auth.users),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text);`);
    const before=fingerprint();
    try{console.log(sql(migration.replace(/COMMIT;\s*$/,'')+runtime.replace(/^BEGIN;/,'')));}
    finally{assert.equal(fingerprint(),before,'203 rehearsal must restore catalog, test identities, levels, tournament and cash');}
    console.log(legacy204?'BLIND204_DDL_RUNTIME_REHEARSAL_ROLLBACK_FINGERPRINT_UNCHANGED':'BLIND203_DDL_RUNTIME_REHEARSAL_ROLLBACK_FINGERPRINT_UNCHANGED');
    sql(migration);
    const post=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('legacy',md5(replace(pg_get_functiondef('public.update_blind_structure(uuid,jsonb)'::regprocedure),chr(13),'')),'import',md5(replace(pg_get_functiondef('public.import_blind_structure(uuid,text)'::regprocedure),chr(13),'')),'upsert',md5(replace(pg_get_functiondef('public.update_tournament_blinds(uuid,jsonb)'::regprocedure),chr(13),'')),'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${legacy204?'20270128000204':'20270128000203'}'),'helperOwner',(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public._lock_tournament_blind_parent_v1(uuid)'::regprocedure),'helperConfig',(SELECT proconfig FROM pg_proc WHERE oid='public._lock_tournament_blind_parent_v1(uuid)'::regprocedure));ROLLBACK;`));
    assert.notEqual(post.legacy,'aec73001b2b0055bc0e5aba94afb48f8');assert.equal(post.ledger,0);assert.equal(post.helperOwner,'postgres');assert.deepEqual(post.helperConfig,['search_path=""']);
    if(legacy204){assert.notEqual(post.import,'7795c101cf451f6170192d88e502242d');assert.notEqual(post.upsert,'9b6e78a222eee79dfe3f7ae7daf6a128');}
    console.log(legacy204?'BLIND204_QUALIFIED_LOCAL_NO_LEDGER':'BLIND203_QUALIFIED_LOCAL_NO_LEDGER',JSON.stringify(post));
  } else if(process.argv.includes('--edit140-clock-state')){
    console.log(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';SET LOCAL ROLE authenticated;
      SELECT jsonb_build_object('fixture','paid_main','clock',public.get_tournament_clock('46cab483-91e7-4220-aacf-e17bdf05269c'));
      SET LOCAL request.jwt.claim.sub='f793a5b3-6025-4766-bc1b-49f16aa1b44a';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f793a5b3-6025-4766-bc1b-49f16aa1b44a"}';
      SELECT jsonb_build_object('fixture','empty_edit_canary','clock',public.get_tournament_clock('c19ee5c2-68c7-4627-842a-06a3a2348d6f'));ROLLBACK;`));
  } else if(process.argv.includes('--edit140-paid-facts')||process.argv.includes('--edit140-paused-clock')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='46cab483-91e7-4220-aacf-e17bdf05269c'),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text);`);
    const before=fingerprint();try{console.log(sql(readFileSync(process.argv.includes('--edit140-paused-clock')?'tests/floorTableControlV3/tournamentEditClock140.existing.pg17.sql':'tests/floorTableControlV3/tournamentEditPaid140.existing.pg17.sql','utf8')));}finally{assert.equal(fingerprint(),before);}
  } else if(process.argv.includes('--blind140-revocation')){
    const {runBlindAuthorityRevocation140}=await import('../floorTableControlV3/tournamentEditLegacy138.native.mjs');
    await runBlindAuthorityRevocation140({sql,session,until});
  } else if(process.argv.includes('--edit140-committed-cas')){
    const {runTournamentBlindCommitCAS140}=await import('../floorTableControlV3/tournamentEditLegacy138.native.mjs');
    await runTournamentBlindCommitCAS140({sql,session,until});
  } else if(['--edit138-legacy-overlap','--edit138-legacy-first','--edit139-import-overlap','--edit139-upsert-overlap','--edit139-import-first','--edit139-upsert-first'].some(flag=>process.argv.includes(flag))){
    const {runTournamentEditLegacy138}=await import('../floorTableControlV3/tournamentEditLegacy138.native.mjs');
    await runTournamentEditLegacy138({sql,session,until,legacyFirst:process.argv.some(flag=>['--edit138-legacy-first','--edit139-import-first','--edit139-upsert-first'].includes(flag)),writer:process.argv.some(flag=>flag.startsWith('--edit139-import-'))?'import':process.argv.some(flag=>flag.startsWith('--edit139-upsert-'))?'upsert':'replace'});
  } else if(process.argv.includes('--blind139-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('ledger204',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000204'),
      'helper',md5(replace(pg_get_functiondef('public._lock_tournament_blind_parent_v1(uuid)'::regprocedure),chr(13),'')),
      'writers',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig)) FROM pg_proc p WHERE p.oid IN('public.import_blind_structure(uuid,text)'::regprocedure,'public.update_tournament_blinds(uuid,jsonb)'::regprocedure))
    );ROLLBACK;`));
  } else if(process.argv.includes('--blind138-writer-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'writers',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'definer',p.prosecdef,'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE')) ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(public[.])?tournament_levels'),
      'importBodies',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid))) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='import_blind_structure')
    );ROLLBACK;`));
  } else if(process.argv.includes('--edit138-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'legacyDefinition',pg_get_functiondef('public.update_blind_structure(uuid,jsonb)'::regprocedure),
      'legacyAcl',(SELECT proacl FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure),
      'legacyDigest',md5(replace(pg_get_functiondef('public.update_blind_structure(uuid,jsonb)'::regprocedure),chr(13),'')),
      'policyDigest',(SELECT md5(string_agg(polcmd::text||':'||coalesce(pg_get_expr(polqual,polrelid),'')||':'||coalesce(pg_get_expr(polwithcheck,polrelid),''),'|' ORDER BY polname)) FROM pg_policy WHERE polrelid='public.tournament_levels'::regclass AND polcmd<>'r'),
      'ledger203',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000203'),
      'lockHelperExists',to_regprocedure('public._lock_tournament_blind_parent_v1(uuid)') IS NOT NULL,
      'policies',(SELECT jsonb_agg(jsonb_build_object('table',tablename,'command',cmd,'using',qual,'check',with_check)) FROM pg_policies WHERE schemaname='public' AND tablename IN('tournaments','tournament_levels')),
      'dealerAuthority',pg_get_functiondef('public.is_club_dealer_control(uuid,uuid)'::regprocedure),
      'editDigest',md5(replace(pg_get_functiondef('public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)'::regprocedure),chr(13),'')),
      'rawLevelUpdate',has_table_privilege('authenticated','public.tournament_levels','UPDATE'),
      'fixture',(SELECT jsonb_build_object('name',name,'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id=t.id),'cash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id=t.id),'levels',(SELECT count(*) FROM public.tournament_levels WHERE tournament_id=t.id)) FROM public.tournaments t WHERE id='c19ee5c2-68c7-4627-842a-06a3a2348d6f')
    );ROLLBACK;`));
  } else if(process.argv.includes('--edit201-overlap')){
    assert.equal(sql(`SELECT md5(pg_get_functiondef('public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)'::regprocedure));`),'549b432cc0838f87c7dbed04743e6a94');
    const tour='c19ee5c2-68c7-4627-842a-06a3a2348d6f',club='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',actor='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
    const claims=`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
    const context=JSON.parse(sql(`${claims}SELECT public.get_tournament_edit_context_v1('${tour}','${actor}');ROLLBACK;`));
    assert.equal(context.ok,true);const state=context.state;
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${tour}'),'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l WHERE tournament_id='${tour}'),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r))::text);`);
    const before=fingerprint(),a=session('edit201_overlap_a'),b=session('edit201_overlap_b');
    try{
      const payload=JSON.stringify(state).replaceAll("'","''"),config=JSON.stringify(state.config).replaceAll("'","''");
      const write=(key)=>`SELECT public.edit_tournament_with_levels_v1('${tour}','${club}','${payload}'::jsonb,'${config}'::jsonb,NULL,'${key}','${actor}');`;
      a.child.stdin.write(`${claims}${write(randomUUID())}SELECT 'EDIT201_A_HOLDS_WRITER';\n`);
      await until(()=>a.output().includes('EDIT201_A_HOLDS_WRITER'));
      b.child.stdin.write(`${claims}SELECT 'EDIT201_B_STARTED';${write(randomUUID())}SELECT 'EDIT201_B_DONE';\n`);
      await until(()=>b.output().includes('EDIT201_B_STARTED'));
      await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='edit201_overlap_b' AND a.application_name='edit201_overlap_a');")==='t');
      assert.equal(b.output().includes('EDIT201_B_DONE'),false);
      a.child.stdin.end('ROLLBACK;\n');await a.closed;
      await until(()=>b.output().includes('EDIT201_B_DONE'));
      assert.match(b.output(),/"ok": true/);assert.doesNotMatch(b.output(),/"ok": false/);
      b.child.stdin.end('ROLLBACK;\n');await b.closed;assert.equal(fingerprint(),before);
      console.log('EDIT201_TWO_ATOMIC_WRITERS_REAL_BLOCKER_ROLLBACK_RESUME_SUCCESS_NO_RETAINED_DELTA');
    }finally{
      if(!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');if(!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([a.closed,b.closed]);
    }
  } else if(process.argv.includes('--edit201-negatives')){
    assert.equal(sql(`SELECT md5(pg_get_functiondef('public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)'::regprocedure));`),'549b432cc0838f87c7dbed04743e6a94');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tours',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r))::text);`);
    const before=fingerprint();console.log(sql(readFileSync('tests/floorTableControlV3/tournamentEdit201Negatives.existing.pg17.sql','utf8')));
    assert.equal(fingerprint(),before);console.log('EDIT201_NEGATIVES_GLOBAL_FACTS_UNCHANGED');
  } else if(process.argv.includes('--edit201-fault')){
    assert.equal(sql(`SELECT md5(pg_get_functiondef('public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)'::regprocedure));`),'549b432cc0838f87c7dbed04743e6a94');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tours',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.tournament_economic_audit_log a))::text);`);
    const before=fingerprint();console.log(sql(readFileSync('tests/floorTableControlV3/tournamentEdit201Fault.existing.pg17.sql','utf8')));
    assert.equal(fingerprint(),before);assert.equal(sql("SELECT to_regprocedure('public.test_edit201_fault()') IS NULL;"),'t');
    console.log('EDIT201_FAULT_GLOBAL_TOUR_LEVEL_RECEIPT_FINANCIAL_AND_ECONOMIC_AUDIT_FINGERPRINT_UNCHANGED');
  } else if(process.argv.includes('--qualify-edit201')){
    const source=readFileSync('supabase/migrations/20270128000201_tournament_edit_atomic_v1.sql','utf8');
    assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000201';"),'0');
    const catalog=()=>sql(`SELECT md5(coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'signature',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid),'acl',p.proacl::text) ORDER BY n.nspname,p.oid::regprocedure::text),'[]'::jsonb)::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN('tournament_edit_snapshot_v1','get_tournament_edit_context_v1','edit_tournament_with_levels_v1','get_tournament_edit_receipt_v1');`);
    const facts=()=>sql(`SELECT md5(jsonb_build_object('tours',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r))::text);`);
    const before=catalog(),business=facts();const dry=source.replace(/COMMIT;\s*$/,'ROLLBACK;');assert.notEqual(source,dry);
    sql(dry);assert.equal(catalog(),before);assert.equal(facts(),business);
    sql(source);
    try{
      console.log(sql(readFileSync('tests/floorTableControlV3/tournamentEdit201.existing.pg17.sql','utf8')));
      assert.equal(facts(),business);
      console.log(sql(`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'digest',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text) ORDER BY p.proname) FROM pg_proc p WHERE p.proname IN('tournament_edit_snapshot_v1','get_tournament_edit_context_v1','edit_tournament_with_levels_v1','get_tournament_edit_receipt_v1');`));
    }catch(error){
      sql(`BEGIN;DROP FUNCTION public.get_tournament_edit_context_v1(uuid,uuid);DROP FUNCTION public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid);DROP FUNCTION public.get_tournament_edit_receipt_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid);DROP FUNCTION floor_private.tournament_edit_snapshot_v1(uuid);COMMIT;`);
      assert.equal(catalog(),before);assert.equal(facts(),business);throw error;
    }
    console.log('EDIT201_LOCAL_DDL_REHEARSAL_RUNTIME_QUALIFIED_NO_BUSINESS_DELTA_NO_LEDGER');
  } else if(process.argv.includes('--tour-level121-fence-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'dirtyWriter',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid),'digest',md5(pg_get_functiondef(p.oid)))) FROM pg_proc p WHERE p.pronamespace='spectator_projection_v2'::regnamespace AND p.proname='mark_dirty'),
      'projectionParentFks',(SELECT jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'constraint',pg_get_constraintdef(c.oid))) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid WHERE c.contype='f' AND c.confrelid='public.tournaments'::regclass AND r.relnamespace='spectator_projection_v2'::regnamespace));ROLLBACK;`));
  } else if(process.argv.includes('--tour-level121-fenced')){
    const tour='c19ee5c2-68c7-4627-842a-06a3a2348d6f',actor='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
    assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE id='${tour}' AND name='Tour edit121 partial local TEST config committed' AND club_id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2';`),'1');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${tour}'),'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l WHERE tournament_id='${tour}'))::text);`);
    const before=fingerprint();
    const claims=`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
    const a=session('tour_level121_a'),b=session('tour_level121_b');
    try{
      a.child.stdin.write(`${claims}SELECT id FROM public.tournaments WHERE id='${tour}' FOR UPDATE;SELECT 'LEVEL121_PARENT_HELD';\n`);
      await until(()=>a.output().includes('LEVEL121_PARENT_HELD'));
      b.child.stdin.write(`${claims}SELECT 'LEVEL121_UPDATE_STARTED';UPDATE public.tournament_levels SET small_blind=small_blind+1 WHERE tournament_id='${tour}' AND level_number=1;SELECT 'LEVEL121_UPDATE_DONE';\n`);
      await until(()=>b.output().includes('LEVEL121_UPDATE_STARTED'));
      await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='tour_level121_b' AND a.application_name='tour_level121_a');")==='t');
      assert.equal(b.output().includes('LEVEL121_UPDATE_DONE'),false);
      a.child.stdin.end('ROLLBACK;\n');await a.closed;
      await until(()=>b.output().includes('LEVEL121_UPDATE_DONE'));
      b.child.stdin.end('ROLLBACK;\n');await b.closed;assert.equal(fingerprint(),before);
      console.log('TOUR_LEVEL121_TRUE_PARENT_BLOCKER_CHILD_WRITE_WAITS_THEN_RESUMES_ROLLBACK_NO_DELTA');
    }finally{
      if(!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');if(!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([a.closed,b.closed]);
    }
  } else if(process.argv.includes('--tour-edit121-partial')){
    const club='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',actor='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
    const name='Tour edit121 partial local TEST',key=randomUUID();
    assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE name LIKE 'Tour edit121 partial local TEST%';`),'0','one retained reproduction; never repeat after success');
    assert.equal(sql(`SELECT count(*) FROM public.clubs WHERE id='${club}' AND owner_id='${actor}' AND name='Cash identity local TEST';`),'1');
    const financial=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r))::text);`);
    const financialBefore=financial();
    const claims=`SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
    const config={name,start_time:'2026-12-20T12:00:00+07:00',buy_in:100000,rake_amount:0,service_fee_amount:0,starting_stack:20000,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6};
    const levels=[{level_number:1,small_blind:100,big_blind:200,ante:0,duration_minutes:20,is_break:false},{level_number:2,small_blind:200,big_blind:400,ante:0,duration_minutes:20,is_break:false}];
    const created=JSON.parse(sql(`BEGIN;${claims}SELECT public.create_tournament_with_levels_v1('${club}','${JSON.stringify(config)}'::jsonb,'${JSON.stringify(levels)}'::jsonb,'${key}','${actor}');COMMIT;`));
    assert.equal(created.ok,true,JSON.stringify(created));const tour=created.tournament_id;assert.match(tour,/^[a-f0-9-]{36}$/);
    console.log('TOUR_EDIT121_RETAINED_REPRO_MANIFEST',JSON.stringify({tour,club,actor,createRequestId:key}));
    const levelFingerprint=()=>sql(`SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY level_number)::text) FROM public.tournament_levels l WHERE tournament_id='${tour}';`);
    const oldLevels=levelFingerprint();
    // Match the current UI's first separately committed PostgREST UPDATE.
    sql(`BEGIN;${claims}UPDATE public.tournaments SET name='${name} config committed' WHERE id='${tour}';COMMIT;`);
    assert.equal(sql(`SELECT name FROM public.tournaments WHERE id='${tour}';`),`${name} config committed`);
    // A real failure during the second writer must roll back that writer's
    // DELETE/INSERT, but it cannot roll back the prior committed parent update.
    const fault=sql(`BEGIN;SET LOCAL statement_timeout='10s';
      CREATE FUNCTION public.test_tour_edit121_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.tournament_id='${tour}'::uuid THEN RAISE EXCEPTION 'TEST_TOUR_EDIT121_LEVEL_FAILURE';END IF;RETURN NEW;END $$;
      CREATE TRIGGER test_tour_edit121_fault BEFORE INSERT ON public.tournament_levels FOR EACH ROW EXECUTE FUNCTION public.test_tour_edit121_fault();
      ${claims}DO $$ BEGIN BEGIN
        PERFORM public.update_blind_structure('${tour}','${JSON.stringify(levels)}'::jsonb);
        RAISE EXCEPTION 'tour_edit121_expected_failure_missing';
        EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TEST_TOUR_EDIT121_LEVEL_FAILURE' THEN RAISE;END IF;END;
      END $$;RESET ROLE;ROLLBACK;SELECT 'TOUR_EDIT121_ACTUAL_SECOND_WRITER_INSERT_FAILURE_DELETE_ROLLED_BACK';`);
    console.log(fault);
    assert.equal(levelFingerprint(),oldLevels);assert.equal(financial(),financialBefore);
    const post=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('id',t.id,'name',t.name,'levels',(SELECT count(*) FROM public.tournament_levels WHERE tournament_id=t.id),
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id=t.id),'cash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id=t.id),
      'faultHelper',to_regprocedure('public.test_tour_edit121_fault()') IS NOT NULL) FROM public.tournaments t WHERE id='${tour}';ROLLBACK;`));
    assert.equal(post.name,`${name} config committed`);assert.equal(post.levels,2);assert.equal(post.entries,0);assert.equal(post.cash,0);assert.equal(post.faultHelper,false);
    console.log('TOUR_EDIT121_PARTIAL_SAVE_NATIVE_REPRODUCED_NOT_FIXED_FIRST_COMMIT_SURVIVES_SECOND_FAILURE',JSON.stringify(post));
  } else if(process.argv.includes('--tour-edit120-boundaries')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public' AND tablename IN('tournaments','tournament_levels')),
      'levelReferences',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'constraint',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE contype='f' AND confrelid='public.tournament_levels'::regclass),
      'levelTriggers',(SELECT jsonb_agg(jsonb_build_object('trigger',pg_get_triggerdef(oid),'function',tgfoid::regprocedure::text) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.tournament_levels'::regclass AND NOT tgisinternal));ROLLBACK;`));
  } else if(process.argv.includes('--tour-edit120-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'triggers',(SELECT jsonb_agg(jsonb_build_object('trigger',pg_get_triggerdef(t.oid),'function',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid)) ORDER BY tgname) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE tgrelid='public.tournaments'::regclass AND NOT tgisinternal),
      'blindWriters',(SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'body',pg_get_functiondef(oid),'acl',proacl::text,'config',proconfig)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('update_blind_structure','ops_update_tournament')),
      'receiptColumns',(SELECT jsonb_agg(jsonb_build_object('column',column_name,'type',data_type) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='table_operation_receipts'),
      'target',(SELECT jsonb_build_object('id',id,'status',status,'live_status',live_status,'updated_at',updated_at,'buy_in',buy_in,'rake',rake_amount,'stack',starting_stack) FROM public.tournaments WHERE id='f811e882-0bf8-4bfa-b790-d0f8cf122ca4'));
      ROLLBACK;`));
  } else if(process.argv.includes('--booking119-negative')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('chats',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.booking_chats c),'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.chat_messages m),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text);`);
    const before=fingerprint();console.log(sql(readFileSync('tests/cashier/booking119Negative.existing.pg17.sql','utf8')));
    assert.equal(fingerprint(),before);console.log('BOOKING119_RETAINED_CANARY_AND_ALL_MESSAGE_CASH_FINGERPRINT_UNCHANGED');
  } else if(process.argv.includes('--booking119-commit-overlap')){
    assert.equal(sql(`SELECT md5(pg_get_functiondef('public.ensure_booking_chat_v1(uuid)'::regprocedure));`),'9498418cedc905ea1da9e8a4d798c12b');
    const club='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',owner='f793a5b3-6025-4766-bc1b-49f16aa1b44a',actor='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec';
    const name='Booking concurrent119 local TEST',key=randomUUID();
    assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE name='${name}';`),'0','one retained canary only; do not repeat after success');
    assert.equal(sql(`SELECT count(*) FROM public.clubs WHERE id='${club}' AND owner_id='${owner}' AND name='Cash identity local TEST';`),'1');
    const cash=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r))::text);`);
    const chats=(exclude)=>sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]'::jsonb)::text) FROM public.booking_chats c ${exclude?`WHERE tournament_id<>'${exclude}'`:''};`);
    const before=cash(),beforeChats=chats();
    const claims=(who)=>`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='${who}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${who}"}';SET LOCAL ROLE authenticated;`;
    const config={name,start_time:'2026-12-20T12:00:00+07:00',buy_in:100000,rake_amount:0,service_fee_amount:0,starting_stack:20000,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6};
    const created=JSON.parse(sql(`${claims(owner)}SELECT public.create_tournament_with_levels_v1('${club}','${JSON.stringify(config)}'::jsonb,'[]'::jsonb,'${key}','${owner}');COMMIT;`));
    assert.equal(created.ok,true,JSON.stringify(created));const tour=created.tournament_id;assert.match(tour,/^[a-f0-9-]{36}$/);
    console.log('BOOKING119_RETAINED_CANONICAL_TOUR',JSON.stringify({tour,club,owner,actor,createRequestId:key}));
    const a=session('booking119_a'),b=session('booking119_b');let aResult,bResult;
    try{
      a.child.stdin.write(`${claims(actor)}SELECT public.ensure_booking_chat_v1('${tour}');SELECT 'BOOKING119_A_READY';\n`);
      await until(()=>a.output().includes('BOOKING119_A_READY'));
      b.child.stdin.write(`${claims(actor)}SELECT 'BOOKING119_B_STARTED';SELECT public.ensure_booking_chat_v1('${tour}');SELECT 'BOOKING119_B_DONE';\n`);
      await until(()=>b.output().includes('BOOKING119_B_STARTED'));
      await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='booking119_b' AND wait_event_type='Lock' AND wait_event='advisory');")==='t');
      assert.equal(b.output().includes('BOOKING119_B_DONE'),false);
      a.child.stdin.end('COMMIT;\n');await a.closed;
      await until(()=>b.output().includes('BOOKING119_B_DONE'));
      b.child.stdin.end('COMMIT;\n');await b.closed;
      aResult=JSON.parse(a.output().split('\n').find(line=>line.startsWith('{')));
      bResult=JSON.parse(b.output().split('\n').find(line=>line.startsWith('{')));
      assert.equal(aResult.created,true);assert.equal(bResult.created,false);assert.equal(aResult.chat.id,bResult.chat.id);
    }finally{
      if(!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');
      if(!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([a.closed,b.closed]);
    }
    const replay=JSON.parse(sql(`${claims(actor)}SELECT public.ensure_booking_chat_v1('${tour}');COMMIT;`));
    assert.equal(replay.created,false);assert.equal(replay.chat.id,aResult.chat.id);
    const post=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('chats',(SELECT count(*) FROM public.booking_chats WHERE tournament_id='${tour}'),
      'welcome',(SELECT count(*) FROM public.chat_messages WHERE chat_id='${replay.chat.id}' AND sender_id IS NULL),
      'expectedWelcome',(SELECT 1+CASE WHEN bot_enabled AND nullif(btrim(bot_qr_url),'') IS NOT NULL THEN 1 ELSE 0 END+CASE WHEN bot_enabled AND nullif(btrim(bot_welcome_message),'') IS NOT NULL THEN 1 ELSE 0 END FROM public.clubs WHERE id='${club}'),
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}'),
      'cash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${tour}'));ROLLBACK;`));
    assert.equal(post.chats,1);assert.equal(post.welcome,post.expectedWelcome);assert.equal(post.entries,0);assert.equal(post.cash,0);
    assert.equal(cash(),before);assert.equal(chats(tour),beforeChats);
    console.log('BOOKING119_TRUE_TWO_COMMIT_SAME_CHAT_SINGLE_WELCOME_FRESH_CONNECTION_UNKNOWN_RESPONSE_REPLAY_NO_FINANCIAL_DELTA_PASS',JSON.stringify({tour,chat:replay.chat.id,actor,post}));
  } else if(process.argv.includes('--booking200-post')){
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'definer',(SELECT prosecdef FROM pg_proc WHERE oid='public.ensure_booking_chat_v1(uuid)'::regprocedure),
      'owner',(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.ensure_booking_chat_v1(uuid)'::regprocedure),
      'config',(SELECT proconfig FROM pg_proc WHERE oid='public.ensure_booking_chat_v1(uuid)'::regprocedure),
      'digest',md5(pg_get_functiondef('public.ensure_booking_chat_v1(uuid)'::regprocedure)),
      'authenticated',has_function_privilege('authenticated','public.ensure_booking_chat_v1(uuid)','EXECUTE'),
      'anon',has_function_privilege('anon','public.ensure_booking_chat_v1(uuid)','EXECUTE'),
      'service',has_function_privilege('service_role','public.ensure_booking_chat_v1(uuid)','EXECUTE'),
      'policies',(SELECT jsonb_agg(jsonb_build_object('name',policyname,'permissive',permissive) ORDER BY policyname) FROM pg_policies WHERE schemaname='public' AND policyname IN('booking_human_message_actor_v1','booking_create_canonical_club_v1')),
      'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000200'),
      'fixtureChats',(SELECT count(*) FROM public.booking_chats WHERE tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30'),
      'testFaultHelper',to_regprocedure('public.test_booking200_welcome_fault()') IS NOT NULL,
      'mainRevision',(SELECT source_revision FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba'),
      'mainStatus',(SELECT status FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba'),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'auto',(SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'));
      ROLLBACK;`));
    assert.equal(state.definer,true);assert.equal(state.owner,'postgres');assert.deepEqual(state.config,['search_path=""']);
    assert.equal(state.digest,'9498418cedc905ea1da9e8a4d798c12b');
    assert.equal(state.authenticated,true);assert.equal(state.anon,false);assert.equal(state.service,false);
    assert.equal(state.policies.length,2);for(const p of state.policies)assert.equal(p.permissive,'RESTRICTIVE');
    assert.equal(state.ledger,0);assert.equal(state.fixtureChats,0);assert.equal(state.testFaultHelper,false);
    assert.equal(state.mainRevision,18);assert.equal(state.mainStatus,'in_progress');assert.equal(state.cash,300000);assert.equal(state.auto,false);
    console.log('BOOKING200_FRESH_CONNECTION_BODY_ACL_RESTRICTIVE_POLICIES_NO_LEDGER_NO_TEST_RESIDUE_MAIN_PRESERVED_PASS',JSON.stringify(state));
  } else if(process.argv.includes('--booking200-fault-overlap')){
    assert.equal(sql(`SELECT md5(pg_get_functiondef('public.ensure_booking_chat_v1(uuid)'::regprocedure));`),'9498418cedc905ea1da9e8a4d798c12b');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('chats',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.booking_chats c),'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.chat_messages m),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text);`);
    const before=fingerprint();console.log(sql(readFileSync('tests/cashier/booking200Fault.existing.pg17.sql','utf8')));
    assert.equal(fingerprint(),before);
    const tour='d24e3aed-f125-4bc5-ab11-49836c435e30',actor='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec';
    const claims=`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
    const a=session('booking200_a'),b=session('booking200_b');
    try{
      a.child.stdin.write(`${claims}SELECT public.ensure_booking_chat_v1('${tour}');SELECT 'BOOKING200_A_READY';\n`);
      await until(()=>a.output().includes('BOOKING200_A_READY'));
      b.child.stdin.write(`${claims}SELECT 'BOOKING200_B_STARTED';SELECT public.ensure_booking_chat_v1('${tour}');SELECT 'BOOKING200_B_DONE';\n`);
      await until(()=>b.output().includes('BOOKING200_B_STARTED'));
      await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='booking200_b' AND wait_event_type='Lock' AND wait_event='advisory');")==='t');
      assert.equal(b.output().includes('BOOKING200_B_DONE'),false);
      a.child.stdin.end('ROLLBACK;\n');await a.closed;
      await until(()=>b.output().includes('BOOKING200_B_DONE'));
      b.child.stdin.end('ROLLBACK;\n');await b.closed;
      assert.equal(fingerprint(),before);
      console.log('BOOKING200_TRUE_TWO_SESSION_ADVISORY_WAIT_FIRST_ROLLBACK_SECOND_CAN_CREATE_NO_PARTIAL_CHAT_OR_BUSINESS_DELTA');
    }finally{
      if(!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');
      if(!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([a.closed,b.closed]);
    }
  } else if(process.argv.includes('--qualify-booking200')){
    const file='supabase/migrations/20270128000200_booking_message_actor_integrity_v1.sql';
    const migration=readFileSync(file,'utf8');
    const catalog=()=>sql(`SELECT md5(jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public' AND tablename IN('chat_messages','booking_chats')),'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.booking_chats'::regclass AND NOT tgisinternal),'function',to_regprocedure('public.ensure_booking_chat_v1(uuid)') IS NOT NULL)::text);`);
    const business=()=>sql(`SELECT md5(jsonb_build_object('chats',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.booking_chats c),'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.chat_messages m),'clubs',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.clubs c),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text);`);
    const before=catalog(),facts=business();
    const dry=migration.replace(/COMMIT;\s*$/,'ROLLBACK;');assert.notEqual(dry,migration);
    sql(dry);assert.equal(catalog(),before);assert.equal(business(),facts);
    sql(migration);
    try{
      console.log(sql(readFileSync('tests/cashier/booking115CanonicalRead.existing.pg17.sql','utf8')));
      console.log(sql(readFileSync('tests/cashier/booking200Create.existing.pg17.sql','utf8')));
      assert.equal(business(),facts);
      console.log(sql(`SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,'digest',md5(pg_get_functiondef(oid))) FROM pg_proc WHERE oid='public.ensure_booking_chat_v1(uuid)'::regprocedure;`));
    }catch(error){
      sql(`BEGIN;DROP TRIGGER booking_client_identity_v1 ON public.booking_chats;DROP FUNCTION public.guard_booking_client_identity_v1();DROP FUNCTION public.ensure_booking_chat_v1(uuid);DROP POLICY booking_human_message_actor_v1 ON public.chat_messages;DROP POLICY booking_create_canonical_club_v1 ON public.booking_chats;COMMIT;`);
      assert.equal(catalog(),before);assert.equal(business(),facts);throw error;
    }
    assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000200';"),'0');
    console.log('BOOKING200_LOCAL_DDL_REHEARSAL_AND_RUNTIME_QUALIFIED_NO_LEDGER_BUSINESS_FINGERPRINT_UNCHANGED');
  } else if(process.argv.includes('--booking117-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public' AND tablename IN('chat_messages','booking_chats')),
      'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger WHERE tgrelid IN('public.chat_messages'::regclass,'public.booking_chats'::regclass) AND NOT tgisinternal),
      'indices',(SELECT jsonb_agg(indexdef ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='booking_chats'),
      'columns',(SELECT jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'default',column_default) ORDER BY table_name,ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name IN('chat_messages','booking_chats')),
      'collision200',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000200'),
      'functionExists',to_regprocedure('public.ensure_booking_chat_v1(uuid)') IS NOT NULL);ROLLBACK;`));
  } else if(process.argv.includes('--booking114-legacy-boundary')||process.argv.includes('--booking115-canonical-read')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('legacy',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.stack_registrations r),'chats',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.booking_chats c),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30'),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30'))::text);`);
    const before=fingerprint();console.log(sql(readFileSync(process.argv.includes('--booking115-canonical-read')?'tests/cashier/booking115CanonicalRead.existing.pg17.sql':'tests/cashier/booking114LegacyBoundary.existing.pg17.sql','utf8')));
    assert.equal(fingerprint(),before);console.log('BOOKING_READ_BOUNDARY_NO_DB_DELTA');
  } else if(process.argv.includes('--superadmin114-create')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tours',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l),'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.user_roles r),'users',(SELECT jsonb_agg(id ORDER BY id) FROM auth.users),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r))::text);`);
    const before=fingerprint();console.log(sql(readFileSync('tests/floorTableControlV3/superAdmin114Create.existing.pg17.sql','utf8')));
    assert.equal(fingerprint(),before);console.log('SUPERADMIN114_ALL_TOUR_LEVEL_ROLE_USER_RECEIPT_FINGERPRINT_UNCHANGED');
  } else if(process.argv.includes('--multiple113-post')){
    const hand='6bcc874f-828e-4e87-beb0-3ecbe9deda19',tour='d24e3aed-f125-4bc5-ab11-49836c435e30';
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('revision',h.source_revision,'status',h.status,'pot',h.pot_size,
     'currentProof',(SELECT count(*) FROM public.tournament_settlement_outcomes o WHERE o.hand_id=h.id AND o.status='verified' AND o.verification_scope='historical_display' AND o.source_revision=(s.snapshot->>'sourceRevision')::bigint AND o.source_chain_hash=s.snapshot->>'sourceChainHash'),
     'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=h.tournament_id),
     'parity',(SELECT jsonb_agg(jsonb_build_array(p.ending_stack,e.current_stack,se.chip_count,c.chip_count) ORDER BY p.seat_number) FROM public.hand_players p JOIN public.tournament_entries e ON e.tournament_id=h.tournament_id AND e.player_id=p.player_id AND e.entry_no=p.entry_number JOIN public.tournament_seats se ON se.entry_id=e.id AND se.is_active JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no WHERE p.hand_id=h.id),
     'activeHands',(SELECT count(*) FROM public.tournament_hands WHERE tournament_id=h.tournament_id AND status='in_progress'),
     'auto',(SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2'),
     'workerRoles',(SELECT count(*) FROM pg_roles WHERE rolname LIKE 'history_worker_%')) FROM public.tournament_hands h CROSS JOIN LATERAL(SELECT public.get_tracker_historical_display_snapshot(h.id,h.tournament_id) snapshot)s WHERE h.id='${hand}' AND h.tournament_id='${tour}';ROLLBACK;`));
    assert.deepEqual(state,{revision:21,status:'completed',pot:79799,currentProof:1,cash:400000,parity:[78396,201,802,601].map(v=>[v,v,v,v]),activeHands:0,auto:false,workerRoles:0});
    console.log('MULTIPLE113_FRESH_CONNECTION_CURRENT_HASH_PROOF_FOUR_PROJECTIONS_CASH_AUTO_OFF_PASS',JSON.stringify(state));
  } else if(process.argv.includes('--multiple113')){
    const {runMultiple113}=await import('../trackerSettlement/multiple113.native.mjs');
    await runMultiple113({sql});
  } else if(process.argv.includes('--mixed-street230')){
    const {runMixedStreet230}=await import('../trackerSettlement/mixedStreet230.native.mjs');
    await runMixedStreet230({sql});
  } else if(process.argv.includes('--booking111-unarchive')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
     'chats',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.booking_chats c),
     'cash',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c),
     'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id IN('46cab483-91e7-4220-aacf-e17bdf05269c','a43f49a7-bf31-4972-8ef9-f6fc2ea9802e')),
     'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id IN('46cab483-91e7-4220-aacf-e17bdf05269c','a43f49a7-bf31-4972-8ef9-f6fc2ea9802e')))::text);`);
    const before=fingerprint();console.log(sql(readFileSync('tests/cashier/bookingUnarchive111.existing.pg17.sql','utf8')));
    assert.equal(fingerprint(),before,'booking rollback changed retained metadata/cash/hands/entries');
    console.log('BOOKING111_RETAINED_METADATA_CASH_HAND_ENTRY_FINGERPRINT_UNCHANGED');
  } else if(process.argv.includes('--correction109-scope')){
    const {runCorrectionEntryNegatives}=await import('../trackerSettlement/correctionEntryProjection.native.mjs');
    await runCorrectionEntryNegatives({sql,scopeOnly:true});
  } else if(process.argv.includes('--correction108-legacy')){
    const {runCorrectionEntryNegatives}=await import('../trackerSettlement/correctionEntryProjection.native.mjs');
    await runCorrectionEntryNegatives({sql,legacyOnly:true});
  } else if(process.argv.includes('--correction107-negatives')){
    const {runCorrectionEntryNegatives}=await import('../trackerSettlement/correctionEntryProjection.native.mjs');
    await runCorrectionEntryNegatives({sql,session,until});
  } else if(process.argv.includes('--correction107-regression')){
    const {runCorrectionEntryProjection}=await import('../trackerSettlement/correctionEntryProjection.native.mjs');
    await runCorrectionEntryProjection({sql});
  } else if(process.argv.includes('--nonallin106-projection-post')||process.argv.includes('--nonallin106-projection-contract')){
    const hand='f420f331-d986-4278-acba-dcdb7303a5ba';
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
      'players',(SELECT jsonb_agg(jsonb_build_object('player',p.player_id,'start',p.starting_stack,'end',p.ending_stack,'seat',p.seat_number,
        'entry',s.entry_id,'entryStatus',e.status,'entryStack',e.current_stack,'seatStack',s.chip_count,'countStack',c.chip_count,'cards',p.hole_cards) ORDER BY p.seat_number)
       FROM public.hand_players p JOIN public.tournament_hands h ON h.id=p.hand_id
       LEFT JOIN public.tournament_seats s ON s.tournament_table_id=h.tournament_table_id AND s.table_session_id=h.table_session_id AND s.player_id=p.player_id AND s.entry_number=p.entry_number AND s.seat_number=p.seat_number AND s.is_active
       LEFT JOIN public.tournament_entries e ON e.id=s.entry_id LEFT JOIN public.tournament_chip_counts c ON c.tournament_id=h.tournament_id AND c.player_id=p.player_id AND c.entry_number=p.entry_number WHERE p.hand_id='${hand}'),
      'actions',(SELECT jsonb_agg(jsonb_build_object('player',a.player_id,'street',a.street,'type',a.action_type,'amount',a.action_amount) ORDER BY action_order) FROM public.hand_actions a WHERE hand_id='${hand}'),
      'writerDigest',(SELECT md5(replace(pg_get_functiondef('public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure),chr(13),''))),
      'writerMentionsEntry',(SELECT position('tournament_entries' IN pg_get_functiondef('public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure))>0),
      'repairAuditCount',(SELECT count(*) FROM public.audit_logs WHERE action='local_tracker_entry_projection_repair' AND payload->>'repair_key'='correction199-retained-hand30-entry-parity'
       AND entity_id IN('96ae5f01-7e6e-4344-895a-2b5cdbf124cd','9384eec9-8014-4d38-a1b0-03a35d264aa9')),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'));ROLLBACK;`));
    console.log('NONALLIN106_PROJECTION_DIAGNOSTIC',JSON.stringify(state));
    if(process.argv.includes('--nonallin106-projection-contract')){
      assert.equal(state.hand?.id,hand);assert.equal(state.cash,300000);assert.equal(state.players.length,2);
      for(const player of state.players){
        assert.equal(player.entryStatus,'seated');assert.equal(player.seatStack,player.start);assert.equal(player.countStack,player.start);
        assert.equal(player.entryStack,player.start,'correction must synchronize canonical entry.current_stack before the next hand can finish');
      }
      assert.equal(state.repairAuditCount,2,'exact local compensation must have one audit row per repaired entry');
      console.log('NONALLIN106_CANONICAL_SEAT_ENTRY_COUNT_START_STACK_PARITY_PASS');
    }
  } else if(process.argv.includes('--winner-correction104-post')||process.argv.includes('--winner-correction104-final')){
    const hand='3b17d706-6efa-4264-80b0-ec296397f6cf',tour='46cab483-91e7-4220-aacf-e17bdf05269c';
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
      'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY settlement_revision) FROM public.tournament_settlement_outcomes o WHERE hand_id='${hand}'),
      'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY source_revision) FROM public.tracker_historical_display_queue q WHERE hand_id='${hand}'),
      'seats',(SELECT jsonb_agg(chip_count ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND is_active),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='${tour}'),
      'source',(SELECT public.get_tournament_settlement_source_hash('${hand}')),
      'enabledScopes',(SELECT count(*) FROM public.tracker_correction_uat_scopes WHERE tournament_id='${tour}' AND enabled),
      'temporaryRoles',(SELECT count(*) FROM pg_roles WHERE rolname LIKE 'correction_browser_%'),
      'public',(SELECT public.get_public_tournament_table_history_v2('${tour}','d294f4a4-082b-4efc-a6ca-1f96579ea344',20,NULL,NULL)));ROLLBACK;`));
    assert.equal(state.hand?.source_revision,19);assert.equal(state.hand.status,'completed');assert.equal(state.hand.is_voided,false);
    assert.deepEqual(state.hand.community_cards,['2c','3d','4h','5s','6c']);assert.deepEqual(state.seats,[58600,1400]);assert.equal(state.cash,300000);
    const old=state.outcomes.filter(o=>o.source_revision===16&&o.verification_scope==='historical_display');
    assert.equal(old.length,1);assert.equal(old[0].status,'stale');
    const current=state.outcomes.filter(o=>o.source_revision===19&&o.verification_scope==='chain'&&o.status==='verified');assert.equal(current.length,1);
    assert.equal(current[0].source_revision,state.source.source_revision);assert.equal(current[0].source_chain_hash,state.source.source_chain_hash);
    assert.equal(current[0].idempotency_key,'825c183b-d141-4005-9bf2-6c414613cc5a');
    const item=state.public.items.find(i=>i.handId===hand);assert.equal(item.result.status,'verified');
    assert.deepEqual(item.result.recipients.map(r=>[r.playerId,r.potAward,r.netDelta]).sort(),[['533feda3-28c5-4194-bdf3-53a07c41305b',1400,0],['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',1400,0]].sort());
    const final=process.argv.includes('--winner-correction104-final');
    assert.equal(state.queue.find(q=>q.source_revision===19)?.status,final?'completed':'pending');
    if(final){
      assert.equal(state.outcomes.filter(o=>o.source_revision===19&&o.verification_scope==='historical_display'&&o.status==='verified').length,1);
      assert.equal(state.enabledScopes,0);assert.equal(state.temporaryRoles,0);
    }
    console.log('WINNER_CORRECTION104_OLD_AA_PROOF_STALE_CURRENT_SPLIT_CHAIN_PUBLIC_CONSERVATION_PASS',JSON.stringify({hand,oldRevision:16,newRevision:19,key:current[0].idempotency_key,seats:state.seats,cash:state.cash,recipients:item.result.recipients}));
  } else if(process.argv.includes('--winner-showdown103-post')){
    const hand='3b17d706-6efa-4264-80b0-ec296397f6cf',tour='46cab483-91e7-4220-aacf-e17bdf05269c';
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}' AND tournament_id='${tour}'),
      'players',(SELECT jsonb_agg(jsonb_build_object('start',starting_stack,'end',ending_stack,'cards',hole_cards,'out',is_eliminated) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${hand}'),
      'actions',(SELECT jsonb_agg(jsonb_build_object('type',action_type,'amount',action_amount) ORDER BY action_order) FROM public.hand_actions WHERE hand_id='${hand}'),
      'seats',(SELECT jsonb_agg(chip_count ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND is_active),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='${tour}'),
      'activeHands',(SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${tour}' AND status='in_progress'),
      'maxHand',(SELECT max(hand_number) FROM public.tournament_hands WHERE tournament_id='${tour}'),
      'auto',(SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'),
      'receipt',(SELECT result FROM floor_private.floor_table_v3_existing_receipt('675fe35e-60a8-4452-bb90-e79486d54da6','record_tracker_manual_hand_v1','3fb7f5d7-41f3-4daa-acd4-8f325e5b1a9a')));ROLLBACK;`));
    assert.equal(state.hand?.status,'completed');assert.equal(state.hand.source_revision,16);assert.equal(state.hand.pot_size,2800);
    assert.equal(state.hand.is_voided,false);assert.equal(state.hand.hand_number,29);
    assert.deepEqual(state.hand.community_cards,['2c','3d','7s','9c','Jd']);
    assert.deepEqual(state.players,[{start:58600,end:57200,cards:['Ks','Kh'],out:false},{start:1400,end:2800,cards:['As','Ah'],out:false}]);
    assert.deepEqual(state.actions,[{type:'post_sb',amount:100},{type:'post_bb',amount:200},{type:'call',amount:100},{type:'all_in',amount:1200},{type:'call',amount:1200}]);
    assert.deepEqual(state.seats,[57200,2800]);assert.equal(state.cash,300000);assert.equal(state.activeHands,0);assert.equal(state.maxHand,29);assert.equal(state.auto,false);
    assert.equal(state.receipt?.hand_id,hand);
    console.log('WINNER_SHOWDOWN103_ACTUAL_BROWSER_FINISH_DB_CONSERVATION_PASS',JSON.stringify(state));
  } else if(process.argv.includes('--inspect-winner-correction-candidates')){
    console.log(sql(`BEGIN READ ONLY;SELECT coalesce(jsonb_agg(jsonb_build_object(
      'hand',h.id,'tour',h.tournament_id,'table',h.tournament_table_id,'revision',h.source_revision,
      'handNumber',h.hand_number,'status',h.status,'voided',h.is_voided,'board',h.community_cards,'pot',h.pot_size,
      'tourStatus',t.status,'club',t.club_id,'owner',c.owner_id,
      'activeHands',(SELECT count(*) FROM public.tournament_hands x WHERE x.tournament_id=t.id AND x.status='in_progress'),
      'latestCompletedInTable',(SELECT x.id FROM public.tournament_hands x WHERE x.tournament_id=t.id AND x.tournament_table_id=h.tournament_table_id AND x.status='completed' AND NOT x.is_voided ORDER BY x.hand_number DESC LIMIT 1),
      'latestCompletedInTournament',(SELECT x.id FROM public.tournament_hands x WHERE x.tournament_id=t.id AND x.status='completed' AND NOT x.is_voided ORDER BY x.created_at DESC,x.id DESC LIMIT 1),
      'players',(SELECT jsonb_agg(jsonb_build_object('player',p.player_id,'entry',p.entry_number,'seat',p.seat_number,
        'start',p.starting_stack,'end',p.ending_stack,'cards',p.hole_cards,'eliminated',p.is_eliminated) ORDER BY p.seat_number) FROM public.hand_players p WHERE p.hand_id=h.id),
      'actions',(SELECT jsonb_agg(jsonb_build_object('order',a.action_order,'type',a.action_type,'amount',a.action_amount,'street',a.street,'player',a.player_id) ORDER BY a.action_order) FROM public.hand_actions a WHERE a.hand_id=h.id)
     ) ORDER BY h.id),'[]') FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
     JOIN public.clubs c ON c.id=t.club_id WHERE h.id IN('08730ce1-9a83-4439-96f9-ac005ae3d734','4ef98dd4-cb2b-4158-8a98-fe327ce71c0d',
       'f738688d-b606-4af7-b16f-84c66a95a4d3','876a9056-b3bf-414c-a1f6-5e344fc003d3','ba840f18-085a-430a-918a-6fca24d8c9ca',
       '3b17d706-6efa-4264-80b0-ec296397f6cf');ROLLBACK;`));
  } else if(process.argv.includes('--close-active-correction')){
    sql(readFileSync('tests/trackerVoice/activeCorrectionClose.existing.pg17.sql','utf8'));
    console.log('ACTIVE_CORRECTION101_ASSIGNMENT_RELEASED_SCOPES_DISABLED_HISTORY_PRESERVED_PASS');
  } else if(process.argv.includes('--active-correction-pending-guard')){
    sql(readFileSync('tests/trackerVoice/activeCorrectionPending.existing.pg17.sql','utf8'));
    console.log('ACTIVE_CORRECTION101_PROGRESSION_DENIED_ACTION_REVISION_UNCHANGED_PASS');
  } else if(process.argv.includes('--active-correction-post')||process.argv.includes('--active-correction-final')){
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=28),
      'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.action_order) FROM public.hand_actions a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND h.hand_number=28),
      'alerts',(SELECT jsonb_agg(to_jsonb(a)) FROM public.tracker_floor_alerts a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND h.hand_number=28),
      'undo',(SELECT jsonb_agg(to_jsonb(o)) FROM public.tracker_correction_operations o JOIN public.tournament_hands h ON h.id=o.hand_id WHERE h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND h.hand_number=28),
      'seatStacks',(SELECT jsonb_agg(chip_count ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND is_active),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'auto',(SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'),
      'activeHands',(SELECT count(*) FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND status='in_progress'),
      'maxHand',(SELECT max(hand_number) FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'enabledScopes',(SELECT count(*) FROM public.tracker_correction_uat_scopes WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND enabled),
      'activeAssignments',(SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND released_at IS NULL));
      ROLLBACK;`));
    if(process.argv.includes('--active-correction-final')){
      assert.equal(state.hand?.id,'876a9056-b3bf-414c-a1f6-5e344fc003d3');assert.equal(state.hand.status,'completed');
      assert.equal(state.hand.source_revision,11);assert.equal(state.hand.pot_size,200);assert.equal(state.hand.is_voided,false);
      assert.deepEqual(state.actions.map(row=>row.action_type),['post_sb','post_bb','fold']);
      assert.equal(state.undo.length,1);assert.equal(state.undo[0].receipt.source_revision,7);
      assert.equal(state.undo[0].idempotency_key,'bad8e19f-9679-4cd2-97be-674e9a206a79');
      assert.equal(state.alerts.length,1);assert.equal(state.alerts[0].status,'resolved');assert.equal(state.alerts[0].version,4);
      assert.equal(Object.keys(state.alerts[0].transition_receipts).length,3);
      assert.deepEqual(state.seatStacks,[58600,1400]);assert.equal(state.cash,300000);
      assert.equal(state.auto,false);assert.equal(state.activeHands,0);assert.equal(state.maxHand,28);
      assert.equal(state.enabledScopes,0);assert.equal(state.activeAssignments,0);
      console.log('ACTIVE_CORRECTION101_FINAL_NEW_CONNECTION_PASS',JSON.stringify({hand:state.hand.id,revision:11,
        alert:state.alerts[0].id,alertStatus:'resolved',alertVersion:4,undoRevision:7,seatStacks:state.seatStacks,cash:state.cash,
        auto:false,activeHands:0,activeAssignments:0,enabledScopes:0,nextHand:29}));
    }else console.log(JSON.stringify(state));
  } else if(process.argv.includes('--prepare-active-correction')){
    const deadline=Date.now()+16*60_000;
    while(true){
      const seconds=Number(sql("SELECT greatest(0,extract(epoch FROM(released_at+interval '15 minutes'-clock_timestamp()))) FROM public.dealer_assignments WHERE id='7fa013b4-80ef-4afe-add9-aa057121b431' AND released_at IS NOT NULL AND release_reason='local_undo_canary_complete';"));
      assert.ok(Number.isFinite(seconds)&&seconds>=0&&seconds<=900,'exact released assignment rest clock required');
      if(seconds===0)break;
      assert.ok(Date.now()<deadline,'real-rest wait bounded; do not rewrite time');
      console.log('ACTIVE_CORRECTION101_WAIT_REAL_REST_SECONDS',Math.ceil(seconds));
      await new Promise(resolve=>setTimeout(resolve,Math.min(30_000,Math.ceil(seconds*1000))));
    }
    console.log('ACTIVE_CORRECTION101_CANONICAL_CONTEXT',sql(readFileSync('tests/trackerVoice/activeCorrectionPrepare.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--undo-browser-receipt-post')){
    const hand='3c9e3e32-1855-434b-9e4c-34f651426819',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
    const proof=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'key',o.idempotency_key,'action',o.receipt->>'undone_action_id','expectedRevision',6,'receipt',o.receipt,
      'actionCount',(SELECT count(*) FROM public.hand_actions WHERE hand_id=h.id),
      'missingUndoneAction',NOT EXISTS(SELECT 1 FROM public.hand_actions WHERE id=(o.receipt->>'undone_action_id')::uuid),
      'handStatus',h.status,'revision',h.source_revision,'pot',h.pot_size,
      'operations',(SELECT count(*) FROM public.tracker_correction_operations WHERE hand_id=h.id),
      'seatStacks',(SELECT jsonb_agg(chip_count ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_table_id=h.tournament_table_id AND is_active),
      'activeHands',(SELECT count(*) FROM public.tournament_hands WHERE tournament_id=h.tournament_id AND status='in_progress'),
      'maxHand',(SELECT max(hand_number) FROM public.tournament_hands WHERE tournament_id=h.tournament_id),
      'activeAssignments',(SELECT count(*) FROM public.dealer_assignments WHERE table_session_id=h.table_session_id AND released_at IS NULL),
      'enabledScopes',(SELECT count(*) FROM public.tracker_correction_uat_scopes WHERE tournament_id=h.tournament_id AND enabled))
      FROM public.tracker_correction_operations o JOIN public.tournament_hands h ON h.id=o.hand_id
      WHERE h.id='${hand}' AND o.actor_user_id='${actor}';ROLLBACK;`));
    assert.equal(proof.key,'2fecac1c-6766-4ce3-b317-cd9176a6dcd4');assert.equal(proof.action,'ec3cb38a-156c-4c5b-ab67-dacdf383d7ff');
    assert.equal(proof.actionCount,3);assert.equal(proof.missingUndoneAction,true);assert.equal(proof.handStatus,'completed');
    assert.equal(proof.revision,11);assert.equal(proof.pot,200);assert.equal(proof.operations,1);
    assert.deepEqual(proof.seatStacks,[58500,1500]);assert.equal(proof.activeHands,0);assert.equal(proof.maxHand,27);
    assert.equal(proof.activeAssignments,0);assert.equal(proof.enabledScopes,0);
    // Same actual receipt remains readable after assignment release/UAT disable;
    // no live lock or present Dealer assignment is necessary for READ recovery.
    const usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
    const receipt=JSON.parse(sql(`BEGIN;${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
      SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';
      SET LOCAL ROLE authenticated;
      SELECT public.get_tracker_undo_receipt_v1('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',
        '${hand}','${proof.action}',6,'${proof.key}');ROLLBACK;`));
    assert.equal(receipt.outcome,'recorded');assert.deepEqual(receipt.receipt,{...proof.receipt,duplicate:true});
    console.log('UNDO_BROWSER100_INDEPENDENT_POST_SCOPE_RELEASE_RECEIPT_CURRENT_STATE_PASS',JSON.stringify(proof));
  } else if(process.argv.includes('--close-undo-browser')){
    sql(readFileSync('tests/trackerVoice/undoBrowserClose.existing.pg17.sql','utf8'));
    console.log('UNDO_BROWSER100_ASSIGNMENT_RELEASED_SCOPE_DISABLED_HISTORY_PRESERVED_AUTO_OFF_PASS');
  } else if(process.argv.includes('--undo-browser-post')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=27),
      'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY action_order) FROM public.hand_actions a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND h.hand_number=27),
      'operations',(SELECT jsonb_agg(to_jsonb(o)) FROM public.tracker_correction_operations o JOIN public.tournament_hands h ON h.id=o.hand_id WHERE h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND h.hand_number=27),
      'activeSeats',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND is_active),
      'cash',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'));
      ROLLBACK;`));
  } else if(process.argv.includes('--prepare-undo-browser')){
    console.log('UNDO_BROWSER100_CANONICAL_DEALER_CONTEXT',sql(readFileSync('tests/trackerVoice/undoBrowserPrepare.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--inspect-undo-context')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'table',(SELECT to_jsonb(t) FROM public.tournament_tables t WHERE id='d294f4a4-082b-4efc-a6ca-1f96579ea344'),
      'session',(SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'),
      'dealers',(SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.full_name,'user',d.user_id,'status',d.status)) FROM public.dealers d WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'),
      'assignments',(SELECT jsonb_agg(to_jsonb(a)) FROM public.dealer_assignments a WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'),
      'scopes',(SELECT jsonb_agg(to_jsonb(s)) FROM public.tracker_correction_uat_scopes s WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'attendance',(SELECT jsonb_agg(to_jsonb(a)) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'),
      'shifts',(SELECT jsonb_agg(to_jsonb(s)) FROM public.dealer_shifts s WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'),
      'checkin',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid))) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%check%in%dealer%'));
      ROLLBACK;`));
  } else if(process.argv.includes('--undo-receipt-read')){
    sql(readFileSync('tests/trackerVoice/undoReceiptRead.existing.pg17.sql','utf8'));
    const definition=sql("SELECT replace(pg_get_functiondef('public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),'');");
    assert.ok(definition.includes('STABLE SECURITY DEFINER')&&definition.includes("SET search_path TO ''"));
    sql(`BEGIN;REVOKE EXECUTE ON FUNCTION public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid) FROM authenticated;
      DROP FUNCTION public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid);
      DO $$ BEGIN ASSERT to_regprocedure('public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid)') IS NULL;END $$;ROLLBACK;`);
    assert.equal(sql("SELECT replace(pg_get_functiondef('public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),'');"),definition);
    console.log('UNDO_RECEIPT_READ_ACTOR_PAYLOAD_ACL_READ_ONLY_RECOVERY_ROLLBACK_PASS',sql(`SELECT jsonb_build_object(
      'getter_digest',md5(replace(pg_get_functiondef('public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),'')),
      'writer_digest',md5(replace(pg_get_functiondef('public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),'')),
      'ledger198',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000198'));`));
  } else if(process.argv.includes('--inspect-undo-receipt-catalog')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
      'collision',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000198'),
      'getter',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_tracker_undo_receipt_v1'),
      'writer_digest',md5(replace(pg_get_functiondef('public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),'')),
      'tracker_digest',md5(replace(pg_get_functiondef('public.is_club_tracker(uuid,uuid)'::regprocedure),chr(13),'')),
      'operation_columns',(SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='tracker_correction_operations'));
      ROLLBACK;`));
  } else if(process.argv.includes('--undo-denial-edge')){
    const {runTrackerBrowserEdge}=await import('../trackerVoice/trackerBrowserEdge.local.mjs');
    process.env.VINPOKER_NATIVE_BROWSER='1';
    const fixture={tour:'46cab483-91e7-4220-aacf-e17bdf05269c'},actor='675fe35e-60a8-4452-bb90-e79486d54da6';
    const hand='f738688d-b606-4af7-b16f-84c66a95a4d3',table='d294f4a4-082b-4efc-a6ca-1f96579ea344';
    assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${hand}' AND tournament_id='${fixture.tour}' AND created_by='${actor}';`),'completed');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
      'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='${hand}'),
      'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${hand}'),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${fixture.tour}'))::text);`);
    const before=fingerprint(),usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
    const query=statement=>JSON.parse(sql(`BEGIN;${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
      SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';
      SET LOCAL ROLE authenticated;${statement}RESET ROLE;${usage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));
    const revision=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`));
    const action=sql(`SELECT id FROM public.hand_actions WHERE hand_id='${hand}' ORDER BY action_order DESC LIMIT 1;`),log=[];
    const response=await runTrackerBrowserEdge({fixture,user:{id:actor},query,log,body:{action:'undo_last_action_v1',
      tournament_id:fixture.tour,tournament_table_id:table,hand_id:hand,expected_action_id:action,
      expected_source_revision:revision,idempotency_key:crypto.randomUUID()}});
    const body=await response.json();
    assert.equal(fingerprint(),before,'undo rejection must not change canonical hand or seats');
    assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.code,'stale_tracker_context');
    console.log('ACTUAL_UNDO_EDGE_COMPLETED_HAND_DENIAL_NO_HAND_ACTION_PLAYER_SEAT_DELTA_PASS',JSON.stringify({status:response.status,code:body.code,log}));
  } else if(process.argv.includes('--dealer-integrated-capacity-post')){
    const club=process.argv[process.argv.indexOf('--dealer-integrated-capacity-post')+1];
    assert.match(club??'',/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    assert.equal(sql(`SELECT name FROM public.clubs WHERE id='${club}';`),'Ready capacity TEST 40');
    const state=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('club','${club}',
      'auto',(SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${club}'),
      'sessions',(SELECT count(*) FROM public.table_sessions WHERE club_id='${club}'),
      'closedSessions',(SELECT count(*) FROM public.table_sessions WHERE club_id='${club}' AND closed_at IS NOT NULL),
      'assignments',(SELECT count(*) FROM public.dealer_assignments WHERE club_id='${club}'),
      'released',(SELECT count(*) FROM public.dealer_assignments WHERE club_id='${club}' AND released_at IS NOT NULL),
      'active',(SELECT count(*) FROM public.dealer_assignments WHERE club_id='${club}' AND status='assigned' AND released_at IS NULL),
      'activeUnique',(SELECT count(DISTINCT attendance_id)||'|'||count(DISTINCT table_session_id) FROM public.dealer_assignments WHERE club_id='${club}' AND status='assigned' AND released_at IS NULL),
      'metrics',(SELECT count(*) FROM public.cron_metrics WHERE club_id='${club}' AND cron_name='process-swing-on-dealer-ready' AND status='success' AND processed_count=1),
      'checkedOut',(SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${club}' AND (a.check_out_time IS NOT NULL OR a.status='checked_out')),
      'temporaryRoles',(SELECT count(*) FROM pg_roles WHERE rolname LIKE 'ready_capacity_%'));COMMIT;`));
    assert.deepEqual(state,{club,auto:false,sessions:40,closedSessions:1,assignments:80,released:41,active:39,
      activeUnique:'39|39',metrics:40,checkedOut:0,temporaryRoles:0});
    console.log('DEALER_INTEGRATED40_INDEPENDENT_POSTCHECK_PASS',JSON.stringify(state));
  } else if(process.argv.includes('--ready153-edge-compensation')){
    execFileSync(process.execPath,['--max-old-space-size=128','--experimental-transform-types','tests/dealerSwing/readyWorkerCapacity.native.mjs','--integrated-projections','--edge-compensation153'],{
      stdio:'inherit',timeout:60_000,env:{...process.env,VINPOKER_NATIVE_READY_CAPACITY:'1',PGHOST:'127.0.0.1',
       PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}});
  } else if(process.argv.includes('--ready152-rest-deficit')||process.argv.includes('--ready152-fallback-deficit')){
    execFileSync(process.execPath,['--max-old-space-size=128','--experimental-transform-types','tests/dealerSwing/readyWorkerCapacity.native.mjs','--integrated-projections','--shared-incoming-contention','--rest-deficit-contention',...(process.argv.includes('--ready152-fallback-deficit')?['--fallback-deficit-contention']:[])],{
      stdio:'inherit',timeout:60_000,env:{...process.env,VINPOKER_NATIVE_READY_CAPACITY:'1',PGHOST:'127.0.0.1',
       PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}});
  } else if(process.argv.includes('--ready151-shared-incoming')){
    execFileSync(process.execPath,['--max-old-space-size=128','--experimental-transform-types','tests/dealerSwing/readyWorkerCapacity.native.mjs','--integrated-projections','--shared-incoming-contention'],{
      stdio:'inherit',timeout:60_000,env:{...process.env,VINPOKER_NATIVE_READY_CAPACITY:'1',PGHOST:'127.0.0.1',
       PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}});
  } else if(process.argv.includes('--ready150-contention40')){
    execFileSync(process.execPath,['--max-old-space-size=128','--experimental-transform-types','tests/dealerSwing/readyWorkerCapacity.native.mjs','--integrated-projections','--worker-contention40'],{
      stdio:'inherit',timeout:5*60_000,env:{...process.env,VINPOKER_NATIVE_READY_CAPACITY:'1',PGHOST:'127.0.0.1',
       PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}});
  } else if(process.argv.includes('--dealer-integrated-capacity')){
    execFileSync(process.execPath,['--experimental-transform-types','tests/dealerSwing/readyWorkerCapacity.native.mjs','--integrated-projections'],{
      stdio:'inherit',timeout:10*60_000,env:{...process.env,VINPOKER_NATIVE_READY_CAPACITY:'1',PGHOST:'127.0.0.1',
       PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}});
  } else if(process.argv.includes('--dealer-wall-clock-soak')){
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='vinpoker_ops_ready_capacity_ci');"),'t',
      'existing isolated capacity database required; do not clone or apply schema for soak');
    execFileSync(process.execPath,['--experimental-transform-types','tests/dealerSwing/readyWorkerCapacity.native.mjs','--wall-clock-soak'],{
      stdio:'inherit',timeout:96*60_000,env:{...process.env,VINPOKER_NATIVE_READY_CAPACITY:'1',PGHOST:'127.0.0.1',
       PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_ready_capacity_ci'}});
  } else if(process.argv.includes('--inspect-v2-start-readiness')){
    console.log(sql(`BEGIN READ ONLY;
      WITH candidates AS(SELECT tt.id,tt.tournament_id,c.owner_id,tt.table_id,tt.game_table_id,tt.table_session_id
       FROM public.tournament_tables tt JOIN public.tournaments t ON t.id=tt.tournament_id
       JOIN public.clubs c ON c.id=t.club_id
       WHERE t.name ILIKE '%TEST%' AND t.status NOT IN('completed','cancelled') AND tt.status='active'
        AND (SELECT count(*) FROM public.tournament_seats s WHERE s.tournament_table_id=tt.id AND s.is_active)>=2
       ORDER BY tt.id LIMIT 10)
      SELECT coalesce(jsonb_agg(jsonb_build_object('table',x.id,'tournament',x.tournament_id,
       'legacy_physical_present',x.table_id IS NOT NULL,'canonical_physical_present',x.game_table_id IS NOT NULL,
       'session_present',x.table_session_id IS NOT NULL,'ok',ctx->'ok','error',ctx->'error',
       'readiness',ctx->'readiness','context_version',ctx->'context_version')),'[]'::jsonb)
      FROM candidates x CROSS JOIN LATERAL(SELECT public._tracker_unified_ops_context_v2(x.tournament_id,x.id,x.owner_id) AS ctx) q;
      ROLLBACK;`));
  } else if(process.argv.includes('--inspect-hand-start-writers')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
       'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
       'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,
       'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
       'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
       'service',has_function_privilege('service_role',p.oid,'EXECUTE'),
       'snapshots193',p.prosrc LIKE '%tracker_hand_seat_snapshots193%',
       'calls_v3',p.prosrc LIKE '%start_tracker_hand_v3%',
       'calls_legacy',p.prosrc ~ '(^|[^a-z_])start_hand[[:space:]]*[(]|start_tracker_hand_v2[[:space:]]*[(]',
       'definition',CASE WHEN ${process.argv.includes('--include-legacy-bodies')?'true':'false'} AND p.proname IN('start_hand','start_tracker_hand_v2') THEN pg_get_functiondef(p.oid) END)
       ORDER BY p.oid::regprocedure::text),'[]'::jsonb)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN('public','floor_private','private') AND p.prokind='f'
       AND (p.proname IN('start_hand','start_tracker_hand_v2','start_tracker_hand_v3')
        OR p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?hand_players'
        OR p.prosrc ~ '(^|[^a-z_])start_hand[[:space:]]*[(]|start_tracker_hand_v2[[:space:]]*[(]');
      ROLLBACK;`));
  } else if(process.argv.includes('--verify194-recovery-rollback')){
    const before=sql("SELECT md5(replace(pg_get_functiondef('public.start_hand(uuid,uuid,integer,timestamptz,uuid,integer)'::regprocedure),chr(13),''));");
    const recovery=readFileSync('docs/emergency_rollbacks/20270128000194_restore_reviewed_legacy_start.sql','utf8');
    assert.equal(recovery.match(/COMMIT;/g)?.length,1);
    console.log(sql(recovery.replace('COMMIT;',()=>`DO $$ BEGIN
      ASSERT md5(replace(pg_get_functiondef('public.start_hand(uuid,uuid,integer,timestamptz,uuid,integer)'::regprocedure),chr(13),''))='4875b3119a00e0d7413fa74df08f4415';
      END $$;ROLLBACK;SELECT 'START194_EXACT_RECOVERY_ROLLBACK_PASS';`)));
    assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.start_hand(uuid,uuid,integer,timestamptz,uuid,integer)'::regprocedure),chr(13),''));"),before);
    assert.throws(()=>sql(readFileSync('supabase/migrations/20270128000194_tracker_start_exact_context_v1.sql','utf8')),/tracker_start194_baseline_drift_or_collision/);
    assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.start_hand(uuid,uuid,integer,timestamptz,uuid,integer)'::regprocedure),chr(13),''));"),before);
    console.log('START194_REAPPLY_FAIL_CLOSED_CATALOG_UNCHANGED_PASS');
  } else if(process.argv.includes('--legacy-start-probe')){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
      'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_tables t WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'proof10',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb'))::text);`);
    const before=fingerprint();
    console.log(sql(`BEGIN;SET LOCAL statement_timeout='10s';
      DO $$ BEGIN
       ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
       ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND status='in_progress');
      END $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
      SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
      ${process.argv.includes('--legacy-tracker-mode-fixture')?`-- Transaction-only valid legacy mode, not an identity backfill or retained repair.
      UPDATE public.tournament_tables SET floor_control_mode='tracker'
       WHERE id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c';`:''}
      DO $$ DECLARE r jsonb;n integer;before_count integer;BEGIN
       SELECT max(hand_number)+1,count(*) INTO n,before_count FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c';
       BEGIN
        PERFORM set_config('role','authenticated',true);
        r:=public.start_hand('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',n,now(),'675fe35e-60a8-4452-bb90-e79486d54da6',1);
        PERFORM set_config('role','none',true);
       EXCEPTION WHEN insufficient_privilege THEN
        PERFORM set_config('role','none',true);r:=jsonb_build_object('permission_denied',true);
       END;
       RAISE NOTICE 'LEGACY_START_PROBE %',jsonb_build_object('response',r,
        'added_hands',(SELECT count(*)-before_count FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
        'session_null',(SELECT table_session_id IS NULL FROM public.tournament_hands WHERE id=(r->>'hand_id')::uuid),
        'players',(SELECT count(*) FROM public.hand_players WHERE hand_id=(r->>'hand_id')::uuid));
       ASSERT (SELECT count(*)=before_count FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
        'legacy_start_created_hand_without_exact_session';
       ASSERT r->>'error'='tracker_exact_session_required','legacy_start_explicit_reload_reason_required';
       PERFORM set_config('role','authenticated',true);
       r:=public.start_hand('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',n,now(),'11111111-1111-4111-8111-111111111111',1);
       ASSERT r->>'error'='actor_mismatch',r::text;
       PERFORM set_config('request.jwt.claim.sub','',true);
       PERFORM set_config('request.jwt.claims','{}',true);
       r:=public.start_hand('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',n,now(),NULL,1);
       ASSERT r->>'error'='unauthenticated',r::text;
       PERFORM set_config('role','none',true);
       ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000194');
      END $$;
      ROLLBACK;SELECT 'LEGACY_START_NO_CONTEXT_NO_WRITE_ROLLBACK_PASS';`));
    assert.equal(fingerprint(),before,'legacy negative probe changed retained tour or proof');
    console.log('START194_AUTH_ACTOR_RETAINED_TOUR_PROOF_NO_DELTA_PASS');
  } else if(process.argv.includes('--void193-inspect')){
    console.log(sql(`SELECT jsonb_build_object('start_digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
      'start_body_digest',md5(replace(p.prosrc,chr(13),'')),'start_owner',pg_get_userbyid(p.proowner),
      'start_acl',p.proacl,'start_config',p.proconfig,'start_definer',p.prosecdef,
      'void_digest',md5(replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),chr(13),'')),
      'snapshot_exists',to_regclass('floor_private.tracker_hand_seat_snapshots193') IS NOT NULL,
      'ledger193',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000193'))
      FROM pg_proc p WHERE p.oid='public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)'::regprocedure;`));
  } else if(process.argv.includes('--void192-inspect')){
    console.log(sql(`SELECT jsonb_build_object('definition',replace(pg_get_functiondef(p.oid),chr(13),''),
      'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'body_digest',md5(replace(p.prosrc,chr(13),'')),
      'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef,
      'ledger192',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000192'))
      FROM pg_proc p WHERE p.oid='public.void_last_hand(uuid)'::regprocedure;`));
  } else if(process.argv.includes('--finish191-concurrency-inspect')){
    console.log(sql(`SELECT jsonb_build_object('hands',(SELECT jsonb_agg(jsonb_build_object('id',h.id,'number',h.hand_number,'status',h.status,'voided',h.is_voided,'players',
      (SELECT jsonb_agg(jsonb_build_object('player',hp.player_id,'entry',hp.entry_number,'seat',hp.seat_number,'start',hp.starting_stack,'end',hp.ending_stack)) FROM public.hand_players hp WHERE hp.hand_id=h.id)))
      FROM public.tournament_hands h WHERE h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND h.hand_number>=10),
      'seats',(SELECT jsonb_agg(jsonb_build_object('id',id,'player',player_id,'entry',entry_number,'entry_id',entry_id,'seat',seat_number,'status',status,'active',is_active,'session',table_session_id,'chips',chip_count)) FROM public.tournament_seats WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'));`));
  } else if(process.argv.includes('--void192-elimination')){
    const {probeRestoredEntryEliminationVoid}=await import('../trackerVoice/finishConcurrency.existing.native.mjs');
    await probeRestoredEntryEliminationVoid(sql,{session,until});
  } else if(process.argv.includes('--finish191-concurrency')){
    const {probeFinishConcurrency191}=await import('../trackerVoice/finishConcurrency.existing.native.mjs');
    await probeFinishConcurrency191(sql,{session,until});
  } else if(process.argv.includes('--finish191-fresh-child')){
    const retained=()=>sql(`SELECT md5(jsonb_build_object(
      'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'proof',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb'),
      'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'))::text);`);
    const before=retained();
    try{
    console.log(sql(readFileSync('tests/trackerVoice/finishExistingActions191.existing.pg17.sql','utf8')));
    }finally{assert.equal(retained(),before,'fresh-child rollback changed retained hand/proof/business data');}
  } else if(process.argv.includes('--finish191-probe')){
    const {probeRetainedFinishReplay}=await import('../trackerVoice/retainedFinishReplay.native.mjs');
    await probeRetainedFinishReplay(sql);
  } else if(process.argv.includes('--multiple-sidepot-db-boundary')){
    const {probeMultipleSidepotDbBoundary}=await import('../trackerSettlement/sidepotRetained.rollback.native.mjs');
    await probeMultipleSidepotDbBoundary(sql);
  } else if(process.argv.includes('--pot183-parity')){
    const {probeDbPotParity}=await import('../trackerSettlement/sidepotRetained.rollback.native.mjs');
    probeDbPotParity(sql);
  } else if(process.argv.includes('--verify191-fresh-rollback')){
    const source=readFileSync('supabase/migrations/20270128000191_tracker_finish_existing_action_noop_v1.sql','utf8').replaceAll('\r','');
    const recovery=readFileSync('docs/emergency_rollbacks/20270128000191_restore_reviewed_record_hand.sql','utf8').replaceAll('\r','');
    for(const text of [source,recovery]){assert.equal(text.split('\nBEGIN;\n').length,2);assert.match(text,/\nCOMMIT;\s*$/);}
    const body=text=>text.replace('\nBEGIN;\n','\n').replace(/\nCOMMIT;\s*$/,'\n');
    const fingerprint=()=>sql(`SELECT md5(jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,
      'definition',replace(pg_get_functiondef(oid),chr(13),''),'acl',proacl) ORDER BY oid::regprocedure::text)::text)
      FROM pg_proc WHERE oid IN('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure,
      'floor_private.guard_tracker_action_stack189()'::regprocedure);`);
    const before=fingerprint();
    console.log(sql(`BEGIN;${body(recovery)}${body(source)}
      DO $$ BEGIN
        ASSERT md5(replace(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))='26c27c18eead389f7798b81244d74313';
        ASSERT md5(replace(pg_get_functiondef('floor_private.guard_tracker_action_stack189()'::regprocedure),chr(13),''))='4f064c7755b5a8ee53e39caed61f7429';
      END $$;ROLLBACK;SELECT 'CANDIDATE191_EXACT_PREDECESSOR_FRESH_APPLY_ROLLBACK_PASS';`));
    assert.equal(fingerprint(),before,'fresh191 changed current function/ACL/guard');
    let rejected=false;
    try{sql(source);}catch(error){
      assert.match(String(error.stderr??error),/tracker_finish191_baseline_drift_or_collision/);rejected=true;
    }
    assert.equal(rejected,true,'reapplying against a changed definition must not be silently accepted');
    assert.equal(fingerprint(),before,'rejected191 changed current catalog');
    console.log('CANDIDATE191_CHANGED_DEFINITION_FAIL_CLOSED_NO_CATALOG_DELTA_PASS');
  } else if(process.argv.includes('--verify189-fresh-rollback')){
    const source=readFileSync('supabase/migrations/20270128000189_tracker_action_stack_bound_v1.sql','utf8').replaceAll('\r','');
    assert.equal(source.split('\nBEGIN;\n').length,2);assert.match(source,/\nCOMMIT;\s*$/);
    const body=source.replace('\nBEGIN;\n','\n').replace(/\nCOMMIT;\s*$/,'\n');
    const snapshot=()=>sql(`SELECT md5(jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,
      'definition',replace(pg_get_functiondef(oid),chr(13),''),'acl',proacl) ORDER BY oid::regprocedure::text)::text)
      FROM pg_proc WHERE oid IN('public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure,
       'floor_private.guard_tracker_action_stack189()'::regprocedure);`);
    const before=snapshot();
    console.log(sql(`BEGIN;DO $restore$ DECLARE definition text; BEGIN
      ASSERT md5(replace(pg_get_functiondef('public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure),chr(13),''))='8995c91d0ef3dae89faadd2d1910fccf';
      definition:=replace(pg_get_functiondef('public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure),chr(13),'');
      definition:=replace(definition,$catch$  EXCEPTION WHEN check_violation THEN
    IF SQLERRM IN('tracker_action_negative_amount','tracker_action_stack_evidence_missing','tracker_action_stack_exceeded') THEN
      RETURN jsonb_build_object('error',SQLERRM,'trace_id',p_trace_id);
    END IF;
    RAISE;
  WHEN unique_violation THEN$catch$,'  EXCEPTION WHEN unique_violation THEN');
      ASSERT md5(definition)='9a0c1397480381859a12fbd6b619cd87';EXECUTE definition;
      END;$restore$;
      DROP TRIGGER trg_guard_tracker_action_stack189 ON public.hand_actions;
      DROP FUNCTION floor_private.guard_tracker_action_stack189();
      ${body}
      SELECT 'CANDIDATE189_EXACT_PREDECESSOR_FRESH_APPLY_ROLLBACK_PASS';ROLLBACK;`));
    assert.equal(snapshot(),before,'fresh-apply probe changed current qualified function/ACL');
  } else if(process.argv.includes('--action-stack-concurrency')){
    const {probeActionStackConcurrency}=await import('../trackerVoice/actionStackConcurrency.existing.native.mjs');
    await probeActionStackConcurrency(sql,{session,until,update:process.argv.includes('--update-writer')});
  } else if(process.argv.includes('--inspect189')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('signature',oid::regprocedure::text,
      'digest',md5(replace(pg_get_functiondef(oid),chr(13),'')),'owner',pg_get_userbyid(proowner),'definer',prosecdef,
      'config',proconfig,'acl',proacl) FROM pg_proc WHERE oid IN(
      'public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure,
      'floor_private.guard_tracker_action_stack189()'::regprocedure);
      SELECT count(*) AS migration189_ledger_rows FROM supabase_migrations.schema_migrations WHERE version='20270128000189';
      SELECT count(*) AS unretained_hand5 FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number>4;
      ROLLBACK;`));
  } else if(process.argv.includes('--inspect-action-integrity')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('signature',oid::regprocedure::text,'digest',md5(replace(pg_get_functiondef(oid),chr(13),'')),
        'owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl,'body',prosrc)
        FROM pg_proc WHERE oid='public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure;
      SELECT jsonb_build_object('policy',policyname,'cmd',cmd,'using',qual,'check',with_check)
        FROM pg_policies WHERE schemaname='public' AND tablename='hand_actions';
      SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.hand_actions'::regclass AND NOT tgisinternal;
      ROLLBACK;`));
  } else if(process.argv.includes('--retained-card-negatives')||process.argv.includes('--retained-action-negatives')){
    const retainedCards=()=>sql(`SELECT md5(jsonb_build_object(
      'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_tables t WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'sessions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.table_sessions t WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'seats',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_seats t WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_entries t WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'hands',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_hands t WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.hand_players p JOIN public.tournament_hands h ON h.id=p.hand_id WHERE h.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'cash',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cashier_buyin_movements t WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
      'proof',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_settlement_outcomes t WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'))::text);`);
    const before=retainedCards();
    console.log(sql((process.argv.includes('--retained-action-negatives')?"SET test.tracker_action_negatives='1';\n":'')
      +(process.argv.includes('--legacy-negative-action')?"SET test.tracker_legacy_negative='1';\n":'')+readFileSync('tests/trackerVoice/retainedCardNegatives.existing.pg17.sql','utf8')));
    assert.equal(retainedCards(),before,'card probe retained changes in the paid journey');
    console.log('RETAINED_CARD_NEGATIVES_JOURNEY_FINGERPRINT_UNCHANGED');
  } else if(process.argv.includes('--sidepot-retained-rollback')){
    const {probeRetainedSidepot}=await import('../trackerSettlement/sidepotRetained.rollback.native.mjs');
    await probeRetainedSidepot(sql,{tampered:process.argv.includes('--probe-tampered-sidepots'),actionRetries:process.argv.includes('--probe-action-retries'),sourceOmission:process.argv.includes('--probe-source-action-omission')});
  } else if(process.argv.includes('--arm-sidepot-browser')){
    assert.equal(sql(`SELECT count(*) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
      WHERE t.id='46cab483-91e7-4220-aacf-e17bdf05269c' AND c.id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6'
      AND t.name='Cash identity local TEST' AND NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=t.id AND hand_number>1)
      AND NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id=c.id);`),'1');
    sql(`INSERT INTO public.club_settings(club_id,auto_swing_enabled,player_history_enabled) VALUES('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',false,true);`);
    console.log('EXACT_NEW_SIDEPOT_TEST_CLUB_AUTO_OFF_HISTORY_ENABLED');
  } else if(process.argv.includes('--inspect-sidepot-browser')){
    console.log(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('tour',to_jsonb(t),'settings',(SELECT to_jsonb(cs) FROM public.club_settings cs WHERE club_id=t.club_id),
      'cash',(SELECT jsonb_agg(jsonb_build_object('amount',amount,'applied',applied_amount)) FROM public.cashier_buyin_movements WHERE tournament_id=t.id),
      'hands',(SELECT jsonb_agg(jsonb_build_object('id',id,'number',hand_number,'pot',pot_size,'status',status)) FROM public.tournament_hands WHERE tournament_id=t.id),
      'tables',(SELECT jsonb_agg(to_jsonb(tt)) FROM public.tournament_tables tt WHERE tournament_id=t.id),
      'seats',(SELECT jsonb_agg(jsonb_build_object('entry',entry_id,'stack',chip_count,'session',table_session_id)) FROM public.tournament_seats WHERE tournament_id=t.id AND is_active))
      FROM public.tournaments t WHERE t.id='46cab483-91e7-4220-aacf-e17bdf05269c' AND t.name='Cash identity local TEST';ROLLBACK;`));
  } else if(process.argv.includes('--prepare-sidepot-browser')){
    const {fixture,hand}=createPaidCompletedHandFixture(sql,{verified:true});
    assert.equal(sql(`SELECT count(*) FROM public.club_settings WHERE club_id='${fixture.club}';`),'0');
    sql(`INSERT INTO public.club_settings(club_id,auto_swing_enabled,player_history_enabled) VALUES('${fixture.club}',false,true);`);
    const table=JSON.parse(sql(`SELECT jsonb_build_object('table',tt.id,'session',ts.id,'revision',ts.revision,'epoch',ts.control_epoch,
      'stacks',(SELECT jsonb_agg(s.chip_count ORDER BY s.chip_count) FROM public.tournament_seats s WHERE s.table_session_id=ts.id AND s.is_active))
      FROM public.tournament_tables tt JOIN public.table_sessions ts ON ts.id=tt.table_session_id
      WHERE tt.tournament_id='${fixture.tour}' AND tt.status='active';`));
    assert.deepEqual(table.stacks,[19900,20000,20100]);
    const result=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${fixture.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${fixture.actor}"}';SET LOCAL ROLE authenticated;
      SELECT public.floor_request_table_control_mode_v4('${table.table}','${table.session}','tracker',${table.revision},${table.epoch},'${randomUUID()}');COMMIT;`));
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.outcome,'applied');
    console.log('CANONICAL_SIDEPOT_BROWSER_PREPARED',JSON.stringify({...fixture,seedHand:hand,table:table.table,session:table.session,starting:table.stacks,
      oracle:{mainPot:59700,sidePot:200,uncalledReturn:100,totalPot:59900,endingByStarting:{19900:59700,20000:200,20100:100}}}));
  } else if(process.argv.includes('--prepare-inbox-direct-browser')){
    const actor=sql(`SELECT c.owner_id FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
      WHERE h.id='055121ac-b49f-4b4b-9d17-a13cdee903e3' AND t.id='eb0c2302-5fec-4e61-a326-a9ba84728bb2' AND c.name='Cash identity local TEST';`);
    assert.equal(actor,'df6214be-0ba4-4df0-bb4e-3e7a10e126b2');
    const peer=randomUUID(),outsider=randomUUID(),chat=randomUUID(),tag=randomUUID();
    const usage=sql(`SELECT has_schema_privilege('authenticated','auth','USAGE');`);assert.ok(['t','f'].includes(usage));
    const asActor=(id,query)=>sql(`BEGIN;${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
      SET LOCAL request.jwt.claim.sub='${id}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${id}"}';SET LOCAL ROLE authenticated;
      ${query}RESET ROLE;${usage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`);
    sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${peer}'),('${outsider}');
      INSERT INTO public.profiles(user_id,display_name) VALUES('${peer}','LOCAL DM peer TEST ${tag.slice(0,8)}');COMMIT;`);
    asActor(actor,`INSERT INTO public.direct_chats(id,user_a,user_b) VALUES('${chat}',least('${actor}'::uuid,'${peer}'::uuid),greatest('${actor}'::uuid,'${peer}'::uuid));
      INSERT INTO public.direct_messages(chat_id,sender_id,kind,content) VALUES('${chat}','${actor}','text','LOCAL DM browser private TEST ${tag}');`);
    asActor(peer,`INSERT INTO public.direct_messages(chat_id,sender_id,kind,content) VALUES('${chat}','${peer}','text','LOCAL DM browser reply TEST ${tag}');`);
    const hidden=JSON.parse(asActor(outsider,`SELECT jsonb_build_object('chats',(SELECT count(*) FROM public.direct_chats WHERE id='${chat}'),
      'messages',(SELECT count(*) FROM public.direct_messages WHERE chat_id='${chat}'));`));
    assert.deepEqual(hidden,{chats:0,messages:0});
    assert.equal(sql(`SELECT has_schema_privilege('authenticated','auth','USAGE');`),usage);
    console.log('INBOX_DIRECT_BROWSER_CANONICAL_PRIVATE_FIXTURE_PREPARED',JSON.stringify({actor,peer,outsider,chat,tag,hidden}));
  } else if(process.argv.includes('--direct-text-component-native')){
    const env={...process.env,VINPOKER_NATIVE_DM_TEXT_UI:'1',PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database};
    for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!env[key]);
    const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/cashier/directTextRecovery.native.test.tsx',
      '--maxWorkers=1','--minWorkers=1'],{env,encoding:'utf8',timeout:60000,maxBuffer:2e6});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0,'actual direct text component native recovery');
  } else if(process.argv.includes('--direct-chat-integrity')){
    const output=sql(readFileSync('tests/cashier/directChatIntegrity.existing.pg17.sql','utf8'));
    console.log(output);
    const receipt=JSON.parse(output.split('\n').find(line=>line.startsWith('{')&&line.includes('"local_dm_receipt"'))).local_dm_receipt;
    const {directTextHash,matchDirectTextReceipt,retainDirectTextIntent,readDirectTextIntent,settleDirectTextIntent}=await import('../../src/lib/directTextIntent.ts');
    const intent={version:1,actorId:receipt.sender_id,chatId:receipt.chat_id,messageId:receipt.id,contentHash:await directTextHash('LOCAL DM rollback private message')};
    const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
    retainDirectTextIntent(storage,intent);assert.deepEqual(readDirectTextIntent(storage,intent.actorId,intent.chatId),intent);
    assert.equal([...values.values()].join('').includes(receipt.content),false);
    assert.deepEqual(await matchDirectTextReceipt(intent,receipt),receipt);
    assert.equal(await matchDirectTextReceipt(intent,{...receipt,content:'LOCAL other payload'}),null);
    assert.equal(await matchDirectTextReceipt({...intent,actorId:randomUUID()},receipt),null);
    settleDirectTextIntent(storage,intent);assert.equal(values.size,0);
    console.log('DIRECT_TEXT_ACTUAL_AUTHENTICATED_ROW_CLIENT_JOURNAL_RECEIPT_BINDING_PASS');
    console.log('DIRECT_CHAT_REAL_RLS_IMMUTABLE_PARTICIPANTS_OWN_READ_MARKER_PASS');
  } else if(process.argv.includes('--inspect-direct-chat')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'acl',c.relacl)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('direct_chats','direct_messages');
      SELECT to_jsonb(p) FROM pg_policies p WHERE schemaname='public' AND tablename IN('direct_chats','direct_messages');
      SELECT jsonb_build_object('trigger',t.tgname,'table',c.relname,'definition',pg_get_triggerdef(t.oid),'body',pg_get_functiondef(t.tgfoid))
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname IN('direct_chats','direct_messages') AND NOT t.tgisinternal;
      SELECT jsonb_build_object('index',indexname,'definition',indexdef) FROM pg_indexes WHERE schemaname='public' AND tablename='direct_chats';
      COMMIT;`));
  } else if(process.argv.includes('--fnb-mobile-refund-post')){
    const rows=JSON.parse(sql(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT o.id,o.status,o.subtotal_vnd,
      (SELECT on_hand FROM public.fnb_ingredients WHERE id='51da41ee-8727-4b92-b4ec-fb7589884418') stock,
      (SELECT jsonb_agg(jsonb_build_object('reason',reason,'delta',delta) ORDER BY created_at,id) FROM public.fnb_stock_movements WHERE ref_id=o.id) movements,
      (SELECT count(*) FROM public.fnb_create_intents_v1 WHERE club_id=o.club_id AND request_id=o.client_request_id) intents
      FROM public.fnb_orders o WHERE o.club_id='349ecf35-50ba-4c71-a581-15dc45f1cd01'
      AND o.customer_name='LOCAL FNB mobile refund TEST')t;`));
    assert.equal(rows.length,1);const row=rows[0];assert.equal(row.status,'cancelled');assert.equal(row.subtotal_vnd,5000);
    assert.equal(row.stock,8);assert.equal(row.intents,1);
    assert.deepEqual(row.movements,[{reason:'sale',delta:-2},{reason:'cancel_return',delta:2}]);
    console.log('FNB_ACTUAL_MOBILE_BROWSER_PAY_REFUND_STOCK_COMPENSATION_PASS',JSON.stringify(row));
  } else if(process.argv.includes('--fnb-browser-post')){
    const value=JSON.parse(sql(`SELECT jsonb_build_object('id',o.id,'status',o.status,'subtotal',o.subtotal_vnd,
      'stock',(SELECT on_hand FROM public.fnb_ingredients WHERE id='51da41ee-8727-4b92-b4ec-fb7589884418'),
      'stockMovements',(SELECT jsonb_agg(jsonb_build_object('reason',reason,'delta',delta) ORDER BY created_at) FROM public.fnb_stock_movements WHERE ref_id=o.id),
      'items',(SELECT jsonb_agg(jsonb_build_object('qty',qty,'status',line_status)) FROM public.fnb_order_items WHERE order_id=o.id),
      'orderCount',(SELECT count(*) FROM public.fnb_orders WHERE club_id=o.club_id AND client_request_id=o.client_request_id))
      FROM public.fnb_orders o WHERE o.id='8a75bec8-7ed1-4776-af9b-1552eccfb60d'
      AND o.club_id='349ecf35-50ba-4c71-a581-15dc45f1cd01' AND o.customer_name='LOCAL FNB browser TEST';`));
    assert.deepEqual(value,{id:'8a75bec8-7ed1-4776-af9b-1552eccfb60d',status:'shipped',subtotal:5000,stock:8,
      stockMovements:[{reason:'sale',delta:-2}],items:[{qty:1,status:'shipped'}],orderCount:1});
    console.log('FNB_ACTUAL_BROWSER_CREATE_PAY_SHIP_DB_POST_PASS',JSON.stringify(value));
  } else if(process.argv.includes('--fnb-harness-contain')){
    console.log('LOCAL_FNB_HARNESS_GATE_BEFORE',sql(`SELECT jsonb_build_object(
      'ops',(SELECT jsonb_agg(to_jsonb(g)) FROM public.centerpoint_tournament_ops_release g),
      'd2',(SELECT jsonb_agg(to_jsonb(g)) FROM public.multi_day_package_release_v1 g));`));
    sql(`BEGIN;DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM public.centerpoint_tournament_ops_release WHERE allowed_club_ids IS DISTINCT FROM ARRAY['349ecf35-50ba-4c71-a581-15dc45f1cd01'::uuid])
        OR EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 WHERE allowed_club_ids IS DISTINCT FROM ARRAY['349ecf35-50ba-4c71-a581-15dc45f1cd01'::uuid]) THEN
        RAISE EXCEPTION 'never contain another harness scope';END IF;
      UPDATE public.centerpoint_tournament_ops_release SET enabled=false WHERE id;
      UPDATE public.multi_day_package_release_v1 SET enabled=false WHERE id;
      END $$;COMMIT;`);
    console.log('LOCAL_FNB_HARNESS_SCOPED_GATES_OFF_NOT_ORIGINAL_SNAPSHOT_RESTORE');
  } else if(process.argv.includes('--fnb-concurrency')){
    const {runFnbConcurrency}=await import('./fnbConcurrency.native.mjs');
    await runFnbConcurrency({sql,session,until});
  } else if(process.argv.includes('--fnb-lifecycle')){
    console.log(sql(readFileSync('tests/cashier/fnbLifecycle.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--inspect-fnb-integrity')){
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('function',p.proname,'definition',pg_get_functiondef(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN('fnb_club_ids','fnb_create_order','fnb_create_comp_order','fnb_mark_paid','fnb_cancel_order');
      SELECT jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default)
      FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'fnb_%' ORDER BY table_name,ordinal_position;
      COMMIT;`));
  } else if(process.argv.includes('--inspect-fnb-contracts')){
    console.log(sql(`SELECT jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
      'result',pg_get_function_result(p.oid),'digest',md5(p.prosrc),'acl',p.proacl,
      'returns',(SELECT jsonb_agg(line) FROM regexp_split_to_table(p.prosrc,E'\\n') line WHERE line ILIKE '%RETURN%' OR line ILIKE '%jsonb_build_object%'))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN('fnb_mark_paid','fnb_cancel_order','fnb_mark_shipped','fnb_create_order','fnb_create_comp_order','fnb_club_ids') ORDER BY p.proname;
      SELECT jsonb_build_object('orders',to_regclass('public.fnb_orders'),'items',to_regclass('public.fnb_order_items'));`));
  } else if(process.argv.includes('--configured-single-final-post')){
    const f={tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5',
      player:'a364de8e-06b1-4428-a20d-ac614ec406e5',entry:'3971d626-9716-49a3-b641-c825f687ef44',registration:'fcedfb4e-cb0d-4ca2-9444-86309a5c317a'};
    const state=JSON.parse(sql(`SELECT jsonb_build_object('status',t.status,
      'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id=t.id AND is_active),
      'sessions',(SELECT count(*) FROM public.table_sessions WHERE tournament_id=t.id AND closed_at IS NULL),
      'assignments',(SELECT count(*) FROM public.dealer_assignments a JOIN public.table_sessions s ON s.id=a.table_session_id WHERE s.tournament_id=t.id AND a.released_at IS NULL),
      'pending',(SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id=t.id AND status='pending'),
      'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=t.id),
      'entryStack',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id=t.id),
      'ranks',(SELECT jsonb_agg(finished_place ORDER BY finished_place) FROM public.tournament_entries WHERE tournament_id=t.id AND finished_place IS NOT NULL),
      'oldBulletPlace',(SELECT finished_place FROM public.tournament_entries WHERE id='2ff34617-98c7-409c-91c9-dd2341c17d71'),
      'reports',(SELECT count(*) FROM public.tournament_close_report WHERE tournament_id=t.id),
      'official',(SELECT detail->'official_results' FROM public.tournament_close_report WHERE tournament_id=t.id),
      'payments',(SELECT jsonb_agg(jsonb_build_object('place',finished_place,'amount',prize_amount,'recipient',recipient_ref) ORDER BY finished_place)
        FROM public.tournament_prize_payments WHERE tournament_id=t.id AND status='paid')) FROM public.tournaments t WHERE t.id='${f.tour}';`));
    assert.deepEqual(state,{status:'completed',seats:0,sessions:0,assignments:0,pending:0,cash:900000,entryStack:180000,ranks:[1,2,3,4,5,6,7,8],oldBulletPlace:null,reports:1,
      official:{version:1,status:'finalized',field:8},payments:[{place:1,amount:450000,recipient:'8d61bcdb-fdd8-49a0-9216-87ad9d7393df'},
        {place:2,amount:225000,recipient:f.actor},{place:3,amount:225000,recipient:'863c5855-a65d-4366-9a34-e70a91566cb2'}]});
    // The public contract uses member_id first, not player_id. Verify both
    // exact rank identities and that the payment points at that entry's member.
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('entry',id,'player',player_id) ORDER BY finished_place)
      FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND finished_place IN(1,2,3);`)),[
      {entry:'12e68149-025c-4659-88fe-2d015fd4951d',player:'1c1d8317-d4d9-4ee3-8b8f-6781f4989564'},
      {entry:f.entry,player:f.actor},{entry:'b8ce656b-5c98-4c5b-ad97-10b2e94e7fb1',player:'94aa69ff-01da-4920-854d-7e606bf3d16b'}]);
    assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments p JOIN public.tournament_entries e
      ON e.tournament_id=p.tournament_id AND e.finished_place=p.finished_place WHERE p.tournament_id='${f.tour}'
      AND p.recipient_ref IS DISTINCT FROM coalesce(e.member_id,e.player_id);`),'0');
    console.log('CONFIGURED_SINGLE_BROWSER_OFFICIAL_CLOSE_REENTRY_RANK_PAYOUT_PASS',JSON.stringify(state));
    const output=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{
      encoding:'utf8',timeout:120000,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,
        VINPOKER_NATIVE_PAID_TOUR:'1',VINPOKER_HISTORY_PARENT_SHOWDOWN:'1',VINPOKER_HISTORY_CONFIGURED_SEQUENTIAL:'9',
        VINPOKER_HISTORY_PARENT_HAND:'83d02eb2-8f65-4172-a94f-fa34c322e271',VINPOKER_HISTORY_PARENT_BASELINE:JSON.stringify(f)}});
    process.stdout.write(output);assert.match(output,/ACTUAL_PAID_TERMINAL_SHOWDOWN_HISTORY_WORKER_PUBLIC_VERIFIED_PASS/);
  } else if(process.argv.includes('--configured-single-sequential-history')){
    const {configuredSequentialHands}=await import('./configuredSingleSequential.fixture.mjs');
    const f={tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5',
      player:'a364de8e-06b1-4428-a20d-ac614ec406e5',entry:'3971d626-9716-49a3-b641-c825f687ef44',registration:'fcedfb4e-cb0d-4ca2-9444-86309a5c317a'};
    assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'2|180000');
    for(const h of configuredSequentialHands){
      assert.equal(sql(`SELECT h.status||'|'||h.pot_size||'|'||(SELECT count(*) FROM public.tournament_eliminations e WHERE e.hand_id=h.id)
        FROM public.tournament_hands h WHERE h.id='${h.id}' AND h.tournament_id='${f.tour}' AND h.hand_number=${h.number};`),`completed|${h.pot}|1`);
      const output=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{
        encoding:'utf8',timeout:120000,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,
          VINPOKER_NATIVE_PAID_TOUR:'1',VINPOKER_HISTORY_PARENT_SHOWDOWN:'1',VINPOKER_HISTORY_CONFIGURED_SEQUENTIAL:String(h.number),
          VINPOKER_HISTORY_PARENT_HAND:h.id,VINPOKER_HISTORY_PARENT_BASELINE:JSON.stringify(f)}});
      process.stdout.write(output);assert.match(output,/ACTUAL_PAID_TERMINAL_SHOWDOWN_HISTORY_WORKER_PUBLIC_VERIFIED_PASS/);
      console.log('CONFIGURED_SEQUENTIAL_HISTORY_VERIFIED',h.number,h.id);
    }
  } else if(process.argv.includes('--configured-single-sequential-to-headsup')){
    const {runConfiguredSingleSequential}=await import('./configuredSingleSequential.native.mjs');await runConfiguredSingleSequential(sql);
  } else if(process.argv.includes('--configured-single-browser-hand3-history')){
    const f={tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5',
      player:'a364de8e-06b1-4428-a20d-ac614ec406e5',entry:'3971d626-9716-49a3-b641-c825f687ef44',registration:'fcedfb4e-cb0d-4ca2-9444-86309a5c317a'};
    const hand='637c2e84-d785-4f68-901e-d001e84a6bc3';
    const facts=JSON.parse(sql(`SELECT jsonb_build_object('status',h.status,'revision',h.source_revision,'pot',h.pot_size,'board',h.community_cards,
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id=h.tournament_id),
      'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id=h.tournament_id AND is_active),
      'stack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id=h.tournament_id AND is_active),
      'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=h.tournament_id),
      'eliminated',(SELECT jsonb_agg(player_id) FROM public.hand_players WHERE hand_id=h.id AND ending_stack=0),
      'receipt',(SELECT result->>'hand_id' FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','ae3c2c3f-a5cd-466a-9482-cefcec2d4557')))
      FROM public.tournament_hands h WHERE h.id='${hand}' AND h.tournament_id='${f.tour}';`));
    assert.deepEqual(facts,{status:'completed',revision:43,pot:40200,board:['2c','3d','4h','7s','9c'],entries:9,seats:7,stack:180000,cash:900000,
      eliminated:['b60c0cf2-ec9f-46c2-82c9-8c6c3f045247'],receipt:hand});
    console.log('CONFIGURED_SINGLE_BROWSER_HAND3_FINISH_RELOAD_ONE_ELIMINATION_PASS',JSON.stringify(facts));
    const output=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{
      encoding:'utf8',timeout:120000,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,
        VINPOKER_NATIVE_PAID_TOUR:'1',VINPOKER_HISTORY_PARENT_SHOWDOWN:'1',VINPOKER_HISTORY_CONFIGURED_BROWSER_HAND3:'1',
        VINPOKER_HISTORY_PARENT_HAND:hand,VINPOKER_HISTORY_PARENT_BASELINE:JSON.stringify(f)}});
    process.stdout.write(output);assert.match(output,/ACTUAL_PAID_TERMINAL_SHOWDOWN_HISTORY_WORKER_PUBLIC_VERIFIED_PASS/);
  } else if(process.argv.includes('--configured-single-reopen-close-post')){
    const facts=JSON.parse(sql(`SELECT jsonb_build_object(
      'closedSessions',(SELECT count(*) FROM public.table_sessions WHERE id IN('03731801-341e-46e1-8919-e4ef68dbe952','21037753-414b-4146-a018-6f534c0e671b') AND closed_at IS NOT NULL AND tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'),
      'newLogicalTable',(SELECT id FROM public.tournament_tables WHERE table_session_id='21037753-414b-4146-a018-6f534c0e671b'),
      'newSessionAssignments',(SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='21037753-414b-4146-a018-6f534c0e671b'),
      'oldAssignmentReleased',(SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='03731801-341e-46e1-8919-e4ef68dbe952' AND status='completed' AND released_at IS NOT NULL),
      'stack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND is_active));`));
    assert.deepEqual(facts,{closedSessions:2,newLogicalTable:'33a5d63b-4f07-4cf6-b060-8523b298ced0',newSessionAssignments:0,oldAssignmentReleased:1,stack:180000});
    console.log('CONFIGURED_SINGLE_BROWSER_REOPEN_NEW_SESSION_CLOSE_NO_ASSIGNMENT_REUSE_PASS',JSON.stringify(facts));
  } else if(process.argv.includes('--configured-single-break-post')){
    const facts=JSON.parse(sql(`SELECT jsonb_build_object(
      'sourceClosed',(SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='03731801-341e-46e1-8919-e4ef68dbe952' AND tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'),
      'sourceSeats',(SELECT count(*) FROM public.tournament_seats WHERE table_session_id='03731801-341e-46e1-8919-e4ef68dbe952' AND is_active),
      'sourceAssignments',(SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='03731801-341e-46e1-8919-e4ef68dbe952' AND released_at IS NULL AND status='assigned'),
      'destinationSeats',(SELECT count(*) FROM public.tournament_seats WHERE table_session_id='ffcfe3fb-1a8f-42b5-898d-f36b09756805' AND is_active),
      'stack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND is_active),
      'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'),
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'));`));
    assert.deepEqual(facts,{sourceClosed:true,sourceSeats:0,sourceAssignments:0,destinationSeats:8,stack:180000,cash:900000,entries:9});
    console.log('CONFIGURED_SINGLE_BROWSER_BREAK_SOURCE_CLOSED_DEALER_RELEASED_CONSERVED_PASS',JSON.stringify(facts));
  } else if(process.argv.includes('--configured-single-reentry-issuance-post')){
    const facts=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='a364de8e-06b1-4428-a20d-ac614ec406e5';
      SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}';SET LOCAL ROLE authenticated;
      SELECT jsonb_build_object('inventory',(SELECT jsonb_object_agg(denomination_id,current_count) FROM public.chip_ops_current_denom_counts('829e61fe-0ac8-4ced-950d-ab76cb8dadc5')),
        'issuance',public.get_chip_issuance_state_v1('c57b36fe-e11d-4ce9-83fa-b57dfd4a064c','a364de8e-06b1-4428-a20d-ac614ec406e5'),
        'stack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND is_active),
        'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'));COMMIT;`));
    assert.deepEqual(facts.inventory,{'01886ad6-1cd4-4929-8a4d-0e8446ed5a50':900,'59f7ab30-5d04-4cf5-a8d1-66b1a46c2fca':90});
    assert.equal(facts.issuance.issued_count,9);assert.equal(facts.issuance.revision,2);
    assert.equal(facts.stack,180000);assert.equal(facts.cash,900000);
    console.log('CONFIGURED_SINGLE_REENTRY_ISSUANCE_MATCHES_PLAYABLE_STACK_PASS',JSON.stringify(facts));
  } else if(process.argv.includes('--configured-single-reentry-post')){
    const facts=JSON.parse(sql(`SELECT jsonb_build_object('bullets',jsonb_agg(jsonb_build_object('number',entry_no,'status',status,'stack',current_stack) ORDER BY entry_no),
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id=e.tournament_id),
      'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id=e.tournament_id AND is_active),
      'stack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id=e.tournament_id AND is_active),
      'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=e.tournament_id),
      'movements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id=e.tournament_id))
      FROM public.tournament_entries e WHERE e.tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND e.player_id='a364de8e-06b1-4428-a20d-ac614ec406e5' GROUP BY e.tournament_id;`));
    assert.deepEqual(facts,{bullets:[{number:1,status:'busted',stack:0},{number:2,status:'seated',stack:20000}],entries:9,seats:8,stack:180000,cash:900000,movements:9});
    console.log('CONFIGURED_SINGLE_REENTRY_CASH_RELOAD_SINGLE_MOVEMENT_NEW_BULLET_PASS',JSON.stringify(facts));
  } else if(process.argv.includes('--configured-single-showdown-history')){
    const f={tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5',
      player:'a364de8e-06b1-4428-a20d-ac614ec406e5',entry:'2ff34617-98c7-409c-91c9-dd2341c17d71',registration:'3ad75948-91de-415b-9ed2-6aa98e04f2ec'};
    const output=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{
      encoding:'utf8',timeout:120000,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,
        VINPOKER_NATIVE_PAID_TOUR:'1',VINPOKER_HISTORY_CONFIGURED_SINGLE_SHOWDOWN:'1',VINPOKER_HISTORY_PARENT_SHOWDOWN:'1',
        VINPOKER_HISTORY_PARENT_HAND:'a6624773-e132-410f-9460-c73ff2c88088',VINPOKER_HISTORY_PARENT_BASELINE:JSON.stringify(f)}});
    process.stdout.write(output);assert.match(output,/ACTUAL_PAID_TERMINAL_SHOWDOWN_HISTORY_WORKER_PUBLIC_VERIFIED_PASS/);
  } else if(process.argv.includes('--configured-single-showdown')||process.argv.includes('--configured-single-showdown-finish')){
    const {runConfiguredSingleShowdown}=await import('./configuredSingleShowdown.native.mjs');await runConfiguredSingleShowdown(sql,{resume:process.argv.includes('--configured-single-showdown-finish')});
  } else if(process.argv.includes('--configured-single-restore-post')){
    const facts=JSON.parse(sql(`SELECT jsonb_build_object('entry',e.id,'status',e.status,'stack',e.current_stack,'bustOrder',e.bust_order,'place',e.finished_place,
      'activeSeat',(SELECT count(*) FROM public.tournament_seats WHERE entry_id=e.id AND is_active AND chip_count=20000 AND seat_number=4 AND tournament_table_id='0118fcd0-4bff-453d-ad96-363bca64600b'),
      'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id=e.tournament_id),
      'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=e.tournament_id),
      'totalStack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id=e.tournament_id AND is_active))
      FROM public.tournament_entries e WHERE e.id='34529693-9f67-4672-a20c-cfc10c4d5063' AND e.tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5';`));
    assert.deepEqual(facts,{entry:'34529693-9f67-4672-a20c-cfc10c4d5063',status:'seated',stack:20000,bustOrder:null,place:null,activeSeat:1,entries:8,cash:800000,totalStack:160000});
    console.log('CONFIGURED_SINGLE_BROWSER_BUST_RESTORE_SAME_ENTRY_NO_EXTRA_CHIPS_PASS',JSON.stringify(facts));
  } else if(process.argv.includes('--configured-single-color-post')){
    const facts=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='a364de8e-06b1-4428-a20d-ac614ec406e5';
      SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}';SET LOCAL ROLE authenticated;
      SELECT jsonb_build_object('inventory',(SELECT jsonb_object_agg(denomination_id,current_count) FROM public.chip_ops_current_denom_counts('829e61fe-0ac8-4ced-950d-ab76cb8dadc5')),
       'reversed',(SELECT count(*) FROM public.color_up_operation WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND status='reversed'),
       'confirmed',(SELECT count(*) FROM public.color_up_operation WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND status='confirmed'),
       'rounding',(SELECT sum(rounding_delta) FROM public.color_up_operation WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'),
       'stack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND is_active),
       'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'));COMMIT;`));
    assert.deepEqual(facts,{inventory:{'01886ad6-1cd4-4929-8a4d-0e8446ed5a50':800,'59f7ab30-5d04-4cf5-a8d1-66b1a46c2fca':80},reversed:3,confirmed:0,rounding:0,stack:160000,cash:800000});
    console.log('CONFIGURED_SINGLE_COLOR_RELOAD_RECEIPT_UNDO_POSTCONDITIONS_PASS',JSON.stringify(facts));
  } else if(process.argv.includes('--configured-single-first-history')){
    const f={tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5',
      player:'a364de8e-06b1-4428-a20d-ac614ec406e5',entry:'2ff34617-98c7-409c-91c9-dd2341c17d71',registration:'3ad75948-91de-415b-9ed2-6aa98e04f2ec'};
    const output=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{
      encoding:'utf8',timeout:120000,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database,
        VINPOKER_NATIVE_PAID_TOUR:'1',VINPOKER_HISTORY_PARENT_HAND:'3d650426-7008-4127-baca-bfdcf3a7be2a',VINPOKER_HISTORY_PARENT_BASELINE:JSON.stringify(f)}});
    process.stdout.write(output);assert.match(output,/ACTUAL_PAID_PARENT_BASELINE_HISTORY_WORKER_PUBLIC_PASS/);
  } else if(process.argv.includes('--configured-single-hand-audit')){
    console.log(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5';
      SELECT jsonb_build_object('id',s.id,'mode',s.control_mode,'epoch',s.control_epoch,'revision',s.revision) FROM public.table_sessions s WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5';`));
    const facts=JSON.parse(sql(`SELECT jsonb_build_object('assignments',(SELECT count(*) FROM public.dealer_assignments a JOIN public.table_sessions s ON s.id=a.table_session_id
      WHERE s.tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND a.status='assigned' AND a.released_at IS NULL),
      'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND is_active),
      'stack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND is_active),
      'cash',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'),
      'proofs',(SELECT count(*) FROM public.tournament_settlement_outcomes o JOIN public.tournament_hands h ON h.id=o.hand_id AND h.source_revision=o.source_revision
        WHERE h.id='3d650426-7008-4127-baca-bfdcf3a7be2a' AND o.status='verified' AND o.verification_scope='historical_display'));`));
    assert.deepEqual(facts,{assignments:2,seats:8,stack:160000,cash:800000,proofs:1});
    console.log('CONFIGURED_SINGLE_HAND_CORRECTION_SCOPED_POSTCONDITIONS_PASS',JSON.stringify(facts));
  } else if(process.argv.includes('--configured-single-first-hand')){
    const f={tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5',
      player:'a364de8e-06b1-4428-a20d-ac614ec406e5',entry:'2ff34617-98c7-409c-91c9-dd2341c17d71',registration:'3ad75948-91de-415b-9ed2-6aa98e04f2ec'};
    assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${f.tour}';`),'0','continue existing hand after partial failure, do not start another');
    const tables=JSON.parse(sql(`SELECT jsonb_agg(t ORDER BY t.table_number) FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
      WHERE t.tournament_id='${f.tour}' AND t.status='active' AND s.closed_at IS NULL;`));
    const {runPaidTourHand}=await import('../trackerVoice/paidTourHand.native.mjs');
    const before=process.env.VINPOKER_NATIVE_PAID_TOUR;process.env.VINPOKER_NATIVE_PAID_TOUR='1';
    try{await runPaidTourHand(sql,f,tables);}finally{if(before===undefined)delete process.env.VINPOKER_NATIVE_PAID_TOUR;else process.env.VINPOKER_NATIVE_PAID_TOUR=before;}
  } else if(process.argv.includes('--configured-single-dealers')){
    const f={tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5'};
    const {runSingleDayDealerCheckinsNative}=await import('./singleDayParticipants.native.mjs');
    const rows=runSingleDayDealerCheckinsNative(sql,f);
    const {runPaidTourInitialAssignments}=await import('../dealerSwing/paidTourInitialAssign.native.mjs');
    const tables=JSON.parse(sql(`SELECT jsonb_agg(t ORDER BY t.table_number) FROM public.tournament_tables t
      JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${f.tour}' AND t.status='active' AND s.closed_at IS NULL;`));
    assert.equal(tables.length,2);assert.deepEqual(tables.map(t=>t.table_number),[30,31]);
    const before=process.env.VINPOKER_NATIVE_PAID_TOUR;process.env.VINPOKER_NATIVE_PAID_TOUR='1';
    try{await runPaidTourInitialAssignments(sql,{...f,player:'79b8765d-b08a-4b98-8504-e5f882c176e9'},tables,rows.map(r=>r.dealer));}
    finally{if(before===undefined)delete process.env.VINPOKER_NATIVE_PAID_TOUR;else process.env.VINPOKER_NATIVE_PAID_TOUR=before;}
  } else if(process.argv.includes('--configured-single-participants')){
    const {runSingleDayParticipantsNative}=await import('./singleDayParticipants.native.mjs');
    await runSingleDayParticipantsNative(sql,{tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5'});
  } else if(process.argv.includes('--prepare-single-e2e')){
    const {prepareSingleDayE2e}=await import('./singleDayE2ePrepare.native.mjs');prepareSingleDayE2e(sql);
  } else if(process.argv.includes('--inspect-single-setup')){
    console.log(sql(`SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
      AND p.proname IN('chip_ops_create_chip_set','chip_ops_add_denomination','chip_ops_save_stack_template','chip_ops_bind_tournament_chip_set');`));
  } else if(process.argv.includes('--d2-linked-postclose')){
    for(const tour of ['1bea5b51-d32e-454a-bb2f-caec74cefd81','7687094f-c35c-4a3d-993b-c878b4b9e0d0']){
      const state=JSON.parse(sql(`SELECT jsonb_build_object('status',t.status,'event',t.event_id,'club',t.club_id,'actor',(SELECT owner_id FROM public.clubs WHERE id=t.club_id),
        'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id=t.id AND is_active),
        'openSessions',(SELECT count(*) FROM public.table_sessions WHERE tournament_id=t.id AND closed_at IS NULL),
        'assignments',(SELECT count(*) FROM public.dealer_assignments a JOIN public.table_sessions s ON s.id=a.table_session_id WHERE s.tournament_id=t.id AND a.released_at IS NULL),
        'pendingMoves',(SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id=t.id AND status='pending'),
        'ranks',(SELECT jsonb_agg(finished_place ORDER BY finished_place) FROM public.tournament_entries WHERE tournament_id=t.id),
        'proofs',(SELECT count(*) FROM public.tournament_hands h JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id AND o.source_revision=h.source_revision
          WHERE h.tournament_id=t.id AND o.status='verified' AND o.verification_scope='historical_display'),
        'hand',(SELECT id FROM public.tournament_hands WHERE tournament_id=t.id),
        'table',(SELECT table_id FROM public.tournament_hands WHERE tournament_id=t.id)) FROM public.tournaments t WHERE t.id='${tour}';`));
      console.log('D2_LINKED_POSTCLOSE_STATE',JSON.stringify({tour,...state}));
      assert.equal(state.status,'completed');for(const key of ['activeSeats','openSessions','assignments','pendingMoves'])assert.equal(state[key],0,key);
      assert.deepEqual(state.ranks,[1,2,3,4,5,6,7,8]);assert.equal(state.proofs,1);
      const history=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
        SELECT public.get_public_tournament_table_history_v2('${tour}','${state.table}',20,NULL,NULL);COMMIT;`));
      assert.equal(history.items.length,1);assert.equal(history.items[0].result.status,'verified');
      const money=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${state.actor}';SET LOCAL request.jwt.claim.role='authenticated';
        SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${state.actor}"}';SET LOCAL ROLE authenticated;
        SELECT jsonb_build_object('event',public.multi_day_payout_postfinal_state_v1('${state.event}'),
          'club',public.get_club_payout_liability_v2('2026-10-01','2026-10-31','${state.club}'));COMMIT;`));
      assert.equal(money.event.paidPlayerVnd,0);assert.equal(money.event.unpaidObligationVnd,1600000);
      assert.equal(money.club.paidTotal,0);assert.equal(money.club.outstandingTotal,1600000);
    }
    console.log('D2_LINKED_HAND_HISTORY_CLOSE_POSTCONDITIONS_PASS');
  } else if(process.argv.includes('--linked-terminal216-public-projector')){
    const {runPublicResultsProjector}=await import('./publicResultsProjector.native.mjs');
    await runPublicResultsProjector(sql,session,until,{linkedTerminal216:true});
  } else if(process.argv.includes('--main-event-public-projector')){
    const {runPublicResultsProjector}=await import('./publicResultsProjector.native.mjs');
    await runPublicResultsProjector(sql,session,until,{mainEvent:true});
  } else if(process.argv.includes('--configured-single-public-projector')){
    const {runPublicResultsProjector}=await import('./publicResultsProjector.native.mjs');
    await runPublicResultsProjector(sql,session,until,{configuredSingle:true});
  } else if(process.argv.includes('--public-projector')){
    const {runPublicResultsProjector}=await import('./publicResultsProjector.native.mjs');
    await runPublicResultsProjector(sql,session,until);
  } else if(process.argv.includes('--inspect-public-result-contract')){
    console.log(sql(`SELECT pg_get_functiondef('public.get_public_tournament_results(uuid)'::regprocedure);
     SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname ~ '(publish.*payout|payout.*publish|public.*result)' ORDER BY 1;`));
  } else if(process.argv.includes('--public-official-results')){
    for(const tour of ['5875d8a8-b55f-4dbf-b462-46404d3ae04e','664e6861-ec0b-4471-8902-672be2d30efe']){
      const rows=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
       SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.get_public_tournament_results('${tour}') t;COMMIT;`));
      console.log('ACTUAL_ANON_CLOSED_RESULT_OBSERVED',JSON.stringify({tour,rows}));
      assert.ok(rows.length>0&&rows.every(row=>row.result_status==='official'&&typeof row.player_name==='string'&&row.player_name.trim()),'official close must publish resolved results');
    }
  } else if(process.argv.includes('--inspect175')){
    console.log(sql(`SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'path',proconfig,'definer',prosecdef,
      'hash',md5(replace(prosrc,chr(13),'')),'tail',right(prosrc,340),'acl',proacl)
      FROM pg_proc WHERE oid='public.multi_day_payout_postfinal_state_v1(uuid)'::regprocedure;`));
  } else if(process.argv.includes('--inspect-multi-day-payment-schema')){
    console.log(sql(`SELECT jsonb_build_object('table',c.relname,'index',pg_get_indexdef(i.indexrelid))
     FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.oid IN('public.tournament_prize_payments'::regclass,'public.multi_day_payout_corrections_v1'::regclass);
     SELECT jsonb_build_object('name',p.oid::regprocedure,'digest',md5(replace(prosrc,chr(13),''))) FROM pg_proc p WHERE p.oid IN(
      'public.multi_day_payout_postfinal_state_v1(uuid)'::regprocedure,'private.multi_day_legacy_payout_hold_v1()'::regprocedure,
      'public.multi_day_request_payout_correction_v1(uuid,text,uuid,uuid,bigint,text,text,text,uuid)'::regprocedure);
     SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.get_tournament_payout_recipients(uuid)'::regprocedure;
     SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_prize_payments' ORDER BY ordinal_position;`));
  } else if(process.argv.includes('--d2-payment-race')){
    const {runD2PaymentConcurrency}=await import('./d2PaymentConcurrency.native.mjs');
    await runD2PaymentConcurrency(sql,session,until);
  } else if(process.argv.includes('--d2-payment-bridge')){
    console.log(sql(readFileSync('tests/cashier/d2PaymentBridge.existing.pg17.sql','utf8')));
  } else if(process.argv.includes('--d2-payout-payment-gap')){
    const event='81473a81-36bf-474a-a600-67b66d5bf77d',tour='664e6861-ec0b-4471-8902-672be2d30efe';
    const actor='c76dfc1c-d861-4101-8ba3-9bfba3f8ae95';
    assert.equal(sql(`SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${event}' AND final_tournament_id='${tour}';`),'1');
    const call=q=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
      SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;${q}COMMIT;`));
    const read=call(`SELECT public.get_tournament_payout_recipients('${tour}');`);
    if(read.mode==='multi_day'){
      assert.equal(read.owedTotal,1600000);assert.equal(read.totalCount,8);
      assert.equal(read.places[0].obligationAmount,200000);
      const before=sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${tour}';`);
      const rejected=call(`SELECT public.record_tournament_prize_payment_v2('${tour}',1,'cash','${read.places[0].confirmationToken}','${randomUUID()}');`);
      assert.equal(rejected.error,'payout_confirmation_stale');
      assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${tour}';`),before);
      console.log('D2_PAYMENT_GAP_FIXED_FULL_OBLIGATION_READ_LEGACY_WRITE_FAILS_CLOSED');
    }else{
    const first=read.places[0];assert.equal(first.finishedPlace,1);assert.equal(first.prizeAmount,100000);
    const total=sql(`SELECT obligations->0->>'totalVnd' FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${event}';`);
    assert.equal(total,'200000');
    const fingerprint=()=>sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb)::text) FROM public.tournament_prize_payments p WHERE tournament_id='${tour}';`);
    const before=fingerprint();
    assert.throws(()=>call(`SELECT public.record_tournament_prize_payment_v2('${tour}',1,'cash','${first.confirmationToken}','${randomUUID()}');`),/multi_day_verified_payout_writer_required/);
    assert.equal(fingerprint(),before);
    console.log('D2_PAYMENT_GAP_CONFIRMED_LEGACY_READ100K_VS_FROZEN200K_WRITER_DENIED_NO_MONEY_DELTA');
    }
  } else if(process.argv.includes('--d2-roundtrip')){
    console.log(sql(`SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.floor_assign_entry_to_seat(uuid,uuid,integer,bigint,uuid)'::regprocedure;`));
    console.log(sql(readFileSync('tests/cashier/d2FloorRoundtrip.existing.pg17.sql','utf8')));
  } else if (process.argv.includes('--inspect-d2-close')) {
    const target='7a5a5738-1654-4597-9b8a-597944591e41';
    assert.equal(sql(`SELECT name FROM public.tournaments WHERE id='${target}' AND event_id='9f1a9d8f-1107-49cd-9c80-d2b04bedefd4';`),'Multi-day Final local TEST');
    console.log(sql(`SELECT jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(e)) FROM public.tournament_entries e WHERE tournament_id='${target}'),
     'seats',(SELECT jsonb_agg(to_jsonb(s)) FROM public.tournament_seats s WHERE tournament_id='${target}' AND is_active));
     SELECT jsonb_build_object('signature',p.oid::regprocedure,'digest',md5(replace(p.prosrc,chr(13),''))) FROM pg_proc p
     WHERE p.pronamespace='public'::regnamespace AND p.proname IN('floor_free_sit_player_v1','floor_assign_entry_to_seat','get_floor_seatable_entries');
     SELECT pg_get_functiondef('public.get_floor_seatable_entries(uuid)'::regprocedure);`));
  } else if (process.argv.includes('--inspect-manual')) {
    console.log(sql(`SELECT jsonb_build_object('name',p.oid::regprocedure::text,
      'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')), 'definition',pg_get_functiondef(p.oid))
      FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'floor_private'::regnamespace)
      AND p.proname IN('floor_bust_player_v3','finalize_tournament_results','payout_place_context_v1') ORDER BY p.proname;`));
  } else if (process.argv.includes('--multiday')) {
    const result = spawnSync(process.execPath, ['tests/chipOps/multiDayCrossFlow.native.mjs',
      ...(process.argv.includes('--prepare-bagging-browser') ? ['--prepare-bagging-browser'] : []),
      ...(process.argv.includes('--d2-read') ? ['--d2-read'] : []),
      ...(process.argv.includes('--initial-plan') ? ['--initial-plan'] : []),
      ...(process.argv.includes('--initial-apply') ? ['--initial-apply'] : []),
      ...(process.argv.includes('--multiplayer') ? ['--multiplayer'] : []),
      ...(process.argv.includes('--apply-faults') ? ['--apply-faults'] : []),
      ...(process.argv.includes('--apply-overlap') ? ['--apply-overlap'] : []),
      ...(process.argv.includes('--cancel-plan') ? ['--cancel-plan'] : []),
      ...(process.argv.includes('--decision-overlap') ? ['--decision-overlap'] : []),
      ...(process.argv.includes('--prepare-browser') ? ['--prepare-browser'] : []),
      ...(process.argv.includes('--initial-tv') ? ['--initial-tv'] : []),
      ...(process.argv.includes('--d2-hand') ? ['--d2-hand'] : []),
      ...(process.argv.includes('--payout-journey') ? ['--payout-journey'] : []),
      ...(process.argv.includes('--destination-guards') ? ['--destination-guards'] : [])], {
      encoding: 'utf8', timeout: 240000, maxBuffer: 2e6, env: { ...process.env,
        PGHOST: '127.0.0.1', PGPORT: '55441', PGUSER: 'postgres', PGDATABASE: database,
        VINPOKER_NATIVE_CROSS_FLOW: '1' },
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, 'canonical D2 seating must pass without diagnostic suppression');
  } else if (process.argv.includes('--official-close-journey')) {
    const {runOfficialCloseJourney}=await import('./officialCloseJourney.native.mjs');
    await runOfficialCloseJourney(sql);
  } else if (process.argv.includes('--manual-name')) {
    const f = createPaidJourneyFixture(sql, { playerHistoryEnabled: true });
    const call = (statement) => JSON.parse(sql(`BEGIN;
      SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';
      SET LOCAL ROLE authenticated;${statement}COMMIT;`));
    const table = JSON.parse(sql(`SELECT jsonb_build_object('table',t.id,'session',s.id,'revision',s.revision,'epoch',s.control_epoch)
      FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
      WHERE t.tournament_id='${f.tour}' ORDER BY t.table_number DESC LIMIT 1;`));
    const added = call(`SELECT public.floor_add_manual_player_v1('${f.tour}','Manual payout TEST','${table.table}',1,
      '${table.session}',${table.revision},${table.epoch},'${randomUUID()}','${f.actor}');`);
    assert.equal(added.ok, true, JSON.stringify(added));
    const entry = added.entry_id;
    const seat = JSON.parse(sql(`SELECT jsonb_build_object('revision',s.revision,'epoch',s.control_epoch,'stack',e.current_stack)
      FROM public.tournament_entries e JOIN public.tournament_seats q ON q.entry_id=e.id AND q.is_active
      JOIN public.table_sessions s ON s.id=q.table_session_id WHERE e.id='${entry}';`));
    assert.equal(call(`SELECT public.floor_bust_player_v3('${entry}',${seat.revision},${seat.epoch},${seat.stack},'${randomUUID()}','TEST manual payout');`).ok, true);
    sql(`INSERT INTO public.tournament_prizes(tournament_id,position,percentage,amount) VALUES('${f.tour}',1,50,50000),('${f.tour}',2,50,50000);
      UPDATE public.tournaments SET itm_places=2 WHERE id='${f.tour}';`);
    if(sql(`SELECT has_function_privilege('authenticated','public.finalize_tournament_results(uuid)','EXECUTE');`)==='t'){
      const finalized = call(`SELECT public.finalize_tournament_results('${f.tour}');`);
      assert.equal(finalized.ok, true, JSON.stringify(finalized));
    }else{
      const {closeCanonicalFinishedField}=await import('./officialCloseJourney.native.mjs');closeCanonicalFinishedField(sql,f);
    }
    const read = call(`SELECT public.get_tournament_payout_recipients('${f.tour}');`);
    const manual = read.places.find((row) => row.entryId === entry);
    assert.ok(manual);
    assert.equal(manual.recipientName, 'Manual payout TEST', 'canonical manual participation name must survive bust/finalization into payout');
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${manual.recipientRef}');`), 'f', 'manual operational identity needs no web account');
    const paid = call(`SELECT public.record_tournament_prize_payment_v2('${f.tour}',${manual.finishedPlace},'cash','${manual.confirmationToken}','${randomUUID()}');`);
    assert.equal(paid.ok, true); assert.equal(paid.entry_id, entry); assert.equal(paid.prize_amount, 50000);
    assert.equal(sql(`SELECT recipient_name FROM public.tournament_prize_payments WHERE id='${paid.payment_id}';`), 'Manual payout TEST');
    console.log('PAYOUT_MANUAL_CANONICAL_NAME_READ_PASS', JSON.stringify({ tour: f.tour, entry }));
  } else if (process.argv.includes('--clean-chain')) {
    const clone = `vinpoker_ops_payout124_clean_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    assert.match(clone, /^vinpoker_ops_payout124_clean_[a-f0-9]{8}$/);
    const cloneSql = (input) => execFileSync('wsl', ['-d', distro, '--', 'env', 'PGHOST=127.0.0.1',
      'PGPORT=55441', 'PGUSER=postgres', `PGDATABASE=${clone}`, 'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { input, encoding: 'utf8', timeout: 30000, maxBuffer: 2e6 }).trim();
    const fingerprintQuery = "SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb)::text) FROM public.tournament_prize_payments t;";
    const originalFingerprint = sql(fingerprintQuery);
    const catalogQuery = `SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object(
      'digest',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'acl',p.proacl::text,'config',p.proconfig))
      FROM pg_proc p WHERE p.proname IN ('get_tournament_payout_recipients','record_tournament_prize_payment',
      'record_tournament_prize_payment_v2','get_tournament_prize_payment_receipt_v2','get_club_payout_liability_v2',
      'payout_place_context_v1','record_prize_payment_v1','multi_day_seat_final_v1',
      'multi_day_final_roster_v1','multi_day_plan_initial_draw_v1','multi_day_get_initial_draw_plan_v1',
      'multi_day_apply_initial_draw_v1','multi_day_get_initial_draw_application_v1',
      'multi_day_cancel_initial_draw_v1','multi_day_get_initial_draw_resolution_v1',
      'get_public_tournament_redraw_v1','standard_public_redraw_v1');`;
    let created = false;
    try {
      wsl('env', 'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres', 'createdb', '--maintenance-db=postgres', `--template=${database}`, clone);
      created = true;
      assert.equal(cloneSql('SELECT current_database();'), clone);
      assert.equal(cloneSql('SHOW data_directory;'), `${parent}/data`);
      // Restore only copied objects to the captured pre124 state. Original audit
      // and ledger remain untouched in the original database.
      cloneSql(readFileSync('tests/cashier/fixtures/payoutPre124.writer.sql', 'utf8') + `
        DROP FUNCTION floor_private.standard_public_redraw_v1(uuid);
        DROP FUNCTION public.multi_day_cancel_initial_draw_v1(uuid,uuid);
        DROP FUNCTION public.multi_day_get_initial_draw_resolution_v1(uuid,uuid);
        DROP TABLE private.multi_day_initial_draw_cancellations_v1;
        DROP FUNCTION public.multi_day_get_initial_draw_application_v1(uuid,uuid);
        DROP FUNCTION public.multi_day_apply_initial_draw_v1(uuid,uuid);
        DROP TABLE private.multi_day_initial_draw_applications_v1;
        DROP FUNCTION public.multi_day_get_initial_draw_plan_v1(uuid,uuid);
        DROP FUNCTION public.multi_day_plan_initial_draw_v1(uuid,uuid[],text,uuid);
        DROP TABLE private.multi_day_initial_draw_plans_v1;
        DROP FUNCTION public.multi_day_final_roster_v1(uuid);
        DROP FUNCTION public.get_tournament_prize_payment_receipt_v2(uuid);
        DROP FUNCTION public.record_tournament_prize_payment_v2(uuid,integer,text,text,uuid);
        DROP FUNCTION public.get_tournament_payout_recipients(uuid);
        DROP FUNCTION floor_private.record_prize_payment_v1(uuid,integer,text,text,text,text);
        DROP FUNCTION floor_private.payout_place_context_v1(uuid,integer);
        DROP TABLE floor_private.payout_payment_receipts_v1;
        DROP FUNCTION public.get_club_payout_liability_v2(date,date,uuid);`);
      assert.equal(cloneSql("SELECT md5(replace(pg_get_functiondef('public.record_tournament_prize_payment(uuid,integer,text,text,text)'::regprocedure),chr(13),''));"), 'a0577fcca58d4f12d342e54f8981a5a8');
      // Restore just the copied function's verified prior body, not the pending
      // migration or any of its tables/triggers/seed data.
      const priorD2 = readFileSync('supabase/pending-migrations/20270120000003_multiday_final_seating_adjustment_v1.sql', 'utf8');
      const d2Start = priorD2.indexOf('CREATE FUNCTION public.multi_day_seat_final_v1(');
      const d2End = priorD2.indexOf('REVOKE ALL ON FUNCTION public.multi_day_seat_final_v1', d2Start);
      assert.ok(d2Start > 0 && d2End > d2Start);
      cloneSql(priorD2.slice(d2Start, d2End).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
      assert.equal(cloneSql("SELECT md5(replace(pg_get_functiondef('public.multi_day_seat_final_v1(uuid,uuid,uuid,integer,integer,uuid)'::regprocedure),chr(13),''));"), 'd28ff6121b7f5136a361c2ee7cb85645');
      const priorTv=readFileSync('supabase/pending-migrations/20270126000001_redraw_clock_hold_v1.sql','utf8');
      const tvStart=priorTv.indexOf('CREATE OR REPLACE FUNCTION public.get_public_tournament_redraw_v1(');
      const tvEnd=priorTv.indexOf('ALTER FUNCTION public.get_public_tournament_redraw_v1',tvStart);
      assert.ok(tvStart>0&&tvEnd>tvStart);cloneSql(priorTv.slice(tvStart,tvEnd));
      assert.equal(cloneSql("SELECT md5(replace(pg_get_functiondef('public.get_public_tournament_redraw_v1(uuid)'::regprocedure),chr(13),''));"),'4f9aabd19e87e0502240ec07736c8505');
      for (const file of ['20270128000124_payout_confirmation_integrity_v1.sql', '20270128000125_payout_liability_business_period_v2.sql', '20270128000126_payout_participation_display_v1.sql',
        '20270128000127_multiday_canonical_final_seating_v1.sql','20270128000128_multiday_final_participation_name_v1.sql','20270128000129_multiday_final_playable_stack_v1.sql',
        '20270128000130_multiday_final_roster_read_v1.sql','20270128000131_multiday_initial_draw_plan_v1.sql',
        '20270128000132_multiday_initial_draw_apply_v1.sql','20270128000133_multiday_initial_draw_cancel_v1.sql',
        '20270128000134_multiday_initial_draw_tv_hold_v1.sql']) {
        cloneSql(readFileSync(`supabase/migrations/${file}`, 'utf8'));
      }
      assert.deepEqual(JSON.parse(cloneSql(catalogQuery)), JSON.parse(sql(catalogQuery)), 'fresh full files must match the iteratively qualified local catalog');
      console.log(cloneSql(`SET test.payout_clone='${clone}';` + readFileSync('tests/cashier/payoutLiabilityPeriod.pg17.sql', 'utf8')));
      assert.equal(sql(fingerprintQuery), originalFingerprint, 'original payment history must be unchanged');
      assert.equal(cloneSql("SELECT has_table_privilege('authenticated','private.multi_day_initial_draw_plans_v1','SELECT');"),'f');
      assert.equal(cloneSql("SELECT has_function_privilege('anon','public.multi_day_final_roster_v1(uuid)','EXECUTE');"),'f');
      assert.equal(cloneSql("SELECT has_table_privilege('authenticated','private.multi_day_initial_draw_applications_v1','INSERT');"),'f');
      console.log('PAYOUT_D2_124_TO_134_FULL_FILES_CLEAN_BASELINE_CLONE_CATALOG_ACL_PASS');
    } finally {
      if (created) {
        assert.equal(cloneSql('SELECT current_database();'), clone);
        wsl('env', 'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres', 'dropdb', '--maintenance-db=postgres', clone);
      }
    }
  } else if (process.argv.includes('--liability-period')) {
    console.log(sql(readFileSync('tests/cashier/payoutLiabilityPeriod.pg17.sql', 'utf8')));
  } else if (process.argv.includes('--inspect')) {
    console.log(sql(`BEGIN READ ONLY;
      SELECT jsonb_build_object('name', p.oid::regprocedure::text, 'definition', pg_get_functiondef(p.oid),
        'digest', md5(replace(pg_get_functiondef(p.oid),chr(13),'')), 'acl', p.proacl::text)
      FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
      ('record_tournament_prize_payment','get_tournament_payout_recipients','get_club_payout_liability') ORDER BY p.proname;
      SELECT jsonb_build_object('entry_columns', (SELECT jsonb_agg(column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_entries'),
        'payment_columns', (SELECT jsonb_agg(column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_prize_payments'));
      COMMIT;`));
  } else if (process.argv.includes('--test')) {
    assert.equal(sql("SELECT to_regprocedure('public.get_tournament_payout_recipients(uuid)') IS NOT NULL;"), 't',
      'canonical payout read RPC must exist before UI confirmation is available');
    const run = execFileSync(process.execPath, ['tests/cashier/crossFlowItm.native.mjs'], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 2e6, env: { ...process.env,
        PGHOST: '127.0.0.1', PGPORT: '55441', PGUSER: 'postgres', PGDATABASE: database,
        VINPOKER_NATIVE_CROSS_FLOW: '1' },
    });
    const line = run.split('\n').find((row) => row.startsWith('SEQUENTIAL_ITM_OUT_RANK_PAYOUT_AND_RETRY_LOCAL_PASS '));
    assert.ok(line, run);
    const f = JSON.parse(line.slice(line.indexOf('{')));
    const owner = sql(`SELECT owner_id FROM public.clubs WHERE id='${f.club}';`);
    const actor = (id) => `SET LOCAL request.jwt.claim.sub='${id}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${id}"}';SET LOCAL ROLE authenticated;`;
    const call = (query, id = owner) => JSON.parse(sql(`BEGIN;${actor(id)}${query}COMMIT;`));
    const read = () => call(`SELECT public.get_tournament_payout_recipients('${f.tour}');`);
    const data = read();
    assert.equal(data.tournamentId, f.tour); assert.equal(data.totalCount, 3);
    assert.deepEqual(data.places.map((p) => p.finishedPlace), [1, 2, 3]);
    const target = data.places.find((p) => p.finishedPlace === 2);
    assert.ok(target.entryId && target.recipientRef && /^[a-f0-9]{32}$/.test(target.confirmationToken));
    const invoke = (token, key, method = 'cash', place = 2) => `SELECT public.record_tournament_prize_payment_v2('${f.tour}',${place},'${method}','${token}','${key}');`;
    const badKey = randomUUID();
    assert.equal(call(invoke('0'.repeat(32), badKey)).error, 'payout_confirmation_stale');
    assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}' AND finished_place=2;`), '0');
    assert.equal(call(invoke(target.confirmationToken, badKey)).error, 'request_payload_conflict');
    const key = randomUUID(); const query = invoke(target.confirmationToken, key);
    const clientIntent = parsePrizePaymentIntent(JSON.stringify({ actorId: owner, tournamentId: f.tour,
      requestId: key, entryId: target.entryId, recipientRef: target.recipientRef, recipientName: target.recipientName,
      finishedPlace: target.finishedPlace, prizeAmount: target.prizeAmount, confirmationToken: target.confirmationToken,
      method: 'cash' }), owner, f.tour);
    const paid = call(query); assert.equal(paid.ok, true); assert.equal(paid.entry_id, target.entryId);
    assert.equal(paid.recipient_ref, target.recipientRef); assert.equal(paid.prize_amount, target.prizeAmount);
    assert.deepEqual(call(query), paid, 'lost response replay returns the same durable receipt');
    const recovered = call(`SELECT public.get_tournament_prize_payment_receipt_v2('${key}');`);
    assert.equal(recovered.found, true); assert.deepEqual(recovered.result, paid);
    assert.equal(recovered.payload.expected_token, target.confirmationToken);
    assert.equal(resolvePrizePaymentResult(clientIntent, paid).status, 'committed', 'actual DB response must satisfy the frontend boundary');
    assert.equal(resolvePrizePaymentReceipt(clientIntent, recovered).status, 'committed', 'actual durable DB receipt must satisfy reload recovery');
    assert.equal(call(invoke(target.confirmationToken, key, 'bank')).error, 'request_payload_conflict');
    assert.equal(call(invoke(target.confirmationToken, randomUUID())).outcome, 'already_paid');
    assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}' AND finished_place=2;`), '1');
    const outsider = randomUUID(); sql(`INSERT INTO auth.users(id) VALUES('${outsider}');`);
    assert.equal(call(invoke(target.confirmationToken, randomUUID()), outsider).error, 'actor_not_allowed');
    assert.equal(call(`SELECT public.get_tournament_prize_payment_receipt_v2('${key}');`, outsider).found, false);
    assert.throws(() => call(`SELECT public.get_tournament_payout_recipients('${f.tour}');`, outsider), /actor_not_allowed/);
    assert.equal(sql("SELECT has_function_privilege('anon','public.get_tournament_payout_recipients(uuid)','EXECUTE');"), 'f');
    assert.equal(sql("SELECT has_function_privilege('service_role','public.record_tournament_prize_payment_v2(uuid,integer,text,text,uuid)','EXECUTE');"), 'f');
    assert.equal(sql("SELECT has_function_privilege('authenticated','floor_private.record_prize_payment_v1(uuid,integer,text,text,text,text)','EXECUTE');"), 'f');
    assert.equal(read().paidCount, 2);
    // Real source change between read and confirm, fully rolled back afterwards.
    const first = read().places.find((p) => p.finishedPlace === 1);
    const stale = JSON.parse(sql(`BEGIN;
      UPDATE public.tournament_prizes SET amount=amount+1 WHERE tournament_id='${f.tour}' AND position=1;
      ${actor(owner)}${invoke(first.confirmationToken, randomUUID(), 'cash', 1)}ROLLBACK;`));
    assert.equal(stale.error, 'payout_confirmation_stale');
    assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}' AND finished_place=1;`), '0');
    const ambiguous = JSON.parse(sql(`BEGIN;
      UPDATE public.tournament_entries SET finished_place=1 WHERE id='${target.entryId}';
      ${actor(owner)}SELECT public.record_tournament_prize_payment('${f.tour}',1,'cash');ROLLBACK;`));
    assert.equal(ambiguous.error, 'place_ambiguous', 'legacy caller must also fail closed rather than LIMIT 1');
    const invalidPaid = JSON.parse(sql(`BEGIN;
      UPDATE public.tournament_prizes SET amount=amount+1 WHERE tournament_id='${f.tour}' AND position=2;
      ${actor(owner)}SELECT public.record_tournament_prize_payment('${f.tour}',2,'cash');ROLLBACK;`));
    assert.equal(invalidPaid.error, 'paid_result_conflict');
    const faultKey = randomUUID();
    const atomic = JSON.parse(sql(`BEGIN;
      CREATE FUNCTION pg_temp.reject_payout_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'TEST receipt failure' USING ERRCODE='23514'; END;$$;
      CREATE TRIGGER test_payout_receipt_failure BEFORE INSERT ON floor_private.payout_payment_receipts_v1
        FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_payout_receipt();
      ${actor(owner)}
      DO $$BEGIN
        BEGIN
          PERFORM public.record_tournament_prize_payment_v2('${f.tour}',1,'cash','${first.confirmationToken}','${faultKey}');
          RAISE EXCEPTION 'fault injection must fail';
        EXCEPTION WHEN check_violation THEN NULL; END;
      END;$$;
      RESET ROLE;
      SELECT jsonb_build_object('payments',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}' AND finished_place=1),
        'receipts',(SELECT count(*) FROM floor_private.payout_payment_receipts_v1 WHERE actor_id='${owner}' AND request_id='${faultKey}'));
      ROLLBACK;`));
    assert.deepEqual(atomic, { payments: 0, receipts: 0 }, 'receipt failure must roll back the payment insert');
    const cashier = randomUUID();
    sql(`INSERT INTO auth.users(id) VALUES('${cashier}');INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${f.club}','${cashier}');`);
    const firstKey = randomUUID(), secondKey = randomUUID();
    const secondName = `payout124_${randomUUID().replaceAll('-', '')}`;
    const firstSession = session('payout124_first');
    let secondSession;
    try {
      firstSession.child.stdin.write(`BEGIN;${actor(owner)}${invoke(first.confirmationToken, firstKey, 'cash', 1)}SELECT 'FIRST_PAYMENT_HELD';\n`);
      await until(() => firstSession.output().includes('FIRST_PAYMENT_HELD'));
      secondSession = session(secondName);
      secondSession.child.stdin.end(`BEGIN;${actor(cashier)}${invoke(first.confirmationToken, secondKey, 'cash', 1)}COMMIT;\n`);
      await until(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${secondName}' AND wait_event_type='Lock');`) === 't');
      firstSession.child.stdin.end('COMMIT;\n');
      const outputs = await Promise.all([firstSession.closed, secondSession.closed]);
      const payments = outputs.map((output) => JSON.parse(output.split('\n').find((row) => row.startsWith('{'))));
      assert.equal(payments[0].outcome, 'recorded'); assert.equal(payments[1].outcome, 'already_paid');
      assert.equal(payments[0].payment_id, payments[1].payment_id);
      assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}' AND finished_place=1;`), '1');
    } finally {
      if (!firstSession.child.stdin.destroyed) firstSession.child.stdin.end('ROLLBACK;\n');
      await Promise.allSettled([firstSession.closed, ...(secondSession ? [secondSession.closed] : [])]);
    }
    sql(`DELETE FROM public.club_cashiers WHERE club_id='${f.club}' AND user_id='${cashier}';`);
    assert.equal(call(invoke(first.confirmationToken, secondKey, 'cash', 1), cashier).error, 'actor_not_allowed',
      'receipt replay cannot bypass a revoked club grant');
    assert.throws(() => call(`SELECT public.get_tournament_prize_payment_receipt_v2('${secondKey}');`, cashier), /actor_not_allowed/);
    const recovery = readFileSync('docs/emergency_rollbacks/20270128000124_payout_confirmation_suspend_writes.sql', 'utf8');
    assert.match(recovery, /COMMIT;\s*$/);
    const recoveryResult = JSON.parse(sql(recovery.replace(/COMMIT;\s*$/, `
      SELECT jsonb_build_object('old_writer',has_function_privilege('authenticated','public.record_tournament_prize_payment(uuid,integer,text,text,text)','EXECUTE'),
        'new_writer',has_function_privilege('authenticated','public.record_tournament_prize_payment_v2(uuid,integer,text,text,uuid)','EXECUTE'),
        'recovery_read',has_function_privilege('authenticated','public.get_tournament_prize_payment_receipt_v2(uuid)','EXECUTE'));
      ROLLBACK;`)));
    assert.deepEqual(recoveryResult, { old_writer: false, new_writer: false, recovery_read: true });
    assert.equal(sql("SELECT has_function_privilege('authenticated','public.record_tournament_prize_payment_v2(uuid,integer,text,text,uuid)','EXECUTE');"), 't');
    console.log('PAYOUT124_CANONICAL_READ_CONFIRMATION_CAS_RECEIPT_ACL_PASS', JSON.stringify({ tour: f.tour, entry: target.entryId }));
  } else {
    throw new Error('Choose --inspect; runtime regression is added after catalog verification.');
  }
} finally {
  if (owned) wsl(...pgctl, '-m', 'fast', '-w', 'stop');
}
