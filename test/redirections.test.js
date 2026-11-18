import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateKeys, finalDestinations, isEmailAddress, resolve, tableParts, validate } from '../src/redirections.js';

test('isEmailAddress', () => {
  for (const ok of ['a@b.fr', 'first.last+tag@sub.example.com', "o'neil@example.org"]) {
    assert.ok(isEmailAddress(ok), ok);
  }
  for (const ko of ['', 'a', 'a@', '@b.fr', 'a@b', 'a@@b.fr', 'a b@c.fr', 'a..b@c.fr', '.a@c.fr', 'a.@c.fr',
    'A@b.fr', 'a@B.fr', 'Name <a@b.fr>', 'a@b.fr,c@d.fr', 'a@-b.fr', 'a@b.f', null, 42]) {
    assert.ok(!isEmailAddress(ko), String(ko));
  }
});

const table = (redirections, pending) => ({ redirections, ...(pending && { pending }) });

test('valid table', () => {
  assert.deepEqual(validate(table({
    'a@x.fr': 'me@gmail.com',
    'b@x.fr': ['a@x.fr', 'you@gmail.com'],
  })), []);
});

test('invalid structure', () => {
  assert.equal(validate(null).length, 1);
  assert.equal(validate([]).length, 1);
  assert.equal(validate(table({})).length, 1);
  assert.equal(validate(table({ 'a@x.fr': [] })).length, 1);
  assert.equal(validate(table({ 'a@x.fr': 3 })).length, 1);
  assert.equal(validate(table({ 'a@x.fr': ['b@y.fr', 3] })).length, 1);
});

test('invalid addresses', () => {
  const errors = validate(table({ 'bad': 'me@gmail.com', 'a@x.fr': 'nope', 'B@x.fr': 'me@gmail.com' }));
  assert.equal(errors.length, 3);
});

test('duplicate destination', () => {
  assert.equal(validate(table({ 'a@x.fr': ['me@gmail.com', 'me@gmail.com'] })).length, 1);
});

test('the same destination can be used by several sources', () => {
  assert.deepEqual(validate(table({ 'a@x.fr': 'me@gmail.com', 'b@x.fr': 'me@gmail.com' })), []);
});

test('cycles', () => {
  assert.deepEqual(validate(table({ 'a@x.fr': 'a@x.fr' })), ['Cycle: a@x.fr -> a@x.fr']);
  assert.deepEqual(validate(table({ 'a@x.fr': 'b@x.fr', 'b@x.fr': 'a@x.fr' })), ['Cycle: a@x.fr -> b@x.fr -> a@x.fr']);
  const errors = validate(table({ 'a@x.fr': ['me@gmail.com', 'b@x.fr'], 'b@x.fr': 'c@x.fr', 'c@x.fr': ['d@y.fr', 'b@x.fr'] }));
  assert.deepEqual(errors, ['Cycle: b@x.fr -> c@x.fr -> b@x.fr']);
});

