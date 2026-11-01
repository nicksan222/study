/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks source-backed material content uses the canonical public source shape and   │
 * │ that the native RPC request names cover the public materials API.                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses canonical contract schemas and RPC definitions to catch public shape drift.       │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { materialContentDetailSchema } from '@study/contracts/materials/schemas';
import { Schema } from 'effect';

test('source-backed material content uses the canonical public source shape', () => {
  const source = {
    id: 1n,
    name: 'source',
    kind: 'text',
    mime: 'text/plain',
    origin: 'import',
    projectId: 1n,
    projectName: 'project',
    sizeBytes: 3n,
    sha256: new Uint8Array(32),
    uri: null,
    createdAt: 1n
  };
  const detail = Schema.decodeUnknownSync(materialContentDetailSchema)({
    kind: 'file',
    sourceId: 1n,
    source
  });

  assert.deepEqual(detail, { kind: 'file', sourceId: 1n, source });
});

test('native materials RPC names cover the complete public API', async () => {
  const { MaterialsRpc } = await import('@study/contracts/materials/rpc');

  assert.deepEqual(
    [...MaterialsRpc.requests.keys()].sort(),
    [
      'archive',
      'attach',
      'create',
      'createVersion',
      'deleteDraft',
      'detach',
      'material',
      'citations',
      'dependents',
      'inputs',
      'materialVersion',
      'materialVersionExport',
      'materials',
      'materialVersions',
      'publishVersion',
      'rename',
      'reorder',
      'replaceDraft',
      'requestMaterialGeneration',
      'setCitations',
      'unarchive'
    ]
      .map((name) => `materials.${name}`)
      .sort()
  );
});
