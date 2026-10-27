export type Mention = 'assistant';

export const mentionLabel = (_mention: Mention) => '@study';

/** Cursor and returned range use JavaScript UTF-16 offsets. */
export function mentionSuggestions(
  text: string,
  cursor: number
): { start: number; end: number; mentions: Mention[] } | undefined {
  if (
    !Number.isInteger(cursor) ||
    cursor < 0 ||
    cursor > text.length ||
    (cursor < text.length && !/\s/u.test(text[cursor]))
  )
    return;

  const before = text.slice(0, cursor);
  const start = (before.match(/\s[^\s]*$/u)?.index ?? -1) + 1;
  const word = before.slice(start);

  if (!word.startsWith('@') || !'study'.startsWith(word.slice(1).toLowerCase())) return;

  return { start, end: cursor, mentions: ['assistant'] };
}
