// Ink and type for the landing page. Margin strokes draw and their notes write once each comes
// into view, a few at a time; what the app writes types out when it is shown. Without `js-ink`
// (no script, or reduced motion; Landing.astro sets it before first paint) everything is
// already set down, and these only mark it done.
//
// Markup contract: `[data-ink]` is a piece that inks once (`.draw` strokes, `.fade` fills);
// `[data-type="ch"|"w"|"hand"]` is text split into `.t` units (see components/landing/text.ts);
// `[data-seq]` gets `done` when its texts have finished; `[data-manual]` pieces and anything
// inside `[data-ink-later]` wait for their section's script to call `ink` or `play`.
// Arrows and marks anchored to what they name are drawn by `scripts/anchor.ts`; call `relayout`
// after anything moves them without a resize.

import { CHAR_MS, DRAW_MS, HAND_WORD_MS, live, PIECE_MS, STAGGER_MS, STEP_MS, VIEW_THRESHOLD, WORD_MS } from './pace';

// The page's pace (scripts/pace.ts), for sections to time their own steps by, and the
// anchored arrows and marks (scripts/anchor.ts), which draw themselves once loaded.
export * from './pace';
export { relayout } from './anchor';

export const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const between = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);

const runs = new WeakMap<Element, number>();
const bump = (el: Element) => {
  const run = (runs.get(el) ?? 0) + 1;
  runs.set(el, run);
  return run;
};

/** Puts a piece back to unwritten, cancelling any typing in progress. */
export const clear = (el: Element) => {
  bump(el);
  el.classList.remove('typed', 'done');
  el.querySelectorAll('.t').forEach((unit) => unit.classList.remove('on', 'at'));
};

/**
 * One piece of text: by letter with a caret, by word with a caret, or by word in the hand,
 * sped up as needed to finish within `budget`.
 */
export const type = async (el: HTMLElement | SVGElement, budget = PIECE_MS) => {
  const run = bump(el);
  const mode = el.dataset.type;
  const units = [...el.querySelectorAll<HTMLElement>('.t')];
  const most = budget / Math.max(units.length, 1);
  el.classList.remove('typed');
  units.forEach((unit) => unit.classList.remove('on', 'at'));
  if (!live) return void el.classList.add('typed');
  let last: HTMLElement | undefined;
  for (const unit of units) {
    if (runs.get(el) !== run) return;
    const length = unit.textContent?.length ?? 1;
    if (mode === 'hand') unit.style.setProperty('--dur', `${Math.min(length * CHAR_MS[1] + STAGGER_MS, STEP_MS * 1.5)}ms`);
    unit.classList.add('on');
    if (mode !== 'hand' && unit.tagName !== 'tspan') {
      last?.classList.remove('at');
      unit.classList.add('at');
      last = unit;
    }
    await wait(Math.min(mode === 'ch' ? between(CHAR_MS) : mode === 'w' ? between(WORD_MS) : HAND_WORD_MS, most));
  }
  if (runs.get(el) !== run) return;
  last?.classList.remove('at');
  el.classList.add('typed');
};

/** A run of texts, one after another, sharing one piece's time; the root is `done` when the last one is. */
export const play = async (root: HTMLElement, texts = [...root.querySelectorAll<HTMLElement>('[data-type]')], budget = PIECE_MS) => {
  const run = bump(root);
  root.classList.remove('done');
  for (const text of texts) {
    await type(text, budget / texts.length);
    if (runs.get(root) !== run) return;
  }
  root.classList.add('done');
};

/** Strokes draw in order, then the texts that are not waiting on a visitor. */
export const ink = (root: HTMLElement, auto = true) => {
  const strokes = [...root.querySelectorAll<SVGElement>('.draw, .fade')];
  const last = Math.min((strokes.length - 1) * STAGGER_MS, STEP_MS * 2);
  strokes.forEach((stroke, i) => {
    stroke.style.setProperty('--d', `${Math.min(i * STAGGER_MS, last)}ms`);
    stroke.style.transitionDuration = `${DRAW_MS}ms`;
  });
  root.classList.remove('is-inked');
  if (live) void root.getBoundingClientRect();
  root.classList.add('is-inked');
  // Texts in a manual piece inside this one wait for that piece; the root's own count.
  const waits = (text: HTMLElement) => {
    const manual = text.closest('[data-manual]');
    return !!manual && manual !== root && root.contains(manual);
  };
  const texts = [...root.querySelectorAll<HTMLElement>('[data-type]')].filter((text) => !text.hidden && !waits(text));
  if (!auto || !texts.length) return Promise.resolve();
  // Text starts while the strokes finish, and shares what is left of the piece's time.
  const settle = live && strokes.length ? Math.min(last + STAGGER_MS, STEP_MS) : 0;
  return wait(settle).then(() => play(root, texts, PIECE_MS - settle));
};

// A few at a time: pieces that come into view together start a little apart.
let next = 0;
const views = live
  ? new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          views?.unobserve(entry.target);
          const now = performance.now();
          const start = Math.max(now, next);
          next = start + STAGGER_MS * 2;
          window.setTimeout(() => ink(entry.target as HTMLElement), start - now);
        }
      },
      { threshold: VIEW_THRESHOLD },
    )
  : undefined;

for (const root of document.querySelectorAll<HTMLElement>('[data-ink]:not([data-manual])')) {
  if (!views) ink(root);
  else if (!root.closest('[data-ink-later]')) views.observe(root);
}
if (!live) document.querySelectorAll<HTMLElement>('[data-type]').forEach((text) => text.classList.add('typed'));
if (!live) document.querySelectorAll<HTMLElement>('[data-seq]').forEach((root) => root.classList.add('done'));
