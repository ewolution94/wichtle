import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedGivers, draw, householdOf, patchIn, patchOut, possible, valid } from '../shared/draw.mjs';

/** A seeded source (mulberry32), so every run draws the same: the real one is node:crypto. */
function seeded(seed) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

const people = (n) => Array.from({ length: n }, (_, i) => `p${i}`);

test('a draw is possible with three or more and no household over half', () => {
  assert.deepEqual(possible(people(2)), { ok: false, reason: 'few' });
  assert.deepEqual(possible(people(3)), { ok: true });
  assert.deepEqual(possible(people(4), [['p0', 'p1']]), { ok: true });
  assert.deepEqual(possible(people(4), [['p0', 'p1', 'p2']]), { ok: false, reason: 'household', household: 0 });
  // Exactly half is still possible: everyone else sits between them.
  assert.deepEqual(possible(people(6), [['p0', 'p1', 'p2']]), { ok: true });
  assert.deepEqual(possible(people(5), [['p3', 'p4'], ['p0', 'p1', 'p2']]), { ok: false, reason: 'household', household: 1 });
});

test('households: unlisted people are their own, strangers are ignored', () => {
  const of = householdOf(['a', 'b', 'c'], [['a', 'b', 'zz']]);
  assert.equal(of.get('a'), of.get('b'));
  assert.notEqual(of.get('a'), of.get('c'));
  assert.equal(of.has('zz'), false);
});

test('every draw keeps the rules, in both shapes, across sizes and households', () => {
  const random = seeded(1);
  const cases = [
    [3, []],
    [4, [['p0', 'p1']]],
    [5, [['p0', 'p1'], ['p2', 'p3']]],
    [12, [['p0', 'p1'], ['p2', 'p3', 'p4'], ['p5', 'p6']]],
    [6, [['p0', 'p1', 'p2']]],
    [30, [['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14']]],
    [100, []],
  ];
  for (const [n, households] of cases) {
    for (const shape of ['chain', 'any']) {
      for (let i = 0; i < 40; i++) {
        const { pairs } = draw(people(n), households, shape, random);
        assert.ok(valid(pairs, people(n), households, shape), `${n} ${shape} ${JSON.stringify(households)}`);
      }
    }
  }
});

test('a chain never has two people drawing each other; any may', () => {
  const random = seeded(2);
  let mutual = 0;
  for (let i = 0; i < 300; i++) {
    const chain = draw(people(4), [], 'chain', random).pairs;
    assert.ok(Object.entries(chain).every(([g, r]) => chain[r] !== g));
    const any = draw(people(4), [], 'any', random).pairs;
    if (Object.entries(any).some(([g, r]) => any[r] === g)) mutual++;
  }
  assert.ok(mutual > 0);
});

test('a group half one household is drawn by the search, and still keeps the rules', () => {
  const random = seeded(3);
  const ids = people(40);
  const households = [ids.slice(0, 20)];
  for (const shape of ['chain', 'any']) {
    const { pairs, how } = draw(ids, households, shape, random);
    assert.equal(how, 'search');
    assert.ok(valid(pairs, ids, households, shape));
  }
});

test('an impossible draw throws', () => {
  assert.throws(() => draw(people(4), [['p0', 'p1', 'p2']], 'chain', seeded(4)));
  assert.throws(() => draw(people(2), [], 'any', seeded(4)));
});

