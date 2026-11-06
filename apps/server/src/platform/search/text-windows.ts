/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Splits whole entity text into bounded surrogate-safe indexing windows.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves original text order without dropping or duplicating code units.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Token-aware overlap remains the embedding provider responsibility inside each window.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

/** Use one effective size for segmentation and cache identity. */
export function textWindowSize(maximum: number): number {
  return Math.min(maximum, 64 * 1024);
}

/** Bound worker requests independently of whole-document size and preserve surrogate pairs. */
export function* textWindows(text: string, maximum: number): Generator<string> {
  const size = textWindowSize(maximum);

  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + size);
    const last = text.charCodeAt(end - 1),
      next = text.charCodeAt(end);

    if (end < text.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end--;

    yield text.slice(start, end);
    start = end;
  }
}
