import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../supabase/migrations/20270128000067_floor_manual_bust_restore_read_v1.sql',import.meta.url),'utf8');
test('forward67 changes only the pinned read seam, preserving immutable chip/entry history and writer guards',()=>{
  for(const text of ['f9b32df63f6d9aa627aa5fbbd2d92d70','1fa4fcae06f56774b40913b83a6b239a',
    '6b2e72c175318f2f91a1a0b55966a1db',"e.source='manual'",'patch_not_unique','postcheck_failed','ROLLBACK']) assert.ok(sql.includes(text),text);
  assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE|DELETE FROM|DROP TABLE|TRUNCATE)\s+public\./i);
  assert.doesNotMatch(sql,/CREATE\s+(?:OR REPLACE\s+)?FUNCTION/i);
  assert.ok(sql.indexOf('manual_restore_reader_postcheck_failed')<sql.lastIndexOf('COMMIT;'));
});
test('runtime covers real public create, bust, display, restore, replay and conflict without a fabricated registration',()=>{
  const testSql=readFileSync(new URL('./manualEntryRestore.currentSchema.sql',import.meta.url),'utf8');
  for(const text of ['floor_add_manual_player_v1','floor_bust_player_v3','get_floor_restorable_entries_v3',
    'floor_restore_busted_player_to_seat_v5','MANUAL_RESTORABLE_ENTRY_MISSING','IDEMPOTENCY_CONFLICT',
    'registration_id IS NULL','chip_count=20000','ROLLBACK;']) assert.ok(testSql.includes(text),text);
});
test('forward68 pins the existing private writer and restores canonical backlinks and current ticket proof atomically',()=>{
  const writer=readFileSync(new URL('../../supabase/migrations/20270128000068_floor_restore_canonical_tuple_v1.sql',import.meta.url),'utf8');
  for(const text of ['c8c66b3a511399fac6e05921a8791d91','ca72a3aa2e2b1681407b6289bd8f4a2a',
    'seat_id = v_new_seat_id','table_id = v_game_table_id','v_destination_table.id, v_busted_seat.player_name',
    'receipt_code','chip_count_at_move','destination_session_id','restore68_postcheck_failed',
    "'{postgres=X/postgres}'"]) assert.ok(writer.includes(text),text);
  assert.ok(writer.indexOf('restore68_postcheck_failed')<writer.lastIndexOf('COMMIT;'));
  assert.doesNotMatch(writer,/GRANT\s|DELETE FROM\s|TRUNCATE\s|DROP TABLE\s/i);
});
