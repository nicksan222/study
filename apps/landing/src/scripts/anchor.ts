// Anchored ink: arrows and marks the page measures and draws, so each lands on what it names at
// every width. A section writes them empty, inside a `[data-ink-scope]`:
//
//   <svg class="ink-arrow" data-arrow data-from="#note" data-to="#target" data-bow="0.25"
//        data-arrow-min="768" aria-hidden="true"></svg>
//   <svg class="ink-mark" data-mark="ring" data-to="#target" aria-hidden="true"></svg>
//
// An arrow runs from its note's nearest edge to just outside its target's, the head's tip at the
// target; `data-bow` (-1 to 1, default 0.2) bends it to the right of travel, or left when
// negative. A mark (`ring`, `underline`, `double`, `bracket`, `check`, `star`) is sized from
// its target's words, line by line (`data-lines="first"` underlines only the first line). Both
// redraw when their scope, note or target resizes, when the fonts load, after a transition that
// shows or moves them, and on `ink:relayout` (`relayout`). With `js-ink` each draws in once its
// target is in view, after its note has written and its `[data-manual]` root (if any) is inked,
// two at a time; otherwise it is set down at once. A piece that cannot land cleanly is hidden, and
// `data-ink-hidden` says why: `min` (narrower than data-arrow-min), `missing` (no such note
// or target), `unseen` (one is not shown), `apart` (they overlap), `short` (too close for an
// arrow) or `crosses` (every route would cross text or a picture, or leave the page).
import { along, bow, pen, seed, type Pt } from '../components/rough';
import { DRAW_MS, HEAD_MS, live, STAGGER_MS, STEP_MS, VIEW_THRESHOLD } from './pace';

type Box = { l: number; t: number; r: number; b: number };
type Mark = 'ring' | 'underline' | 'double' | 'bracket' | 'check' | 'star';
type Piece = {
  svg: SVGSVGElement;
  scope: Element;
  from: Element | null;
  to: Element | null;
  drawn: 'waiting' | 'drawing' | 'done';
  seen: boolean;
  /** Moved while drawing in; redrawn once it has finished. */
  stale: boolean;
};

/** Tells the anchored ink that something moved without resizing: a tab, a flip, a reveal. */
export const relayout = () => document.dispatchEvent(new Event('ink:relayout'));

const OUT_NOTE = 6;
const OUT_TARGET = 5;
const MIN_LENGTH = 26;

const boxOf = (r: DOMRectReadOnly): Box => ({
  l: r.left,
  t: r.top,
  r: r.right,
  b: r.bottom,
});
const grow = (b: Box, by: number): Box => ({
  l: b.l - by,
  t: b.t - by,
  r: b.r + by,
  b: b.b + by,
});
const inside = ([x, y]: Pt, b: Box) => x >= b.l && x <= b.r && y >= b.t && y <= b.b;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const shown = (el: Element) => el.checkVisibility({ visibilityProperty: true });

const find = (scope: Element, sel: string | undefined) => {
  if (!sel) return null;
  try {
    return scope.querySelector(sel) ?? document.querySelector(sel);
  } catch {
    return null;
  }
};

// What a stroke must not cross: the lines of text and the pictures shown in a scope, cut to
// what their clipping boxes let show. Gathered once per scope per redraw, in viewport
// coordinates; the route leaves out its own note and target.
const obstaclesOf = (scope: Element): { box: Box; el: Element }[] => {
  const all: Box = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity };
  const seen = new Map<Element, boolean>();
  const visible = (el: Element) => seen.get(el) ?? (seen.set(el, shown(el)), seen.get(el)!);
  const clips = new Map<Element, Box>();
  const clipOf = (el: Element | null): Box => {
    if (!el || el === scope) return all;
    const known = clips.get(el);
    if (known) return known;
    const outer = clipOf(el.parentElement);
    const style = getComputedStyle(el);
    const own = style.overflowX !== 'visible' || style.overflowY !== 'visible' ? boxOf(el.getBoundingClientRect()) : all;
    const clip = {
      l: Math.max(outer.l, own.l),
      t: Math.max(outer.t, own.t),
      r: Math.min(outer.r, own.r),
      b: Math.min(outer.b, own.b),
    };
    clips.set(el, clip);
    return clip;
  };
  const found: { box: Box; el: Element }[] = [];
  const add = (r: DOMRectReadOnly, el: Element) => {
    const clip = clipOf(el.parentElement);
    const box = {
      l: Math.max(r.left, clip.l),
      t: Math.max(r.top, clip.t),
      r: Math.min(r.right, clip.r),
      b: Math.min(r.bottom, clip.b),
    };
    if (box.r > box.l && box.b > box.t) found.push({ box, el });
  };
  const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const el = node.parentElement;
    if (!el || !node.textContent?.trim() || el.closest('svg[data-arrow], svg[data-mark]') || !visible(el)) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) add(r, el);
  }
  for (const el of scope.querySelectorAll('img, picture, video, canvas')) if (visible(el)) add(el.getBoundingClientRect(), el);
  return found;
};

