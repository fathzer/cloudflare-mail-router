import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalDestinations } from '../src/redirections.js';
import { checkDestinations, findUnverified, findVerified, listDestinationAddresses } from '../src/cloudflare.js';

test('finalDestinations', () => {
  const table = { redirections: { 'a@x.fr': 'me@gmail.com', 'b@x.fr': ['a@x.fr', 'you@gmail.com'], 'c@x.fr': 'me@gmail.com' } };
  assert.deepEqual(finalDestinations(table), ['me@gmail.com', 'you@gmail.com']);
});

test('findUnverified', () => {
  const known = [
    { email: 'me@gmail.com', verified: '2026-01-01T00:00:00Z' },
    { email: 'You@gmail.com', verified: null },
  ];
  assert.deepEqual(findUnverified(['me@gmail.com', 'you@gmail.com', 'other@gmail.com'], known), [
    { address: 'you@gmail.com', reason: 'declared but not verified yet' },
    { address: 'other@gmail.com', reason: 'not declared in Cloudflare' },
  ]);
});

test('listDestinationAddresses follows the pages', async () => {
  const urls = [];
  const fetcher = async (url, init) => {
    urls.push(url);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    const page = Number(new URL(url).searchParams.get('page'));
    return { ok: true, status: 200, json: async () => ({
      success: true, result: [{ email: `p${page}@x.fr`, verified: null }], result_info: { total_pages: 2 },
    }) };
  };
  const result = await listDestinationAddresses({ accountId: 'acc', token: 'tok', fetch: fetcher });
  assert.deepEqual(result.map((a) => a.email), ['p1@x.fr', 'p2@x.fr']);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /accounts\/acc\/email\/routing\/addresses/);
});

test('listDestinationAddresses reports API errors', async () => {
  const fetcher = async () => ({ ok: false, status: 403, statusText: 'Forbidden',
    json: async () => ({ success: false, errors: [{ message: 'Authentication error' }] }) });
  await assert.rejects(listDestinationAddresses({ accountId: 'a', token: 't', fetch: fetcher }), /403.*Authentication error/);
});

test('findVerified', () => {
  const known = [{ email: 'me@gmail.com', verified: '2026-01-01T00:00:00Z' }, { email: 'you@gmail.com', verified: null }];
  assert.deepEqual(findVerified(['me@gmail.com', 'you@gmail.com', 'other@gmail.com'], known), ['me@gmail.com']);
});

const OK = '2026-01-01T00:00:00Z';
const TABLE = {
  redirections: { 'a@x.fr': 'me@gmail.com', 'b@x.fr': ['a@x.fr', 'sister@gmail.com'] },
  pending: ['sister@gmail.com'],
};

test('checkDestinations: everything is fine', () => {
  const known = [{ email: 'me@gmail.com', verified: OK }, { email: 'sister@gmail.com', verified: null }];
  assert.deepEqual(checkDestinations(TABLE, known), { problems: [], activeCount: 1 });
  // A pending destination that is not even declared is fine too
  assert.deepEqual(checkDestinations(TABLE, [{ email: 'me@gmail.com', verified: OK }]).problems, []);
});

test('checkDestinations: an active destination must be verified', () => {
  const known = [{ email: 'me@gmail.com', verified: null }];
  assert.deepEqual(checkDestinations(TABLE, known).problems, [{ address: 'me@gmail.com', reason: 'declared but not verified yet' }]);
  assert.deepEqual(checkDestinations(TABLE, []).problems, [{ address: 'me@gmail.com', reason: 'not declared in Cloudflare' }]);
});

test('checkDestinations: a pending destination must not be verified', () => {
  const known = [{ email: 'me@gmail.com', verified: OK }, { email: 'sister@gmail.com', verified: OK }];
  assert.deepEqual(checkDestinations(TABLE, known).problems, [
    { address: 'sister@gmail.com', reason: 'is verified, remove it from the pending destinations' },
  ]);
});
