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

export async function verifySatelliteRealtime({ sql, statusPath, first, spectator, practiceHand, satelliteHand }) {
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
  try {
    await Promise.all(clients.map((client, index) => new Promise((resolve, reject) => {
      client.channel(`fixture-poker-${index}`).on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'online_poker_hands',
      }, payload => seen[index].push(payload.new)).subscribe((state) => {
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
  } finally {
    await Promise.all(clients.map(async (client) => {
      await client.removeAllChannels();
      client.realtime.disconnect();
    }));
  }
}
