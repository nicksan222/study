/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates local semantic retrieval through typed capabilities and durable        │
 * │ workflow resources.                                                                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves entity identities and keeps retrieval scoped and bounded.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature projections own visibility and runtime registration remains an explicit caller   │
 * │ decision.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type { SearchProjection } from '@study/contracts/search/schemas';
import { searchTargetSchema } from '@study/contracts/search/schemas';
import { Schema } from 'effect';

import { textWindowSize } from './text-windows.ts';

const encodeTarget = Schema.encodeSync(
  Schema.fromJsonString(Schema.toCodecJson(searchTargetSchema))
);

/** Create stable opaque keys without placing entity text in SQLite primary keys. */
function hash(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

/** Include the indexing policy so a segmentation change invalidates every cached ordinal. */
function fingerprint(row: SearchProjection, target: string, maximum: number): string {
  return hash(
    JSON.stringify([
      'bounded-text-windows-v1',
      textWindowSize(maximum),
      target,
      row.title,
      row.text,
      row.revision,
      [...row.projectIds].map(String).sort()
    ])
  );
}

/** Validate unique targets and derive visibility-sensitive fingerprints before chunking or ranking. */
export function* searchEntities(rows: Iterable<SearchProjection>, maximum: number) {
  const identities = new Set<string>();

  for (const row of rows) {
    const target = encodeTarget(row.target);

    if (identities.has(target))
      throw new StudyError('internal', 'Duplicate searchable entity identity');

    identities.add(target);

    yield {
      kind: row.target.type === 'registered' ? row.target.entity : row.target.type,
      target,
      fingerprint: fingerprint(row, target, maximum),
      title: row.title,
      text: [row.title, row.text].filter(Boolean).join('\n').trim(),
      projection: row
    };
  }
}

export type SearchEntity =
  ReturnType<typeof searchEntities> extends Generator<infer Entity> ? Entity : never;

/** Associate one ordered chunk with its original entity and stable per-entity ordinal. */
export function searchRecord(entity: SearchEntity, text: string, ordinal: number) {
  return { ...entity, key: hash(entity.target) + ':' + ordinal, text };
}

export type SearchRecord = ReturnType<typeof searchRecord>;

/** Reject malformed or zero vectors and serialize portable little-endian float components. */
export function vectorBuffer(vector: Float32Array, dimensions: number): Buffer {
  if (
    vector.length !== dimensions ||
    !vector.every(Number.isFinite) ||
    !vector.some((value) => value !== 0)
  )
    throw new StudyError('invalid_input', 'Embedding has invalid dimensions or values');

  const buffer = Buffer.alloc(dimensions * 4);

  for (let i = 0; i < dimensions; i++) buffer.writeFloatLE(vector[i]!, i * 4);

  return buffer;
}