test('alias of a managed domain that is not in the table', () => {
  const errors = validate(table({ 'a@x.fr': 'gone@x.fr' }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /gone@x\.fr/);
});

test('findDuplicateKeys', () => {
  assert.deepEqual(findDuplicateKeys('{"a@x.fr":"b@y.fr","a@x.fr":"c@y.fr"}'), ['a@x.fr']);
  assert.deepEqual(findDuplicateKeys('{\n "a@x.fr": ["b@y.fr", "a@x.fr"],\n "b@x.fr": "a@x.fr"\n}'), []);
  assert.deepEqual(findDuplicateKeys('{"a@x.fr":"b@y.fr","a@x.fr":"b@y.fr","a@x.fr":"b@y.fr"}'), ['a@x.fr']);
});

test('resolve', () => {
  const t = table({
    'a@x.fr': 'me@gmail.com',
    'b@x.fr': ['a@x.fr', 'you@gmail.com'],
    'c@x.fr': ['b@x.fr', 'me@gmail.com'],
  });
  assert.deepEqual(resolve(t, 'a@x.fr'), ['me@gmail.com']);
  assert.deepEqual(resolve(t, 'C@X.fr'), ['me@gmail.com', 'you@gmail.com']);
  assert.equal(resolve(t, 'unknown@x.fr'), null);
  assert.equal(resolve(t, 'constructor'), null);
});

test('resolve does not trust the table', () => {
  assert.throws(() => resolve(table({ 'a@x.fr': 'b@x.fr', 'b@x.fr': 'a@x.fr' }), 'a@x.fr'), /cycle/);
  const deep = {};
  for (let i = 0; i < 20; i++) deep[`a${i}@x.fr`] = `a${i + 1}@x.fr`;
  deep['a20@x.fr'] = 'me@gmail.com';
  assert.throws(() => resolve(table(deep), 'a0@x.fr'), /too deep/);
  assert.throws(() => resolve(table({ 'a@x.fr': 3 }), 'a@x.fr'), /Invalid entry/);
});

const EXTENDED = {
  redirections: { 'a@x.fr': 'me@gmail.com', 'b@x.fr': ['a@x.fr', 'sister@gmail.com'] },
  pending: ['sister@gmail.com'],
};

test('the old form of the table (without "redirections") is refused', () => {
  assert.equal(validate({ 'a@x.fr': 'me@gmail.com' }).length, 1);
});

test('table with pending destinations: valid, split and resolved', () => {
  assert.deepEqual(validate(EXTENDED), []);
  assert.deepEqual(validate({ redirections: EXTENDED.redirections }), []);
  assert.deepEqual(tableParts(EXTENDED).pending, ['sister@gmail.com']);
  assert.deepEqual(tableParts({ redirections: { 'a@x.fr': 'me@gmail.com' } }), { redirections: { 'a@x.fr': 'me@gmail.com' }, pending: [] });
  assert.deepEqual(resolve(EXTENDED, 'B@x.fr'), ['me@gmail.com', 'sister@gmail.com']);
  assert.equal(resolve(EXTENDED, 'pending@x.fr'), null);
  assert.deepEqual(finalDestinations(EXTENDED), ['me@gmail.com', 'sister@gmail.com']);
});

test('table: invalid structure', () => {
  assert.equal(validate({ redirections: [] }).length, 1);
  assert.equal(validate({ redirections: EXTENDED.redirections, pending: 'sister@gmail.com' }).length, 1);
  assert.equal(validate({ redirections: EXTENDED.redirections, other: 1 }).length, 1);
  assert.equal(validate({ pending: [] , redirections: 3 }).length, 1);
});

test('table: invalid pending addresses', () => {
  const redirections = EXTENDED.redirections;
  assert.equal(validate({ redirections, pending: ['nope'] }).length, 1);
  assert.match(validate({ redirections, pending: ['sister@gmail.com', 'sister@gmail.com'] })[0], /Duplicate pending/);
  assert.match(validate({ redirections, pending: ['a@x.fr'] })[0], /is a source/);
  assert.match(validate({ redirections, pending: ['unused@gmail.com'] })[0], /not the destination/);
});

test('table: the other rules still apply', () => {
  assert.deepEqual(validate({ redirections: { 'a@x.fr': 'b@x.fr', 'b@x.fr': 'a@x.fr' } }), ['Cycle: a@x.fr -> b@x.fr -> a@x.fr']);
});

test('findDuplicateKeys looks in every object', () => {
  assert.deepEqual(findDuplicateKeys('{"redirections":{"a@x.fr":"b@y.fr","a@x.fr":"c@y.fr"},"pending":[]}'), ['a@x.fr']);
  assert.deepEqual(findDuplicateKeys('{"redirections":{"a@x.fr":"b@y.fr"},"pending":["a@x.fr"]}'), []);
  assert.deepEqual(findDuplicateKeys('{"redirections":{},"redirections":{}}'), ['redirections']);
  assert.deepEqual(findDuplicateKeys('{"a":{"k":1},"b":{"k":2}}'), []);
});