// The two ends of an arrow along one axis, or nothing when the boxes do not part along it.
const ends = (a: Box, b: Box, axis: 'x' | 'y'): [Pt, Pt] | null => {
  const [lo, hi, across, acrossEnd] = axis === 'x' ? (['l', 'r', 't', 'b'] as const) : (['t', 'b', 'l', 'r'] as const);
  const mid = (box: Box) => (box[across] + box[acrossEnd]) / 2;
  const size = (box: Box) => box[acrossEnd] - box[across];
  // The note's end leans toward the target, the target's end toward the note.
  const from = clamp(mid(b), a[across] + size(a) * 0.3, a[acrossEnd] - size(a) * 0.3);
  const inset = Math.min(size(b) * 0.3, 12);
  const to = clamp(mid(a), b[across] + inset, b[acrossEnd] - inset);
  let s: number;
  let e: number;
  if (b[lo] >= a[hi]) [s, e] = [a[hi] + OUT_NOTE, b[lo] - OUT_TARGET];
  else if (b[hi] <= a[lo]) [s, e] = [a[lo] - OUT_NOTE, b[hi] + OUT_TARGET];
  else return null;
  return axis === 'x'
    ? [
        [s, from],
        [e, to],
      ]
    : [
        [from, s],
        [to, e],
      ];
};

// The cleanest route from note to target: the axis they part along most and the bow asked for
// first, then a flatter bow, the other way, and the other axis. Nothing when none is clean.
const route = (from: Element, to: Element, bowAsked: number, obstacles: { box: Box; el: Element }[]) => {
  const a = boxOf(from.getBoundingClientRect());
  const b = boxOf(to.getBoundingClientRect());
  const gapX = Math.max(b.l - a.r, a.l - b.r);
  const gapY = Math.max(b.t - a.b, a.t - b.b);
  if (gapX < 0 && gapY < 0) return 'apart' as const;
  const blocks = obstacles.filter(({ el }) => !from.contains(el) && !to.contains(el)).map(({ box }) => grow(box, 3));
  const page = document.documentElement.clientWidth;
  const axes: ('x' | 'y')[] = gapX >= gapY ? ['x', 'y'] : ['y', 'x'];
  let tried = false;
  for (const axis of axes) {
    const pair = ends(a, b, axis);
    if (!pair) continue;
    const [s, e] = pair;
    const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
    if (len < MIN_LENGTH) continue;
    tried = true;
    for (const bowTry of new Set([bowAsked, bowAsked * 0.4, -bowAsked])) {
      const bend = bowTry * len * 0.45;
      const [c1, c2] = bow(s, e, bend);
      let clean = true;
      for (let i = 1; i <= 22 && clean; i++) {
        const p = along(s, c1, c2, e, 0.04 + (i / 22) * 0.88);
        clean = p[0] > 2 && p[0] < page - 2 && !blocks.some((box) => inside(p, box));
      }
      if (clean) return { s, e, bend, len };
    }
  }
  return tried ? ('crosses' as const) : ('short' as const);
};

// A target's lines of text, each its own box, or the target's box when it has none.
const linesOf = (to: Element): Box[] => {
  // Only the words: no whitespace at either end of a text run, and nothing inside an SVG
  // (the mark's own, sitting at the target's corner, would read as a line of its own).
  const range = document.createRange();
  const walk = document.createTreeWalker(to, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const lines: Box[] = [];
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const text = node.textContent ?? '';
    const start = text.search(/\S/);
    if (start < 0) continue;
    range.setStart(node, start);
    range.setEnd(node, text.trimEnd().length);
    for (const r of range.getClientRects()) {
      if (!r.width || !r.height) continue;
      const line = lines.find((l) => r.top < l.b - 2 && r.bottom > l.t + 2);
      if (line)
        Object.assign(line, {
          l: Math.min(line.l, r.left),
          r: Math.max(line.r, r.right),
          t: Math.min(line.t, r.top),
          b: Math.max(line.b, r.bottom),
        });
      else lines.push(boxOf(r));
    }
  }
  return lines.length ? lines : [boxOf(to.getBoundingClientRect())];
};

