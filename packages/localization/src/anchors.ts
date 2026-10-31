import type { Locale } from './catalog.ts';
import { joined } from './formatting.ts';
import { timestamp } from './time.ts';

export type Anchor =
  | { kind: 'time'; startMs: number; endMs: number }
  | { kind: 'page'; page: number }
  | { kind: 'text'; lineStart: number; lineEnd: number }
  | { kind: 'slide' | 'paragraph'; index: number }
  | { kind: 'url'; fragment?: string | null };

export function anchorLabel(l: Locale, a: Anchor): string | undefined {
  const words =
    l === 'english'
      ? { page: 'p.', slide: 'slide', paragraph: '¶' }
      : { page: 'pag.', slide: 'diapositiva', paragraph: '§' };

  switch (a.kind) {
    case 'time':
      return timeAnchorLabel(a);
    case 'page':
      return `${words.page} ${a.page}`;
    case 'text':
      return textAnchorLabel(l, a);
    case 'slide':
      return `${words.slide} ${a.index}`;
    case 'paragraph':
      return `${words.paragraph} ${a.index}`;
    case 'url':
      return a.fragment == null ? undefined : `#${a.fragment}`;
  }
}

export const citationLabel = (l: Locale, n: number, source: string, a: Anchor) =>
  `[${n}] ${joined([source, anchorLabel(l, a) ?? ''])}`;

function textAnchorLabel(l: Locale, a: Extract<Anchor, { kind: 'text' }>) {
  const words = l === 'english' ? ['line', 'lines'] : ['riga', 'righe'];

  return a.lineStart === a.lineEnd
    ? `${words[0]} ${a.lineStart}`
    : `${words[1]} ${a.lineStart}–${a.lineEnd}`;
}

function timeAnchorLabel(a: Extract<Anchor, { kind: 'time' }>) {
  return Math.floor(a.endMs / 1000) > Math.floor(a.startMs / 1000)
    ? `${timestamp(a.startMs)}–${timestamp(a.endMs)}`
    : timestamp(a.startMs);
}
