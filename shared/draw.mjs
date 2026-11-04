// The draw: who gives to whom. Shared by the server (which draws) and the host's page (which says
// before the draw whether one is possible). No dependencies, and no randomness of its own: the
// server passes `randomInt` from node:crypto (learnings/randomness.md), the tests a seeded one.
//
// A draw is `pairs`, giver id → recipient id. Nobody draws themselves or anyone from their own
// household. Two shapes:
//   chain  one closed circle through everyone (A→B→C→…→A), so nobody gives to the person who
//          gives to them;
//   any    any assignment that keeps the rules above (two people may draw each other).
// With households as the only rule, both exist exactly when there are at least three people and
// no household holds more than half of them (a complete multipartite graph has a Hamiltonian cycle
// then, and Hall's condition holds), so the shape never decides whether a draw is possible.

/** @typedef {(n: number) => number} RandomInt  an integer in [0, n) */
/** @typedef {Record<string, string>} Pairs  giver id → recipient id */

/** Tries of the exactly uniform rejection step before the randomised search takes over. */
const TRIES = 4000;

/** Each person's household: a list of households (id lists) becomes id → household index. */
export function householdOf(ids, households = []) {
  const map = new Map();
  households.forEach((members, i) => {
    for (const id of members) if (ids.includes(id)) map.set(id, `h${i}`);
  });
  for (const id of ids) if (!map.has(id)) map.set(id, `p:${id}`);
  return map;
}

/**
 * Whether a draw is possible: `{ ok: true }`, or `{ ok: false, reason, household? }` with the
 * reason `few` (under three people) or `household` (one holds more than half, its index given).
 */
export function possible(ids, households = []) {
  if (ids.length < 3) return { ok: false, reason: 'few' };
  const of = householdOf(ids, households);
  const counts = new Map();
  for (const id of ids) counts.set(of.get(id), (counts.get(of.get(id)) ?? 0) + 1);
  for (const [h, count] of counts) {
    if (count * 2 > ids.length) return { ok: false, reason: 'household', household: Number(h.slice(1)) };
  }
  return { ok: true };
}

/** Whether `pairs` is a valid draw of exactly `ids` in `shape`. */
export function valid(pairs, ids, households = [], shape = 'any') {
  const of = householdOf(ids, households);
  const givers = Object.keys(pairs);
  if (givers.length !== ids.length || !ids.every((id) => id in pairs)) return false;
  const recipients = new Set(Object.values(pairs));
  if (recipients.size !== ids.length || !ids.every((id) => recipients.has(id))) return false;
  for (const [g, r] of Object.entries(pairs)) if (g === r || of.get(g) === of.get(r)) return false;
  if (shape === 'chain') {
    // One circle: following the draws from anyone visits everyone before coming back.
    let at = ids[0];
    for (let i = 1; i < ids.length; i++) {
      at = pairs[at];
      if (at === ids[0]) return false;
    }
    if (pairs[at] !== ids[0]) return false;
  }
  return true;
}

function shuffle(list, randomInt) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A circle in this order: each gives to the next, the last to the first. Keyed in `ids` order, so
 * the object's own order never tells the circle's. */
function closeCircle(order, ids) {
  const next = new Map(order.map((id, i) => [id, order[(i + 1) % order.length]]));
  return Object.fromEntries(ids.map((id) => [id, next.get(id)]));
}

/**
 * A new draw of `ids`. Rejection sampling first, which is exactly uniform over the valid draws: a
 * random order (chain: closed into a circle; any: read as giver i → recipient order[i]) is kept only
 * if it breaks no rule. Large households make that slow, so after TRIES a randomised search takes
 * over, which always finds one when `possible` says there is one. Throws when there is none.
 *
 * @returns {{ pairs: Pairs, how: 'uniform' | 'search' }}
 */
export function draw(ids, households, shape, randomInt) {
  const check = possible(ids, households);
  if (!check.ok) throw new Error(`no draw: ${check.reason}`);
  const of = householdOf(ids, households);
  for (let t = 0; t < TRIES; t++) {
    const order = shuffle(ids, randomInt);
    if (shape === 'chain') {
      if (order.every((id, i) => of.get(id) !== of.get(order[(i + 1) % order.length]))) return { pairs: closeCircle(order, ids), how: 'uniform' };
    } else if (ids.every((g, i) => of.get(g) !== of.get(order[i]))) {
      return { pairs: Object.fromEntries(ids.map((g, i) => [g, order[i]])), how: 'uniform' };
    }
  }
  return { pairs: shape === 'chain' ? searchChain(ids, of, randomInt) : searchAny(ids, of, randomInt), how: 'search' };
}

/**
 * Any valid draw by a randomised greedy assignment that never runs into a dead end: a giver may
 * only take a recipient if every household's remaining givers still find enough recipients outside
 * their household (Hall's condition, which is exact for household rules).
 */
