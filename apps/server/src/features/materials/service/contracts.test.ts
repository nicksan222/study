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

import { materialContentDetailSchema } from '@study/contracts/materials/schemas';
import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

testStable('Materials rejects retired source and authored document kinds', () => {
  for (const kind of ['file', 'audio', 'video', 'image', 'link', 'document', 'diagram'])
    assert.ok(
      Schema.is(materialContentDetailSchema)({
        kind,
        sourceId: 1n,
        source: {},
        extracted: null
      }) === false
    );

  assert.ok(
    Schema.is(materialContentDetailSchema)({
      kind: 'flashcards',
      cards: [{ cardId: 1n, front: 'Question', back: 'Answer' }]
    }) === true
  );
});

testStable('native materials RPC names cover the complete public API', async () => {
  const { MaterialsRpc } = await import('@study/contracts/materials/rpc');

  expect([...MaterialsRpc.requests.keys()].sort()).toStrictEqual(
    [
      'exportMaterialVersion',
      'previewHistoryPrune',
      'requestHistoryPrune',
      'historyPrune',
      'retryHistoryPrune',
      'previewDeletion',
      'requestDeletion',
      'deletion',
      'retryDeletion',
      'activeMaterialGenerations',
      'materialGeneration',
      'cancelMaterialGeneration',
      'retryMaterialGeneration',
      'requestMaterialGeneration',
      'archive',
      'unarchive',
      'create',
      'createVersion',
      'material',
      'materialVersion',
      'materials',
      'materialVersions',
      'citations',
      'attach',
      'detach',
      'updateDescription',
      'rename',
      'reorder',
      'replaceDraft',
      'deleteDraft',
      'publishVersion',
      'setCitations'
    ]
      .map((name) => `materials.${name}`)
      .sort()
  );
});
