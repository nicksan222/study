/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks retained export barriers, exact byte budgets and conservative import        │
 * │ claims.                                                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises native RPC handlers with real temporary SQLite state.                        │
 * │ - Checks canonical aid codecs, CSV safety and shared reader callbacks.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ All fixtures own cleanup and never invoke external providers or background workflows.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { materialVersionIdSchema } from '@study/contracts/ids';
import { materialAidExportSchema, MAX_EXPORT_BYTES } from '@study/contracts/materials/export';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import type { materialContentInputSchema } from '@study/contracts/materials/schemas';
import { PagesRpc } from '@study/contracts/pages/rpc';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { eq, and } from '@study/db';
import { material_flashcard_entries } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Materials } from '#server/features/materials/index';
import { makeCitations } from '#server/features/materials/store/citations';
import { MaterialExportCitationsStore } from '#server/features/materials/store/export';
import { Pages } from '#server/features/pages/index';
import { PagesRpcLive } from '#server/features/pages/rpc/index';
import { Sources } from '#server/features/sources/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { exportBudget } from '#server/platform/content-export/budget';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { deletionDocument } from '#testing/material-deletion';
import { materialRpcHandlers } from '#testing/material-rpc';

import { serializeMaterialVersion } from './export-serializer.ts';

async function fixture() {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const database = Layer.succeed(Database, { store: context });
  const services = Layer.mergeAll(Materials.layer, Sources.layer, Pages.layer).pipe(
    Layer.provideMerge(database)
  );
  const handlers = Layer.mergeAll(materialRpcHandlers, SourcesRpcLive, PagesRpcLive).pipe(
    Layer.provideMerge(services)
  );

  return {
    handlers,
    context,
    async close() {
      context.close();
      await location.cleanup();
    }
  };
}

for (const retirement of ['deletion', 'prune'] as const) {
  testStable(
    `exact authored export and ancestor ${retirement} honor retained descendant pins`,
    async () => {
      const f = await fixture();

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(PagesRpc, { flatten: true });
            const ancestor = yield* rpc('pages.create', {
              createKey: `export-${retirement}`,
              title: 'Ancestor',
              document: deletionDocument('Retained ancestor'),
              inputs: [],
              citations: []
            });

            assert.ok(ancestor.version);
            const chain = [ancestor];
            let input = ancestor.version.id;

            for (let depth = 0; depth < 4; depth++) {
              const next = yield* rpc('pages.create', {
                createKey: `${retirement}-${depth}`,
                title: `Depth ${depth}`,
                document: deletionDocument(`Derived ${depth}`),
                inputs: [{ kind: 'page', versionId: input }],
                citations: []
              });

              assert.ok(next.version);
              chain.push(next);
              input = next.version.id;
            }

            const key = { id: input, format: 'markdown' as const };
            const before = yield* rpc('pages.exportFile', key);

            assert.ok(new TextDecoder().decode(before.bytes).includes('Derived 3'));

            if (retirement === 'prune')
              yield* rpc('pages.save', {
                pageId: ancestor.id,
                expectedVersionId: ancestor.version.id,
                key: 'replace',
                document: deletionDocument('Replacement')
              });

            const scope = { pageId: ancestor.id, keepLatest: 1 };
            const preview =
              retirement === 'prune'
                ? yield* rpc('pages.previewHistory', scope)
                : yield* rpc('pages.previewDeletion', { id: ancestor.id });

            expect(preview.blockedVersionIds).toStrictEqual([ancestor.version.id]);
            const attempted =
              retirement === 'prune'
                ? rpc('pages.retireHistory', { ...scope, token: preview.token })
                : rpc('pages.delete', { pageId: ancestor.id, token: preview.token });

            assert.ok((yield* Effect.flip(attempted)).kind === 'invalid_input');
            expect(yield* rpc('pages.exportFile', key)).toStrictEqual(before);

            for (const descendant of chain.slice(1).reverse()) {
              const selected = yield* rpc('pages.previewDeletion', { id: descendant.id });

              expect(selected.blockedVersionIds).toStrictEqual([]);
              yield* rpc('pages.delete', { pageId: descendant.id, token: selected.token });
            }

            const released =
              retirement === 'prune'
                ? yield* rpc('pages.previewHistory', scope)
                : yield* rpc('pages.previewDeletion', { id: ancestor.id });

            expect(released.blockedVersionIds).toStrictEqual([]);

            if (retirement === 'prune')
              yield* rpc('pages.retireHistory', { ...scope, token: released.token });
            else yield* rpc('pages.delete', { pageId: ancestor.id, token: released.token });

            assert.ok(
              (yield* Effect.flip(
                rpc('pages.exportFile', { id: ancestor.version.id, format: 'markdown' })
              )).kind === 'not_found'
            );
          }).pipe(Effect.scoped, Effect.provide(f.handlers))
        );
      } finally {
        await f.close();
      }
    }
  );
}

