// The landing page's pace, quick rather than slow: how long ink and type take, shared by
// scripts/ink.ts, scripts/anchor.ts, the sections' own scripts (through ink.ts) and the
// stylesheets (through the `--pace-*` properties set on the root below). Every duration on the
// page comes from here; a piece, from its first ink to its last, stays under about 1.2s.

/** One stroke drawing along its length. */
export const DRAW_MS = 300;
/** An arrowhead's two flicks, after its shaft. */
export const HEAD_MS = 90;
/** A fade or a pop: a word, a citation, a step appearing. */
export const FADE_MS = 160;
/** Between strokes, or pieces, that start together. */
export const STAGGER_MS = 50;
/** The longest wait between one step and the next. */
export const STEP_MS = 120;
/** The longest any one piece's text takes; with its strokes and arrow, under about 1.2s. */
export const PIECE_MS = 800;
/** Per letter typed, and per word typed, as the fastest and slowest. */
export const CHAR_MS = [10, 14] as const;
export const WORD_MS = [20, 28] as const;
/** Per word written by hand. */
export const HAND_WORD_MS = 20;
/** How much of a piece must be in view before it inks. */
export const VIEW_THRESHOLD = 0.15;

/** Whether ink and type animate: with the script and motion allowed (Landing.astro sets `js-ink`). */
export const live = document.documentElement.classList.contains('js-ink');

// The stylesheets' transitions read the same pace.
for (const [name, ms] of [
  ['draw', DRAW_MS],
  ['fade', FADE_MS],
  ['step', STEP_MS],
] as const)
  document.documentElement.style.setProperty(`--pace-${name}`, `${ms}ms`);
