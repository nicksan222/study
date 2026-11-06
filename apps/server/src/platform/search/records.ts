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

const encodeTarget = Schema.encodeSync(
  Schema.fromJsonString(Schema.toCodecJson(searchTargetSchema))
);

function hash(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

function fingerprint(row: SearchProjection, target: string): string {
  return hash(
    JSON.stringify([
      target,
      row.title,
      row.text,
      row.revision,
      [...row.projectIds].map(String).sort()
    ])
  );
}

export function searchEntities(rows: readonly SearchProjection[]) {
  const identities = new Set<string>();

  return rows.map((row) => {
    const target = encodeTarget(row.target);

    if (identities.has(target))
      throw new StudyError('internal', 'Duplicate searchable entity identity');

    identities.add(target);

    return {
      kind: row.target.type === 'registered' ? row.target.entity : row.target.type,
      target,
      fingerprint: fingerprint(row, target),
      title: row.title,
      text: [row.title, row.text].filter(Boolean).join('\n').trim(),
      projection: row
    };
  });
}

export type SearchEntity = ReturnType<typeof searchEntities>[number];

export function searchRecord(entity: SearchEntity, text: string, ordinal: number) {
  return { ...entity, key: hash(entity.target) + ':' + ordinal, text };
}

export type SearchRecord = ReturnType<typeof searchRecord>;

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
