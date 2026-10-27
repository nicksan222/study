import { StudyError } from '#backend/shared/errors/index';
import type { SourceId } from '#backend/shared/ids';

import type { Anchor } from './document.ts';

export interface Citation {
  marker: number;
  sourceId: SourceId | null;
  sourceName: string;
  anchor: Anchor;
  quote: string;
}

const MAX_MARKER = 0xffff_ffff;

/** Validate the whole batch before any generated content is persisted. */
export function validateCitations(citations: readonly Citation[]): void {
  const markers = new Set<number>();

  for (const citation of citations) {
    if (
      !Number.isInteger(citation.marker) ||
      citation.marker < 1 ||
      citation.marker > MAX_MARKER ||
      markers.has(citation.marker)
    )
      throw new StudyError('invalid_input', 'invalid citation marker');

    if (
      citation.sourceId !== null &&
      (typeof citation.sourceId !== 'bigint' ||
        citation.sourceId <= 0n ||
        citation.sourceId > 0x7fff_ffff_ffff_ffffn)
    )
      throw new StudyError('invalid_input', 'invalid citation source');

    markers.add(citation.marker);
  }
}

/** Distinct in-range markers in order of first appearance. */
export function citedMarkers(text: string, max: number = MAX_MARKER): number[] {
  const markers = new Set<number>();

  for (const group of text.matchAll(/\[([^\]]*)\]/g)) {
    for (const token of group[1].split(/[,; ]/)) {
      const number = token.trim();

      if (!/^\+?[0-9]+$/.test(number)) continue;

      const marker = Number(number);

      if (marker >= 1 && marker <= Math.min(max, MAX_MARKER)) markers.add(marker);
    }
  }

  return [...markers];
}

/** Rewrite only numeric brackets whose every marker has a citation. */
export function renumberCitations(
  text: string,
  cited: readonly number[],
  kept: readonly number[]
): string {
  let out = '';
  let rest = text;

  while (rest.includes('[')) {
    const open = rest.indexOf('[');

    out += rest.slice(0, open);
    rest = rest.slice(open + 1);
    const close = rest.indexOf(']');
    const tokens = close < 0 ? [] : rest.slice(0, close).split(/[,; ]/).filter(Boolean);
    const markers = tokens.map(Number);

    if (
      !tokens.length ||
      tokens.some((token) => !/^[0-9]+$/.test(token)) ||
      markers.some((marker) => marker > MAX_MARKER || !cited.includes(marker))
    ) {
      out += '[';
      continue;
    }

    const renumbered = markers.flatMap((marker) => {
      const index = kept.indexOf(marker);

      return index < 0 ? [] : [index + 1];
    });

    out = renumbered.length ? out + `[${renumbered.join(', ')}]` : out.replace(/ +$/, '');
    rest = rest.slice(close + 1);
  }

  return out + rest;
}

export function withoutCitations(text: string, cited: readonly number[]): string {
  return renumberCitations(text, cited, []);
}