test('the rejection step is uniform: every valid draw of four comes up as often', () => {
  const random = seeded(5);
  // Four people: 9 derangements; 3! = 6 circles.
  for (const [shape, kinds] of [['any', 9], ['chain', 6]]) {
    const counts = new Map();
    const runs = kinds * 2000;
    for (let i = 0; i < runs; i++) {
      const { pairs, how } = draw(people(4), [], shape, random);
      assert.equal(how, 'uniform');
      const k = JSON.stringify(pairs);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    assert.equal(counts.size, kinds, shape);
    for (const c of counts.values()) assert.ok(Math.abs(c - 2000) < 2000 * 0.12, `${shape}: ${c}`);
  }
});

test('with a couple, the uniform step still covers every valid draw evenly', () => {
  const random = seeded(6);
  const ids = people(5);
  const households = [['p0', 'p1']];
  const counts = new Map();
  for (let i = 0; i < 24000; i++) {
    const k = JSON.stringify(draw(ids, households, 'chain', random).pairs);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // Circles of five with p0 and p1 never side by side: 4!/… counted by hand is 12 directed circles.
  assert.equal(counts.size, 12);
  const mean = 24000 / 12;
  for (const c of counts.values()) assert.ok(Math.abs(c - mean) < mean * 0.12, String(c));
});

test('a drop-out changes one draw when it can (their giver takes their person)', () => {
  const random = seeded(7);
  for (const shape of ['chain', 'any']) {
    for (let i = 0; i < 200; i++) {
      const ids = people(8);
      const { pairs } = draw(ids, [], shape, random);
      const out = ids[random(ids.length)];
      const next = patchOut(pairs, out, ids, [], shape, random);
      const rest = ids.filter((id) => id !== out);
      if (shape === 'chain') {
        assert.ok(next);
        assert.equal(changedGivers(pairs, next).length, 1);
      }
      if (next) {
        assert.ok(valid(next, rest, [], shape));
        assert.ok(changedGivers(pairs, next).length <= 2);
      }
    }
  }
});

test('a drop-out whose giver would draw their own household: a swap, or a step-in in a chain', () => {
  const random = seeded(8);
  const ids = people(9);
  const households = [['p0', 'p1'], ['p2', 'p3']];
  let patched = 0;
  let wide = 0;
  for (let i = 0; i < 400; i++) {
    for (const shape of ['chain', 'any']) {
      const { pairs } = draw(ids, households, shape, random);
      const out = ids[random(ids.length)];
      const next = patchOut(pairs, out, ids, households, shape, random);
      if (!next) continue;
      patched++;
      const rest = ids.filter((id) => id !== out);
      assert.ok(valid(next, rest, households, shape));
      const changes = changedGivers(pairs, next).length;
      assert.ok(changes <= (shape === 'chain' ? 3 : 2), `${shape} ${changes}`);
      if (changes > 1) wide++;
    }
  }
  assert.ok(patched > 700);
  assert.ok(wide > 0, 'some drop-outs needed more than one change');
});

test('a late joiner goes in between two people: one existing draw changes', () => {
  const random = seeded(9);
  for (const shape of ['chain', 'any']) {
    for (let i = 0; i < 200; i++) {
      const ids = people(7);
      const { pairs } = draw(ids, [['p0', 'p1']], shape, random);
      // Every other time the newcomer moves in with the couple.
      const households = i % 2 ? [['p0', 'p1', 'new']] : [['p0', 'p1']];
      const next = patchIn(pairs, 'new', ids, households, shape, random);
      assert.ok(next);
      assert.ok(valid(next, [...ids, 'new'], households, shape));
      assert.equal(changedGivers(pairs, next).length, 1);
    }
  }
});

test('valid() rejects broken draws', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.equal(valid({ a: 'b', b: 'a', c: 'd', d: 'c' }, ids, [], 'any'), true);
  assert.equal(valid({ a: 'b', b: 'a', c: 'd', d: 'c' }, ids, [], 'chain'), false);
  assert.equal(valid({ a: 'b', b: 'c', c: 'd', d: 'a' }, ids, [], 'chain'), true);
  assert.equal(valid({ a: 'b', b: 'c', c: 'd', d: 'a' }, ids, [['a', 'b']], 'chain'), false);
  assert.equal(valid({ a: 'a', b: 'c', c: 'd', d: 'b' }, ids, [], 'any'), false);
  assert.equal(valid({ a: 'b', b: 'c', c: 'b', d: 'a' }, ids, [], 'any'), false);
  assert.equal(valid({ a: 'b', b: 'c', c: 'a' }, ids, [], 'any'), false);
});