testStable(
  'native aid JSON decodes complete canonical versions and exact citations for every aid kind',
  async () => {
    const f = await fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

            const docs = yield* RpcTest.makeClient(PagesRpc, { flatten: true });
            const document = deletionDocument('Evidence é😀');
            const owner = yield* docs('pages.create', {
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              title: 'Evidence',
              document
            });

            yield* docs('pages.version', {
              id: owner.version!.id
            });
            const contents: (typeof materialContentInputSchema.Type)[] = [
              { kind: 'flashcards', cards: [{ front: 'Question é', back: 'Answer 😀' }] },
              {
                kind: 'quiz',
                questions: [
                  {
                    kind: 'single_choice',
                    prompt: 'Which?',
                    explanation: 'Because',
                    choices: [
                      { text: 'Yes', isCorrect: true },
                      { text: 'No', isCorrect: false }
                    ]
                  }
                ]
              },
              { kind: 'diagram', format: 'mermaid', payload: 'graph TD; A-->B' }
            ];
            const codec = Schema.fromJsonString(Schema.toCodecJson(materialAidExportSchema));

            for (const content of contents) {
              const aid = yield* rpc('materials.create', {
                title: content.kind,
                inputs: [{ kind: 'page', versionId: owner.version!.id }],
                publish: false,
                content
              });

              yield* rpc('materials.setCitations', {
                id: aid.version.id,
                citations: [
                  {
                    marker: 4294967295n,
                    input: { kind: 'page' as const, versionId: owner.version!.id },
                    anchor: { type: 'authored' },
                    quote: 'Evidence',
                    target: {
                      blockId: document.blocks[0]!.id,
                      start: 0,
                      end: 8
                    }
                  }
                ]
              });
              yield* rpc('materials.publishVersion', { id: aid.version.id });
              const version = yield* rpc('materials.materialVersion', { id: aid.version.id });
              const citations = (yield* rpc('materials.citations', {
                id: aid.version.id,
                limit: 10
              })).items;
              const file = yield* rpc('materials.exportMaterialVersion', {
                id: aid.version.id,
                format: 'aid_json'
              });
              const text = new TextDecoder().decode(file.bytes);
              const decoded = Schema.decodeUnknownSync(codec)(text);

              expect(decoded).toStrictEqual({ schemaVersion: 1, version, citations });
              expect(
                Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(decoded))
              ).toStrictEqual(decoded);
              assert.strictEqual(JSON.parse(text).version.id, String(version.id));
              expect(decoded.citations[0]!.target).toStrictEqual({
                blockId: document.blocks[0]!.id,
                start: 0,
                end: 8
              });
              assert.ok(file.mediaType === 'application/json');
              // Exercise a legal identity beyond Number's exact range without changing SQLite rows.
              const wide = {
                ...version,
                id: Schema.decodeUnknownSync(materialVersionIdSchema)(9007199254740993n)
              };
              const wideFile = serializeMaterialVersion(wide, 'aid_json', citations);

              assert.strictEqual(
                Schema.decodeUnknownSync(codec)(new TextDecoder().decode(wideFile.bytes)).version
                  .id,
                wide.id
              );
            }
          })
        ).pipe(Effect.provide(f.handlers))
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'native CSV preserves quoted multiline text and neutralizes formula prefixes without altering ordinary text',
  async () => {
    const f = await fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

            yield* RpcTest.makeClient(PagesRpc, { flatten: true });
            const cells = [
              '=1+1',
              '  +SUM(A1)',
              '-1',
              '@SUM(A1)',
              '\tordinary',
              '\rordinary',
              '\nordinary',
              'safe, "quoted"\r\nnext',
              'a=b',
              'é😀'
            ];
            const aid = yield* rpc('materials.create', {
              title: 'CSV cases',
              publish: false,
              content: {
                kind: 'flashcards',
                cards: cells.map((_, index) => ({ front: 'Card ' + index, back: 'Answer' }))
              }
            });

            // Retained content can contain whitespace that authored input normalization removes.
            for (const [position, front] of cells.entries())
              f.context.db.orm
                .update(material_flashcard_entries)
                .set({ front })
                .where(
                  and(
                    eq(material_flashcard_entries.version_id, aid.version.id),
                    eq(material_flashcard_entries.position, BigInt(position))
                  )
                )
                .run();

            yield* rpc('materials.publishVersion', { id: aid.version.id });
            const file = yield* rpc('materials.exportMaterialVersion', {
              id: aid.version.id,
              format: 'csv'
            });
            const text = new TextDecoder().decode(file.bytes);

            for (const front of cells.slice(0, 7))
              assert.ok(text.includes('"\'' + front + '"'), front);

            assert.ok(text.includes('"safe, ""quoted""\r\nnext"'));
            assert.ok(text.includes('"a=b"'));
            assert.ok(text.includes('"é😀"'));
            assert.ok(file.omissions.some((o) => o.code === 'csv_structure'));
            assert.ok(file.mediaType === 'text/csv; charset=utf-8');
            assert.ok(text.endsWith('\r\n'));
          })
        ).pipe(Effect.provide(f.handlers))
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'citation snapshot accepts its exact UTF-8 budget without expanding retained evidence bodies',
  async () => {
    const f = await fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

            const docs = yield* RpcTest.makeClient(PagesRpc, { flatten: true });
            const body = deletionDocument('é😀'.repeat(32 * 1024));
            const owner = yield* docs('pages.create', {
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              title: 'Large',
              document: body
            });
            const later = yield* docs('pages.create', {
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              title: 'Later',
              document: deletionDocument('Later')
            });

            yield* docs('pages.version', {
              id: owner.version!.id
            });
            const claim = yield* rpc('materials.create', {
              title: 'Bounded',
              publish: false,
              inputs: [
                { kind: 'page', versionId: owner.version!.id },
                { kind: 'page', versionId: later.version!.id }
              ],
              content: { kind: 'diagram', format: 'mermaid', payload: 'graph TD; A-->B' }
            });
            const first = {
              marker: 1n,
              input: { kind: 'page' as const, versionId: owner.version!.id },
              anchor: { type: 'authored' as const },
              quote: 'é',
              target: {
                blockId: body.blocks[0]!.id,
                start: 0,
                end: 1
              }
            };

            yield* rpc('materials.setCitations', { id: claim.version.id, citations: [first] });
            const snapshot = (budget: number) =>
              transaction((tx) =>
                tx
                  .store(MaterialExportCitationsStore)
                  .exportCitationSnapshot({ id: claim.version.id, budget })
              );
            const single = yield* snapshot(MAX_EXPORT_BYTES);
            const serialized = JSON.stringify(single.citations[0], (_, item: unknown) =>
              typeof item === 'bigint' ? String(item) : item
            );
            // Each resolved citation reserves four bytes in addition to its encoded JSON.
            const exact = new TextEncoder().encode(serialized).length + 4;

            expect(yield* snapshot(exact)).toStrictEqual(single);
            assert.ok((yield* Effect.flip(snapshot(exact - 1))).kind === 'invalid_input');
            yield* rpc('materials.setCitations', {
              id: claim.version.id,
              citations: [
                first,
                { ...first, marker: 2n },
                {
                  marker: 3n,
                  input: { kind: 'page' as const, versionId: later.version!.id },
                  anchor: { type: 'authored' },
                  quote: 'Later'
                }
              ]
            });
            yield* rpc('materials.publishVersion', { id: claim.version.id });
            const expected = (yield* rpc('materials.citations', {
              id: claim.version.id,
              limit: 10
            })).items;
            const actual = f.context.transaction((tx) =>
              makeCitations({ db: tx.db, clock: tx.clock }).readCitations(claim.version.id)
            );

            expect(actual).toStrictEqual(expected);
            const preview = yield* docs('pages.previewDeletion', { id: later.id });

            expect(preview.blockedVersionIds).toStrictEqual([later.version!.id]);
            assert.ok(
              (yield* Effect.flip(docs('pages.delete', { pageId: later.id, token: preview.token })))
                .kind === 'invalid_input'
            );
            assert.ok((yield* Effect.flip(snapshot(exact))).kind === 'invalid_input');
            const bounded = yield* snapshot(MAX_EXPORT_BYTES);

            assert.strictEqual(bounded.citations.length, 3);
            assert.ok(
              JSON.stringify(bounded, (_, value) =>
                typeof value === 'bigint' ? String(value) : value
              ).length < 8192
            );
          })
        ).pipe(Effect.provide(f.handlers))
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'native capability reports local routes and keeps vision and absent-provider support conservative',
  async () => {
    const f = await fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(SourcesRpc, { flatten: true });
            const cases = [
              {
                kind: 'text',
                mime: 'text/plain',
                path: 'text',
                status: 'supported',
                reason: 'local_decoder'
              },
              {
                kind: 'text',
                mime: 'text/html',
                path: 'html',
                status: 'supported',
                reason: 'local_decoder'
              },
              {
                kind: 'document',
                mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                path: 'office',
                status: 'supported',
                reason: 'local_decoder'
              },
              {
                kind: 'pdf',
                mime: 'application/pdf',
                path: 'vision',
                status: 'unavailable',
                reason: 'provider_unverified'
              },
              {
                kind: 'image',
                mime: 'image/png',
                path: 'vision',
                status: 'unavailable',
                reason: 'provider_unverified'
              },
              {
                kind: 'image',
                mime: 'image/svg+xml',
                path: 'none',
                status: 'unavailable',
                reason: 'no_decoder'
              },
              {
                kind: 'other',
                mime: 'application/octet-stream',
                path: 'none',
                status: 'unavailable',
                reason: 'no_decoder'
              }
            ] as const;

            for (const { kind, mime, path, status, reason } of cases) {
              expect(yield* rpc('sources.importCapability', { kind, mime })).toStrictEqual({
                kind,
                recognized: kind !== 'other',
                path,
                status,
                reason,
                provider: { authentication: 'unavailable', capability: 'unverified' }
              });
            }
          })
        ).pipe(Effect.provide(f.handlers))
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'JSON export budget matches UTF-8 at the public limit across controls, surrogates and cumulative values',
  () => {
    const values = [
      '\u0000\b\t\n\f\r\u001f"\\',
      '\udc00',
      'é字😀',
      [undefined, null, -0, false, 9007199254740993n],
      { 'é😀': '\ud800', omitted: undefined }
    ];
    const lengths = values.map(
      (value) =>
        new TextEncoder().encode(
          JSON.stringify(value, (_, item: unknown) =>
            typeof item === 'bigint' ? String(item) : item
          )
        ).length
    );
    const budget = exportBudget(lengths.reduce((total, bytes) => total + bytes, 0));

    values.forEach((value) => budget.consume(value));
    assert.strictEqual(budget.remaining(), 0);
    expect(() => budget.consume(null)).toThrow(expect.objectContaining({ kind: 'invalid_input' }));
    const exact = 'é'.repeat((MAX_EXPORT_BYTES - 2) / 2);

    exportBudget().consume(exact);
    expect(() => exportBudget().consume(exact + 'a')).toThrow(
      expect.objectContaining({ kind: 'invalid_input' })
    );
  }
);
