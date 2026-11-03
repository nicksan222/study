import { Effect, Schema } from 'effect';

import { projectIdSchema } from '../ids.ts';

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const segments = (value: string) => Array.from(graphemes.segment(value), (part) => part.segment);

export function validProjectIcon(value: string) {
  return (
    value === value.trim() &&
    /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*$/u.test(value) &&
    segments(value).length >= 1 &&
    segments(value).length <= 3 &&
    value.length <= 24
  );
}

export const projectIconSchema = Schema.String.check(Schema.makeFilter(validProjectIcon));

export function projectInitials(name: string) {
  const words =
    name
      .trim()
      .normalize('NFC')
      .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
  const letters =
    words.length > 1
      ? segments(words[0]!)[0]! + segments(words.at(-1)!)[0]!
      : segments(words[0] ?? '')
          .slice(0, 2)
          .join('');
  return segments(letters.toLocaleUpperCase('en-US')).slice(0, 2).join('') || 'S';
}

export const projectSchema = Schema.Struct({
  id: projectIdSchema.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })),
  name: Schema.String,
  icon: Schema.NullOr(projectIconSchema).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  examOn: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt
});

export type Project = typeof projectSchema.Type;
