import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';

async function observe(predicate, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  assert.fail(label);
}

export async function verifySatelliteRealtime({ sql, statusPath, first, spectator, practiceHand, satelliteHand, secondaryHand }) {
  const status = JSON.parse(readFileSync(statusPath, 'utf8'));
  assert.equal(status.API_URL, 'http://127.0.0.1:54321');
  assert.ok(status.JWT_SECRET && status.ANON_KEY, 'Isolated fixture credentials unavailable');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const clientFor = (actor) => createClient(status.API_URL, status.ANON_KEY, {
    accessToken: async () => {
      const now = Math.floor(Date.now() / 1000);
      const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        role: 'authenticated', aud: 'authenticated', sub: actor, iat: now, exp: now + 300,
      })}`;
      const signature = createHmac('sha256', status.JWT_SECRET).update(input).digest('base64url');
      return `${input}.${signature}`;
    },
  });
  const clients = [clientFor(first), clientFor(spectator),
    createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } })];
  const seen = clients.map(() => []);
  const arrivalByRevision = new Map();
  try {
    await Promise.all(clients.slice(0, 2).map(client => client.realtime.setAuth()));
    const visible = await Promise.all(clients.map(client => client.from('online_poker_hands')
      .select('id').eq('id', satelliteHand)));
    assert.deepEqual(visible.map(({ error, data }) => ({ code: error?.code ?? null, count: data?.length ?? null })), [
      { code: null, count: 1 }, { code: null, count: 0 }, { code: null, count: 0 },
    ], 'REST and Realtime must use the same isolated identities');
    await Promise.all(clients.map((client, index) => new Promise((resolve, reject) => {
      client.channel(`fixture-poker-${index}`).on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'online_poker_hands',
      }, payload => {
        seen[index].push(payload.new);
        if (index === 0 && payload.new.id === secondaryHand) {
          arrivalByRevision.set(Number(payload.new.state_version), performance.now());
        }
      }).subscribe((state) => {
        if (state === 'SUBSCRIBED') resolve();
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          reject(new Error(`Realtime subscription: ${state}`));
        }
      });
    })));
    // Distinct revisions keep in-flight warm-up events from satisfying the
    // barrier after the private event. This writes only disposable fixture rows.
    const receipt = (id) => Number(sql(`UPDATE public.online_poker_hands SET state_version=state_version+1
      WHERE id='${id}' RETURNING state_version`));
    const received = (events, id) => events.filter(row => row.id === id).length;
    const canary = () => seen.map(events => received(events, practiceHand));
    for (let attempt = 0; attempt < 12 && canary().some(count => count === 0); attempt++) {
      receipt(practiceHand);
      await delay(500);
    }
    await observe(() => canary().every(count => count > 0), 'All three healthy sockets must receive a practice event');
    receipt(satelliteHand);
    await observe(() => received(seen[0], satelliteHand) === 1, 'Registered socket must receive the satellite event');
    const barrier = receipt(practiceHand);
    await observe(() => seen.every(events => events.some(row => row.id === practiceHand
      && Number(row.state_version) === barrier)), 'All sockets must receive the exact following canary');
    assert.equal(received(seen[1], satelliteHand), 0);
    assert.equal(received(seen[2], satelliteHand), 0);
    const privateEvent = seen[0].find(row => row.id === satelliteHand);
    assert.doesNotMatch(JSON.stringify(privateEvent), /"(?:holeCards|deck|board_future|server_seed)"\s*:/);
    console.log('SUPABASE_REALTIME_SATELLITE_REGISTERED_DELIVERY_FOREIGN_AND_ANON_ISOLATION_PASS');
    const secondary = await Promise.all(clients.map(client => client.from('online_poker_hands')
      .select('id').eq('id', secondaryHand)));
    assert.deepEqual(secondary.map(({ error, data }) => [error?.code ?? null, data?.length]), [[null,1],[null,0],[null,0]]);
    receipt(secondaryHand);
    await observe(() => received(seen[0], secondaryHand) === 1, 'Assigned socket must receive the secondary-table event');
    const secondBarrier = receipt(practiceHand);
    await observe(() => seen.every(events => events.some(row => row.id === practiceHand
      && Number(row.state_version) === secondBarrier)), 'All sockets must receive the secondary-table barrier');
    assert.equal(received(seen[1], secondaryHand), 0);
    assert.equal(received(seen[2], secondaryHand), 0);
    assert.doesNotMatch(JSON.stringify(seen[0].find(row => row.id === secondaryHand)),
      /"(?:holeCards|deck|board_future|server_seed)"\s*:/);
    console.log('SUPABASE_REALTIME_SATELLITE_SECONDARY_TABLE_ASSIGNED_ONLY_PASS');
    // Diagnostic only. Start before the disposable SQL writer and finish in
    // the authorized socket callback using the same monotonic clock.
    const deliveryMs = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const revision = receipt(secondaryHand);
      await observe(() => arrivalByRevision.has(revision), `Missing secondary sample ${i + 1}`);
      deliveryMs.push(arrivalByRevision.get(revision) - started);
    }
    const finalBarrier = receipt(practiceHand);
    await observe(() => seen.every(events => events.some(row => row.id === practiceHand
      && Number(row.state_version) === finalBarrier)), 'All sockets must receive the final diagnostic barrier');
    assert.equal(received(seen[1], secondaryHand), 0);
    assert.equal(received(seen[2], secondaryHand), 0);
    deliveryMs.sort((left, right) => left - right);
    console.log('SATELLITE_SECONDARY_REALTIME_DIAGNOSTIC', JSON.stringify({
      scope: 'disposable_sql_dispatch_to_assigned_socket_callback',
      expectedSamples: 20, completedSamples: deliveryMs.length,
      openSockets: clients.length, p95Ms: Math.round(deliveryMs[Math.ceil(deliveryMs.length * .95) - 1]),
      maxMs: Math.round(deliveryMs.at(-1)), capacityQualified: false,
    }));
  } finally {
    await Promise.all(clients.map(async (client) => {
      await client.removeAllChannels();
      client.realtime.disconnect();
    }));
  }
}

export async function verifySatelliteAudience({ sql, statusPath, practiceHand, secondaryHand }) {
  const status = JSON.parse(readFileSync(statusPath, 'utf8'));
  assert.equal(status.API_URL, 'http://127.0.0.1:54321');
  const audienceSize = 30;
  const audience = Array.from({ length: audienceSize }, () => ({
    client: createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } }),
    arrivals: new Map(),
    privateEvents: 0,
  }));
  const measurements = [];
  const waves = 6;
  try {
    await Promise.all(audience.map(async ({ client }, index) => {
      const read = await client.from('online_poker_hands').select('id').in('id', [practiceHand, secondaryHand]);
      assert.equal(read.error, null);
      assert.deepEqual(read.data.map(row => row.id), [practiceHand]);
      const watcher = audience[index];
      await new Promise((resolve, reject) => {
        client.channel(`disposable-audience-${index}`).on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'online_poker_hands',
        }, ({ new: row }) => {
          if (row.id === practiceHand) watcher.arrivals.set(Number(row.state_version), performance.now());
          if (row.id === secondaryHand) watcher.privateEvents++;
        }).subscribe(state => {
          if (state === 'SUBSCRIBED') resolve();
          if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(state)) reject(new Error(`Audience join: ${state}`));
        });
      });
    }));
    const updatePractice = () => Number(sql(`UPDATE public.online_poker_hands SET state_version=state_version+1
      WHERE id='${practiceHand}' RETURNING state_version`));
    const warm = updatePractice();
    await observe(() => audience.every(watcher => watcher.arrivals.has(warm)), 'Audience warm-up missed');
    for (let wave = 0; wave < waves; wave++) {
      sql(`UPDATE public.online_poker_hands SET state_version=state_version+1 WHERE id='${secondaryHand}'`);
      const started = performance.now();
      const revision = updatePractice();
      await observe(() => audience.every(watcher => watcher.arrivals.has(revision)), `Audience wave ${wave + 1} missed`);
      measurements.push(...audience.map(watcher => watcher.arrivals.get(revision) - started));
    }
    const privateEvents = audience.reduce((total, watcher) => total + watcher.privateEvents, 0);
    assert.equal(privateEvents, 0);
    measurements.sort((a, b) => a - b);
    console.log('SATELLITE_AUDIENCE_ISOLATED_DIAGNOSTIC', JSON.stringify({
      scope: 'public_practice_fanout_private_satellite_isolation', audienceSize, waves,
      deliveries: measurements.length, privateEvents,
      p95Ms: Math.round(measurements[Math.ceil(measurements.length * .95) - 1]),
      capacityQualified: false,
    }));
  } finally {
    await Promise.all(audience.map(async ({ client }) => {
      await client.removeAllChannels();
      client.realtime.disconnect();
    }));
  }
}
