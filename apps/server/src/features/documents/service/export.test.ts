/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises exact native exports and their retained content availability barriers.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks deterministic serialization, escaped literals and explicit list numbering.      │
 * │ - Exercises citation expansion limits and deletion or history acceptance.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use real temporary SQLite state and native RPC without external provider calls.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { DocumentsRpc } from '@study/contracts/documents/rpc';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { DocumentsRpcLive } from '#server/features/documents/rpc/index';
import { Materials } from '#server/features/materials/index';
import { Sources } from '#server/features/sources/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { exportBudget } from '#server/platform/content-export/budget';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { deletionDocument } from '#testing/material-deletion';
import { materialRpcHandlers } from '#testing/material-rpc';

import { safeExportLink, escapeHtml } from './export-serializer.ts';

testStable('export primitives reject active protocols and escape text and attributes', () => {
  for (const link of [
    'javascript:alert(1)',
    'data:text/html,x',
    'https://a/\n',
    '//example.com',
    'file:///tmp/x'
  ])
    assert.ok(safeExportLink(link) === false);

  assert.ok(safeExportLink('https://example.com/a') === true);
  assert.ok(escapeHtml('<script a="x">&') === '&lt;script a=&quot;x&quot;&gt;&amp;');
});

testStable(
  'native export is deterministic, exact, escaped and fenced by deletion acceptance',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const services = Layer.mergeAll(Materials.layer, Sources.layer, Documents.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    const handlers = Layer.mergeAll(materialRpcHandlers, SourcesRpcLive, DocumentsRpcLive).pipe(
      Layer.provideMerge(services)
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(DocumentsRpc, { flatten: true });
            const aidRpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const sourceRpc = yield* RpcTest.makeClient(SourcesRpc, { flatten: true });
            const document = {
              ...deletionDocument('Exact <script>alert(1)</script>'),
              blocks: [
                createBlock({
                  type: 'paragraph',
                  inlines: [{ type: 'text', text: '<script>alert(1)</script>', marks: ['strong'] }]
                }),
                createBlock({ type: 'code', code: '```\n<script>x</script>', language: 'html' }),
                createBlock({ type: 'math', expression: '<img src=x onerror=x>' }),
                createBlock({
                  type: 'paragraph',
                  inlines: [
                    {
                      type: 'link',
                      text: 'Reference',
                      href: 'https://example.com',
                      marks: ['strong']
                    }
                  ]
                }),
                createBlock({
                  type: 'table',
                  rows: [
                    {
                      cells: [
                        {
                          header: true,
                          colspan: 2,
                          rowspan: 2,
                          colwidth: [120, 120],
                          paragraphs: [[{ type: 'text', text: 'Merged', marks: [] }]]
                        },
                        { header: true, paragraphs: [[{ type: 'text', text: 'B', marks: [] }]] }
                      ]
                    },
                    {
                      cells: [
                        { header: false, paragraphs: [[{ type: 'text', text: 'C', marks: [] }]] }
                      ]
                    }
                  ]
                })
              ]
            };
            const material = yield* rpc('documents.create', {
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              title: 'Export',
              document
            });
            const key = { id: material.version!.id, format: 'html' as const };
            const first = yield* rpc('documents.exportFile', key);

            expect(first).toStrictEqual(yield* rpc('documents.exportFile', key));
            const text = new TextDecoder().decode(first.bytes);

            assert.ok(text.includes('<th colspan="2" rowspan="2">'));
            assert.ok(
              text.includes('<a href="https://example.com"><strong>Reference</strong></a>')
            );

            assert.ok(!text.includes('<script>'));
            assert.ok(text.includes('&lt;script&gt;'));
            assert.ok(first.omissions.some((o) => o.code === 'math_not_rendered'));
            assert.strictEqual(first.versionId, material.version!.id);

            for (const kind of ['audio', 'video'] as const) {
              const capability = yield* sourceRpc('sources.importCapability', {
                kind,
                mime: kind + '/test'
              });

              assert.ok(capability.status === 'unavailable');
              assert.ok(capability.provider.capability === 'unverified');
            }

            const literal =
              '![pixel](https://example.com/pixel) [open](file:///tmp/x) `code` *word*';
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
            const rich = yield* rpc('documents.create', {
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
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
              (yield* rpc('documents.exportFile', {
                id: rich.version!.id,
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
            const large = yield* rpc('documents.create', {
              createKey: 'large-export',
              title: 'Large evidence',
              document: largeBody,
              inputs: [],
              citations: []
            });

            assert.ok(large.version);
            const input = { kind: 'document' as const, versionId: large.version.id };
            const cited = yield* rpc('documents.create', {
              createKey: 'cited-export',
              title: 'Repeated evidence',
              document: deletionDocument('Cited'),
              inputs: [input],
              citations: Array.from({ length: 40 }, (_, index) => ({
                marker: index + 1,
                input,
                anchor: { type: 'authored' as const },
                quote: 'x',
                target: { blockId: largeBody.blocks[0]!.id, start: 0, end: 1 }
              }))
            });

            assert.ok(cited.version);
            const references = yield* rpc('documents.exportFile', {
              id: cited.version.id,
              format: 'markdown'
            });

            assert.ok(
              references.bytes.length < 64 * 1024,
              'Referenced source bodies are never expanded into another export'
            );
            const aid = yield* aidRpc('materials.create', {
              title: 'Cards',
              publish: true,
              content: {
                kind: 'flashcards',
                cards: [{ front: '=1+1', back: 'Quoted "answer"\nnext' }]
              }
            });
            const csv = yield* aidRpc('materials.exportMaterialVersion', {
              id: aid.version.id,
              format: 'csv'
            });

            assert.ok(new TextDecoder().decode(csv.bytes).includes("'=1+1"));
            const aidJson = yield* aidRpc('materials.exportMaterialVersion', {
              id: aid.version.id,
              format: 'aid_json'
            });

            assert.ok(
              JSON.parse(new TextDecoder().decode(aidJson.bytes)).version.content.kind ===
                'flashcards'
            );
            const historical = yield* rpc('documents.create', {
              createKey: 'history-export',
              title: 'History',
              document: deletionDocument('BEFORE_EXACT'),
              inputs: [],
              citations: []
            });

            assert.ok(historical.version);
            yield* rpc('documents.save', {
              documentId: historical.id,
              expectedVersionId: historical.version.id,
              key: 'export-edit',
              document: deletionDocument('AFTER_CURRENT')
            });
            const exact = yield* rpc('documents.exportFile', {
              id: historical.version.id,
              format: 'markdown'
            });

            assert.ok(new TextDecoder().decode(exact.bytes).includes('BEFORE_EXACT'));
            assert.ok(!new TextDecoder().decode(exact.bytes).includes('AFTER_CURRENT'));
            const scope = { documentId: historical.id, keepLatest: 1 };
            const history = yield* rpc('documents.previewHistory', scope);

            yield* rpc('documents.retireHistory', { ...scope, token: history.token });
            assert.ok(
              (yield* Effect.flip(
                rpc('documents.exportFile', { id: historical.version.id, format: 'markdown' })
              )).kind === 'not_found'
            );
            const preview = yield* rpc('documents.previewDeletion', { id: material.id });

            yield* rpc('documents.delete', { documentId: material.id, token: preview.token });
            assert.ok((yield* Effect.flip(rpc('documents.exportFile', key))).kind === 'not_found');
            expect(
              yield* aidRpc('materials.exportMaterialVersion', {
                id: aid.version.id,
                format: 'aid_json'
              }),
              'Independent learning artifacts keep their own export lifetime'
            ).toStrictEqual(aidJson);
          })
        ).pipe(Effect.provide(handlers))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'export budget counts escaped UTF-8 exactly and rejects before reading later evidence',
  () => {
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
      assert.strictEqual(exact.remaining(), 0);
      expect(() => exportBudget(bytes - 1).consume(value)).toThrow(
        expect.objectContaining({ kind: 'invalid_input' })
      );
    }

    let readLater = false;
    const evidence = {
      first: 'é'.repeat(100),
      get later() {
        readLater = true;

        return 'must not read';
      }
    };

    expect(() => exportBudget(20).consume(evidence)).toThrow(
      expect.objectContaining({ kind: 'invalid_input' })
    );
    assert.ok(readLater === false);
  }
);
