import { Effect, Schema } from 'effect';

import { projectIdSchema } from '../ids.ts';

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const segments = (value: string) => Array.from(graphemes.segment(value), (part) => part.segment);

function validProjectMonogram(value: string) {
  return (
    value === value.trim() &&
    /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*$/u.test(value) &&
    segments(value).length >= 1 &&
    segments(value).length <= 3 &&
    value.length <= 24
  );
}

export const projectIconColors = [
  'neutral',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink'
] as const;
export const projectSymbols = [
  'book',
  'notebook',
  'folder',
  'graduation-cap',
  'atom',
  'flask',
  'dna',
  'microscope',
  'calculator',
  'sigma',
  'chart',
  'globe',
  'landmark',
  'languages',
  'palette',
  'music',
  'code',
  'cpu',
  'rocket',
  'leaf',
  'heart',
  'brain',
  'sparkles',
  'compass'
] as const;
export const projectEmojis = [
  '📚',
  '📖',
  '✏️',
  '🎓',
  '🧠',
  '🔬',
  '🧬',
  '🧪',
  '⚛️',
  '🧮',
  '📐',
  '📊',
  '🌍',
  '🏛️',
  '🎨',
  '🎵',
  '💻',
  '🚀',
  '🌱',
  '💡',
  '⭐',
  '🎯',
  '⚖️',
  '🗺️'
] as const;
const iconColor = Schema.Literals(projectIconColors);
export const projectIconSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('automatic'), color: iconColor }),
  Schema.Struct({
    kind: Schema.Literal('monogram'),
    color: iconColor,
    value: Schema.String.check(Schema.makeFilter(validProjectMonogram))
  }),
  Schema.Struct({
    kind: Schema.Literal('symbol'),
    color: iconColor,
    value: Schema.Literals(projectSymbols)
  }),
  Schema.Struct({
    kind: Schema.Literal('emoji'),
    color: iconColor,
    value: Schema.Literals(projectEmojis)
  })
]);
export type ProjectIcon = typeof projectIconSchema.Type;
export const automaticProjectIcon = {
  kind: 'automatic',
  color: 'neutral'
} as const satisfies ProjectIcon;

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
  icon: projectIconSchema.pipe(Schema.withDecodingDefault(Effect.succeed(automaticProjectIcon))),
  examOn: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt
});

export type Project = typeof projectSchema.Type;