// The punctuation written right after an element, if any: the `.` in `free.`.
const trailing = (to: Element): Box | null => {
  const next = to.nextSibling;
  if (next?.nodeType !== Node.TEXT_NODE) return null;
  const mark = /^[.,;:!?…»”’)]+/.exec(next.textContent ?? '');
  if (!mark) return null;
  const range = document.createRange();
  range.setStart(next, 0);
  range.setEnd(next, mark[0].length);
  return boxOf(range.getBoundingClientRect());
};

// Where a ring round `to` may run, top to bottom: the letters' own ink with a little air, cut
// to half the gap to the letters of a line above or below.
const ringRoom = (to: Element, words: Box, font: number, stop: Box | null) => {
  const style = getComputedStyle(to);
  const ctx = (ringRoom.ctx ??= document.createElement('canvas').getContext('2d'));
  const air = clamp(font * 0.12, 3, 8);
  if (!ctx) return { t: words.t - air, b: words.b + air, top: words.t, bottom: words.b };
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const text = (linesText(to) + (stop ? '.' : '')).trim() || 'x';
  const own = ctx.measureText(text);
  const tall = ctx.measureText('Hdkl');
  const deep = ctx.measureText('gjpqy');
  // A range's line box starts at the font's ascent above the baseline and ends at its descent below.
  const top = words.t + own.fontBoundingBoxAscent - own.actualBoundingBoxAscent;
  const bottom = words.b - own.fontBoundingBoxDescent + own.actualBoundingBoxDescent;
  const lh = parseFloat(style.lineHeight) || font * 1.2;
  const block = (to.closest('h1, h2, h3, h4, p, li, figcaption') ?? to.parentElement ?? to).getBoundingClientRect();
  let t = top - air;
  let b = bottom + air;
  if (words.t - block.top > lh * 0.5) t = Math.max(t, top - (lh - deep.actualBoundingBoxDescent - own.actualBoundingBoxAscent) / 2);
  if (block.bottom - words.b > lh * 0.5) b = Math.min(b, bottom + (lh - tall.actualBoundingBoxAscent - own.actualBoundingBoxDescent) / 2);
  // Never through its own letters, however tight the lines.
  return { t: Math.min(t, top - 2), b: Math.max(b, bottom + 2), top, bottom };
};
ringRoom.ctx = null as CanvasRenderingContext2D | null;

// The words of `to`, without its marks.
const linesText = (to: Element) => {
  let text = '';
  const walk = document.createTreeWalker(to, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) if (!node.parentElement?.closest('svg')) text += node.textContent;
  return text;
};

// The words' box, all lines together.
const wordsOf = (to: Element): Box =>
  linesOf(to).reduce((u, l) => ({
    l: Math.min(u.l, l.l),
    t: Math.min(u.t, l.t),
    r: Math.max(u.r, l.r),
    b: Math.max(u.b, l.b),
  }));

// A mark's strokes in viewport coordinates: the first pass, then a lighter one a hair apart.
const markStrokes = (svg: SVGSVGElement, kind: Mark, to: Element, ink: ReturnType<typeof pen>, at: (p: Pt) => Pt): string[][] => {
  const box = boxOf(to.getBoundingClientRect());
  const w = box.r - box.l;
  const h = box.b - box.t;
  const font = parseFloat(getComputedStyle(to).fontSize) || 16;
  const twice = (make: () => string) => [make(), make()];
  const [x, y] = at([box.l, box.t]);
  switch (kind) {
    case 'ring': {
      // Hugs the words: sideways by under half a space, so it never reaches the next word, and
      // round any punctuation that sits right against them, so it never cuts through that.
      // Up and down it rings the letters' ink, not the line box, and stays inside half the gap
      // to the lines above and below.
      const words = wordsOf(to);
      const stop = trailing(to);
      if (stop) words.r = Math.max(words.r, stop.r);
      const { t, b, top, bottom } = ringRoom(to, words, font, stop);
      const [cx, cy] = at([(words.l + words.r) / 2, (t + b) / 2]);
      const rx = (words.r - words.l) / 2 + Math.max(font * 0.1, 2.5);
      // The loop runs a few hundredths past ry, and the stroke has width.
      const ry = Math.max((b - t) / 2 / 1.04 - 1, Math.max((t + b) / 2 - top, bottom - (t + b) / 2) + 2.5);
      return [twice(() => ink.ring(cx, cy, rx, ry, 0.55))];
    }
    case 'underline':
    case 'double':
      // Just under the baseline: a line box's foot less most of the descender.
      // From the words' left edge, overshooting each end by a hair. `data-lines="first"`
      // underlines only the first line of a wrapped phrase.
      return linesOf(to)
        .slice(0, svg.dataset.lines === 'first' ? 1 : undefined)
        .map((line) => {
          const [lx, ly] = at([line.l, line.b - font * 0.1]);
          const width = line.r - line.l + 2;
          const under = () => ink.underline(lx - 1, ly, width);
          return kind === 'underline' ? twice(under) : [under(), ink.underline(lx - 2, ly + Math.max(3, font * 0.14), width * 0.96)];
        });
    case 'bracket':
      return [twice(() => ink.bracket(x - 9, y - 4, h + 8, 10))];
    case 'check': {
      const size = clamp(h * 0.9, 14, 26);
      return [twice(() => ink.check(x + w - size * 0.15, y + (h - size) / 2, size))];
    }
    case 'star': {
      const r = clamp(h * 0.45, 7, 14);
      return [twice(() => ink.star(x + w + r * 0.2, y + h / 2, r))];
    }
  }
};

