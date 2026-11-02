/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ Exercises exact native exports and their retained content availability barriers.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks deterministic serialization, escaped literals and explicit list numbering.      │
 * │ - Exercises citation expansion limits and deletion or history acceptance.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use real temporary SQLite state and native RPC without external provider calls.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { Sources } from '#server/features/sources/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { deletionDocument } from '#testing/material-deletion';

import { exportBudget } from '../export-budget.ts';
import { safeExportLink, escapeHtml } from './export-serializer.ts';

test('export primitives reject active protocols and escape text and attributes', () => {
  for (const link of [
    'javascript:alert(1)',
    'data:text/html,x',
    'https://a/\n',
    '//example.com',
    'file:///tmp/x'
  ])
    assert.equal(safeExportLink(link), false);
  assert.equal(safeExportLink('https://example.com/a'), true);
  assert.equal(escapeHtml('<script a="x">&'), '&lt;script a=&quot;x&quot;&gt;&amp;');
});

test('native export is deterministic, exact, escaped and fenced by deletion acceptance', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Materials.layer, Sources.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );
  const handlers = Layer.mergeAll(MaterialsRpcLive, SourcesRpcLive).pipe(
    Layer.provideMerge(services)
  );
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const sourceRpc = yield* RpcTest.makeClient(SourcesRpc, { flatten: true });
          const document = {
            ...deletionDocument('Exact <script>alert(1)</script>'),
            blocks: [
              createBlock({
                type: 'paragraph',
                inlines: [{ type: 'text', text: '<script>alert(1)</script>', marks: ['strong'] }]
              }),
              createBlock({ type: 'code', code: '```\n<script>x</script>', language: 'html' }),
              createBlock({ type: 'math', expression: '<img src=x onerror=x>' })
            ]
          };
          const material = yield* rpc('materials.createManualDocument', {
            title: 'Export',
            document
          });
          const key = { id: material.version.id, format: 'html' as const };
          const first = yield* rpc('materials.exportMaterialVersion', key);
          assert.deepEqual(first, yield* rpc('materials.exportMaterialVersion', key));
          const text = new TextDecoder().decode(first.bytes);
          assert.ok(!text.includes('<script>'));
          assert.ok(text.includes('&lt;script&gt;'));
          assert.ok(first.omissions.some((o) => o.code === 'math_not_rendered'));
          assert.equal(first.versionId, material.version.id);
          assert.equal(
            (yield* Effect.flip(rpc('materials.exportMaterialVersion', { ...key, format: 'csv' })))
              .kind,
            'unsupported'
          );
          for (const kind of ['audio', 'video'] as const) {
            const capability = yield* sourceRpc('sources.importCapability', {
              kind,
              mime: kind + '/test'
            });
            assert.equal(capability.status, 'unavailable');
            assert.equal(capability.provider.capability, 'unverified');
          }
          const literal = '![pixel](https://example.com/pixel) [open](file:///tmp/x) `code` *word*';
          const listItems = [
            {
              depth: 0,
              ordered: true,
              start: 1,
              inlines: [{ type: 'text' as const, text: 'First', marks: [] }]
            },
            {
              depth: 0,
              ordered: true,
              start: 100,
              inlines: [{ type: 'text' as const, text: 'Restart', marks: [] }]
            },
            {
              depth: 1,
              ordered: false,
              start: 1,
              inlines: [{ type: 'text' as const, text: 'Child', marks: [] }]
            },
            {
              depth: 0,
              ordered: true,
              start: 100,
              continuation: true,
              inlines: [{ type: 'text' as const, text: 'After child', marks: [] }]
            }
          ];
          const rich = yield* rpc('materials.createManualDocument', {
            title: 'Literal Markdown and numbering',
            document: {
              ...deletionDocument('Rich'),
              blocks: [
                createBlock({
                  type: 'paragraph',
                  inlines: [{ type: 'text', text: literal, marks: ['strong', 'emphasis'] }]
                }),
                createBlock({ type: 'list_item', items: listItems })
              ]
            }
          });
          const markdown = new TextDecoder().decode(
            (yield* rpc('materials.exportMaterialVersion', {
              id: rich.version.id,
              format: 'markdown'
            })).bytes
          );
          const visible = markdown.split('\n\n~~~')[0]!;
          assert.ok(!visible.includes('![pixel]'));
          assert.ok(!visible.includes('[open]'));
          assert.ok(visible.includes('&#33;&#91;pixel&#93;'));
          assert.ok(visible.includes('&#96;code&#96;'));
          assert.ok(visible.includes('&#42;word&#42;'));
          assert.ok(visible.includes('>100. Restart</div>'));
          assert.ok(visible.includes('margin-left:2em'));
          assert.ok(visible.includes('data-continuation="true">After child</div>'));

          const largeBody = deletionDocument('x'.repeat(128 * 1024));
          const large = yield* rpc('materials.createManualDocument', {
            title: 'Large evidence',
            document: largeBody
          });
          const exactLarge = yield* rpc('materials.materialVersionDocument', {
            id: large.version.id
          });
          const cited = yield* rpc('materials.create', {
            title: 'Repeated retained evidence',
            publish: false,
            inputs: [large.version.id],
            content: { kind: 'document', ...deletionDocument('Cited') }
          });
          yield* rpc('materials.setCitations', {
            id: cited.version.id,
            citations: Array.from({ length: 40 }, (_, index) => ({
              marker: BigInt(index + 1),
              inputVersionId: large.version.id,
              anchor: { type: 'authored' as const },
              quote: 'x',
              target: {
                versionId: large.version.id,
                documentId: exactLarge.id,
                blockId: largeBody.blocks[0]!.id,
                start: 0,
                end: 1
              }
            }))
          });
          yield* rpc('materials.publishVersion', { id: cited.version.id });
          assert.equal(
            (yield* Effect.flip(
              rpc('materials.exportMaterialVersion', { id: cited.version.id, format: 'markdown' })
            )).kind,
            'invalid_input'
          );
          const aid = yield* rpc('materials.create', {
            title: 'Cards',
            inputs: [material.version.id],
            publish: true,
            content: {
              kind: 'flashcards',
              cards: [{ front: '=1+1', back: 'Quoted "answer"\nnext' }]
            }
          });
          const csv = yield* rpc('materials.exportMaterialVersion', {
            id: aid.version.id,
            format: 'csv'
          });
          assert.ok(new TextDecoder().decode(csv.bytes).includes("'=1+1"));
          const aidJson = yield* rpc('materials.exportMaterialVersion', {
            id: aid.version.id,
            format: 'aid_json'
          });
          assert.equal(
            JSON.parse(new TextDecoder().decode(aidJson.bytes)).version.content.kind,
            'flashcards'
          );
          const historical = yield* rpc('materials.create', {
            title: 'History',
            publish: true,
            content: { kind: 'document', ...deletionDocument('BEFORE_EXACT') }
          });
          yield* rpc('materials.createVersion', {
            materialId: historical.id,
            publish: true,
            content: { kind: 'document', ...deletionDocument('AFTER_CURRENT') }
          });
          const exact = yield* rpc('materials.exportMaterialVersion', {
            id: historical.version.id,
            format: 'markdown'
          });
          assert.ok(new TextDecoder().decode(exact.bytes).includes('BEFORE_EXACT'));
          assert.ok(!new TextDecoder().decode(exact.bytes).includes('AFTER_CURRENT'));
          const scope = { materialId: historical.id, policy: { keepLatest: 1 } };
          const history = yield* rpc('materials.previewHistoryPrune', scope);
          yield* rpc('materials.requestHistoryPrune', {
            ...scope,
            operationId: 'export-history',
            token: history.token,
            candidateIds: history.candidateIds
          });
          assert.equal(
            (yield* Effect.flip(
              rpc('materials.exportMaterialVersion', {
                id: historical.version.id,
                format: 'markdown'
              })
            )).kind,
            'not_found'
          );
          const preview = yield* rpc('materials.previewDeletion', { materialId: material.id });
          // Acceptance uses the production preview token rather than performing cleanup.
          yield* rpc('materials.requestDeletion', {
            materialId: material.id,
            token: preview.token,
            descendantIds: preview.descendants
          });
          assert.equal(
            (yield* Effect.flip(rpc('materials.exportMaterialVersion', key))).kind,
            'not_found'
          );
          assert.equal(
            (yield* Effect.flip(
              rpc('materials.exportMaterialVersion', { id: aid.version.id, format: 'aid_json' })
            )).kind,
            'not_found'
          );
        })
      ).pipe(Effect.provide(handlers))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('export budget counts escaped UTF-8 exactly and rejects before reading later evidence', () => {
  for (const value of [
    'é😀\n"\\',
    '\ud800',
    { id: 9n, optional: undefined, values: ['字', null, true] }
  ]) {
    const serialized = JSON.stringify(value, (_, item: unknown) =>
      typeof item === 'bigint' ? String(item) : item
    );
    const bytes = new TextEncoder().encode(serialized).length;
    const exact = exportBudget(bytes);
    exact.consume(value);
    assert.equal(exact.remaining(), 0);
    assert.throws(() => exportBudget(bytes - 1).consume(value), { kind: 'invalid_input' });
  }
  let readLater = false;
  const evidence = {
    first: 'é'.repeat(100),
    get later() {
      readLater = true;
      return 'must not read';
    }
  };
  assert.throws(() => exportBudget(20).consume(evidence), { kind: 'invalid_input' });
  assert.equal(readLater, false);
});
