// The draw's statistics, on node:crypto like the server: many draws, counted. Not in CI (the
// family's rule since 2026-10-20: CI runs the unit tests); run them with `npm run test:sim`.
// Every valid draw equally likely, for both shapes and with households (each valid draw counted
// against a brute-force list of them all); every allowed giver → recipient pair about as likely as
// any other; the search for large households always valid and reaching every allowed pair; and the
// patches for a drop-out and a late joiner valid and as small as promised, over many draws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { changedGivers, draw, patchIn, patchOut, valid } from '../shared/draw.mjs';

const people = (n) => Array.from({ length: n }, (_, i) => `p${i}`);

/** Every assignment of `ids` that the rules allow, as keys like "p1,p2,p0". */
function allValid(ids, households, shape) {
  const out = [];
  const permute = (rest, chosen) => {
    if (!rest.length) {
      const pairs = Object.fromEntries(ids.map((g, i) => [g, chosen[i]]));
      if (valid(pairs, ids, households, shape)) out.push(chosen.join());
      return;
    }
    for (const r of rest) permute(rest.filter((x) => x !== r), [...chosen, r]);
  };
  permute(ids, []);
  return out;
}

/**
 * Pearson's chi-square of the counts against equal odds. The bound is the 0.1 % critical value for
 * the degrees of freedom (Wilson–Hilferty), so a fair draw fails once in a thousand runs.
 */
function chiSquare(counts, total) {
  const k = counts.length;
  const expected = total / k;
  const stat = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
  const df = k - 1;
  const z = 3.09;
  const bound = df * (1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))) ** 3;
  return { stat, bound };
}

function uniform(ids, households, shape, perDraw = 2000) {
  const keys = allValid(ids, households, shape);
  const counts = new Map(keys.map((k) => [k, 0]));
  const total = keys.length * perDraw;
  for (let i = 0; i < total; i++) {
    const { pairs, how } = draw(ids, households, shape, randomInt);
    assert.equal(how, 'uniform');
    const key = ids.map((g) => pairs[g]).join();
    assert.ok(counts.has(key), `an invalid draw: ${key}`);
    counts.set(key, counts.get(key) + 1);
  }
  const { stat, bound } = chiSquare([...counts.values()], total);
  assert.ok(stat < bound, `${keys.length} draws, chi-square ${stat.toFixed(1)} over ${bound.toFixed(1)}`);
  return keys.length;
}

test('any valid draw: all 44 for five people come up equally often', () => {
  assert.equal(uniform(people(5), [], 'any'), 44);
});

test('any valid draw with a couple: every one of them equally often', () => {
  const n = uniform(people(5), [['p0', 'p1']], 'any');
  assert.ok(n > 0 && n < 44);
});

test('one circle: all 24 circles through five people come up equally often', () => {
  assert.equal(uniform(people(5), [], 'chain'), 24);
});

test('one circle with two couples: every allowed circle equally often', () => {
  const n = uniform(people(6), [['p0', 'p1'], ['p2', 'p3']], 'chain', 1500);
  assert.ok(n > 0 && n < 120);
});

// Without households only: with them, every valid draw is still equally likely, but someone living
// alone draws a household's members more often (they can't draw each other, so someone else must).
test('without households, everyone is as likely to draw each of the others', () => {
  const ids = people(8);
  const households = [];
  for (const shape of ['any', 'chain']) {
    const counts = new Map();
    const total = 40_000;
    for (let i = 0; i < total; i++) {
      const { pairs } = draw(ids, households, shape, randomInt);
      const k = `${pairs.p5}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    assert.equal(counts.size, 7, shape);
    const { stat, bound } = chiSquare([...counts.values()], total);
    assert.ok(stat < bound, `${shape}: chi-square ${stat.toFixed(1)} over ${bound.toFixed(1)}`);
  }
});

test('large households: the search always finds a valid draw, reaches every possible pair, roughly evenly', () => {
  const ids = people(20);
  // Exactly half in one household: random orders almost never fit, so the search takes over. Every
  // draw then crosses between the household and the rest, and every crossing pair is possible.
  const home = ids.slice(0, 10);
  const households = [home, ['p10', 'p11']];
  const inHome = (id) => home.includes(id);
  const crossing = ids.flatMap((g) => ids.filter((r) => inHome(g) !== inHome(r)).map((r) => `${g}>${r}`));
  for (const shape of ['any', 'chain']) {
    const seen = new Map();
    const how = new Set();
    const total = 1500;
    for (let i = 0; i < total; i++) {
      const result = draw(ids, households, shape, randomInt);
      assert.ok(valid(result.pairs, ids, households, shape), shape);
      how.add(result.how);
      for (const [g, r] of Object.entries(result.pairs)) seen.set(`${g}>${r}`, (seen.get(`${g}>${r}`) ?? 0) + 1);
    }
    assert.ok(how.has('search'), `${shape}: the search ran`);
    assert.deepEqual([...seen.keys()].filter((p) => !crossing.includes(p)), [], `${shape}: a pair that can't be`);
    assert.deepEqual(crossing.filter((p) => !seen.has(p)), [], `${shape}: pairs the search never made`);
    // Not exactly uniform (that's the rejection sampling's job), but no pair is far off its share.
    const share = total / 10;
    for (const [p, c] of seen) assert.ok(c > share * 0.5 && c < share * 1.5, `${shape}: ${p} drawn ${c} times, a fair share is ${share}`);
  }
});

test('a drop-out: the patch stays valid and changes one draw where it can, three at most', () => {
  for (const shape of ['any', 'chain']) {
    const tally = new Map();
    for (let i = 0; i < 4000; i++) {
      const n = 4 + randomInt(9);
      const ids = people(n);
      const households = n >= 6 ? [['p0', 'p1']] : [];
      const { pairs } = draw(ids, households, shape, randomInt);
      const out = ids[randomInt(n)];
      const next = patchOut(pairs, out, ids, households, shape, randomInt);
      const rest = ids.filter((id) => id !== out);
      if (!next) continue;
      assert.ok(valid(next, rest, households, shape), `${shape}: valid after ${out} left`);
      const changed = changedGivers(pairs, next).length;
      assert.ok(changed >= 1 && changed <= (shape === 'chain' ? 3 : 2), `${shape}: ${changed} changed`);
      tally.set(changed, (tally.get(changed) ?? 0) + 1);
    }
    // Mostly the drop-out's giver just takes over their person.
    assert.ok((tally.get(1) ?? 0) > 3000, `${shape}: ${JSON.stringify([...tally])}`);
  }
});

test('a late joiner: fitted in with exactly one changed draw, always valid', () => {
  for (const shape of ['any', 'chain']) {
    for (let i = 0; i < 4000; i++) {
      const n = 3 + randomInt(10);
      const ids = people(n);
      const households = n >= 5 ? [['p0', 'p1']] : [];
      const { pairs } = draw(ids, households, shape, randomInt);
      // Sometimes the newcomer joins the couple's household.
      const joinsCouple = households.length && randomInt(3) === 0;
      const after = joinsCouple ? [['p0', 'p1', 'new']] : households;
      const next = patchIn(pairs, 'new', [...ids, 'new'], after, shape, randomInt);
      if (!next) continue;
      assert.ok(valid(next, [...ids, 'new'], after, shape), shape);
      assert.equal(changedGivers(pairs, next).length, 1, shape);
    }
  }
});
