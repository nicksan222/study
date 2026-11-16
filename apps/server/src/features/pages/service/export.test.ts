import { MaterialsRpc } from '@study/contracts';
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
import { PagesRpc } from '@study/contracts';
import { createBlock } from '@study/contracts';
import { SourcesRpc } from '@study/contracts';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { PagesRpcLive } from '#server/features/pages/rpc/index';
import { Sources } from '#server/features/sources/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { exportBudget } from '#server/platform/content-export/budget';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { testLiveQueries } from '#testing/live-queries';
import { deletionDocument } from '#testing/material-deletion';
import { materialRpcHandlers } from '#testing/material-rpc';

import { safeExportLink, escapeHtml } from './export-serializer.ts';

test.stable('export primitives reject active protocols and escape text and attributes', () => {
  for (const link of [
    'javascript:alert(1)',
    'data:text/html,x',
    'https://a/\n',
    '//example.com',
    'file:///tmp/x'
  ])
    test.assert.ok(safeExportLink(link) === false);

  test.assert.ok(safeExportLink('https://example.com/a') === true);
  test.assert.ok(escapeHtml('<script a="x">&') === '&lt;script a=&quot;x&quot;&gt;&amp;');
});

test.stable(
  'native export is deterministic, exact, escaped and fenced by deletion acceptance',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const services = Layer.mergeAll(Materials.layer, Sources.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    const handlers = Layer.mergeAll(
      materialRpcHandlers,
      SourcesRpcLive.pipe(Layer.provide(testLiveQueries)),
      PagesRpcLive.pipe(Layer.provide(testLiveQueries))
    ).pipe(Layer.provideMerge(services));

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(PagesRpc, { flatten: true });
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
            const material = yield* rpc('pages.create', {
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              title: 'Export',
              document
            });
            const key = { id: material.version!.id, format: 'html' as const };
            const first = yield* rpc('pages.exportFile', key);

            test.expect(first.filename).toBe(`page-${material.version!.id}.html`);
            test.expect(first).toStrictEqual(yield* rpc('pages.exportFile', key));
            const text = new TextDecoder().decode(first.bytes);

            test.assert.ok(text.includes('<th colspan="2" rowspan="2">'));
            test.assert.ok(
              text.includes('<a href="https://example.com"><strong>Reference</strong></a>')
            );

            test.assert.ok(!text.includes('<script>'));
            test.assert.ok(text.includes('&lt;script&gt;'));
            test.assert.ok(first.omissions.some((o) => o.code === 'math_not_rendered'));
            test.assert.strictEqual(first.versionId, material.version!.id);

            for (const kind of ['audio', 'video'] as const) {
              const capability = yield* sourceRpc('sources.importCapability', {
                kind,
                mime: kind + '/test'
              });

              test.assert.ok(capability.status === 'unavailable');
              test.assert.ok(capability.provider.capability === 'unverified');
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
            const rich = yield* rpc('pages.create', {
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
              (yield* rpc('pages.exportFile', {
                id: rich.version!.id,
                format: 'markdown'
              })).bytes
            );
            const visible = markdown.split('\n\n~~~')[0]!;

            test.assert.ok(!visible.includes('![pixel]'));
            test.assert.ok(!visible.includes('[open]'));
            test.assert.ok(visible.includes('&#33;&#91;pixel&#93;'));
            test.assert.ok(visible.includes('&#96;code&#96;'));
            test.assert.ok(visible.includes('&#42;word&#42;'));
            test.assert.ok(visible.includes('>100. Restart</div>'));
            test.assert.ok(visible.includes('margin-left:2em'));
            test.assert.ok(visible.includes('data-continuation="true">After child</div>'));

            const largeBody = deletionDocument('x'.repeat(128 * 1024));
            const large = yield* rpc('pages.create', {
              createKey: 'large-export',
              title: 'Large evidence',
              document: largeBody,
              inputs: [],
              citations: []
            });

            test.assert.ok(large.version);
            const input = { kind: 'page' as const, versionId: large.version.id };
            const cited = yield* rpc('pages.create', {
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

            test.assert.ok(cited.version);
            const references = yield* rpc('pages.exportFile', {
              id: cited.version.id,
              format: 'markdown'
            });

            test.assert.ok(
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

            test.assert.ok(new TextDecoder().decode(csv.bytes).includes("'=1+1"));
            const aidJson = yield* aidRpc('materials.exportMaterialVersion', {
              id: aid.version.id,
              format: 'aid_json'
            });

            test.assert.ok(
              JSON.parse(new TextDecoder().decode(aidJson.bytes)).version.content.kind ===
                'flashcards'
            );
            const historical = yield* rpc('pages.create', {
              createKey: 'history-export',
              title: 'History',
              document: deletionDocument('BEFORE_EXACT'),
              inputs: [],
              citations: []
            });

            test.assert.ok(historical.version);
            yield* rpc('pages.save', {
              pageId: historical.id,
              expectedVersionId: historical.version.id,
              key: 'export-edit',
              document: deletionDocument('AFTER_CURRENT')
            });
            const exact = yield* rpc('pages.exportFile', {
              id: historical.version.id,
              format: 'markdown'
            });

            test.assert.ok(new TextDecoder().decode(exact.bytes).includes('BEFORE_EXACT'));
            test.assert.ok(!new TextDecoder().decode(exact.bytes).includes('AFTER_CURRENT'));
            const scope = { pageId: historical.id, keepLatest: 1 };
            const history = yield* rpc('pages.previewHistory', scope);

            yield* rpc('pages.retireHistory', { ...scope, token: history.token });
            test.assert.ok(
              (yield* Effect.flip(
                rpc('pages.exportFile', { id: historical.version.id, format: 'markdown' })
              )).kind === 'not_found'
            );
            const preview = yield* rpc('pages.previewDeletion', { id: material.id });

            yield* rpc('pages.delete', { pageId: material.id, token: preview.token });
            test.assert.ok((yield* Effect.flip(rpc('pages.exportFile', key))).kind === 'not_found');
            test
              .expect(
                yield* aidRpc('materials.exportMaterialVersion', {
                  id: aid.version.id,
                  format: 'aid_json'
                }),
                'Independent learning artifacts keep their own export lifetime'
              )
              .toStrictEqual(aidJson);
          })
        ).pipe(Effect.provide(handlers))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
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
      test.assert.strictEqual(exact.remaining(), 0);
      test
        .expect(() => exportBudget(bytes - 1).consume(value))
        .toThrow(test.expect.objectContaining({ kind: 'invalid_input' }));
    }

    let readLater = false;
    const evidence = {
      first: 'é'.repeat(100),
      get later() {
        readLater = true;

        return 'must not read';
      }
    };

    test
      .expect(() => exportBudget(20).consume(evidence))
      .toThrow(test.expect.objectContaining({ kind: 'invalid_input' }));
    test.assert.ok(readLater === false);
  }
);
