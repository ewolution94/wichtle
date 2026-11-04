// The paper cuts drawn as SVG: the firs and hills behind the village, the star, and the candle arch of
// the live draw (from look B in plans/wichtle/looks.html). Decoration only: the firs are placed by a
// seeded LCG so every page draws the same skyline (never for anything that's drawn by lot).

/** A star with `n` points, outer radius `R`, inner `r`, round the origin. */
export const starPoints = (n: number, R: number, r: number) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const d = i % 2 ? r : R;
    return `${(Math.cos(a) * d).toFixed(2)},${(Math.sin(a) * d).toFixed(2)}`;
  }).join(' ');

export const STAR = `<svg viewBox="-12 -12 24 24" aria-hidden="true"><polygon class="c1" points="${starPoints(8, 11.5, 5)}"/></svg>`;

/** Paper-cut firs, three tiers each, in a strip `w` wide and `h` high. */
export function firs(w: number, h: number, n: number, seed: number, cls: string, x0 = 0, dy = 0) {
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.2 + rnd() * 0.6) * w) / n;
    const th = h * (0.5 + rnd() * 0.5);
    const tw = th * 0.36;
    const top = h - th;
    for (let t = 0; t < 3; t++) {
      const ty = top + t * th * 0.24;
      const ww = tw * (0.45 + t * 0.28);
      d += `M${x.toFixed(1)} ${ty.toFixed(1)}L${(x + ww).toFixed(1)} ${(ty + th * 0.36).toFixed(1)}H${(x - ww).toFixed(1)}Z`;
    }
    d += `M${(x - 2).toFixed(1)} ${h}V${(h - th * 0.12).toFixed(1)}h4V${h}Z`;
  }
  return `<path class="${cls}"${dy ? ` transform="translate(0 ${dy})"` : ''} d="${d}"/>`;
}

/** The hills and woods behind the houses, 848 × 160. */
export const HILLS = `<path class="c3" d="M0 160V70Q150 20 330 64T640 46T848 60V160Z"/>${firs(848, 150, 22, 7, 'c3')}<path class="c2" d="M0 160V112Q120 84 260 104T560 96T848 108V160Z"/>${firs(848, 112, 16, 23, 'c2')}`;

/** The live draw's candle arch (a Schwibbogen) with one candle per person, 900 × 470. */
export function arch(n: number) {
  const cx = 450;
  const cy = 440;
  const R = 400;
  const r = 362;
  let candles = '';
  for (let i = 0; i < n; i++) {
    const th = Math.PI * (0.93 - (0.86 * i) / Math.max(1, n - 1));
    const x = cx + (R - 8) * Math.cos(th);
    const y = cy - (R - 8) * Math.sin(th);
    // Many people: thinner candles, so they don't touch.
    const w = n > 40 ? 6 : n > 24 ? 8 : 10;
    candles += `<g class="cd" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><rect class="cb" x="${-w / 2}" y="-36" width="${w}" height="36" rx="2"/><ellipse class="fl" cx="0" cy="-47" rx="${w * 0.55}" ry="10"/></g>`;
  }
  return `<svg class="arch" viewBox="0 0 900 470" aria-hidden="true"><path class="c1" d="M${cx - R} ${cy}A${R} ${R} 0 0 1 ${cx + R} ${cy}H${cx + r}A${r} ${r} 0 0 0 ${cx - r} ${cy}Z"/><rect class="c1" x="24" y="${cy}" width="852" height="22" rx="3"/>
    <g>${firs(300, 190, 7, 11, 'c1', 120, cy - 190)}${firs(260, 160, 6, 5, 'c1', 520, cy - 160)}</g>
    <path class="c1" d="M392 ${cy}V${cy - 130}l58-50 58 50V${cy}ZM432 ${cy - 180}l18-110 18 110z"/><path class="c1" d="M380 ${cy - 130}h140v8H380z"/>
    ${candles}</svg>`;
}

/** Each house's height and roof, by its place in the street (look B's rhythm). */
export const HEIGHTS = [78, 96, 72, 102, 84, 90, 76, 98, 80, 88, 86, 94];