const pieces: Piece[] = [];

const hide = (piece: Piece, why: string) => {
  piece.svg.dataset.inkHidden = why;
  piece.svg.replaceChildren();
};

const paths = (piece: Piece, strokes: { d: string; cls: string }[]) => {
  piece.svg.innerHTML = strokes.map(({ d, cls }) => `<path class="${cls}" d="${d}"/>`).join('');
  if (piece.drawn === 'waiting') {
    for (const path of piece.svg.querySelectorAll('path')) {
      const len = path.getTotalLength() + 1;
      path.style.strokeDasharray = `${len} ${len}`;
      path.style.strokeDashoffset = `${len}`;
    }
  }
};

const draw = (piece: Piece, obstacles: (scope: Element) => { box: Box; el: Element }[]) => {
  const { svg } = piece;
  if (piece.drawn === 'drawing') return void (piece.stale = true);
  const min = Number(svg.dataset.arrowMin ?? 0);
  if (min && !matchMedia(`(min-width: ${min}px)`).matches) return hide(piece, 'min');
  const arrow = svg.hasAttribute('data-arrow');
  const from = (piece.from = arrow ? find(piece.scope, svg.dataset.from) : null);
  const to = (piece.to = find(piece.scope, svg.dataset.to));
  if (!to || (arrow && !from)) return hide(piece, 'missing');
  if (!shown(to) || (from && !shown(from)) || !svg.parentElement || !shown(svg.parentElement)) return hide(piece, 'unseen');
  delete svg.dataset.inkHidden;
  const origin = svg.getBoundingClientRect();
  const at = ([x, y]: Pt): Pt => [x - origin.left, y - origin.top];
  const ink = pen(seed(`${svg.dataset.mark ?? 'arrow'} ${svg.dataset.from ?? ''} ${svg.dataset.to}`));
  if (!arrow) {
    const strokes = markStrokes(svg, svg.dataset.mark as Mark, to, ink, at);
    return paths(
      piece,
      strokes.flatMap(([first, second]) => [
        { d: first, cls: 'stroke' },
        { d: second, cls: 'stroke pass' },
      ]),
    );
  }
  const found = route(from!, to, clamp(Number(svg.dataset.bow ?? 0.2) || 0, -1, 1), obstacles(piece.scope));
  if (typeof found === 'string') return hide(piece, found);
  const head = clamp(found.len * 0.12, 8, 13);
  const first = ink.bowed(at(found.s), at(found.e), found.bend, head);
  const second = ink.bowed(at(found.s), at(found.e), found.bend, head * 0.92);
  paths(piece, [
    { d: first.shaft, cls: 'shaft' },
    { d: second.shaft, cls: 'shaft pass' },
    { d: first.head, cls: 'head' },
    { d: second.head, cls: 'head pass' },
  ]);
};

const redraw = () => {
  const cache = new Map<Element, { box: Box; el: Element }[]>();
  const obstacles = (scope: Element) => cache.get(scope) ?? (cache.set(scope, obstaclesOf(scope)), cache.get(scope)!);
  pieces.forEach((piece) => draw(piece, obstacles));
  pieces.forEach(start);
};

