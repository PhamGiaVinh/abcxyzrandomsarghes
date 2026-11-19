import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dealNextHand } from '../../supabase/functions/_shared/pokerRuntime/dealNextHand.ts';
import { applyAction, createHand, forcedTimeoutAction, shuffledDeck } from '../../supabase/functions/_shared/pokerEngine/index.ts';
import { actionToRow, deserializeAuthoritative, ENGINE_VERSION, serializeAuthoritative } from '../../supabase/functions/_shared/pokerAdapter/index.ts';

const tableId = 'ab510000-0000-4000-8000-000000000001';
const first = 'ab510000-0000-4000-8000-000000000002';
const second = 'ab510000-0000-4000-8000-000000000003';
const spectator = 'ab510000-0000-4000-8000-000000000013';

function sql(source) {
  const result = spawnSync('psql', ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8', input: source, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function json(source) { return JSON.parse(sql(source)); }
function file(path) { return readFileSync(new URL(path, import.meta.url), 'utf8'); }

function session(name) {
  const child = spawn('psql', ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
    env: { ...process.env, PGAPPNAME: name, PGOPTIONS: '-c statement_timeout=8000' },
    stdio: 'pipe',
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', part => { stdout += part; });
  child.stderr.setEncoding('utf8').on('data', part => { stderr += part; });
  const closed = new Promise(resolve => child.on('close', resolve));
  return {
    send: statement => child.stdin.write(statement + '\n'),
    async waitFor(marker) {
      for (let n = 0; n < 100 && !stdout.includes(marker); n++) await delay(40);
      assert.ok(stdout.includes(marker), stderr);
    },
    async finish() {
      child.stdin.end();
      assert.equal(await closed, 0, stderr);
      return stdout.trim().split(/\r?\n/);
    },
    stop: () => child.kill(),
  };
}

// Only recreate the observed function body in this throwaway database.
// Archived migration files are never replayed as migrations.
function archivedFunction(name, path, group = 'legacy-unapplied') {
  const start = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const source = file(`../../supabase/migration-archive/${group}/${path}`).replace(/\r\n/g, '\n');
  const offset = source.indexOf(start);
  assert.ok(offset >= 0);
  const end = source.indexOf('$$;', source.indexOf('AS $$', offset) + 5);
  assert.ok(end > offset);
  return source.slice(offset, end + 3);
}

async function waitForPostgresLock(name) {
  assert.match(name, /^g03-[a-z-]+$/);
  for (let n = 0; n < 40; n++) {
    if (sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name='${name}' AND wait_event_type='Lock')`) === 't') return;
    await delay(50);
  }
  assert.fail('Second connection must actually be blocked on the first transaction');
}

function startStatement(args) {
  const payload = Buffer.from(JSON.stringify(args)).toString('hex');
  return `
    SET ROLE service_role;
    WITH input AS (SELECT convert_from(decode('${payload}','hex'),'UTF8')::jsonb AS p)
    SELECT public.op_start_hand(p->'p_state', p->'p_deck', p->'p_board_future', p->'p_holes',
      p->'p_events', p->>'p_engine_version', (p->>'p_act_deadline')::timestamptz,
      (p->>'p_actor_user_id')::uuid) FROM input;
  `;
}

test('the shared server deal persists one native hand with consistent public and private state', async () => {
  assert.equal(process.env.PGHOST, '127.0.0.1');
  const realtimeFixture = process.env.POKER_ISOLATED_REALTIME_STATUS;
  const database = realtimeFixture ? 'postgres' : 'online_poker_runtime_ci';
  assert.equal(process.env.PGDATABASE, database);
  assert.equal(sql('SELECT current_database()'), database);
  if (realtimeFixture) {
    assert.equal(process.env.PGPORT, '54322');
    assert.equal(sql("SELECT to_regnamespace('realtime') IS NOT NULL"), 't');
  }
  assert.equal(sql("SELECT to_regclass('public.online_poker_tables') IS NULL"), 't');
  sql(`
    ${realtimeFixture ? '' : `
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    `}
    CREATE TABLE public.clubs(id uuid PRIMARY KEY);
    CREATE TYPE public.app_role AS ENUM ('super_admin');
    CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    ${file('../../supabase/migrations/20260817000000_online_poker_core.sql')}
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
      END IF;
    END $$;
    ${file('../../supabase/migrations/20260817000001_online_poker_realtime.sql')}
    ${file('../../supabase/migrations/20260820000000_online_poker_runtime_rpcs.sql')}
    GRANT SELECT ON public.online_poker_actions TO service_role;
    GRANT SELECT ON public.online_poker_hands, public.online_poker_hand_seats,
      public.online_poker_hand_events TO anon, authenticated;
    GRANT SELECT ON public.online_poker_hand_secrets TO authenticated;
    ${archivedFunction('op_submit_action', '20260907000000_op_submit_action_settlement_seat_writeback.sql')}
    ${archivedFunction('op_stand_up', '20260908000000_op_stand_up_block_folded_midhand.sql')}
    ${archivedFunction('op_close_table_if_empty', '20261002000000_op_auto_close_empty_table.sql', 'historical-never-replay')}
    CREATE TRIGGER trg_op_close_empty AFTER UPDATE OF user_id ON public.online_poker_seats
    FOR EACH ROW WHEN (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL)
    EXECUTE FUNCTION public.op_close_table_if_empty();
    INSERT INTO auth.users VALUES ('${first}'), ('${second}'), ('${spectator}');
    INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
    VALUES ('${tableId}','Disposable TEST',5,10,0,1000,100);
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status)
    VALUES ('${tableId}',2,'${first}',100,'sitting'), ('${tableId}',5,'${second}',100,'sitting');
  `);
  assert.deepEqual(json(`
    SELECT json_object_agg(proname, md5(prosrc))
    FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('op_start_hand','op_submit_action','op_stand_up','op_close_table_if_empty','op_get_my_hole_cards')
  `), {
    op_start_hand: '10282a2bb252d87125652c048de5d502',
    op_submit_action: 'b0dd7ff7cd2d70b84198d35de5f14f6e',
    op_stand_up: '140a23e7260f0d70a11c097c7986061f',
    op_close_table_if_empty: '905b8fbbdbf57aa27598e51027a64b52',
    op_get_my_hole_cards: 'f950e9a194084a44cfbc13e23783e129',
  });
  sql(file('../../supabase/pending-migrations/20261119193713_online_poker_complete_deal_stack_writeback.sql'));
  const anteMigration = file('../../supabase/pending-migrations/20261119203153_online_poker_bba_state_fence.sql');
  const anteRollback = file('../../supabase/pending-migrations/ROLLBACK_20261119203153_online_poker_bba_state_fence.sql');
  sql(anteMigration);

  const registration = spawnSync('git', ['show',
    '6a1e68f9601d4830eae3120577a9c76b98bcb26a:VinPoker/supabase/pending-migrations/20261119143438_online_satellite_pilot_registration.sql'],
  { encoding: 'utf8' });
  assert.equal(registration.status, 0, registration.stderr);
  sql(`
    ALTER TABLE public.clubs ADD COLUMN owner_id uuid REFERENCES auth.users(id);
    CREATE TABLE public.tournaments(id uuid PRIMARY KEY, club_id uuid REFERENCES public.clubs(id), name text);
    CREATE TABLE public.club_floors(club_id uuid, user_id uuid);
    CREATE TABLE public.club_members(club_id uuid, player_user_id uuid);
    ${registration.stdout}
  `);
  sql(file('../../supabase/pending-migrations/20261119204101_online_satellite_deal_levels.sql'));
  sql(file('../../supabase/pending-migrations/20261119204315_online_satellite_deal_commit_fence.sql'));
  sql(file('../../supabase/pending-migrations/20261119204831_online_satellite_private_table_reads.sql'));
  sql(`GRANT SELECT ON public.online_poker_tables, public.online_poker_seats,
    public.online_poker_hand_snapshots TO anon, authenticated`);
  const level = (id = tableId, actor = null) => {
    assert.match(id, /^[0-9a-f-]{36}$/);
    if (actor !== null) assert.match(actor, /^[0-9a-f-]{36}$/);
    return json(`SET ROLE service_role; SELECT public.op_read_satellite_deal_level('${id}',${actor ? `'${actor}'` : 'NULL'})`);
  };
  assert.deepEqual(level(), { mode: 'practice' });
  const clubId = 'ab510000-0000-4000-8000-000000000016';
  const pilotId = 'ab510000-0000-4000-8000-000000000017';
  const destination = 'ab510000-0000-4000-8000-000000000018';
  sql(`
    INSERT INTO public.clubs(id,owner_id) VALUES ('${clubId}','${first}');
    INSERT INTO public.tournaments VALUES ('${destination}','${clubId}','Disposable ticket target');
    INSERT INTO online_satellite_private.pilots VALUES
      ('${pilotId}','${clubId}','${destination}','${first}','${pilotId}',now(),100,2);
    INSERT INTO online_satellite_private.table_clocks(table_id,pilot_id) VALUES ('${tableId}','${pilotId}');
    INSERT INTO online_satellite_private.blind_levels VALUES
      ('${pilotId}',0,5,10,0), ('${pilotId}',60,10,20,20);
  `);
  assert.deepEqual(level(), { mode: 'unavailable' });
  sql(`UPDATE public.online_poker_tables SET club_id='${clubId}' WHERE id='${tableId}'`);
  assert.deepEqual(level(), { mode: 'paused' });
  const atBoundary = (elapsed) => json(`
    WITH tick AS (
      UPDATE online_satellite_private.table_clocks
      SET elapsed_seconds=${elapsed}, running_since=statement_timestamp() WHERE table_id='${tableId}'
      RETURNING 1
    ) SELECT count(*) FROM tick;
  `);
  assert.equal(atBoundary(10), 1);
  assert.deepEqual(level(), { mode: 'ready', clockRevision: '1', levelStartSecond: '0', sb: '5', bb: '10', bigBlindAnte: '0' });
  assert.equal(atBoundary(60), 1);
  assert.deepEqual(level(), { mode: 'ready', clockRevision: '1', levelStartSecond: '60', sb: '10', bb: '20', bigBlindAnte: '20' });
  assert.throws(() => sql(`SET ROLE authenticated; SELECT public.op_read_satellite_deal_level('${tableId}')`), /permission denied/);
  sql(`DELETE FROM online_satellite_private.table_clocks WHERE table_id='${tableId}';
    UPDATE public.online_poker_tables SET club_id=NULL WHERE id='${tableId}'`);
  sql(`UPDATE public.online_poker_tables SET is_satellite=true WHERE id='${tableId}'`);
  assert.deepEqual(level(), { mode: 'unavailable' });
  assert.equal(sql(`SET ROLE anon; SELECT count(*) FROM public.online_poker_tables WHERE id='${tableId}'`), '0');
  sql(`UPDATE public.online_poker_tables SET is_satellite=false WHERE id='${tableId}'`);
  sql(file('../../supabase/pending-migrations/20261119205002_online_satellite_seat_ownership_fence.sql'));
  sql(file('../../supabase/pending-migrations/20261119205132_online_satellite_provision_table.sql'));
  sql(file('../../supabase/pending-migrations/20261119205447_online_satellite_set_clock.sql'));
  const setupPilot = 'ab510000-0000-4000-8000-000000000019';
  sql(`
    INSERT INTO online_satellite_private.registration_gate(club_id,enabled) VALUES ('${clubId}',true);
    INSERT INTO online_satellite_private.pilots VALUES
      ('${setupPilot}','${clubId}','${destination}','${first}','${setupPilot}',now(),140,2);
    INSERT INTO online_satellite_private.entries(pilot_id,player_user_id,registered_at) VALUES
      ('${setupPilot}','${first}',now()-interval '2 seconds'), ('${setupPilot}','${second}',now()-interval '1 second');
  `);
  const setup = (actor) => `SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT public.provision_online_satellite_table_v1('${setupPilot}',
      '[{"starts_at_second":0,"small_blind":5,"big_blind":10,"big_blind_ante":0},
        {"starts_at_second":60,"small_blind":10,"big_blind":20,"big_blind_ante":20}]')`;
  assert.deepEqual(json(`SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
    SELECT public.get_online_satellite_table_v1('${setupPilot}')`), {
    tableId: null, clockRevision: null, running: false, status: 'unprovisioned',
    canManage: true, canPlay: true, canProvision: true,
  });
  assert.throws(() => sql(setup(spectator)), /SATELLITE_PILOT_MANAGER_REQUIRED/);
  const setupReceipt = json(setup(first));
  assert.equal(setupReceipt.idempotent, false);
  assert.deepEqual(json(setup(first)), { tableId: setupReceipt.tableId, idempotent: true });
  assert.deepEqual(json(`SELECT json_agg(json_build_array(user_id,stack) ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${setupReceipt.tableId}'`), [[first,140], [second,140]]);
  assert.deepEqual(level(setupReceipt.tableId), { mode: 'paused' });
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_chip_ledger WHERE table_id='${setupReceipt.tableId}'`), '0');
  sql(anteRollback);
  assert.equal(sql("SELECT to_regprocedure('public.op_preserve_bba_hand_state()') IS NULL"), 't');
  sql(anteMigration);

  const admin = {
    from(table) {
      let id;
      const read = () => {
        assert.match(id, /^[0-9a-f-]{36}$/);
        const reads = {
          online_poker_tables: `SELECT row_to_json(t) FROM public.online_poker_tables t WHERE id='${id}'`,
          online_poker_seats: `SELECT json_agg(s) FROM public.online_poker_seats s WHERE table_id='${id}'`,
          online_poker_hands: `SELECT COALESCE((SELECT json_build_object('hand_no',hand_no,'button_seat',button_seat)
            FROM public.online_poker_hands WHERE table_id='${id}' ORDER BY hand_no DESC LIMIT 1),'null'::json)`,
        };
        assert.ok(Object.hasOwn(reads, table));
        return { data: json(reads[table]), error: null };
      };
      const query = {
        select: () => query, order: () => query, limit: () => query,
        eq(column, value) {
          assert.equal(column, table === 'online_poker_tables' ? 'id' : 'table_id');
          id = value;
          return query;
        },
        maybeSingle: async () => read(),
        then: resolve => resolve(read()),
      };
      return query;
    },
    async rpc(name, args) {
      if (name === 'op_read_satellite_deal_level') return { data: level(args.p_table_id, args.p_actor_user_id), error: null };
      assert.equal(name, 'op_start_hand');
      const data = json(startStatement(args));
      return { data, error: null };
    },
  };
  assert.equal((await dealNextHand(admin, tableId, first)).reason, 'disabled');
  assert.equal(sql('SELECT count(*) FROM public.online_poker_hands'), '0');
  sql('UPDATE public.online_poker_config SET enabled=true');
  const clockCommand = (actor, pilot, revision, running) => json(`SET ROLE authenticated;
    SET request.jwt.claim.sub='${actor}';
    SELECT public.set_online_satellite_clock_v1('${pilot}',${revision},${running})`);
  assert.throws(() => clockCommand(spectator, setupPilot, 1, true), /SATELLITE_PILOT_MANAGER_REQUIRED/);
  assert.deepEqual(clockCommand(first, setupPilot, 1, true), { outcome: 'ok', revision: '2', running: true });
  assert.deepEqual(clockCommand(first, setupPilot, 1, false), { outcome: 'stale', revision: '2', running: true });
  assert.deepEqual(clockCommand(first, setupPilot, 2, false), { outcome: 'ok', revision: '3', running: false });
  assert.equal((await dealNextHand(admin, setupReceipt.tableId, null)).reason, 'table_not_open');
  const hand = await dealNextHand(admin, tableId, first);
  assert.ok(hand.ok, JSON.stringify(hand));
  assert.equal(hand.handNo, 1);
  assert.equal(hand.buttonSeat, 2);
  assert.equal((await dealNextHand(admin, tableId, null)).reason, 'already_active');
  const state = json(`
    SELECT json_build_object('count',count(*),'pot',max(pot),'publicSecret',
      bool_or(state ? 'deck' OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(state->'seats') s WHERE s ? 'holeCards')))
    FROM public.online_poker_hands;
  `);
  assert.deepEqual(state, { count: 1, pot: 15, publicSecret: false });
  assert.equal(sql("SELECT count(*) FROM public.online_poker_hand_secrets"), '4');
  const holeView = actor => json(`
    SET request.jwt.claim.sub='${actor}'; SET ROLE authenticated;
    SELECT public.op_get_my_hole_cards('${hand.handId}')
  `);
  const ownA = holeView(first);
  const ownB = holeView(second);
  assert.equal(ownA.outcome, 'ok');
  assert.equal(ownA.seat, 2);
  assert.equal(ownB.outcome, 'ok');
  assert.equal(ownB.seat, 5);
  assert.equal(ownA.cards.length, 2);
  assert.equal(ownB.cards.length, 2);
  assert.equal(new Set([...ownA.cards, ...ownB.cards].map(card => JSON.stringify(card))).size, 4,
    'Each player sees only the two cards of their own seat');
  assert.deepEqual(holeView(spectator), { outcome: 'not_seated' });
  assert.equal(sql(`SET request.jwt.claim.sub='${first}'; SET ROLE authenticated;
    SELECT count(*) FROM public.online_poker_hand_secrets`), '0');
  assert.equal(sql("SELECT has_function_privilege('anon','public.op_get_my_hole_cards(uuid)','EXECUTE')"), 'f');
  const publicRows = json(`
    SET ROLE anon;
    SELECT json_build_object('state',h.state,'seats',
      (SELECT jsonb_agg(to_jsonb(s)) FROM public.online_poker_hand_seats s WHERE s.hand_id=h.id),
      'events',(SELECT jsonb_agg(e.payload) FROM public.online_poker_hand_events e WHERE e.hand_id=h.id))
    FROM public.online_poker_hands h WHERE h.id='${hand.handId}'
  `);
  assert.equal(publicRows.seats.length, 2);
  assert.ok(publicRows.events.length > 0);
  assert.ok(publicRows.seats.every(row => row.revealed_cards === null));
  assert.doesNotMatch(JSON.stringify(publicRows), /"(?:cards|holeCards|deck|board_future|server_seed)"\s*:/);
  assert.equal(sql(`SELECT string_agg(tablename,',' ORDER BY tablename)
    FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'
      AND tablename LIKE 'online_poker_%'`),
  'online_poker_hand_seats,online_poker_hands,online_poker_seats');
  assert.equal(sql("SELECT sum(stack+total_committed) FROM public.online_poker_hand_seats"), '200');
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.op_start_hand(jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,uuid)','EXECUTE')"), 'f');
  const standDuringHand = json(`
    SET request.jwt.claim.sub='${first}'; SET ROLE authenticated;
    SELECT public.op_stand_up('${tableId}', 'disposable-g03-stand-blocked');
  `);
  assert.equal(standDuringHand.outcome, 'in_active_hand');
  assert.equal(sql('SELECT count(*) FROM public.online_poker_chip_ledger'), '0');

  const context = json(`SET ROLE service_role; SELECT public.op_load_action_context('${hand.handId}')`);
  assert.equal(context.outcome, 'ok');
  const before = deserializeAuthoritative(context.state, context.live_deck, context.holes);
  const action = { type: 'fold', seat: 2 };
  assert.equal(before.toAct, action.seat);
  const folded = applyAction(before, action);
  assert.equal(folded.error, undefined);
  assert.equal(folded.state.status, 'complete');
  const split = serializeAuthoritative(folded.state);
  const args = {
    action: actionToRow(action),
    state: split.stateJson,
    liveDeck: split.liveDeck,
    events: folded.events.map(({ type, payload }) => ({ type, payload })),
  };
  const payload = Buffer.from(JSON.stringify(args)).toString('hex');
  const submit = () => json(`
    SET ROLE service_role;
    WITH input AS (SELECT convert_from(decode('${payload}','hex'),'UTF8')::jsonb AS p)
    SELECT public.op_submit_action('${hand.handId}', '${first}', p->'action', p->'state',
      p->'liveDeck', p->'events', 0, NULL, 'disposable-g03-fold-retry') FROM input;
  `);
  const receipt = submit();
  assert.equal(receipt.outcome, 'ok');
  assert.equal(receipt.state_version, 1);
  assert.deepEqual(submit(), receipt);
  assert.equal(sql('SELECT count(*) FROM public.online_poker_actions'), '1');
  assert.equal(sql("SELECT string_agg(stack::text,',' ORDER BY seat_no) FROM public.online_poker_hand_seats"), '95,105');
  const next = await dealNextHand(admin, tableId, null);
  assert.ok(next.ok, JSON.stringify(next));
  assert.equal(next.handNo, 2);
  assert.equal(next.buttonSeat, 5);
  assert.equal(
    sql(`SELECT string_agg(starting_stack::text,',' ORDER BY seat_no)
      FROM public.online_poker_hand_seats WHERE hand_id='${next.handId}'`),
    '95,105',
    'The following hand must start from the previous hand’s terminal stacks',
  );

  const shortTable = 'ab510000-0000-4000-8000-000000000004';
  const shortHand = 'ab510000-0000-4000-8000-000000000005';
  sql(`
    INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
    VALUES ('${shortTable}','Disposable blind all-in TEST',5,10,0,1000,10);
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status)
    VALUES ('${shortTable}',2,'${first}',5,'sitting'), ('${shortTable}',5,'${second}',10,'sitting');
  `);
  let seed = 1977;
  const deck = shuffledDeck(() => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const allIn = createHand({
    handId: shortHand, tableId: shortTable, handNo: 1, buttonSeat: 2, sb: 5n, bb: 10n,
  }, [...deck], [{ seat: 2, playerId: first, stack: 5n }, { seat: 5, playerId: second, stack: 10n }]);
  assert.equal(allIn.error, undefined);
  assert.equal(allIn.state.status, 'complete');
  assert.deepEqual(allIn.state.seats.map(seat => seat.stack), [0n, 15n]);
  const terminal = serializeAuthoritative(allIn.state);
  const allInArgs = {
    p_state: terminal.stateJson, p_deck: deck, p_board_future: terminal.liveDeck,
    p_holes: terminal.holes, p_events: allIn.events.map(({ type, payload }) => ({ type, payload })),
    p_engine_version: ENGINE_VERSION, p_act_deadline: null, p_actor_user_id: null,
  };
  const startAllIn = () => admin.rpc('op_start_hand', allInArgs);
  sql(`UPDATE public.online_poker_tables SET status='paused' WHERE id='${shortTable}'`);
  assert.equal((await startAllIn()).data.detail, 'stale table configuration');
  sql(`UPDATE public.online_poker_tables SET status='open',bb=15 WHERE id='${shortTable}'`);
  assert.equal((await startAllIn()).data.detail, 'stale table configuration');
  sql(`UPDATE public.online_poker_tables SET bb=10 WHERE id='${shortTable}'`);
  sql(`UPDATE public.online_poker_seats SET stack=11 WHERE table_id='${shortTable}' AND seat_no=5`);
  assert.equal((await startAllIn()).data.detail, 'stale seat roster');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE id='${shortHand}'`), '0');
  assert.equal(sql(`SELECT string_agg(stack::text,',' ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${shortTable}'`), '5,11');
  sql(`UPDATE public.online_poker_seats SET stack=10 WHERE table_id='${shortTable}' AND seat_no=5`);
  const leader = session('g03-terminal-leader');
  const follower = session('g03-terminal-follower');
  try {
    leader.send(`BEGIN;
      SELECT 1 FROM public.online_poker_seats WHERE table_id='${shortTable}' ORDER BY seat_no FOR UPDATE;
      \\echo leader_has_seats`);
    await leader.waitFor('leader_has_seats');
    follower.send(startStatement(allInArgs));
    await waitForPostgresLock('g03-terminal-follower');
    leader.send(startStatement(allInArgs) + '\nCOMMIT;');
    const [winner, duplicate] = await Promise.all([leader.finish(), follower.finish()]);
    assert.equal(JSON.parse(winner.at(-1)).outcome, 'ok');
    assert.equal(JSON.parse(duplicate.at(-1)).detail, 'stale hand sequence');
  } finally {
    leader.stop();
    follower.stop();
  }
  assert.equal(sql(`SELECT status FROM public.online_poker_hands WHERE id='${shortHand}'`), 'complete');
  assert.equal(sql(`SELECT string_agg(stack::text,',' ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${shortTable}'`), '0,15',
    'An immediately complete deal must also persist its terminal stacks');
  assert.equal((await startAllIn()).data.detail, 'stale hand sequence');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE table_id='${shortTable}'`), '1');

  const closingTable = 'ab510000-0000-4000-8000-000000000006';
  const closingHand = 'ab510000-0000-4000-8000-000000000007';
  sql(`
    INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
    VALUES ('${closingTable}','Disposable close overlap TEST',5,10,0,1000,10);
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status)
    VALUES ('${closingTable}',2,'${first}',5,'sitting'), ('${closingTable}',5,'${second}',10,'sitting');
  `);
  const closingArgs = {
    ...allInArgs,
    p_state: { ...allInArgs.p_state, config: { ...allInArgs.p_state.config, tableId: closingTable, handId: closingHand } },
  };
  const leaver = session('g03-terminal-leaver');
  const staleDeal = session('g03-close-stale-deal');
  try {
    leaver.send(`BEGIN;
      SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
      SELECT public.op_stand_up('${closingTable}', 'disposable-g03-close-first');
      SET request.jwt.claim.sub='${second}';
      SELECT public.op_stand_up('${closingTable}', 'disposable-g03-close-second');
      \\echo standups_uncommitted`);
    await leaver.waitFor('standups_uncommitted');
    staleDeal.send(startStatement(closingArgs));
    await waitForPostgresLock('g03-close-stale-deal');
    leaver.send('COMMIT;');
    const [standups, denied] = await Promise.all([leaver.finish(), staleDeal.finish()]);
    assert.deepEqual(standups.slice(0, 2).map(line => JSON.parse(line).outcome), ['ok', 'ok']);
    assert.equal(JSON.parse(denied.at(-1)).detail, 'stale table configuration');
  } finally {
    leaver.stop();
    staleDeal.stop();
  }
  assert.equal(sql(`SELECT status FROM public.online_poker_tables WHERE id='${closingTable}'`), 'closed');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE table_id='${closingTable}'`), '0');
  assert.equal(sql(`SELECT sum(amount) FROM public.online_poker_chip_ledger WHERE table_id='${closingTable}'`), '15');

  const pausedTable = 'ab510000-0000-4000-8000-000000000008';
  const pausedHand = 'ab510000-0000-4000-8000-000000000009';
  sql(`
    INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
    VALUES ('${pausedTable}','Disposable ordinary deal pause TEST',5,10,0,1000,100);
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status)
    VALUES ('${pausedTable}',2,'${first}',100,'sitting'), ('${pausedTable}',5,'${second}',100,'sitting');
  `);
  const ordinary = createHand({
    handId: pausedHand, tableId: pausedTable, handNo: 1, buttonSeat: 2, sb: 5n, bb: 10n,
  }, [...deck], [{ seat: 2, playerId: first, stack: 100n }, { seat: 5, playerId: second, stack: 100n }]);
  assert.equal(ordinary.error, undefined);
  assert.equal(ordinary.state.status, 'betting');
  const ordinaryState = serializeAuthoritative(ordinary.state);
  const ordinaryArgs = {
    p_state: ordinaryState.stateJson, p_deck: deck, p_board_future: ordinaryState.liveDeck,
    p_holes: ordinaryState.holes, p_events: ordinary.events.map(({type, payload}) => ({type, payload})),
    p_engine_version: ENGINE_VERSION, p_act_deadline: '2030-01-01T12:00:00Z', p_actor_user_id: null,
  };
  sql(`UPDATE public.online_poker_tables SET status='paused' WHERE id='${pausedTable}'`);
  const paused = await admin.rpc('op_start_hand', ordinaryArgs);
  assert.equal(paused.data.outcome, 'rejected', 'A prepared regular deal must not start after a pause commits');
  sql(`UPDATE public.online_poker_tables SET status='open',bb=15 WHERE id='${pausedTable}'`);
  assert.equal((await admin.rpc('op_start_hand', ordinaryArgs)).data.detail, 'stale table configuration');
  sql(`UPDATE public.online_poker_tables SET bb=10 WHERE id='${pausedTable}'`);
  sql(`UPDATE public.online_poker_seats SET status='sitting_out' WHERE table_id='${pausedTable}' AND seat_no=5`);
  assert.equal((await admin.rpc('op_start_hand', ordinaryArgs)).data.detail, 'stale seat roster');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE table_id='${pausedTable}'`), '0');
  sql(`UPDATE public.online_poker_seats SET status='sitting' WHERE table_id='${pausedTable}' AND seat_no=5`);
  // A positive stack with no owner is inconsistent. Preserve it for reconciliation
  // and reject the deal rather than treating the chips as available or as zero.
  sql(`INSERT INTO public.online_poker_seats(table_id,seat_no,stack,status)
    VALUES ('${pausedTable}',7,25,'sitting')`);
  assert.equal((await admin.rpc('op_start_hand', ordinaryArgs)).data.detail, 'stale seat roster');
  assert.equal(sql(`SELECT stack FROM public.online_poker_seats WHERE table_id='${pausedTable}' AND seat_no=7`), '25');
  const third = 'ab510000-0000-4000-8000-000000000010';
  sql(`INSERT INTO auth.users VALUES ('${third}');
    UPDATE public.online_poker_seats SET user_id='${third}'
    WHERE table_id='${pausedTable}' AND seat_no=7`);
  assert.equal((await admin.rpc('op_start_hand', ordinaryArgs)).data.detail, 'stale seat roster');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE table_id='${pausedTable}'`), '0');
  sql(`UPDATE public.online_poker_seats SET status='sitting_out' WHERE table_id='${pausedTable}' AND seat_no=7`);
  assert.equal((await admin.rpc('op_start_hand', ordinaryArgs)).data.outcome, 'ok');

  const sweep = () => json('SET ROLE service_role; SELECT public.op_timeout_sweep()');
  assert.ok(!sweep().hands.some(item => item.hand_id === pausedHand));
  sql(`UPDATE public.online_poker_hands SET act_deadline=now()-interval '5 seconds' WHERE id='${pausedHand}'`);
  const overdue = sweep().hands.find(item => item.hand_id === pausedHand);
  assert.equal(overdue.state_version, 0);
  const overdueContext = json(`SET ROLE service_role; SELECT public.op_load_action_context('${pausedHand}')`);
  const overdueState = deserializeAuthoritative(overdueContext.state, overdueContext.live_deck, overdueContext.holes);
  assert.equal(overdueState.toAct, 2);
  const forced = forcedTimeoutAction(overdueState, overdueState.toAct);
  assert.equal(forced.type, 'fold');
  const timedOut = applyAction(overdueState, forced);
  assert.equal(timedOut.error, undefined);
  const timedOutState = serializeAuthoritative(timedOut.state);
  const timeoutPayload = Buffer.from(JSON.stringify({
    action: actionToRow(forced), state: timedOutState.stateJson, liveDeck: timedOutState.liveDeck,
    events: timedOut.events.map(({ type, payload }) => ({ type, payload })),
  })).toString('hex');
  const commitTimeout = () => json(`
    SET ROLE service_role;
    WITH input AS (SELECT convert_from(decode('${timeoutPayload}','hex'),'UTF8')::jsonb AS p)
    SELECT public.op_submit_action('${pausedHand}', '${first}', p->'action', p->'state',
      p->'liveDeck', p->'events', 0, NULL, 'timeout_${pausedHand}_0') FROM input;
  `);
  const timeoutReceipt = commitTimeout();
  assert.equal(timeoutReceipt.outcome, 'ok');
  assert.equal(timeoutReceipt.state_version, 1);
  assert.deepEqual(commitTimeout(), timeoutReceipt);
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_actions WHERE hand_id='${pausedHand}'`), '1');
  assert.equal(sql(`SELECT string_agg(stack::text,',' ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${pausedTable}'`), '95,105,25');
  assert.ok(!sweep().hands.some(item => item.hand_id === pausedHand));
  const sideTable = 'ab510000-0000-4000-8000-000000000011';
  const sideHand = 'ab510000-0000-4000-8000-000000000012';
  const contestants = [
    { seat: 2, playerId: first, stack: 10n },
    { seat: 5, playerId: second, stack: 30n },
    { seat: 7, playerId: third, stack: 50n },
  ];
  sql(`
    INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
    VALUES ('${sideTable}','Disposable side pot TEST',5,10,0,1000,100);
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status)
    VALUES ('${sideTable}',2,'${first}',10,'sitting'), ('${sideTable}',5,'${second}',30,'sitting'),
      ('${sideTable}',7,'${third}',50,'sitting');
  `);
  const sideStart = createHand({
    handId: sideHand, tableId: sideTable, handNo: 1, buttonSeat: 2, sb: 5n, bb: 10n,
  }, [...deck], contestants);
  const sideStartState = serializeAuthoritative(sideStart.state);
  const sideStartReceipt = await admin.rpc('op_start_hand', {
    p_state: sideStartState.stateJson, p_deck: deck, p_board_future: sideStartState.liveDeck,
    p_holes: sideStartState.holes, p_events: sideStart.events.map(({ type, payload }) => ({ type, payload })),
    p_engine_version: ENGINE_VERSION, p_act_deadline: '2030-01-01T12:00:00Z', p_actor_user_id: null,
  });
  assert.equal(sideStartReceipt.data.outcome, 'ok');
  for (const [version, contestant] of contestants.entries()) {
    // Each action reloads only from persisted state and the server-only deck.
    const loaded = json(`SET ROLE service_role; SELECT public.op_load_action_context('${sideHand}')`);
    assert.equal(loaded.state_version, version);
    const state = deserializeAuthoritative(loaded.state, loaded.live_deck, loaded.holes);
    assert.equal(state.toAct, contestant.seat);
    const action = { type: 'allin', seat: contestant.seat };
    const statement = (intent, requestKey) => {
      const applied = applyAction(state, intent);
      assert.equal(applied.error, undefined);
      const split = serializeAuthoritative(applied.state);
      const encoded = Buffer.from(JSON.stringify({
        action: actionToRow(intent), state: split.stateJson, liveDeck: split.liveDeck,
        events: applied.events.map(({ type, payload }) => ({ type, payload })),
      })).toString('hex');
      return `
        SET ROLE service_role;
        WITH input AS (SELECT convert_from(decode('${encoded}','hex'),'UTF8')::jsonb AS p)
        SELECT public.op_submit_action('${sideHand}', '${contestant.playerId}', p->'action', p->'state',
          p->'liveDeck', p->'events', ${version}, NULL, '${requestKey}') FROM input;
      `;
    };
    const playerSubmit = statement(action, `disposable-g03-side-${version}`);
    let receipt;
    if (version === 0) {
      sql(`UPDATE public.online_poker_hands SET act_deadline=now()-interval '5 seconds' WHERE id='${sideHand}'`);
      assert.equal(sweep().hands.find(item => item.hand_id === sideHand).state_version, version);
      const player = session('g03-action-player');
      const timeout = session('g03-action-timeout');
      try {
        player.send('BEGIN;\n' + playerSubmit + '\n\\echo player_action_uncommitted');
        await player.waitFor('player_action_uncommitted');
        timeout.send(statement(forcedTimeoutAction(state, contestant.seat), `timeout_${sideHand}_${version}`));
        await waitForPostgresLock('g03-action-timeout');
        player.send('COMMIT;');
        const [committed, stale] = await Promise.all([player.finish(), timeout.finish()]);
        receipt = JSON.parse(committed[0]);
        const rejected = JSON.parse(stale.at(-1));
        assert.deepEqual(rejected, { outcome: 'race_lost', expected: 0, actual: 1 });
        assert.equal(sql(`SELECT count(*) FROM public.online_poker_actions WHERE hand_id='${sideHand}'`), '1');
        assert.ok(!sweep().hands.some(item => item.hand_id === sideHand));
      } finally {
        player.stop();
        timeout.stop();
      }
    } else {
      receipt = json(playerSubmit);
    }
    assert.equal(receipt.outcome, 'ok');
    assert.equal(receipt.state_version, version + 1);
  }
  const settled = json(`SELECT state FROM public.online_poker_hands WHERE id='${sideHand}'`);
  assert.equal(settled.status, 'complete');
  assert.equal(String(settled.result.potTotal), '70');
  assert.deepEqual(settled.result.payouts, { 5: '70' });
  assert.equal(sql(`SELECT string_agg(stack::text,',' ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${sideTable}'`), '0,70,20');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_actions WHERE hand_id='${sideHand}'`), '3');

  const anteTable = 'ab510000-0000-4000-8000-000000000014';
  const preparedAnteHand = 'ab510000-0000-4000-8000-000000000015';
  sql(`
    INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
    VALUES ('${anteTable}','Disposable BBA TEST',5,10,0,1000,100);
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status)
    VALUES ('${anteTable}',2,'${first}',100,'sitting'), ('${anteTable}',5,'${second}',14,'sitting');
  `);
  const anteDeal = createHand({
    handId: preparedAnteHand, tableId: anteTable, handNo: 1, buttonSeat: 2, sb: 5n, bb: 10n, bigBlindAnte: 10n,
  }, [...deck], [{ seat: 2, playerId: first, stack: 100n }, { seat: 5, playerId: second, stack: 14n }]);
  assert.equal(anteDeal.error, undefined);
  const anteSplit = serializeAuthoritative(anteDeal.state);
  const anteArgs = {
    p_state: anteSplit.stateJson, p_deck: deck, p_board_future: anteSplit.liveDeck,
    p_holes: anteSplit.holes, p_events: anteDeal.events.map(({ type, payload }) => ({ type, payload })),
    p_engine_version: ENGINE_VERSION, p_act_deadline: '2030-01-01T12:00:00Z', p_actor_user_id: null,
  };
  sql(`
    UPDATE public.online_poker_tables SET club_id='${clubId}' WHERE id='${anteTable}';
    INSERT INTO online_satellite_private.blind_levels VALUES ('${pilotId}',120,5,10,10);
    INSERT INTO online_satellite_private.table_clocks(table_id,pilot_id,elapsed_seconds,running_since,revision)
      VALUES ('${anteTable}','${pilotId}',120,statement_timestamp(),2);
  `);
  assert.throws(() => json(startStatement(anteArgs)), /online_satellite_stale_deal_level/);
  const currentAnteArgs = {
    ...anteArgs,
    p_state: { ...anteArgs.p_state, satelliteLevel: { clockRevision: '2', levelStartSecond: '120' } },
  };
  assert.throws(() => json(startStatement(currentAnteArgs)), /online_satellite_deal_roster_invalid/);
  sql(`INSERT INTO online_satellite_private.entries(pilot_id,player_user_id)
    VALUES ('${pilotId}','${first}'), ('${pilotId}','${second}')`);
  const staleAnteArgs = {
    ...currentAnteArgs,
    p_state: { ...currentAnteArgs.p_state, satelliteLevel: { clockRevision: '2', levelStartSecond: '60' } },
  };
  assert.throws(() => json(startStatement(staleAnteArgs)), /online_satellite_stale_deal_level/);
  const clockWriter = session('g03-satellite-clock-writer');
  const waitingDeal = session('g03-satellite-stale-deal');
  try {
    clockWriter.send(`BEGIN;
      UPDATE online_satellite_private.table_clocks SET revision=3 WHERE table_id='${anteTable}';
      \\echo satellite_clock_locked`);
    await clockWriter.waitFor('satellite_clock_locked');
    waitingDeal.send(startStatement(currentAnteArgs));
    await waitForPostgresLock('g03-satellite-stale-deal');
    clockWriter.send('COMMIT;');
    await clockWriter.finish();
    await assert.rejects(waitingDeal.finish(), /online_satellite_stale_deal_level/);
  } finally {
    clockWriter.stop();
    waitingDeal.stop();
  }
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE table_id='${anteTable}'`), '0');
  sql(`UPDATE public.online_poker_tables SET sb=4,bb=8 WHERE id='${anteTable}'`);
  const anteReceipt = await dealNextHand(admin, anteTable, null);
  assert.equal(anteReceipt.ok, true, JSON.stringify(anteReceipt));
  const anteHand = anteReceipt.handId;
  assert.equal(sql(`SELECT state_schema_version FROM public.online_poker_hands WHERE id='${anteHand}'`), '2');
  assert.deepEqual(clockCommand(first, pilotId, 3, false), { outcome: 'ok', revision: '4', running: false });
  const loadedAnte = json(`SET ROLE service_role; SELECT public.op_load_action_context('${anteHand}')`);
  const reloadedAnte = deserializeAuthoritative(loadedAnte.state, loadedAnte.live_deck, loadedAnte.holes);
  const fold = { type: 'fold', seat: 2 };
  const anteSettled = applyAction(reloadedAnte, fold);
  assert.equal(anteSettled.error, undefined);
  const anteFinal = serializeAuthoritative(anteSettled.state);
  const submitAnteFold = (state) => {
    const encoded = Buffer.from(JSON.stringify({
      action: actionToRow(fold), state, liveDeck: anteFinal.liveDeck,
      events: anteSettled.events.map(({ type, payload }) => ({ type, payload })),
    })).toString('hex');
    return `
      SET ROLE service_role;
      WITH input AS (SELECT convert_from(decode('${encoded}','hex'),'UTF8')::jsonb AS p)
      SELECT public.op_submit_action('${anteHand}', '${first}', p->'action', p->'state',
        p->'liveDeck', p->'events', 0, NULL, 'disposable-g03-ante-fold') FROM input;
    `;
  };
  const legacy = structuredClone(anteFinal.stateJson);
  delete legacy.config.bigBlindAnte;
  delete legacy.config.bigBlindAnteSeat;
  for (const seat of legacy.seats) delete seat.deadAnte;
  assert.throws(() => json(submitAnteFold(legacy)), /online_poker_ante_configuration_changed/);
  const duplicateSeat = structuredClone(anteFinal.stateJson);
  duplicateSeat.seats.push(structuredClone(duplicateSeat.seats[0]));
  const encodedDuplicate = Buffer.from(JSON.stringify(duplicateSeat)).toString('hex');
  assert.throws(() => sql(`UPDATE public.online_poker_hands SET
    state=convert_from(decode('${encodedDuplicate}','hex'),'UTF8')::jsonb WHERE id='${anteHand}'`),
  /online_poker_ante_seat_invalid/);
  const anteSeatStacks = () => sql(`SELECT string_agg(stack::text,',' ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${anteTable}'`);
  assert.equal(anteSeatStacks(), '100,14');
  assert.equal(sql(`SELECT state_version FROM public.online_poker_hands WHERE id='${anteHand}'`), '0');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_actions WHERE hand_id='${anteHand}'`), '0');
  assert.equal(json(submitAnteFold(anteFinal.stateJson)).outcome, 'ok');
  assert.equal(anteSeatStacks(), '95,19');
  assert.throws(() => sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
    SELECT public.op_stand_up('${anteTable}', 'disposable-no-satellite-cashout')`),
  /online_satellite_roster_is_fixed/);
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_chip_ledger
    WHERE idempotency_key='disposable-no-satellite-cashout'`), '0');
  assert.equal(anteSeatStacks(), '95,19');
  assert.throws(() => sql(`DELETE FROM online_satellite_private.table_clocks WHERE table_id='${anteTable}'`),
    /online_satellite_table_binding_is_fixed/);
  assert.deepEqual(json(`SELECT satellite_deal_level FROM public.online_poker_hands WHERE id='${anteHand}'`),
    { clockRevision: '3', levelStartSecond: '120', sb: '5', bb: '10', bigBlindAnte: '10' });
  const visibleSatellite = `SELECT json_build_array(
    (SELECT count(*) FROM public.online_poker_tables WHERE id='${anteTable}'),
    (SELECT count(*) FROM public.online_poker_seats WHERE table_id='${anteTable}'),
    (SELECT count(*) FROM public.online_poker_hands WHERE id='${anteHand}'),
    (SELECT count(*) FROM public.online_poker_hand_seats WHERE hand_id='${anteHand}'),
    (SELECT count(*) FROM public.online_poker_hand_events WHERE hand_id='${anteHand}'),
    (SELECT count(*) FROM public.online_poker_hand_snapshots WHERE hand_id='${anteHand}')
  )`;
  sql(`INSERT INTO public.online_poker_hand_snapshots(hand_id,at_seq,state)
    SELECT id,0,state FROM public.online_poker_hands WHERE id='${anteHand}' ON CONFLICT DO NOTHING`);
  assert.deepEqual(json(`SET ROLE anon; ${visibleSatellite}`), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(json(`SET ROLE authenticated; SET request.jwt.claim.sub='${spectator}'; ${visibleSatellite}`),
    [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(json(`SET ROLE authenticated; SET request.jwt.claim.sub='${first}'; ${visibleSatellite}`),
    json(visibleSatellite));
  assert.throws(() => sql(`DELETE FROM public.online_poker_hands WHERE id='${anteHand}'`),
    /online_satellite_hand_history_is_retained/);
  assert.throws(() => sql(`DELETE FROM public.online_poker_hand_seats WHERE hand_id='${anteHand}'`),
    /online_satellite_hand_history_is_retained/);
  sql(`GRANT SELECT, DELETE ON public.online_poker_hands, public.online_poker_hand_seats TO service_role`);
  assert.throws(() => sql(`SET ROLE service_role; DELETE FROM public.online_poker_hands WHERE id='${anteHand}'`),
    /online_satellite_hand_history_is_retained/);
  assert.deepEqual(JSON.parse(sql(`BEGIN; SET LOCAL ROLE service_role;
    WITH removed AS (DELETE FROM public.online_poker_hand_seats WHERE hand_id='${sideHand}' RETURNING 1)
    SELECT json_build_object('practiceSeatsRemoved',count(*)) FROM removed;
    DELETE FROM public.online_poker_hands WHERE id='${sideHand}';
    ROLLBACK;`)), { practiceSeatsRemoved: 3 });
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE id='${sideHand}'`), '1');
  assert.equal(sql(`SET ROLE anon; SELECT count(*) FROM public.online_poker_tables WHERE id='${tableId}'`), '1');
  assert.equal(sql(`SELECT state->'seats'->1->>'deadAnte' FROM public.online_poker_hands WHERE id='${anteHand}'`), '4');
  assert.deepEqual(clockCommand(first, setupPilot, 3, true), { outcome: 'ok', revision: '4', running: true });
  assert.equal((await dealNextHand(admin, setupReceipt.tableId, spectator)).reason, 'satellite_level_unavailable');
  assert.equal((await dealNextHand(admin, setupReceipt.tableId, second)).reason, 'satellite_level_unavailable');
  const provisionedDeal = await dealNextHand(admin, setupReceipt.tableId, first);
  assert.equal(provisionedDeal.ok, true, JSON.stringify(provisionedDeal));
  assert.deepEqual(clockCommand(first, setupPilot, 4, false), { outcome: 'ok', revision: '5', running: false });
  const reopenSatellite = (actor) => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT COALESCE(public.get_online_satellite_table_v1('${setupPilot}'),'null'::jsonb)`);
  assert.deepEqual(reopenSatellite(first), { tableId: setupReceipt.tableId, clockRevision: '5',
    running: false, status: 'paused', canManage: true, canPlay: true, canProvision: false });
  assert.deepEqual(reopenSatellite(second), { ...reopenSatellite(first), canManage: false });
  assert.equal(reopenSatellite(spectator), null);
  const provisionedContext = json(`SET ROLE service_role;
    SELECT public.op_load_action_context('${provisionedDeal.handId}')`);
  const provisionedState = deserializeAuthoritative(
    provisionedContext.state, provisionedContext.live_deck, provisionedContext.holes,
  );
  assert.equal(provisionedState.toAct, 1);
  const provisionedFold = { type: 'fold', seat: 1 };
  const provisionedSettled = applyAction(provisionedState, provisionedFold);
  assert.equal(provisionedSettled.error, undefined);
  const provisionedSplit = serializeAuthoritative(provisionedSettled.state);
  const provisionedInput = Buffer.from(JSON.stringify({
    action: actionToRow(provisionedFold), state: provisionedSplit.stateJson, deck: provisionedSplit.liveDeck,
    events: provisionedSettled.events.map(({ type, payload }) => ({ type, payload })),
  })).toString('hex');
  const provisionedSubmit = `SET ROLE service_role;
    WITH input AS (SELECT convert_from(decode('${provisionedInput}','hex'),'UTF8')::jsonb AS p)
    SELECT public.op_submit_action('${provisionedDeal.handId}', '${first}', p->'action', p->'state',
      p->'deck', p->'events', 0, NULL, 'disposable-g03-provisioned-fold') FROM input`;
  assert.equal(json(provisionedSubmit).outcome, 'ok');
  assert.equal(json(provisionedSubmit).outcome, 'ok');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_actions WHERE hand_id='${provisionedDeal.handId}'`), '1');
  const provisionedStacks = () => json(`SELECT json_agg(stack ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${setupReceipt.tableId}'`);
  assert.deepEqual(provisionedStacks(), [135,145]);
  const reapPractice = 'ab510000-0000-4000-8000-000000000020';
  const missingBinding = 'ab510000-0000-4000-8000-000000000022';
  sql(`
    ALTER TABLE public.online_poker_tables ADD COLUMN host_user_id uuid REFERENCES auth.users(id);
    ALTER TABLE public.online_poker_seats ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
    ${archivedFunction('op_reap_stale_seats', '20260923000000_online_poker_seat_heartbeat.sql', 'historical-never-replay')}
    REVOKE ALL ON FUNCTION public.op_reap_stale_seats(int) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.op_reap_stale_seats(int) TO service_role;
  `);
  sql(file('../../supabase/pending-migrations/20261119205341_online_satellite_exclude_practice_reaper.sql'));
  sql(`
    INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default,host_user_id)
    VALUES ('${reapPractice}','Disposable practice reaper TEST',5,10,0,1000,100,'${spectator}'),
      ('${missingBinding}','Disposable missing Satellite binding TEST',5,10,0,1000,100,NULL);
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status,joined_at,last_seen_at)
    VALUES ('${reapPractice}',1,'${spectator}',100,'sitting',now()-interval '2 hours',now()-interval '2 hours'),
      ('${missingBinding}',1,'${first}',100,'sitting',now()-interval '2 hours',now()-interval '2 hours');
    UPDATE public.online_poker_tables SET is_satellite=true WHERE id='${missingBinding}';
    UPDATE public.online_poker_seats SET joined_at=now()-interval '2 hours',last_seen_at=now()-interval '2 hours'
    WHERE table_id='${setupReceipt.tableId}';
  `);
  assert.deepEqual(json('SET ROLE service_role; SELECT public.op_reap_stale_seats(3600)'), { outcome: 'ok', reaped: 1 });
  assert.equal(sql(`SELECT status FROM public.online_poker_seats WHERE table_id='${reapPractice}'`), 'empty');
  assert.deepEqual(provisionedStacks(), [135,145]);
  assert.equal(sql(`SELECT stack FROM public.online_poker_seats WHERE table_id='${missingBinding}' AND user_id='${first}'`), '100');
  assert.throws(() => sql(`UPDATE public.online_poker_seats SET user_id=NULL WHERE table_id='${missingBinding}'`),
    /online_satellite_roster_is_fixed/);
  if (realtimeFixture) {
    const { verifySatelliteRealtime } = await import('./satelliteRealtime.fixture.mjs');
    await verifySatelliteRealtime({ sql, statusPath: realtimeFixture, first, spectator,
      practiceHand: sideHand, satelliteHand: provisionedDeal.handId });
  }
  if (process.env.VERIFY_POKER_BROWSER_RETRY === '1') {
    const { verifyBrowserActionRetry } = await import('./browserActionRetry.fixture.mjs');
    await verifyBrowserActionRetry({ sql, actor: second, handId: next.handId, seat: 5 });
    const browserPilot = 'ab510000-0000-4000-8000-000000000021';
    sql(`INSERT INTO online_satellite_private.pilots VALUES
      ('${browserPilot}','${clubId}','${destination}','${first}','${browserPilot}',now(),100,2);
      INSERT INTO online_satellite_private.entries(pilot_id,player_user_id)
      VALUES ('${browserPilot}','${first}'),('${browserPilot}','${second}')`);
    const { verifySatelliteClockBrowser } = await import('./satelliteClockBrowser.fixture.mjs');
    await verifySatelliteClockBrowser({ sql, actor: first, pilot: browserPilot });
    assert.equal(sql("SELECT count(*) FROM public.online_poker_hands WHERE status IN ('dealing','betting')"), '0');
    const rollback = file('../../supabase/pending-migrations/ROLLBACK_20261119193713_online_poker_complete_deal_stack_writeback.sql');
    const startOid = "'public.op_start_hand(jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamp with time zone,uuid)'::regprocedure";
    const functionRecord = () => json(`SELECT json_build_object('source',md5(prosrc),
      'owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,'settings',proconfig,'acl',proacl)
      FROM pg_proc WHERE oid=${startOid}`);
    const candidate = functionRecord();
    assert.equal(candidate.source, '6b55c671fbe0219e1c4331c629e79e06');
    const enabled = spawnSync('psql', ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'],
      { encoding: 'utf8', input: rollback, timeout: 10_000 });
    assert.notEqual(enabled.status, 0);
    assert.match(enabled.stderr, /runtime|disabled and idle/);
    assert.deepEqual(functionRecord(), candidate);

    const storedFacts = () => sql(`SELECT md5(jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.online_poker_hands t),
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.online_poker_seats t),
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY hand_id, seat_no) FROM public.online_poker_hand_seats t),
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY hand_id, event_seq) FROM public.online_poker_hand_events t),
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.online_poker_hand_secrets t),
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.online_poker_actions t),
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.online_poker_chip_ledger t)
    )::text)`);
    const beforeRollback = storedFacts();
    sql('UPDATE public.online_poker_config SET enabled=false');
    assert.throws(() => sql(anteRollback), /version-2 hand history requires the BBA fence and reader/);
    assert.equal(sql("SELECT to_regprocedure('public.op_preserve_bba_hand_state()') IS NOT NULL"), 't');
    assert.equal(storedFacts(), beforeRollback);
    sql(rollback);
    assert.deepEqual(functionRecord(), { ...candidate, source: '10282a2bb252d87125652c048de5d502' });
    assert.equal(storedFacts(), beforeRollback);
    console.log('POSTGRES_POKER_ROLLBACK_PRESERVES_COMMITTED_HANDS_AND_RECEIPTS_PASS');
  }
});
