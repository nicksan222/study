// Hand-drawn strokes for inline SVG, in the app's diagram language: every line bows a little
// and is drawn twice, slightly apart. A pen is seeded, so each build draws the same strokes.

export type Pt = [number, number];

/** The control points of a cubic from `a` to `b` whose middle stands `bend` off the chord, to the right of travel. */
export const bow = (a: Pt, b: Pt, bend: number): [Pt, Pt] => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const k = (bend * 4) / 3;
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  return [
    [a[0] + (b[0] - a[0]) / 3 + nx * k, a[1] + (b[1] - a[1]) / 3 + ny * k],
    [a[0] + ((b[0] - a[0]) * 2) / 3 + nx * k, a[1] + ((b[1] - a[1]) * 2) / 3 + ny * k],
  ];
};

/** The point `t` of the way along the cubic `a c1 c2 b`. */
export const along = (a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt => {
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * u * a[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * b[i];
  return [f(0), f(1)];
};

/** A string hashed to a pen seed, so a stroke named by its markup draws the same on every load. */
export const seed = (text: string) => {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

export function pen(seed: number) {
  let state = seed >>> 0 || 1;
  const rand = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const jit = (amount: number) => (rand() - 0.5) * 2 * amount;
  const n = (v: number) => Math.round(v * 10) / 10;

  const stroke = (x1: number, y1: number, x2: number, y2: number, wobble = 1.4) => {
    const bow = Math.min(Math.hypot(x2 - x1, y2 - y1) * 0.02, 2.5);
    const mx = (x1 + x2) / 2 + jit(bow);
    const my = (y1 + y2) / 2 + jit(bow);
    return `M${n(x1 + jit(wobble))} ${n(y1 + jit(wobble))} Q${n(mx)} ${n(my)} ${n(x2 + jit(wobble))} ${n(y2 + jit(wobble))}`;
  };
  const twice = (draw: () => string) => `${draw()} ${draw()}`;

  // A smooth closed or open curve through points, as cubic Béziers (Catmull-Rom).
  const through = (pts: Pt[]) => {
    let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p2[0])} ${n(p2[1])}`;
    }
    return d;
  };

  /**
   * An arrow from `a` to `b` bowed `bend` to the right of travel: a shaft that wavers a
   * little, and a head of two bowed flicks along the shaft's last tangent, its tip on `b`.
   */
  const bowed = (a: Pt, b: Pt, bend = 0, head = 11) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const waver = Math.min(len * 0.02, 2.5);
    const [c1, c2] = bow(a, b, bend).map(([x, y]) => [x + jit(waver), y + jit(waver)] as Pt);
    const shaft = `M${n(a[0] + jit(0.6))} ${n(a[1] + jit(0.6))} C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(b[0])} ${n(b[1])}`;
    const back = Math.atan2(c2[1] - b[1], c2[0] - b[0]);
    const size = Math.min(head, len * 0.4);
    // One flick a little longer than the other, each bowing as the pen lifts.
    const wing = (side: number) => {
      const angle = back + side * (0.46 + jit(0.06));
      const reach = size * (side > 0 ? 1 : 0.82);
      const ex = b[0] + Math.cos(angle) * reach;
      const ey = b[1] + Math.sin(angle) * reach;
      const lift = side * reach * 0.12;
      return `M${n(b[0])} ${n(b[1])} Q${n((b[0] + ex) / 2 - Math.sin(angle) * lift)} ${n((b[1] + ey) / 2 + Math.cos(angle) * lift)} ${n(ex)} ${n(ey)}`;
    };
    return { shaft, head: `${wing(1)} ${wing(-1)}` };
  };

  return {
    line: (x1: number, y1: number, x2: number, y2: number) => twice(() => stroke(x1, y1, x2, y2)),
    rect: (x: number, y: number, w: number, h: number) =>
      twice(() => [stroke(x, y, x + w, y), stroke(x + w, y, x + w, y + h), stroke(x + w, y + h, x, y + h), stroke(x, y + h, x, y)].join(' ')),
    /** The wash under a box: its fill, a little off the lines, as a marker leaves it. */
    fill: (x: number, y: number, w: number, h: number) =>
      `M${n(x + jit(2))} ${n(y + jit(2))} L${n(x + w + jit(2))} ${n(y + jit(2))} L${n(x + w + jit(2))} ${n(y + h + jit(2))} L${n(x + jit(2))} ${n(y + h + jit(2))} Z`,
    bowed,
    /** A hand-placed arrow, for strokes drawn into a fixed viewBox; `bend` as in a quadratic's control point. */
    arrow: (x1: number, y1: number, x2: number, y2: number, bend = 0, head = 11) => {
      const { shaft, head: tip } = bowed([x1, y1], [x2, y2], bend / 2, head);
      return `${shaft} ${tip}`;
    },
    /**
     * A loose ring, drawn once round and a little past where it started. Below 1, `square`
     * flattens it toward a rounded box that hugs a word, and its loop never swells sideways
     * past `rx`, so it stays off the next word.
     */
    ring: (cx: number, cy: number, rx: number, ry: number, square = 1) => {
      const pts: Pt[] = [];
      const start = -0.6;
      const hug = square < 1;
      const steps = hug ? 16 : 8;
      const bend = (c: number) => Math.sign(c) * Math.abs(c) ** square;
      for (let i = 0; i <= steps + 1; i++) {
        const a = start + (i / steps) * Math.PI * 2 * 1.06;
        const grow = (i / (steps + 1)) * 0.06;
        const kx = hug ? 1 - Math.abs(jit(0.02)) : 1 + jit(0.05) + grow;
        const ky = hug ? 1 + jit(0.02) + grow * 0.3 : kx;
        pts.push([cx + bend(Math.cos(a)) * rx * kx, cy + bend(Math.sin(a)) * ry * ky]);
      }
      return through(pts);
    },
    /** An underline that drifts, the way a quick one does. */
    underline: (x: number, y: number, w: number) =>
      through([
        [x, y + jit(1)],
        [x + w * 0.35, y - 2 + jit(1)],
        [x + w * 0.7, y + 1 + jit(1)],
        [x + w, y - 3 + jit(1)],
      ]),
    /** A small doodled star. */
    star: (cx: number, cy: number, r: number) => {
      const pts: Pt[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = (i % 2 ? 0.45 : 1) * r + jit(r * 0.08);
        pts.push([cx + Math.cos(a) * k, cy + Math.sin(a) * k]);
      }
      return pts.map((p, i) => `${i ? 'L' : 'M'}${n(p[0])} ${n(p[1])}`).join(' ');
    },
    /** A tall square bracket, its ends turned in toward what it marks. */
    bracket: (x: number, y: number, h: number, w = 8) =>
      through([
        [x + w, y + jit(1)],
        [x + jit(0.6), y + 3],
        [x + jit(1), y + h / 2],
        [x + jit(0.6), y + h - 3],
        [x + w, y + h + jit(1)],
      ]),
    /** A quick checkmark: a short dip, then a long stroke up. */
    check: (x: number, y: number, s: number) =>
      through([
        [x, y + s * 0.55],
        [x + s * 0.32 + jit(0.8), y + s * 0.92],
        [x + s * 0.62, y + s * 0.42 + jit(0.8)],
        [x + s, y + jit(0.8)],
      ]),
    /** A small pencil, lying at an angle, drawn in outline. */
    pencil: (x: number, y: number, s: number) => {
      const P = (px: number, py: number): Pt => [x + px * s, y + py * s];
      const seg = (a: Pt, b: Pt) => stroke(a[0], a[1], b[0], b[1], 0.5);
      const [a, b, c, d] = [P(0.06, 0.62), P(0.66, 0.06), P(0.18, 0.76), P(0.78, 0.2)];
      const tip = P(0.98, 0);
      return [seg(a, b), seg(c, d), seg(a, c), seg(b, tip), seg(d, tip), seg(P(0.15, 0.53), P(0.27, 0.67))].join(' ');
    },
    curve: (pts: Pt[]) => through(pts.map(([x, y]) => [x + jit(1), y + jit(1)] as Pt)),
    /** A closed outline through corners, each side its own bowed stroke. */
    poly: (pts: Pt[]) => twice(() => pts.map((p, i) => stroke(p[0], p[1], ...pts[(i + 1) % pts.length], 0.8)).join(' ')),
    /** One sweep of a highlighter: a band with ragged long edges and rounded, uneven ends. */
    swash: (w: number, h: number) => {
      const steps = 8;
      const top: Pt[] = [];
      const bottom: Pt[] = [];
      for (let i = 0; i <= steps; i++) {
        const x = 4 + ((w - 8) * i) / steps;
        top.push([x, h * 0.16 - (i / steps) * h * 0.08 + jit(h * 0.05)]);
        bottom.push([x, h * 0.9 - (i / steps) * h * 0.04 + jit(h * 0.05)]);
      }
      const ends = (x: number, a: Pt, b: Pt, out: number): Pt => [x + out, (a[1] + b[1]) / 2 + jit(h * 0.06)];
      const loop: Pt[] = [...top, ends(w - 4, top[steps], bottom[steps], 3), ...bottom.reverse(), ends(4, bottom[steps], top[0], -3), top[0]];
      return `${through(loop)} Z`;
    },
  };
}