let frame = 0;
const schedule = () => {
  if (!frame) frame = requestAnimationFrame(() => ((frame = 0), redraw()));
};

// Drawing in: strokes that come into view together go two at a time, a little apart, each
// once its note has written, so a page of them settles rather than flickers.
const running = new Set<Piece>();
const queue: Piece[] = [];
let lastStart = 0;
const pump = () => {
  while (queue.length && running.size < 2) {
    const wait = lastStart + STAGGER_MS - performance.now();
    if (wait > 0) return void window.setTimeout(pump, wait);
    const piece = queue.shift()!;
    if (piece.drawn !== 'waiting' || piece.svg.dataset.inkHidden) continue;
    lastStart = performance.now();
    running.add(piece);
    piece.drawn = 'drawing';
    let delay = 0;
    for (const path of piece.svg.querySelectorAll<SVGPathElement>('path')) {
      const len = path.getTotalLength();
      const head = path.classList.contains('head');
      const pass = path.classList.contains('pass');
      const duration = head ? HEAD_MS : clamp(len * 1.4, DRAW_MS * 0.6, DRAW_MS);
      path.style.transition = `stroke-dashoffset ${duration}ms var(--ease-out) ${delay + (pass ? STAGGER_MS / 2 : 0)}ms`;
      path.style.strokeDashoffset = '0';
      if (!pass) delay += duration * (head ? 1 : 0.92);
    }
    window.setTimeout(() => {
      running.delete(piece);
      piece.drawn = 'done';
      piece.svg.querySelectorAll<SVGPathElement>('path').forEach((path) => path.removeAttribute('style'));
      if (piece.stale) schedule();
      piece.stale = false;
      pump();
    }, delay + STAGGER_MS);
  }
};

// Resolves once `el` has `cls`, or after `ms` when given.
const until = (el: Element, cls: string, ms?: number) =>
  el.classList.contains(cls)
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const done = () => (watch.disconnect(), window.clearTimeout(timer), resolve());
        const watch = new MutationObserver(() => el.classList.contains(cls) && done());
        const timer = ms === undefined ? undefined : window.setTimeout(done, ms);
        watch.observe(el, { attributes: true, attributeFilter: ['class'] });
      });

// A piece draws in once the section has inked its `[data-manual]` root, if it has one, and its
// note has written (or had a moment to).
const ready = (piece: Piece) => {
  const manual = piece.svg.closest('[data-manual]');
  const note = piece.from?.closest('[data-type]') ?? piece.from?.querySelector('[data-type]');
  return Promise.all([manual && until(manual, 'is-inked'), note && until(note, 'typed', STEP_MS * 6)]);
};

const queued = new WeakSet<Piece>();
function start(piece: Piece) {
  if (piece.drawn !== 'waiting' || !piece.seen || piece.svg.dataset.inkHidden || queued.has(piece)) return;
  queued.add(piece);
  void ready(piece).then(() => {
    queued.delete(piece);
    if (piece.drawn !== 'waiting' || piece.svg.dataset.inkHidden) return;
    queue.push(piece);
    pump();
  });
}

// Every anchored arrow and mark on the page, kept drawn from here on.
{
  for (const svg of document.querySelectorAll<SVGSVGElement>('svg[data-arrow], svg[data-mark]')) {
    const scope = svg.closest('[data-ink-scope]') ?? svg.parentElement ?? document.body;
    const from = svg.hasAttribute('data-arrow') ? find(scope, svg.dataset.from) : null;
    pieces.push({
      svg,
      scope,
      from,
      to: find(scope, svg.dataset.to),
      drawn: live ? 'waiting' : 'done',
      seen: false,
      stale: false,
    });
  }
  const views = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const piece of pieces) {
          if (piece.to !== entry.target || piece.seen) continue;
          piece.seen = true;
          start(piece);
        }
      }
    },
    { threshold: VIEW_THRESHOLD },
  );
  const sizes = new ResizeObserver(schedule);
  for (const piece of pieces) {
    [piece.scope, piece.from, piece.to].forEach((el) => el && sizes.observe(el));
    if (piece.to) views.observe(piece.to);
  }
  schedule();
  document.addEventListener('ink:relayout', schedule);
  void document.fonts.ready.then(schedule);
  // A tab or note that fades in or settles its tilt moves what is anchored to it.
  document.addEventListener('transitionend', (event) => {
    const el = event.target as Element;
    if (pieces.some((piece) => el === piece.from || el === piece.to || el.contains(piece.svg))) schedule();
  });
}
