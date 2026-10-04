// What the landing sections write into their markup on the server: text split into the units
// `scripts/ink.ts` reveals, hand-drawn strokes ready for an inline SVG, and key phrases marked
// by hand.

export const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Text that types by letter (`data-type="ch"`); `tspan` inside an SVG `<text>`. */
export const chars = (text: string, tag = 'span') => [...text].map((c) => (c === ' ' ? ' ' : `<${tag} class="t">${esc(c)}</${tag}>`)).join('');

/** Text that types or writes by word (`data-type="w"` or `"hand"`). */
export const words = (text: string) =>
  text
    .split(/(\s+)/)
    .map((w) => (!w || /^\s+$/.test(w) ? w : `<span class="t">${esc(w)}</span>`))
    .join('');

/** Strokes that draw along their length. */
export const draw = (...ds: string[]) => ds.map((d) => `<path class="draw" pathLength="1" d="${d}"/>`).join('');

/** A stroke with a second, lighter pass, as a pen leaves it. */
export const pressed = (make: () => string) => `${draw(make())}<path class="draw thin" pathLength="1" d="${make()}"/>`;

/**
 * A headline with its one key phrase underlined or ringed by hand: an anchored mark
 * (scripts/anchor.ts) sized to the phrase, the phrase its own ink scope. Each heading passes its own number, which names the
 * phrase and so seeds its stroke; changing one never redraws another.
 */
export const keyed = (title: string, key: string, mark: 'under' | 'ring', id: number) => {
  const at = title.indexOf(key);
  if (at < 0) return esc(title);
  const svg = `<svg class="ink-mark" data-mark="${mark === 'ring' ? 'ring' : 'underline'}" data-to="#key-${id}" aria-hidden="true"></svg>`;
  return `${esc(title.slice(0, at))}<span class="key" id="key-${id}" data-ink-scope>${esc(key)}${svg}</span>${esc(title.slice(at + key.length))}`;
};
