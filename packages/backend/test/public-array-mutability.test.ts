import assert from 'node:assert/strict';
import test from 'node:test';

import { Schema } from 'effect';

import type { outputSchema as jobsOutputSchema } from '#backend/procedures/jobs/job-overviews/output';
import type { outputSchema as learningOutputSchema } from '#backend/procedures/learning/list-attempts/output';
import type { outputSchema as materialOutputSchema } from '#backend/procedures/material/material/output';
import type { outputSchema as materialsOutputSchema } from '#backend/procedures/materials/list/output';
import { inputSchema as reorderInputSchema } from '#backend/procedures/materials/reorder/input';
import type { outputSchema as practiceOutputSchema } from '#backend/procedures/practice/practices/output';
import type { outputSchema as recordingPostOutputSchema } from '#backend/procedures/recordings/post-recording/output';
import type { outputSchema as recordingsOutputSchema } from '#backend/procedures/recordings/recordings/output';
import type { JsonValue } from '#backend/shared/json';
import type { materialDocumentSchema } from '#backend/shared/materials/schemas';

type MutableArray<T extends unknown[]> = T;

type CompatibleJson<T extends JsonValue> = T;

export type PublicArrayMutabilityContracts = [
  MutableArray<(typeof materialOutputSchema.Type)['items']>,
  MutableArray<(typeof materialsOutputSchema.Type)['items']>,
  MutableArray<(typeof practiceOutputSchema.Type)['items']>,
  MutableArray<(typeof learningOutputSchema.Type)['items']>,
  MutableArray<(typeof jobsOutputSchema.Type)['items']>,
  MutableArray<(typeof recordingsOutputSchema.Type)['items']>,
  MutableArray<(typeof reorderInputSchema.Type)['materialIds']>,
  MutableArray<(typeof recordingPostOutputSchema.Type)['parts']>,
  MutableArray<(typeof recordingPostOutputSchema.Type)['parts'][number]['jobs']>,
  MutableArray<(typeof materialDocumentSchema.Type)['blocks']>,
  MutableArray<(typeof materialDocumentSchema.Type)['meta']['refiners']>,
  MutableArray<(typeof materialDocumentSchema.Type)['meta']['waitingFor']>
];

export type PublicJsonMutabilityContracts = [
  CompatibleJson<NonNullable<(typeof jobsOutputSchema.Type)['items'][number]['job']['args']>>,
  CompatibleJson<(typeof recordingPostOutputSchema.Type)['parts'][number]['jobs'][number]['args']>
];

test('public array schemas decode arrays that callers can mutate', () => {
  const value = Schema.decodeUnknownSync(Schema.mutable(Schema.Array(Schema.MutableJson)))([
    { nested: [1] }
  ]);

  value.push({ added: true });
  assert.deepEqual(value, [{ nested: [1] }, { added: true }]);
  assert.throws(() => Schema.decodeUnknownSync(Schema.MutableJson)({ nested: [undefined] }));
  assert.throws(() =>
    Schema.decodeUnknownSync(reorderInputSchema)({ materialIds: Array(10_001).fill(1n) })
  );
});
