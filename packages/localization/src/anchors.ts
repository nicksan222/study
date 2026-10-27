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
  switch (a.kind) {
    case 'time':
      return Math.floor(a.endMs / 1000) > Math.floor(a.startMs / 1000)
        ? `${timestamp(a.startMs)}–${timestamp(a.endMs)}`
        : timestamp(a.startMs);
    case 'page':
      return `${l === 'english' ? 'p.' : 'pag.'} ${a.page}`;
    case 'text':
      return a.lineStart === a.lineEnd
        ? `${l === 'english' ? 'line' : 'riga'} ${a.lineStart}`
        : `${l === 'english' ? 'lines' : 'righe'} ${a.lineStart}–${a.lineEnd}`;
    case 'slide':
      return `${l === 'english' ? 'slide' : 'diapositiva'} ${a.index}`;
    case 'paragraph':
      return `${l === 'english' ? '¶' : '§'} ${a.index}`;
    case 'url':
      return a.fragment == null ? undefined : `#${a.fragment}`;
  }
}

export const citationLabel = (l: Locale, n: number, source: string, a: Anchor) =>
  `[${n}] ${joined([source, anchorLabel(l, a) ?? ''])}`;
