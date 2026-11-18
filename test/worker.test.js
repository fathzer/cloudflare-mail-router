import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { KEY } from '../worker/index.js';

const kv = (text) => ({ get: async (key) => (key === KEY ? text : null) });

function message(to, { failing = [] } = {}) {
  const sent = [];
  return {
    to,
    sent,
    rejected: null,
    setReject(reason) { this.rejected = reason; },
    async forward(destination) {
      if (failing.includes(destination)) throw new Error('not verified');
      sent.push(destination);
    },
  };
}

const TABLE = JSON.stringify({
  redirections: {
    'a@x.fr': 'me@gmail.com',
    'b@x.fr': ['a@x.fr', 'you@gmail.com'],
  },
});

test('forwards to the destination', async () => {
  const m = message('a@x.fr');
  await worker.email(m, { REDIRECTIONS: kv(TABLE) });
  assert.deepEqual(m.sent, ['me@gmail.com']);
  assert.equal(m.rejected, null);
});

test('resolves aliases, case insensitive, several destinations', async () => {
  const m = message('B@X.fr');
  await worker.email(m, { REDIRECTIONS: kv(TABLE) });
  assert.deepEqual(m.sent, ['me@gmail.com', 'you@gmail.com']);
});

test('rejects an unknown recipient', async () => {
  const m = message('unknown@x.fr');
  await worker.email(m, { REDIRECTIONS: kv(TABLE) });
  assert.deepEqual(m.sent, []);
  assert.equal(m.rejected, 'Unknown recipient');
});

test('does not fail if only some forwards fail', async () => {
  const m = message('b@x.fr', { failing: ['you@gmail.com'] });
  const log = console.error;
  console.error = () => {};
  try {
    await worker.email(m, { REDIRECTIONS: kv(TABLE) });
  } finally {
    console.error = log;
  }
  assert.deepEqual(m.sent, ['me@gmail.com']);
});

test('throws if all the forwards fail', async () => {
  const m = message('a@x.fr', { failing: ['me@gmail.com'] });
  await assert.rejects(worker.email(m, { REDIRECTIONS: kv(TABLE) }), /Unable to forward/);
  assert.equal(m.rejected, null);
});

test('throws, and forwards nothing, if the table is missing or not valid', async () => {
  for (const text of [null, 'not json', '[]', '{"a@x.fr":"me@gmail.com"}', '{"redirections":{"a@x.fr":"b@x.fr","b@x.fr":"a@x.fr"}}', '{"redirections":{"a@x.fr":"me@gmail.com","a@x.fr":"you@gmail.com"}}']) {
    const m = message('a@x.fr');
    await assert.rejects(worker.email(m, { REDIRECTIONS: kv(text) }), String(text));
    assert.deepEqual(m.sent, []);
    assert.equal(m.rejected, null);
  }
});

test('picks up a new version of the table', async () => {
  const m1 = message('a@x.fr');
  await worker.email(m1, { REDIRECTIONS: kv(TABLE) });
  const m2 = message('a@x.fr');
  await worker.email(m2, { REDIRECTIONS: kv('{"redirections":{"a@x.fr":"other@gmail.com"}}') });
  assert.deepEqual(m1.sent, ['me@gmail.com']);
  assert.deepEqual(m2.sent, ['other@gmail.com']);
});

const EXTENDED = JSON.stringify({
  redirections: {
    'a@x.fr': 'me@gmail.com',
    'bs@x.fr': 'sister@gmail.com',
    'both@x.fr': ['me@gmail.com', 'sister@gmail.com'],
    'alias@x.fr': 'bs@x.fr',
  },
  pending: ['sister@gmail.com'],
});

async function receive(to, options) {
  const m = message(to, options);
  const log = console.log;
  console.log = () => {};
  try {
    await worker.email(m, { REDIRECTIONS: kv(EXTENDED) });
  } finally {
    console.log = log;
  }
  return m;
}

test('pending: a pending destination is used as soon as it is verified', async () => {
  const m = await receive('both@x.fr');
  assert.deepEqual(m.sent, ['me@gmail.com', 'sister@gmail.com']);
});

test('pending: a pending destination that is not verified is skipped', async () => {
  const m = await receive('both@x.fr', { failing: ['sister@gmail.com'] });
  assert.deepEqual(m.sent, ['me@gmail.com']);
  assert.equal(m.rejected, null);
});

test('pending: rejects if only pending destinations are not verified', async () => {
  for (const to of ['bs@x.fr', 'alias@x.fr']) {
    const m = await receive(to, { failing: ['sister@gmail.com'] });
    assert.deepEqual(m.sent, []);
    assert.equal(m.rejected, 'Recipient address is not active yet');
  }
});

test('pending: a failing destination that is not pending is still an error', async () => {
  await assert.rejects(receive('a@x.fr', { failing: ['me@gmail.com'] }), /Unable to forward/);
  await assert.rejects(receive('both@x.fr', { failing: ['me@gmail.com', 'sister@gmail.com'] }), /Unable to forward/);
});
