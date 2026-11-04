// The practice run: a group of made-up colleagues who join, write their wishes, open their draws
// and tick their gift steps on their own over a few minutes, so a host can try everything (the live
// draw, the reminder, the unseal, a drop-out) before the real party. Marked as practice on every
// page and deleted after a day. The dummies' own pages open from the host's page.
//
// Each dummy gets its timings when the group starts: seconds after the start (joining, wishes) and
// after its draw is there to see (opening, then the gift ready, the parcel posted, the parcel
// arrived). Two of them are slow, so the reminder has someone to name.

export const PRACTICE_CODE = 'wichtel';

const NAMES = ['Anna', 'Ben', 'Carla', 'David', 'Elif', 'Finn', 'Greta', 'Jonas', 'Lena', 'Mia', 'Noah', 'Paul'];

const WISHES = {
  de: [
    [{ t: 'Gute Schokolade, gern dunkel' }, { t: 'Ein Krimi, der in den Bergen spielt' }],
    [{ t: 'Kräutertöpfe fürs Fensterbrett' }],
    [{ t: 'Etwas Selbstgemachtes' }, { t: 'Wollsocken, Größe 39', l: 'https://example.org/wollsocken' }],
    [{ t: 'Ein Puzzle mit 1000 Teilen' }],
    [{ t: 'Gewürze aus aller Welt' }, { t: 'Eine Kerze, die nach Wald riecht' }],
    [{ t: 'Ein gutes Notizbuch, liniert' }],
    [{ t: 'Tee, gern Rooibos' }, { t: 'Kartenspiel für zwei' }],
    [{ t: 'Überrasch mich!' }],
    [{ t: 'Fahrradlicht', l: 'https://example.org/fahrradlicht' }],
    [{ t: 'Ein Kochbuch mit Suppen' }],
    [],
  ],
  en: [
    [{ t: 'Good chocolate, dark if possible' }, { t: 'A crime novel set in the mountains' }],
    [{ t: 'Herb pots for the windowsill' }],
    [{ t: 'Something homemade' }, { t: 'Wool socks, size 6', l: 'https://example.org/wool-socks' }],
    [{ t: 'A 1000-piece jigsaw' }],
    [{ t: 'Spices from around the world' }, { t: 'A candle that smells of forest' }],
    [{ t: 'A good lined notebook' }],
    [{ t: 'Tea, rooibos please' }, { t: 'A card game for two' }],
    [{ t: 'Surprise me!' }],
    [{ t: 'A bike light', l: 'https://example.org/bike-light' }],
    [{ t: 'A cookbook of soups' }],
    [],
  ],
};

const NOT = {
  de: ['Keine Tassen mehr', '', 'Kein Alkohol', '', 'Nüsse (Allergie)', '', '', '', '', 'Nichts mit Duft', ''],
  en: ['No more mugs', '', 'No alcohol', '', 'Nuts (allergy)', '', '', '', '', 'Nothing scented', ''],
};

const ADDRESSES = [
  'Elif Yılmaz\nKastanienallee 12\n10435 Berlin',
  'Jonas Weber\nAm Sandtorkai 5\n20457 Hamburg',
];

/**
 * The dummies for a practice group whose host is called `hostName`: nine colleagues, one couple
 * among them, two who want their gift posted.
 */
export function dummies(hostName, lang, randomInt) {
  const fold = (s) => s.toLocaleLowerCase('de');
  const names = NAMES.filter((n) => fold(n) !== fold(hostName)).slice(0, 9);
  const between = (a, b) => a + randomInt(b - a + 1);
  const words = WISHES[lang] ?? WISHES.de;
  const nots = NOT[lang] ?? NOT.de;
  return names.map((name, i) => {
    const post = i === 4 || i === 7;
    const slow = i === 2 || i === 8;
    return {
      name,
      plan: {
        handover: post ? 'post' : 'party',
        address: post ? ADDRESSES[i === 4 ? 0 : 1].replace(/^[^\s]+/, name) : '',
        wishlist: words[i % words.length],
        not: nots[i % nots.length],
        // One joins late, after six minutes; the rest in the first two and a half.
        join: i === 6 ? 360 : between(6, 150),
        wishes: between(4, 40),
        open: slow ? 900 : between(8, 90),
        ready: slow ? 1500 : between(30, 240),
        post: between(20, 90),
        arrive: between(30, 150),
      },
    };
  });
}

/** One dummy pair of the couple: the first two dummies share a household. */
export const COUPLE = [0, 1];

/**
 * Moves the dummies on to wherever their timings have reached by `now`. Returns true when
 * anything changed. `pace` above 1 runs their timings that many times faster (the end-to-end tests).
 */
export function step(doc, now, stageUntil = 0, pace = 1) {
  let changed = false;
  const s = (sec) => (sec * 1000) / pace;
  const byId = new Map(doc.people.map((p) => [p.id, p]));
  for (const p of doc.people) {
    if (!p.dummy || !p.plan) continue;
    const plan = p.plan;
    if (!p.joinedAt && now >= doc.created + s(plan.join)) {
      p.joinedAt = now;
      p.handover = plan.handover;
      p.address = plan.address;
      changed = true;
    }
    if (p.joinedAt && !p.wishesAt && now >= p.joinedAt + s(plan.wishes)) {
      p.wishes = plan.wishlist;
      p.not = plan.not;
      p.wishesAt = now;
      changed = true;
    }
    if (!doc.draw || !(p.id in doc.draw.pairs) || now < stageUntil) continue;
    const seen = Math.max(doc.draw.at, p.changedAt ?? 0, p.joinedAt ?? 0, stageUntil);
    if (p.joinedAt && !p.openedAt && now >= seen + s(plan.open)) {
      p.openedAt = now;
      p.seenAt = now;
      p.changedAt = null;
      changed = true;
    }
    if (p.openedAt && !p.ready && now >= p.openedAt + s(plan.ready)) {
      p.ready = now;
      changed = true;
    }
    const to = byId.get(doc.draw.pairs[p.id]);
    if (p.ready && to && (to.handover ?? doc.handover) === 'post' && !to.posted && now >= p.ready + s(plan.post)) {
      to.posted = now;
      changed = true;
    }
    if (p.posted && !p.arrived && now >= p.posted + s(plan.arrive)) {
      p.arrived = now;
      changed = true;
    }
  }
  return changed;
}
