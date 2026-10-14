import assert from 'node:assert/strict';
import test from 'node:test';
import { DIGEST, SOURCE, TARGET, VERSION, preload } from './preload-postgres-dump-image.mjs';
const id = `sha256:${'a'.repeat(64)}`;
const image = (imageId = id, digest = DIGEST) => JSON.stringify({ id: imageId, digests: [`supabase/postgres@${digest}`] });
test('preload pins official mirror and verifies original CLI alias without DB credentials', () => {
  const calls = [];
  preload(VERSION, (command, args, options) => {
    calls.push(args); assert.equal(command, 'docker');
    assert.deepEqual(options.env, { PATH: 'safe' });
    return { status: 0, stdout: args[0] === 'image' ? image() : '' };
  }, { PATH: 'safe', PGPASSWORD: 'private', SUPABASE_ACCESS_TOKEN: 'private', GH_TOKEN: 'private' });
  assert.deepEqual(calls.map(args => args.slice(0, 3)), [
    ['pull', SOURCE], ['image', 'inspect', SOURCE], ['tag', SOURCE, TARGET], ['image', 'inspect', TARGET],
  ]);
});
test('unknown linked version fails before invoking Docker', () => {
  assert.throws(() => preload('17.6.1.122', () => assert.fail('unexpected Docker call')), /requires review/u);
});
test('pull failure and digest drift stop before retag', () => {
  assert.throws(() => preload(VERSION, () => ({ status: 1, stdout: '', stderr: 'private' })), /raw output withheld/u);
  const calls = [];
  assert.throws(() => preload(VERSION, (_command, args) => {
    calls.push(args); return { status: 0, stdout: args[0] === 'image' ? image(id, `sha256:${'b'.repeat(64)}`) : '' };
  }), /digest mismatch/u);
  assert.equal(calls.length, 2);
});
test('alias mismatch and failed retag cannot report success', () => {
  for (const failTag of [true, false]) {
    assert.throws(() => preload(VERSION, (_command, args) => ({
      status: failTag && args[0] === 'tag' ? 1 : 0,
      stdout: args[0] === 'image' ? image(args[2] === TARGET ? `sha256:${'c'.repeat(64)}` : id) : '',
    })), failTag ? /preparation failed/u : /alias differs/u);
  }
});
