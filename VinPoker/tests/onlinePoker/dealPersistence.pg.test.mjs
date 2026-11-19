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
  assert.match(name, /^g0[34]-[a-z-]+$/);
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

test('the shared server deal persists one native hand with consistent public and private state', async (t) => {
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
    INSERT INTO auth.users(id) VALUES ('${first}'), ('${second}'), ('${spectator}');
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
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.op_read_satellite_deal_level(uuid,uuid)','EXECUTE')"), 'f');
  if (!realtimeFixture) {
    assert.throws(() => sql(`SET ROLE authenticated; SELECT public.op_read_satellite_deal_level('${tableId}')`), /permission denied/);
  }
  sql(`DELETE FROM online_satellite_private.table_clocks WHERE table_id='${tableId}';
    UPDATE public.online_poker_tables SET club_id=NULL WHERE id='${tableId}'`);
  sql(`UPDATE public.online_poker_tables SET is_satellite=true WHERE id='${tableId}'`);
  assert.deepEqual(level(), { mode: 'unavailable' });
  assert.equal(sql(`SET ROLE anon; SELECT count(*) FROM public.online_poker_tables WHERE id='${tableId}'`), '0');
  sql(`UPDATE public.online_poker_tables SET is_satellite=false WHERE id='${tableId}'`);
  sql(file('../../supabase/pending-migrations/20261119205002_online_satellite_seat_ownership_fence.sql'));
  sql(file('../../supabase/pending-migrations/20261119205132_online_satellite_provision_table.sql'));
  sql(file('../../supabase/pending-migrations/20261119205447_online_satellite_set_clock.sql'));
  sql(file('../../supabase/pending-migrations/20261119213644_online_satellite_bubble_evidence.sql'));
  sql(file('../../supabase/pending-migrations/20261119214450_online_satellite_lock_result.sql'));
  sql(file('../../supabase/pending-migrations/20261119215034_online_satellite_issue_test_tickets.sql'));
  sql(file('../../supabase/pending-migrations/20261119215158_online_satellite_redeem_test_ticket.sql'));
  const setupPilot = 'ab510000-0000-4000-8000-000000000019';
  sql(`
    INSERT INTO online_satellite_private.registration_gate(club_id,enabled) VALUES ('${clubId}',true);
    INSERT INTO online_satellite_private.pilots VALUES
      ('${setupPilot}','${clubId}','${destination}','${first}','${setupPilot}',now(),140,2);
    INSERT INTO online_satellite_private.entries(pilot_id,player_user_id,registered_at) VALUES
      ('${setupPilot}','${first}',now()-interval '2 seconds'), ('${setupPilot}','${second}',now()-interval '1 second');
  `);
  const setup = (actor, slots = 1) => `SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT public.provision_online_satellite_table_v1('${setupPilot}',
      '[{"starts_at_second":0,"small_blind":5,"big_blind":10,"big_blind_ante":0},
        {"starts_at_second":60,"small_blind":10,"big_blind":20,"big_blind_ante":20}]',${slots ?? 'NULL'})`;
  assert.deepEqual(json(`SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
    SELECT public.get_online_satellite_table_v1('${setupPilot}')`), {
    tableId: null, clockRevision: null, running: false, status: 'unprovisioned',
    canManage: true, canPlay: true, canProvision: true,
  });
  if (!realtimeFixture) assert.throws(() => sql(setup(spectator)), /SATELLITE_PILOT_MANAGER_REQUIRED/);
  if (!realtimeFixture) {
    assert.throws(() => sql(setup(first, null)), /SATELLITE_PILOT_BAD_QUALIFICATION_SLOTS/);
  }
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
  // The Realtime job validates network delivery through the Supabase image.
  // The separate vanilla PostgreSQL job retains the full SQL/Chromium suite.
  if (realtimeFixture) {
    assert.deepEqual(clockCommand(first, setupPilot, 1, true), { outcome: 'ok', revision: '2', running: true });
    const practice = await dealNextHand(admin, tableId, null);
    const satellite = await dealNextHand(admin, setupReceipt.tableId, first);
    assert.equal(practice.ok, true, JSON.stringify(practice));
    assert.equal(satellite.ok, true, JSON.stringify(satellite));
    const { verifySatelliteRealtime } = await import('./satelliteRealtime.fixture.mjs');
    await verifySatelliteRealtime({ sql, statusPath: realtimeFixture, first, spectator,
      practiceHand: practice.handId, satelliteHand: satellite.handId });
    return;
  }
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
  sql(`INSERT INTO auth.users(id) VALUES ('${third}');
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
  assert.equal(json(startStatement({ ...currentAnteArgs, p_actor_user_id: spectator })).detail,
    'satellite manager required');
  assert.throws(() => json(startStatement(currentAnteArgs)), /online_satellite_deal_roster_invalid/);
  sql(`INSERT INTO online_satellite_private.entries(pilot_id,player_user_id)
    VALUES ('${pilotId}','${first}'), ('${pilotId}','${second}')`);
  const staleAnteArgs = {
    ...currentAnteArgs,
    p_state: { ...currentAnteArgs.p_state, satelliteLevel: { clockRevision: '2', levelStartSecond: '60' } },
  };
  assert.throws(() => json(startStatement(staleAnteArgs)), /online_satellite_stale_deal_level/);
  sql(`UPDATE online_satellite_private.registration_gate SET delegated_td_actor_id='${second}',
    delegated_by='${first}' WHERE club_id='${clubId}';
    INSERT INTO public.club_floors VALUES ('${clubId}','${second}')`);
  assert.equal(level(anteTable, second).mode, 'ready');
  const revokeTd = session('g03-satellite-revoke-td');
  const oldTdDeal = session('g03-satellite-old-td-deal');
  try {
    revokeTd.send(`BEGIN;
      DELETE FROM public.club_floors WHERE club_id='${clubId}' AND user_id='${second}';
      \\echo satellite_td_settling`);
    await revokeTd.waitFor('satellite_td_settling');
    oldTdDeal.send(startStatement({ ...currentAnteArgs, p_actor_user_id: second }));
    await waitForPostgresLock('g03-satellite-old-td-deal');
    revokeTd.send('COMMIT;');
    await revokeTd.finish();
    assert.equal(JSON.parse((await oldTdDeal.finish()).at(-1)).detail, 'satellite manager required');
  } finally {
    revokeTd.stop();
    oldTdDeal.stop();
  }
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
    running: false, status: 'paused', canManage: true, canPlay: true, canProvision: false, qualificationReached: false });
  assert.deepEqual(reopenSatellite(second), { ...reopenSatellite(first), canManage: false });
  assert.equal(reopenSatellite(spectator), null);
  const provisionedContext = json(`SET ROLE service_role;
    SELECT public.op_load_action_context('${provisionedDeal.handId}')`);
  const bubbleEvidence = (actor) => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT COALESCE(public.get_online_satellite_bubble_evidence_v1('${setupPilot}'),'null'::jsonb)`);
  assert.deepEqual(bubbleEvidence(first), {
    handId: provisionedDeal.handId, handNo: '1', stateVersion: 0, status: 'betting',
    survivingCount: null, eliminations: null,
  });
  assert.equal(bubbleEvidence(second), null);
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
  assert.deepEqual(bubbleEvidence(first), {
    handId: provisionedDeal.handId, handNo: '1', stateVersion: 1, status: 'complete',
    survivingCount: 2, eliminations: [],
  });
  sql(`UPDATE public.online_poker_seats SET status='sitting_out'
    WHERE table_id='${setupReceipt.tableId}' AND user_id='${second}'`);
  assert.equal(bubbleEvidence(first).survivingCount, 2, 'A status change cannot rewrite a settled hand');
  sql(`UPDATE public.online_poker_seats SET status='sitting'
    WHERE table_id='${setupReceipt.tableId}' AND user_id='${second}'`);
  async function settleBubble({ bubblePilot, bubbleTable, bubbleHand, slots, overlapNextDeal }) {
    const bubblePlayers = contestants.map(player => ({ ...player, stack: player.seat === 7 ? 30n : player.stack }));
    sql(`
      INSERT INTO online_satellite_private.pilots VALUES
        ('${bubblePilot}','${clubId}','${destination}','${first}','${bubblePilot}',now(),30,3);
      INSERT INTO online_satellite_private.entries(pilot_id,player_user_id) VALUES
        ('${bubblePilot}','${first}'), ('${bubblePilot}','${second}'), ('${bubblePilot}','${third}');
      INSERT INTO public.online_poker_tables(id,club_id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
        VALUES ('${bubbleTable}','${clubId}','Disposable bubble TEST',5,10,0,0,30);
      INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status) VALUES
        ${bubblePlayers.map(player => `('${bubbleTable}',${player.seat},'${player.playerId}',${player.stack},'sitting')`).join(',')};
      INSERT INTO online_satellite_private.blind_levels VALUES ('${bubblePilot}',0,5,10,0);
      INSERT INTO online_satellite_private.table_clocks(table_id,pilot_id,running_since,qualification_slots)
        VALUES ('${bubbleTable}','${bubblePilot}',statement_timestamp(),${slots});
    `);
    const bubbleDeal = createHand({
      handId: bubbleHand, tableId: bubbleTable, handNo: 1, buttonSeat: 2, sb: 5n, bb: 10n,
    }, [...deck], bubblePlayers);
    assert.equal(bubbleDeal.error, undefined);
    const bubbleSplit = serializeAuthoritative(bubbleDeal.state);
    assert.equal(json(startStatement({
      p_state: { ...bubbleSplit.stateJson, satelliteLevel: { clockRevision: '1', levelStartSecond: '0' } },
      p_deck: deck, p_board_future: bubbleSplit.liveDeck, p_holes: bubbleSplit.holes,
      p_events: bubbleDeal.events.map(({ type, payload }) => ({ type, payload })),
      p_engine_version: ENGINE_VERSION, p_act_deadline: '2030-01-01T12:00:00Z', p_actor_user_id: first,
    })).outcome, 'ok');
    for (let version = 0; version < 3; version++) {
      const context = json(`SET ROLE service_role; SELECT public.op_load_action_context('${bubbleHand}')`);
      const state = deserializeAuthoritative(context.state, context.live_deck, context.holes);
      const player = bubblePlayers.find(item => item.seat === state.toAct);
      assert.ok(player);
      const action = { type: 'allin', seat: player.seat };
      const applied = applyAction(state, action);
      assert.equal(applied.error, undefined);
      const split = serializeAuthoritative(applied.state);
      const input = Buffer.from(JSON.stringify({ action: actionToRow(action), state: split.stateJson,
        deck: split.liveDeck, events: applied.events.map(({ type, payload }) => ({ type, payload })) })).toString('hex');
      const submitBubble = `SET ROLE service_role;
        WITH input AS (SELECT convert_from(decode('${input}','hex'),'UTF8')::jsonb AS p)
        SELECT public.op_submit_action('${bubbleHand}', '${player.playerId}', p->'action', p->'state',
          p->'deck', p->'events', ${version}, NULL, 'disposable-g03-bubble-${bubbleHand}-${version}') FROM input;`;
      if (version < 2 || !overlapNextDeal) {
        assert.equal(json(submitBubble).outcome, 'ok');
        continue;
      }
      assert.equal(applied.state.status, 'complete');
      const staleNext = createHand({
        handId: 'ab510000-0000-4000-8000-000000000028', tableId: bubbleTable, handNo: 2,
        buttonSeat: 5, sb: 5n, bb: 10n,
      }, [...deck], bubblePlayers);
      assert.equal(staleNext.error, undefined);
      const staleSplit = serializeAuthoritative(staleNext.state);
      const settling = session('g03-bubble-settlement');
      const nextDeal = session('g03-bubble-next-deal');
      try {
        settling.send(`BEGIN;
          ${submitBubble}
          \\echo satellite_bubble_uncommitted`);
        await settling.waitFor('satellite_bubble_uncommitted');
        nextDeal.send(startStatement({
          p_state: { ...staleSplit.stateJson, satelliteLevel: { clockRevision: '1', levelStartSecond: '0' } },
          p_deck: deck, p_board_future: staleSplit.liveDeck, p_holes: staleSplit.holes,
          p_events: [], p_engine_version: ENGINE_VERSION, p_act_deadline: null, p_actor_user_id: first,
        }));
        await waitForPostgresLock('g03-bubble-next-deal');
        settling.send('COMMIT;');
        const [committed, rejected] = await Promise.all([settling.finish(), nextDeal.finish()]);
        assert.equal(JSON.parse(committed[0]).outcome, 'ok');
        assert.deepEqual(JSON.parse(rejected.at(-1)), { outcome: 'rejected', detail: 'stale seat roster' });
      } finally {
        settling.stop();
        nextDeal.stop();
      }
    }
    assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE table_id='${bubbleTable}'`), '1');
    assert.deepEqual(json(`SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
      SELECT public.get_online_satellite_bubble_evidence_v1('${bubblePilot}')`), {
      handId: bubbleHand, handNo: '1', stateVersion: 3, status: 'complete', survivingCount: 1,
      eliminations: [{ seat: 2, startingStack: '10' }, { seat: 7, startingStack: '30' }],
    });
    assert.deepEqual(level(bubbleTable), { mode: 'qualification_reached' });
    return { bubblePilot,bubbleTable,bubbleHand };
  }
  const { bubblePilot, bubbleHand } = await settleBubble({
    bubblePilot: 'ab510000-0000-4000-8000-000000000023',
    bubbleTable: 'ab510000-0000-4000-8000-000000000024',
    bubbleHand: 'ab510000-0000-4000-8000-000000000025',
    slots: 2, overlapNextDeal: true,
  });
  const exactBubble = await settleBubble({
    bubblePilot: 'ab510000-0000-4000-8000-000000000029',
    bubbleTable: 'ab510000-0000-4000-8000-000000000030',
    bubbleHand: 'ab510000-0000-4000-8000-000000000031',
    slots: 1, overlapNextDeal: false,
  });
  const boundaryPilot = 'ab510000-0000-4000-8000-000000000026';
  const browserTicketDestination = 'ab510000-0000-4000-8000-000000000034';
  sql(`
    INSERT INTO public.tournaments VALUES ('${browserTicketDestination}','${clubId}','Disposable browser ticket target');
    INSERT INTO online_satellite_private.test_destinations VALUES ('${browserTicketDestination}','${clubId}');
    INSERT INTO online_satellite_private.pilots VALUES
      ('${boundaryPilot}','${clubId}','${browserTicketDestination}','${first}','${boundaryPilot}',now(),100,2);
    INSERT INTO online_satellite_private.entries(pilot_id,player_user_id) VALUES
      ('${boundaryPilot}','${first}'),('${boundaryPilot}','${second}');
  `);
  const boundary = json(`SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
    SELECT public.provision_online_satellite_table_v1('${boundaryPilot}',
    '[{"starts_at_second":0,"small_blind":5,"big_blind":10,"big_blind_ante":0}]',2)`);
  assert.equal(clockCommand(first,boundaryPilot,1,true).outcome, 'ok');
  const boundarySeats = json(`SELECT json_agg(json_build_object('seat',seat_no,'playerId',user_id) ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${boundary.tableId}'`);
  const couldDeal = createHand({
    handId: 'ab510000-0000-4000-8000-000000000027', tableId: boundary.tableId, handNo: 1,
    buttonSeat: 1, sb: 5n, bb: 10n,
  }, [...deck], boundarySeats.map(seat => ({ ...seat, stack: 100n })));
  assert.equal(couldDeal.error, undefined);
  const boundarySplit = serializeAuthoritative(couldDeal.state);
  assert.throws(() => json(startStatement({
    p_state: { ...boundarySplit.stateJson, satelliteLevel: { clockRevision: '2', levelStartSecond: '0' } },
    p_deck: deck, p_board_future: boundarySplit.liveDeck, p_holes: boundarySplit.holes,
    p_events: [], p_engine_version: ENGINE_VERSION, p_act_deadline: null, p_actor_user_id: first,
  })), /online_satellite_qualification_reached/);
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE table_id='${boundary.tableId}'`), '0');
  const lockResult = (actor,pilot,hand = null,version = null) => json(`SET ROLE authenticated;
    SET request.jwt.claim.sub='${actor}';
    SELECT public.lock_online_satellite_result_v1('${pilot}',${hand ? `'${hand}'` : 'NULL'},${version ?? 'NULL'})`);
  assert.throws(() => lockResult(spectator,boundaryPilot), /SATELLITE_PILOT_MANAGER_REQUIRED/);
  assert.deepEqual(lockResult(first,bubblePilot,bubbleHand,2), { outcome: 'stale' });
  assert.deepEqual(lockResult(first,bubblePilot,bubbleHand,3), { outcome: 'bubble_review_required' });
  assert.deepEqual(lockResult(first,exactBubble.bubblePilot,exactBubble.bubbleHand,3),
    { outcome: 'ok', idempotent: false, qualifiedCount: 1 });
  assert.deepEqual(lockResult(first,exactBubble.bubblePilot,exactBubble.bubbleHand,3),
    { outcome: 'ok', idempotent: true, qualifiedCount: 1 });
  assert.equal(sql(`SELECT e.player_user_id FROM online_satellite_private.locked_results r
    JOIN online_satellite_private.entries e ON e.id=r.qualified_entries[1]
    WHERE r.pilot_id='${exactBubble.bubblePilot}'`), second);
  assert.equal(sql(`SELECT status FROM public.online_poker_tables WHERE id='${exactBubble.bubbleTable}'`), 'closed');
  const ownQualification = (actor) => json(`SET ROLE authenticated;
    SET request.jwt.claim.sub='${actor}';
    SELECT COALESCE(public.get_my_online_satellite_result_v1('${exactBubble.bubblePilot}'),'null'::jsonb)`);
  assert.equal(ownQualification(second).qualified, true);
  assert.equal(ownQualification(first).qualified, false);
  assert.equal(ownQualification(spectator), null);
  const issueTicket = (actor, request = 'ab510000-0000-4000-8000-000000000032', expiry = '2099-01-01T00:00:00Z') => json(`
    SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT public.issue_online_satellite_test_tickets_v1('${exactBubble.bubblePilot}','${request}','${expiry}')`);
  assert.throws(() => issueTicket(first), /SATELLITE_TEST_DESTINATION_REQUIRED/);
  sql(`INSERT INTO online_satellite_private.test_destinations VALUES ('${destination}','${clubId}')`);
  assert.throws(() => issueTicket(spectator), /SATELLITE_PILOT_MANAGER_REQUIRED/);
  assert.throws(() => issueTicket(first, undefined, '2000-01-01T00:00:00Z'), /SATELLITE_TEST_ISSUE_BAD_EXPIRY/);
  assert.deepEqual(issueTicket(first), { outcome: 'ok', idempotent: false, ticketCount: 1 });
  assert.deepEqual(issueTicket(first), { outcome: 'ok', idempotent: true, ticketCount: 1 });
  const issuedStatus = actor => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT COALESCE(public.get_online_satellite_test_issuance_v1('${exactBubble.bubblePilot}'),'null'::jsonb)`);
  assert.equal(issuedStatus(first).issuedCount, 1);
  assert.equal(issuedStatus(second), null);
  assert.throws(() => issueTicket(first,'ab510000-0000-4000-8000-000000000033'), /SATELLITE_TEST_ISSUE_CONFLICT/);
  assert.equal(sql(`SELECT e.player_user_id FROM online_satellite_private.test_tickets ticket
    JOIN online_satellite_private.entries e ON e.id=ticket.entry_id
    WHERE ticket.pilot_id='${exactBubble.bubblePilot}'`), second);
  const seeTicket = (actor) => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT COALESCE(public.get_my_online_satellite_test_ticket_v1('${exactBubble.bubblePilot}'),'null'::jsonb)`);
  assert.equal(seeTicket(first), null);
  const delivered = seeTicket(second);
  assert.equal(delivered.destinationId, destination);
  assert.equal(delivered.testEntryId, null);
  const redeemTest = (actor, target = destination) => `SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT public.redeem_online_satellite_test_ticket_v1('${delivered.ticketId}','${target}');`;
  assert.throws(() => sql(redeemTest(first)), /SATELLITE_TEST_TICKET_NOT_AVAILABLE/);
  assert.throws(() => sql(redeemTest(second, clubId)), /SATELLITE_TEST_TICKET_NOT_AVAILABLE/);
  sql(`UPDATE online_satellite_private.test_ticket_batches SET issued_at='2000-01-01',expires_at='2000-01-02'
    WHERE pilot_id='${exactBubble.bubblePilot}'`);
  assert.deepEqual(json(redeemTest(second)), { outcome: 'expired' });
  assert.equal(sql('SELECT count(*) FROM online_satellite_private.test_target_entries'), '0');
  sql(`UPDATE online_satellite_private.test_ticket_batches SET issued_at=clock_timestamp(),expires_at='2099-01-01'
    WHERE pilot_id='${exactBubble.bubblePilot}'`);
  const separateFirst = session('g03-test-ticket-first');
  const separateSecond = session('g03-test-ticket-second');
  try {
    separateFirst.send(`BEGIN; ${redeemTest(second)}
      \\echo test_ticket_entry_uncommitted`);
    await separateFirst.waitFor('test_ticket_entry_uncommitted');
    separateSecond.send(redeemTest(second));
    await waitForPostgresLock('g03-test-ticket-second');
    separateFirst.send('COMMIT;');
    const [written, replayed] = await Promise.all([separateFirst.finish(), separateSecond.finish()]);
    const receipt = JSON.parse(written[0]);
    assert.equal(receipt.outcome, 'ok');
    assert.equal(receipt.idempotent, false);
    assert.deepEqual(JSON.parse(replayed.at(-1)), { ...receipt, idempotent: true });
    assert.equal(seeTicket(second).testEntryId, receipt.testEntryId);
  } finally {
    separateFirst.stop();
    separateSecond.stop();
  }
  assert.equal(sql('SELECT count(*) FROM online_satellite_private.test_target_entries'), '1');
  assert.deepEqual(lockResult(first,boundaryPilot), { outcome: 'ok', idempotent: false, qualifiedCount: 2 });
  assert.deepEqual(lockResult(first,boundaryPilot), { outcome: 'ok', idempotent: true, qualifiedCount: 2 });
  assert.equal(sql(`SELECT status FROM public.online_poker_tables WHERE id='${boundary.tableId}'`), 'closed');
  assert.equal(sql(`SELECT count(*) FROM online_satellite_private.locked_results WHERE pilot_id='${bubblePilot}'`), '0');
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
  sql(file('../../supabase/pending-migrations/20261119222500_online_satellite_round_deal_fence.sql'));
  const fast = 'ab510000-0000-4000-8000-000000000031';
  const slow = 'ab510000-0000-4000-8000-000000000032';
  sql(`INSERT INTO public.online_poker_tables(id,club_id,name,sb,bb,min_buyin,max_buyin,starting_stack_default,is_satellite)
    VALUES ('${fast}','${clubId}','Disposable G04 fast table',5,10,0,1000,100,true),
      ('${slow}','${clubId}','Disposable G04 slow table',5,10,0,1000,100,true);
    INSERT INTO online_satellite_private.round_tables(table_id,pilot_id)
    VALUES ('${fast}','${bubblePilot}'),('${slow}','${bubblePilot}');`);
  const openRound = () => sql(`SELECT online_satellite_private.open_next_round('${bubblePilot}')`);
  // Isolate the round trigger from the independent single-table level trigger.
  // No production path disables the level check.
  const fixtureRoundDeal = (table, round, status = 'complete') => `
    INSERT INTO public.online_poker_hands(table_id,hand_no,status,state)
    VALUES ('${table}',${round},'${status}',
      jsonb_build_object('satelliteRound','${round}','config',jsonb_build_object('schemaVersion',1)));`;
  sql('ALTER TABLE public.online_poker_hands DISABLE TRIGGER trg_op_check_satellite_deal_level');
  assert.equal(openRound(), '1');
  sql(fixtureRoundDeal(fast, 1));
  assert.throws(openRound, /online_satellite_round_still_playing/);
  assert.throws(() => sql(fixtureRoundDeal(fast, 2)), /online_satellite_round_deal_not_available/);
  sql(`BEGIN; ${fixtureRoundDeal(slow, 1)} ROLLBACK;`);
  assert.throws(openRound, /online_satellite_round_still_playing/);
  sql(fixtureRoundDeal(slow, 1));
  assert.equal(openRound(), '2');
  assert.throws(() => sql(fixtureRoundDeal(fast, 1)), /online_satellite_round_deal_not_available/);
  sql('ALTER TABLE public.online_poker_hands ENABLE TRIGGER trg_op_check_satellite_deal_level');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands
    WHERE table_id IN ('${fast}','${slow}') AND state ? 'satelliteRound'`), '0');
  console.log('POSTGRES_SATELLITE_ROUND_WAIT_STALE_PERMIT_ROLLBACK_PASS');
  sql(file('../../supabase/pending-migrations/20261119223500_online_satellite_shared_round_clock.sql'));
  const sharedPilot = 'ab510000-0000-4000-8000-000000000033';
  const sharedDestination = 'ab510000-0000-4000-8000-000000000036';
  const tables = ['ab510000-0000-4000-8000-000000000034', 'ab510000-0000-4000-8000-000000000035'];
  sql(`INSERT INTO public.tournaments VALUES ('${sharedDestination}','${clubId}','Disposable two-table award target');
    INSERT INTO online_satellite_private.test_destinations VALUES ('${sharedDestination}','${clubId}');
    INSERT INTO online_satellite_private.pilots VALUES
    ('${sharedPilot}','${clubId}','${sharedDestination}','${first}','${sharedPilot}',now(),10,4);
    INSERT INTO online_satellite_private.entries(pilot_id,player_user_id) VALUES
    ${[first, second, third, spectator].map(actor => `('${sharedPilot}','${actor}')`).join(',')};
    INSERT INTO public.online_poker_tables(id,club_id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
    VALUES ${tables.map(id => `('${id}','${clubId}','Disposable shared Satellite clock TEST',5,10,0,100,10)`).join(',')};
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status) VALUES
    ${[first, second, third, spectator].map((actor, i) => `('${tables[Math.floor(i / 2)]}',${i % 2 + 1},'${actor}',${i % 2 ? 10 : 5},'sitting')`).join(',')};
    UPDATE public.online_poker_tables SET is_satellite=true WHERE id IN ('${tables.join("','")}');
    INSERT INTO online_satellite_private.table_clocks(table_id,pilot_id,running_since,qualification_slots)
    VALUES ('${tables[0]}','${sharedPilot}',statement_timestamp(),2);
    INSERT INTO online_satellite_private.blind_levels VALUES ('${sharedPilot}',0,5,10,0);
    INSERT INTO online_satellite_private.round_tables(table_id,pilot_id) VALUES
    ${tables.map(id => `('${id}','${sharedPilot}')`).join(',')};`);
  assert.equal(level(tables[1], first).mode, 'waiting_for_round');
  sql(file('../../supabase/pending-migrations/20261119225000_online_satellite_open_round.sql'));
  const openSharedRound = (actor, expected) => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT public.open_online_satellite_round_v1('${sharedPilot}',${expected})`);
  assert.throws(() => openSharedRound(third, 0), /SATELLITE_PILOT_MANAGER_REQUIRED/);
  assert.deepEqual(openSharedRound(first, 0), { outcome: 'ok', roundNo: '1' });
  assert.deepEqual(openSharedRound(first, 0), { outcome: 'stale', roundNo: '1' });
  for (const [i, id] of tables.entries()) {
    assert.equal(level(id, first).roundNo, '1');
    // Same deck as the verified blind all-in case above, so both tables end
    // with exactly one survivor. Limit deterministic randomness to this fixture.
    let roundSeed = 1977;
    const rng = t.mock.method(crypto, 'getRandomValues', buffer => {
      for (let index = 0; index < buffer.length; index++) {
        roundSeed = (Math.imul(roundSeed, 1664525) + 1013904223) >>> 0;
        buffer[index] = roundSeed;
      }
      return buffer;
    });
    let receipt;
    try {
      receipt = await dealNextHand(admin, id, i === 0 ? null : first);
    } finally {
      rng.mock.restore();
    }
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.equal(sql(`SELECT status FROM public.online_poker_hands WHERE id='${receipt.handId}'`), 'complete');
    assert.equal(level(id, first).mode, 'waiting_for_round');
    if (i === 0) assert.deepEqual(openSharedRound(first, 1), { outcome: 'round_still_playing', roundNo: '1' });
  }
  assert.equal(sql(`SELECT count(*) FROM online_satellite_private.round_deals
    WHERE pilot_id='${sharedPilot}' AND round_no=1 AND hand_id IS NOT NULL`), '2');
  console.log('POSTGRES_SHARED_SATELLITE_CLOCK_MANUAL_RUNNER_ROUND_PASS');
  sql(file('../../supabase/pending-migrations/20261119224000_online_satellite_round_table_reads.sql'));
  const visibleRoundTables = `SELECT json_build_object(
    'tables', (SELECT count(*) FROM public.online_poker_tables WHERE id IN ('${tables.join("','")}')),
    'hands', (SELECT count(*) FROM public.online_poker_hands WHERE table_id IN ('${tables.join("','")}')),
    'secondaryHand', (SELECT count(*) FROM public.online_poker_hands WHERE table_id='${tables[1]}')); `;
  const roundRead = actor => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}'; ${visibleRoundTables}`);
  assert.deepEqual(roundRead(third), { tables: 1, hands: 1, secondaryHand: 1 });
  assert.deepEqual(roundRead(first), { tables: 1, hands: 1, secondaryHand: 0 });
  assert.deepEqual(json(`SET ROLE anon; ${visibleRoundTables}`), { tables: 0, hands: 0, secondaryHand: 0 });
  console.log('POSTGRES_SATELLITE_SECONDARY_TABLE_ASSIGNED_READ_PASS');
  sql(file('../../supabase/pending-migrations/20261119224500_online_satellite_round_reconnect.sql'));
  const reconnectRound = actor => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT public.get_online_satellite_table_v1('${sharedPilot}')`);
  assert.equal(reconnectRound(third).tableId, tables[1]);
  assert.equal(reconnectRound(first).tableId, tables[0]);
  assert.equal(reconnectRound(third).canPlay, true);
  assert.equal(reconnectRound(third).clockRevision, reconnectRound(first).clockRevision);
  assert.equal(Object.hasOwn(reconnectRound(third), 'qualificationReached'), false);
  console.log('POSTGRES_SATELLITE_RECONNECT_ASSIGNED_ROUND_TABLE_PASS');
  sql(file('../../supabase/pending-migrations/20261119225500_online_satellite_td_round_state.sql'));
  assert.equal(reconnectRound(first).roundNo, '1');
  assert.equal(Object.hasOwn(reconnectRound(third), 'roundNo'), false);
  console.log('POSTGRES_SATELLITE_ROUND_STATE_TD_SCOPE_PASS');
  sql(file('../../supabase/pending-migrations/20261119231000_online_satellite_round_seat_move.sql'));
  sql(file('../../supabase/pending-migrations/20261119231500_online_satellite_move_placement_revision.sql'));
  const survivor = json(`SELECT json_build_object('id',id,'actor',user_id,'stack',stack)
    FROM public.online_poker_seats WHERE table_id='${tables[1]}' AND stack>0`);
  const moveStatement = (actor, expected, destinationSeat) => `SET ROLE authenticated;
    SET request.jwt.claim.sub='${actor}'; SELECT public.move_online_satellite_round_seat_v2(
      '${sharedPilot}','${survivor.id}','${tables[0]}',${destinationSeat},${expected},0);`;
  const move = (...args) => json(moveStatement(...args));
  const totalRoundChips = () => sql(`SELECT sum(stack) FROM public.online_poker_seats WHERE table_id IN ('${tables.join("','")}')`);
  const totalBeforeMove = totalRoundChips();
  assert.throws(() => move(third, 1, 3), /SATELLITE_PILOT_MANAGER_REQUIRED/);
  assert.deepEqual(move(first, 0, 3), { outcome: 'stale', roundNo: '1' });
  assert.deepEqual(move(first, 1, 1), { outcome: 'invalid_destination' });
  const firstMove = session('g04-first-move');
  const overlappingMove = session('g04-overlapping-move');
  try {
    firstMove.send(`BEGIN; ${moveStatement(first, 1, 3)}
      \\echo first_move_uncommitted`);
    await firstMove.waitFor('first_move_uncommitted');
    overlappingMove.send(moveStatement(first, 1, 4));
    await waitForPostgresLock('g04-overlapping-move');
    firstMove.send('COMMIT;');
    const [moved, stale] = await Promise.all([firstMove.finish(), overlappingMove.finish()]);
    assert.deepEqual(JSON.parse(moved[0]), { outcome: 'ok', tableId: tables[0], seatNo: 3, placementRevision: '1' });
    assert.deepEqual(JSON.parse(stale.at(-1)), { outcome: 'stale_placement', placementRevision: '1' });
  } finally {
    firstMove.stop();
    overlappingMove.stop();
  }
  assert.equal(sql(`SELECT seat_no FROM public.online_poker_seats WHERE id='${survivor.id}'`), '3');
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.move_online_satellite_round_seat_v1(uuid,uuid,uuid,int,bigint)','EXECUTE')"), 'f');
  assert.equal(totalRoundChips(), totalBeforeMove);
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_seats WHERE user_id='${survivor.actor}'
    AND table_id IN ('${tables.join("','")}')`), '1');
  assert.equal(reconnectRound(survivor.actor).tableId, tables[0]);
  assert.equal(roundRead(survivor.actor).secondaryHand, 0);
  console.log('POSTGRES_SATELLITE_ROUND_MOVE_CONSERVE_RECONNECT_PASS');
  sql(file('../../supabase/pending-migrations/20261119232000_online_satellite_require_round_results.sql'));
  assert.deepEqual(lockResult(first,sharedPilot), { outcome: 'round_result_required' });
  assert.throws(() => lockResult(third,sharedPilot), /SATELLITE_PILOT_MANAGER_REQUIRED/);
  assert.deepEqual(lockResult(first,boundaryPilot), { outcome: 'ok', idempotent: true, qualifiedCount: 2 });
  assert.equal(sql(`SELECT count(*) FROM online_satellite_private.locked_results WHERE pilot_id='${sharedPilot}'`), '0');
  console.log('POSTGRES_SATELLITE_ROUND_REJECTS_PARTIAL_RESULT_LOCK_PASS');
  sql(file('../../supabase/pending-migrations/20261119232500_online_satellite_lock_round_result.sql'));
  const lockSharedRound = (actor, round) => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT public.lock_online_satellite_round_result_v1('${sharedPilot}',${round})`);
  const issueSharedTickets = () => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
    SELECT public.issue_online_satellite_test_tickets_v1(
      '${sharedPilot}','ab510000-0000-4000-8000-000000000037','2099-01-01T00:00:00Z')`);
  assert.deepEqual(issueSharedTickets(), { outcome: 'not_ready' });
  assert.throws(() => lockSharedRound(third, 1), /SATELLITE_PILOT_MANAGER_REQUIRED/);
  assert.deepEqual(lockSharedRound(first, 2), { outcome: 'stale' });
  assert.deepEqual(lockSharedRound(first, 1), { outcome: 'ok', idempotent: false, qualifiedCount: 2 });
  assert.deepEqual(lockSharedRound(first, 1), { outcome: 'ok', idempotent: true, qualifiedCount: 2 });
  assert.equal(sql(`SELECT jsonb_array_length(round_hands) FROM online_satellite_private.locked_results
    WHERE pilot_id='${sharedPilot}'`), '2');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_tables WHERE id IN ('${tables.join("','")}')
    AND status='closed'`), '2');
  console.log('POSTGRES_SATELLITE_LOCK_COMPLETE_ROUND_RESULT_PASS');
  assert.deepEqual(issueSharedTickets(), { outcome: 'ok', idempotent: false, ticketCount: 2 });
  assert.deepEqual(issueSharedTickets(), { outcome: 'ok', idempotent: true, ticketCount: 2 });
  const sharedTickets = json(`SELECT json_agg(json_build_object('ticketId',t.id,'actor',e.player_user_id))
    FROM online_satellite_private.test_tickets t JOIN online_satellite_private.entries e ON e.id=t.entry_id
    WHERE t.pilot_id='${sharedPilot}'`);
  assert.deepEqual(sharedTickets.map(({ actor }) => actor).sort(), [second, spectator].sort());
  for (const { actor, ticketId } of sharedTickets) {
    const redeemed = json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
      SELECT public.redeem_online_satellite_test_ticket_v1('${ticketId}','${sharedDestination}')`);
    assert.equal(redeemed.outcome, 'ok');
    assert.equal(redeemed.idempotent, false);
  }
  assert.equal(sql(`SELECT count(*) FROM online_satellite_private.test_target_entries
    WHERE destination_id='${sharedDestination}'`), '2');
  console.log('POSTGRES_SATELLITE_COMPLETE_ROUND_TEST_TICKETS_REDEEM_PASS');
  sql(file('../../supabase/pending-migrations/20261119233500_online_satellite_provision_two_tables.sql'));
  const preparedPilot = 'ab510000-0000-4000-8000-000000000038';
  sql(`INSERT INTO online_satellite_private.pilots VALUES
    ('${preparedPilot}','${clubId}','${sharedDestination}','${first}','${preparedPilot}',now(),100,4);
    INSERT INTO online_satellite_private.entries(pilot_id,player_user_id) VALUES
    ${[first,second,third,spectator].map(actor => `('${preparedPilot}','${actor}')`).join(',')};`);
  const provisionPair = actor => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT public.provision_online_satellite_two_tables_v1('${preparedPilot}',
      '[{"starts_at_second":0,"small_blind":5,"big_blind":10,"big_blind_ante":0}]',2)`);
  assert.throws(() => provisionPair(third), /SATELLITE_PILOT_MANAGER_REQUIRED/);
  const pair = provisionPair(first);
  assert.equal(pair.idempotent, false);
  assert.equal(new Set(pair.tableIds).size, 2);
  assert.deepEqual(provisionPair(first), { ...pair, idempotent: true });
  assert.deepEqual(json(`SELECT json_agg(size ORDER BY size) FROM (
    SELECT count(*) AS size FROM online_satellite_private.round_tables m
    JOIN public.online_poker_seats s ON s.table_id=m.table_id
    WHERE m.pilot_id='${preparedPilot}' GROUP BY m.table_id) counts`), [2,2]);
  assert.deepEqual(json(`SELECT json_build_object('players',count(DISTINCT s.user_id),'chips',sum(s.stack))
    FROM online_satellite_private.round_tables m JOIN public.online_poker_seats s ON s.table_id=m.table_id
    WHERE m.pilot_id='${preparedPilot}'`), { players:4, chips:400 });
  assert.equal(level(pair.tableIds[1],first).mode, 'paused');
  console.log('POSTGRES_SATELLITE_PROVISION_BALANCED_TWO_TABLES_PASS');
  sql(file('../../supabase/pending-migrations/20261119234500_online_satellite_round_operations_state.sql'));
  const operations = (actor, pilot) => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
    SELECT coalesce(public.get_online_satellite_round_operations_v1('${pilot}'),'null'::jsonb)`);
  const prepared = operations(first, preparedPilot);
  assert.equal(prepared.roundNo, '0');
  assert.deepEqual(prepared.tables.map(table => table.tableId), pair.tableIds);
  for (const table of prepared.tables) {
    assert.equal(table.status, 'paused');
    assert.equal(table.roundStatus, 'not_opened');
    assert.deepEqual(table.seats.map(seat => seat.stack), ['100','100']);
  }
  assert.deepEqual(prepared.tables[1].seats.map(s => s.placementRevision), ['1','1']);
  assert.equal(operations(third, preparedPilot), null);
  const finalized = operations(first, sharedPilot);
  assert.equal(finalized.roundNo, '1');
  assert.deepEqual(finalized.tables.map(table => table.roundStatus), ['complete','complete']);
  assert.ok(finalized.tables.every(table => table.status === 'closed'));
  console.log('POSTGRES_SATELLITE_TD_ROUND_OPERATIONS_SCOPE_PASS');
  sql(file('../../supabase/pending-migrations/20261119235500_online_satellite_final_table.sql'));
  const [finalTable, drainingTable] = pair.tableIds;
  const retire = () => json(`SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
    SELECT public.retire_online_satellite_round_table_v1('${preparedPilot}','${drainingTable}',0)`);
  assert.deepEqual(retire(), { outcome: 'table_has_players' });
  const drainingSeats = json(`SELECT json_agg(id ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${drainingTable}' AND stack>0`);
  for (const [i, seat] of drainingSeats.entries()) {
    const moved = json(`SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
      SELECT public.move_online_satellite_round_seat_v2('${preparedPilot}','${seat}','${finalTable}',${i + 3},0,1)`);
    assert.equal(moved.outcome, 'ok');
  }
  assert.deepEqual(retire(), { outcome: 'ok', idempotent: false, roundNo: '0' });
  assert.deepEqual(retire(), { outcome: 'ok', idempotent: true, roundNo: '0' });
  assert.equal(clockCommand(first,preparedPilot,1,true).outcome, 'ok');
  assert.deepEqual(json(`SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
    SELECT public.open_online_satellite_round_v1('${preparedPilot}',0)`), { outcome: 'ok', roundNo: '1' });
  assert.equal(sql(`SELECT table_id FROM online_satellite_private.round_deals WHERE pilot_id='${preparedPilot}'`), finalTable);
  assert.equal(sql(`SELECT sum(stack) FROM public.online_poker_seats WHERE table_id='${finalTable}'`), '400');
  console.log('POSTGRES_SATELLITE_FINAL_TABLE_DRAIN_AND_ROUND_PASS');
  if (process.env.VERIFY_POKER_BROWSER_RETRY === '1') {
    const { verifyBrowserActionRetry } = await import('./browserActionRetry.fixture.mjs');
    await verifyBrowserActionRetry({ sql, actor: second, handId: next.handId, seat: 5 });
    const browserPilot = 'ab510000-0000-4000-8000-000000000021';
    sql(`INSERT INTO online_satellite_private.pilots VALUES
      ('${browserPilot}','${clubId}','${destination}','${first}','${browserPilot}',now(),100,2);
      INSERT INTO online_satellite_private.entries(pilot_id,player_user_id)
      VALUES ('${browserPilot}','${first}'),('${browserPilot}','${second}')`);
    const { verifySatelliteClockBrowser } = await import('./satelliteClockBrowser.fixture.mjs');
    const twoTablePilot = 'ab510000-0000-4000-8000-000000000039';
    const finalTablePilot = 'ab510000-0000-4000-8000-000000000040';
    for (const pilot of [twoTablePilot,finalTablePilot]) {
      sql(`INSERT INTO online_satellite_private.pilots VALUES
        ('${pilot}','${clubId}','${sharedDestination}','${first}','${pilot}',now(),100,4);
        INSERT INTO online_satellite_private.entries(pilot_id,player_user_id) VALUES
        ${[first,second,third,spectator].map(user => `('${pilot}','${user}')`).join(',')};`);
    }
    await verifySatelliteClockBrowser({ sql, actor: first, pilot: browserPilot,
      twoTablePilot, finalTablePilot, ticketScenario: { pilot: boundaryPilot, player: second, destination: browserTicketDestination } });
    assert.equal(sql("SELECT count(*) FROM public.online_poker_hands WHERE status IN ('dealing','betting')"), '0');
    const rollback = file('../../supabase/pending-migrations/ROLLBACK_20261119193713_online_poker_complete_deal_stack_writeback.sql');
    const startOid = "'public.op_start_hand(jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamp with time zone,uuid)'::regprocedure";
    const functionRecord = () => json(`SELECT json_build_object('source',md5(prosrc),
      'owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,'settings',proconfig,'acl',proacl)
      FROM pg_proc WHERE oid=${startOid}`);
    const candidate = functionRecord();
    assert.equal(candidate.source, '13368e326882525cb5b8661b1f0a3541');
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
