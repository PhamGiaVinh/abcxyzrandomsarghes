import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

const name = '20270128000066_floor_manual_seat_session_fence_v1.sql';
const sql = readFileSync(`supabase/migrations/${name}`, 'utf8').replaceAll('\r\n', '\n');
test('catalog pins the exact forward candidate, without editing old migrations', () => {
  const manifest = JSON.parse(readFileSync('supabase/migration-archive/floor-v3-catalog-reconciliation.manifest.json', 'utf8'));
  const row = manifest.ownerGatedActiveAllowlist.find(item => item.filename === name);
  assert.equal(row.version, '20270128000066');
  assert.equal(row.sha256, createHash('sha256').update(sql).digest('hex'));
});
test('old walk-in writer is retired, not delegated to an inferred session', () => {
  const old = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.floor_assign_player_to_seat('));
  assert.match(old, /EXACT_SESSION_REQUIRED/);
  assert.doesNotMatch(old, /INSERT INTO|UPDATE public|RETURN public\.floor_add_manual_player/);
});
test('internal assignment mutex cannot be selected by the public retry key', () => {
  assert.match(sql, /inner_key:=gen_random_uuid\(\);\s*result:=public\.floor_assign_entry_to_seat\(entry_uuid,tt\.id,p_seat_number,p_expected_revision,inner_key\)/);
  assert.doesNotMatch(sql, /floor_assign_entry_to_seat\(entry_uuid[^;]+p_request_id\)/);
});
test('new APIs keep exact authenticated grants and empty search paths', () => {
  for (const signature of [
    'floor_add_manual_player_v1(uuid,text,uuid,integer,uuid,bigint,bigint,uuid,uuid)',
    'get_floor_manual_player_receipt_v1(uuid,uuid,uuid)',
  ]) {
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`));
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature}`));
  }
  assert.doesNotMatch(sql, /GRANT[^;]+TO (?:anon|service_role|PUBLIC)/);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path=''/g) ?? []).length, 3);
});
test('implementation preserves scoped receipt and nested rollback boundaries', () => {
  assert.match(sql, /sess\.revision IS DISTINCT FROM p_expected_revision/);
  assert.match(sql, /sess\.control_epoch IS DISTINCT FROM p_expected_control_epoch/);
  assert.match(sql, /table_session_id=sess\.id AND status='active'/);
  assert.match(sql, /q\.source_table_session_id=sess\.id AND q\.status='pending'/);
  assert.match(sql, /'source_moves_pending'/);
  assert.match(sql, /request_fingerprint IS DISTINCT FROM payload::text/);
  assert.match(sql, /RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='manual_player_core_rejected'/);
  assert.match(sql, /IF SQLERRM<>'manual_player_core_rejected' THEN RAISE/);
  assert.doesNotMatch(sql, /INSERT INTO public\.(?:cashier_money_movements|chip_bank_ledger|dealer_attendance)|net\.http|pg_net|telegram/);
});
