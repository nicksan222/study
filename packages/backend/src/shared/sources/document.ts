import type { anchorSchema, documentSchema } from './schemas.ts';

type Mutable<T> =
  T extends ReadonlyArray<infer Item>
    ? Mutable<Item>[]
    : T extends object
      ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
      : T;

export type Anchor = Mutable<typeof anchorSchema.Type>;

export type Document = Mutable<typeof documentSchema.Type>;

export type Block = Document['blocks'][number];

export type BlockKind = Block['kind'];

export type Stamp = Document['meta']['refiners'][number];

export type DocumentMeta = Document['meta'];