function searchAny(ids, of, randomInt) {
  const givers = shuffle(ids, randomInt);
  const left = new Set(ids);
  const pairs = {};
  const count = (set) => {
    const m = new Map();
    for (const id of set) m.set(of.get(id), (m.get(of.get(id)) ?? 0) + 1);
    return m;
  };
  for (let i = 0; i < givers.length; i++) {
    const g = givers[i];
    const options = shuffle([...left].filter((r) => of.get(r) !== of.get(g)), randomInt);
    const rest = givers.slice(i + 1);
    const chosen = options.find((r) => {
      left.delete(r);
      const gs = count(rest);
      const rs = count(left);
      const ok = [...gs].every(([h, n]) => n <= left.size - (rs.get(h) ?? 0));
      left.add(r);
      return ok;
    });
    if (chosen === undefined) throw new Error('no draw');
    pairs[g] = chosen;
    left.delete(chosen);
  }
  return Object.fromEntries(ids.map((id) => [id, pairs[id]]));
}

/**
 * A circle by randomised backtracking: the next person is a random one from another household than
 * the last, as long as the rest can still be laid out between them and the first (no household may
 * need more than every other place). Restarts if a branch grows too long, which with that check is
 * rare; the circle always closes when `possible` says it can.
 */
function searchChain(ids, of, randomInt) {
  const n = ids.length;
  const fits = (rest, last, first) => {
    const m = rest.length;
    if (!m) return of.get(last) !== of.get(first);
    const counts = new Map();
    for (const id of rest) counts.set(of.get(id), (counts.get(of.get(id)) ?? 0) + 1);
    for (const [h, c] of counts) {
      if (c > Math.ceil(m / 2)) return false;
      // Every other place, both ends: neither neighbour may be from it.
      if (m % 2 === 1 && c === (m + 1) / 2 && (h === of.get(last) || h === of.get(first))) return false;
      // Every other place, one end: one neighbour must be from another household.
      if (m % 2 === 0 && c === m / 2 && h === of.get(last) && h === of.get(first)) return false;
    }
    return true;
  };
  for (let attempt = 0; attempt < 50; attempt++) {
    let steps = 0;
    const order = [ids[randomInt(n)]];
    const walk = (rest) => {
      if (++steps > 20_000) return false;
      if (!rest.length) return of.get(order[order.length - 1]) !== of.get(order[0]);
      const last = order[order.length - 1];
      for (const next of shuffle(rest, randomInt)) {
        if (of.get(next) === of.get(last)) continue;
        const after = rest.filter((id) => id !== next);
        if (!fits(after, next, order[0])) continue;
        order.push(next);
        if (walk(after)) return true;
        order.pop();
      }
      return false;
    };
    if (walk(ids.filter((id) => id !== order[0]))) return closeCircle(order, ids);
  }
  throw new Error('no draw');
}

/** Givers whose recipient differs between two draws (people only in `after` left out). */
export function changedGivers(before, after) {
  return Object.keys(after).filter((g) => g in before && before[g] !== after[g]);
}

/**
 * Takes `out` out of a draw with the fewest changes. Their giver takes over their person; if that
 * breaks a rule (the giver would draw themselves or their household), two draws are swapped
 * instead (any shape), or in a chain someone else steps in between (three draws change). Returns
 * the new pairs, or null when only a redraw will do.
 */
export function patchOut(pairs, out, ids, households, shape, randomInt) {
  const rest = ids.filter((id) => id !== out);
  if (!possible(rest, households).ok) return null;
  const of = householdOf(rest, households);
  const giver = Object.keys(pairs).find((g) => pairs[g] === out);
  const next = { ...pairs };
  delete next[out];
  const target = pairs[out];
  const allowed = (g, r) => g !== r && of.get(g) !== of.get(r);
  if (allowed(giver, target)) {
    next[giver] = target;
    return valid(next, rest, households, shape) ? next : null;
  }
  if (shape !== 'chain') {
    // The giver takes someone else's person, who takes the drop-out's.
    for (const x of shuffle(rest.filter((id) => id !== giver), randomInt)) {
      const y = next[x];
      if (allowed(giver, y) && allowed(x, target)) {
        next[giver] = y;
        next[x] = target;
        if (valid(next, rest, households, shape)) return next;
        next[x] = y;
      }
    }
    return null;
  }
  // A chain without the drop-out: … → giver → (out) → target → …; someone z leaves their place
  // a → z → b (a now gives to b) and steps in: giver → z → target.
  for (const z of shuffle(rest.filter((id) => id !== giver && id !== target), randomInt)) {
    const a = Object.keys(next).find((g) => next[g] === z);
    const b = next[z];
    if (a === undefined || !allowed(giver, z) || !allowed(z, target) || !allowed(a, b)) continue;
    const tryPairs = { ...next, [a]: b, [giver]: z, [z]: target };
    if (valid(tryPairs, rest, households, shape)) return tryPairs;
  }
  return null;
}

/**
 * Puts a newcomer into a draw with one change: a random draw a → b becomes a → new → b. Returns the
 * new pairs, or null when no draw can take them (then only a redraw will do).
 */
export function patchIn(pairs, added, ids, households, shape, randomInt) {
  const all = [...ids.filter((id) => id !== added), added];
  if (!possible(all, households).ok) return null;
  const of = householdOf(all, households);
  for (const a of shuffle(Object.keys(pairs), randomInt)) {
    const b = pairs[a];
    if (of.get(a) === of.get(added) || of.get(b) === of.get(added)) continue;
    const next = { ...pairs, [a]: added, [added]: b };
    if (valid(next, all, households, shape)) return next;
  }
  return null;
}
