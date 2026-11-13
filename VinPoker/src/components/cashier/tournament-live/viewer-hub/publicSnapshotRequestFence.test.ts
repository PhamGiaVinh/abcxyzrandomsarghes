import { describe, expect, it } from 'vitest';
import { PublicSnapshotRequestFence } from './publicSnapshotRequestFence';

const current = (generation: unknown, state = 'current', unchanged = false) => ({ unchanged, freshness: { state, projectedSourceRevision: JSON.stringify({ generation }) } });

describe('request-bound snapshot generation fence', () => {
  it('retains the unchanged-epoch path without trusting a hint', () => {
    expect(new PublicSnapshotRequestFence({ tables: 7 }).accepts('tables', 7, {})).toBe(true);
  });
  it('accepts a current server reply covering every in-flight hint', () => {
    const fence = new PublicSnapshotRequestFence({ tables: 7 });
    fence.record('tables', 8, '9007199254740993');
    fence.record('tables', 9, '9007199254740995');
    fence.record('tables', 10, '9007199254740994');
    expect(fence.accepts('tables', 10, current('9007199254740994'))).toBe(false);
    expect(fence.accepts('tables', 10, current('9007199254740995'))).toBe(true);
  });
  it.each(['updating', 'stale'])('rejects a covered but %s reply', state => {
    const fence = new PublicSnapshotRequestFence({ tables: 1 });
    fence.record('tables', 2, '9');
    expect(fence.accepts('tables', 2, current('10', state))).toBe(false);
  });
  it('does not use a cached unchanged payload as proof', () => {
    const fence = new PublicSnapshotRequestFence({ tables: 1 });
    fence.record('tables', 2, '9');
    expect(fence.accepts('tables', 2, current('10', 'current', true))).toBe(false);
  });
  it.each([undefined, 'not-a-generation', '-1', '1e3', '9223372036854775808', '1'.repeat(100), 9007199254740992])('keeps unknown/invalid hint %s as a strict barrier', revision => {
    const fence = new PublicSnapshotRequestFence({ tables: 1 });
    fence.record('tables', 2, revision);
    fence.record('tables', 3, '10');
    expect(fence.accepts('tables', 3, current('11'))).toBe(false);
  });
  it('rejects an epoch increment not represented by its own journal', () => {
    const fence = new PublicSnapshotRequestFence({ tables: 1 });
    fence.record('tables', 3, '10');
    expect(fence.accepts('tables', 3, current('11'))).toBe(false);
    expect(new PublicSnapshotRequestFence({ tables: 1 }).accepts('tables', 2, current('11'))).toBe(false);
  });
  it('does not substitute another section for the changed section', () => {
    const fence = new PublicSnapshotRequestFence({ tables: 1, ranking: 5 });
    fence.record('ranking', 6, '10');
    expect(fence.accepts('tables', 2, current('11'))).toBe(false);
    expect(fence.accepts('ranking', 6, current('11'))).toBe(true);
  });
  it('does not let an unrequested component account for a requested epoch', () => {
    const fence = new PublicSnapshotRequestFence({ tables: 1 });
    fence.record('ranking', 2, '99');
    expect(fence.accepts('tables', 2, current('99'))).toBe(false);
  });
  it('keeps separate journals for callers sharing an authoritative reply', () => {
    const first = new PublicSnapshotRequestFence({ tables: 1 });
    const second = new PublicSnapshotRequestFence({ tables: 1 });
    first.record('tables', 2, '9');
    second.record('tables', 2, '9');
    second.record('tables', 3, undefined);
    second.record('tables', 4, '10');
    const sharedReply = current('10');
    const original = JSON.stringify(sharedReply);
    expect(first.accepts('tables', 2, sharedReply)).toBe(true);
    expect(second.accepts('tables', 4, sharedReply)).toBe(false);
    expect(JSON.stringify(sharedReply)).toBe(original);
  });
  it.each([null, {}, { freshness: { state: 'current', projectedSourceRevision: '{' } }, current(10), current('9223372036854775808')])('rejects missing or invalid authoritative proof', reply => {
    const fence = new PublicSnapshotRequestFence({ tables: 1 });
    fence.record('tables', 2, '9');
    expect(fence.accepts('tables', 2, reply)).toBe(false);
  });
  it('keeps invalidation stronger than generation and discards the floor on a new request', () => {
    const old = new PublicSnapshotRequestFence({ tables: 1 });
    old.record('tables', 2, '9223372036854775807');
    old.invalidate();
    expect(old.accepts('tables', 2, current('9223372036854775807'))).toBe(false);
    expect(old.accepts('tables', 1, current('9223372036854775807'))).toBe(false);
    const next = new PublicSnapshotRequestFence({ tables: 2 });
    next.record('tables', 3, '10');
    expect(next.accepts('tables', 3, current('10'))).toBe(true);
  });
});
