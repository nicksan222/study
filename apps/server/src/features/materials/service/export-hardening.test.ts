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

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { materialVersionIdSchema } from '@study/contracts/ids';
import { materialAidExportSchema, MAX_EXPORT_BYTES } from '@study/contracts/materials/export';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import type { materialContentInputSchema } from '@study/contracts/materials/schemas';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { eq, and } from '@study/db';
import { material_flashcard_entries } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { makeCitations } from '#server/features/materials/store/citations';
import { MaterialExportCitationsStore } from '#server/features/materials/store/export';
import { exportBudget } from '#server/features/materials/store/export-budget';
import { makeReads } from '#server/features/materials/store/reads';
import { Sources } from '#server/features/sources/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { deletionDocument } from '#testing/material-deletion';
import { materialRpcHandlers } from '#testing/material-rpc';

import { serializeMaterialVersion } from './export-serializer.ts';

function fixture() {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const database = Layer.succeed(Database, { store: context });
  const services = Layer.mergeAll(Materials.layer, Sources.layer).pipe(
    Layer.provideMerge(database)
  );
  const handlers = Layer.mergeAll(materialRpcHandlers, SourcesRpcLive).pipe(
    Layer.provideMerge(services)
  );

  return {
    handlers,
    context,
    close() {
      context.close();
      location.cleanup();
    }
  };
}

for (const retirement of ['deletion', 'prune'] as const) {
  test(`native export rejects a retained leaf after deep ancestor ${retirement} acceptance`, async () => {
    const f = fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const ancestor = yield* rpc('materials.createManualDocument', {
              title: 'Ancestor',
              document: deletionDocument('Retained ancestor')
            });
            let input = ancestor.version.id;

            for (let depth = 0; depth < 4; depth++) {
              const next = yield* rpc('materials.create', {
                title: `Depth ${depth}`,
                inputs: [input],
                publish: true,
                content: { kind: 'document', ...deletionDocument(`Derived ${depth}`) }
              });

              input = next.version.id;
            }

            const key = { id: input, format: 'markdown' as const };
            const before = yield* rpc('materials.exportMaterialVersion', key);

            assert.ok(new TextDecoder().decode(before.bytes).includes('Derived 3'));

            if (retirement === 'prune') {
              yield* rpc('materials.createVersion', {
                materialId: ancestor.id,
                publish: true,
                content: { kind: 'document', ...deletionDocument('Replacement') }
              });
              const scope = { materialId: ancestor.id, policy: { keepLatest: 1 } };
              const preview = yield* rpc('materials.previewHistoryPrune', scope);

              assert.ok(preview.candidateIds.includes(ancestor.version.id));
              yield* rpc('materials.requestHistoryPrune', {
                ...scope,
                operationId: 'export-deep-prune',
                token: preview.token,
                candidateIds: preview.candidateIds
              });
            } else {
              const preview = yield* rpc('materials.previewDeletion', { materialId: ancestor.id });

              // Keep descendants retained: export must inspect transitive inputs itself.
              yield* rpc('materials.requestDeletion', {
                materialId: ancestor.id,
                token: preview.token,
                descendantIds: []
              });
            }

            assert.equal((yield* rpc('materials.materialVersion', { id: input })).id, input);
            assert.equal(
              (yield* Effect.flip(rpc('materials.exportMaterialVersion', key))).kind,
              'not_found'
            );
          })
        ).pipe(Effect.provide(f.handlers))
      );
    } finally {
      f.close();
    }
  });
}

test('native aid JSON decodes complete canonical versions and exact citations for every aid kind', async () => {
  const f = fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const document = deletionDocument('Evidence é😀');
          const owner = yield* rpc('materials.createManualDocument', {
            title: 'Evidence',
            document
          });
          const retained = yield* rpc('materials.materialVersionDocument', {
            id: owner.version.id
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
              inputs: [owner.version.id],
              publish: false,
              content
            });

            yield* rpc('materials.setCitations', {
              id: aid.version.id,
              citations: [
                {
                  marker: 4294967295n,
                  inputVersionId: owner.version.id,
                  anchor: { type: 'authored' },
                  quote: 'Evidence',
                  target: {
                    versionId: owner.version.id,
                    documentId: retained.id,
                    blockId: document.blocks[0]!.id,
                    start: 0,
                    end: 8
                  }
                }
              ]
            });
            yield* rpc('materials.publishVersion', { id: aid.version.id });
            const version = yield* rpc('materials.materialVersion', { id: aid.version.id });
            const citations = (yield* rpc('materials.citations', { id: aid.version.id, limit: 10 }))
              .items;
            const file = yield* rpc('materials.exportMaterialVersion', {
              id: aid.version.id,
              format: 'aid_json'
            });
            const text = new TextDecoder().decode(file.bytes);
            const decoded = Schema.decodeUnknownSync(codec)(text);

            assert.deepEqual(decoded, { schemaVersion: 1, version, citations });
            assert.deepEqual(
              Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(decoded)),
              decoded
            );
            assert.equal(JSON.parse(text).version.id, String(version.id));
            assert.equal(decoded.citations[0]!.evidence?.precision, 'exact');
            assert.equal(file.mediaType, 'application/json');
            // Exercise a legal identity beyond Number's exact range without changing SQLite rows.
            const wide = {
              ...version,
              id: Schema.decodeUnknownSync(materialVersionIdSchema)(9007199254740993n)
            };
            const wideFile = serializeMaterialVersion(wide, 'aid_json', null, citations);

            assert.equal(
              Schema.decodeUnknownSync(codec)(new TextDecoder().decode(wideFile.bytes)).version.id,
              wide.id
            );
          }
        })
      ).pipe(Effect.provide(f.handlers))
    );
  } finally {
    f.close();
  }
});

test('native CSV preserves quoted multiline text and neutralizes formula prefixes without altering ordinary text', async () => {
  const f = fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
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
          assert.equal(file.mediaType, 'text/csv; charset=utf-8');
          assert.ok(text.endsWith('\r\n'));
        })
      ).pipe(Effect.provide(f.handlers))
    );
  } finally {
    f.close();
  }
});

test('citation snapshot accepts its exact UTF-8 budget and stops before a later retired owner', async () => {
  const f = fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const body = deletionDocument('é😀'.repeat(32 * 1024));
          const owner = yield* rpc('materials.createManualDocument', {
            title: 'Large',
            document: body
          });
          const later = yield* rpc('materials.createManualDocument', {
            title: 'Later',
            document: deletionDocument('Later')
          });
          const retained = yield* rpc('materials.materialVersionDocument', {
            id: owner.version.id
          });
          const claim = yield* rpc('materials.create', {
            title: 'Bounded',
            publish: false,
            inputs: [owner.version.id, later.version.id],
            content: { kind: 'document', ...deletionDocument('Claim') }
          });
          const first = {
            marker: 1n,
            inputVersionId: owner.version.id,
            anchor: { type: 'authored' as const },
            quote: 'é',
            target: {
              versionId: owner.version.id,
              documentId: retained.id,
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

          assert.deepEqual(yield* snapshot(exact), single);
          assert.equal((yield* Effect.flip(snapshot(exact - 1))).kind, 'invalid_input');
          yield* rpc('materials.setCitations', {
            id: claim.version.id,
            citations: [
              first,
              { ...first, marker: 2n },
              {
                marker: 3n,
                inputVersionId: later.version.id,
                anchor: { type: 'authored' },
                quote: 'Later'
              }
            ]
          });
          yield* rpc('materials.publishVersion', { id: claim.version.id });
          const claimDocument = yield* rpc('materials.materialVersionDocument', {
            id: claim.version.id
          });

          yield* rpc('materials.assessCitation', {
            claim: {
              materialId: claim.id,
              range: {
                versionId: claim.version.id,
                documentId: claimDocument.id,
                blockId: claimDocument.document.blocks[0]!.id,
                start: 0,
                end: 5
              }
            },
            evidence: { materialId: owner.id, range: first.target },
            marker: 1n,
            judgment: 'supports',
            note: 'Manual assessment'
          });
          const expected = (yield* rpc('materials.citations', { id: claim.version.id, limit: 10 }))
            .items;
          const resources = { db: f.context.db, clock: f.context.clock };
          const reads = makeReads(resources);
          const loaded: Parameters<typeof reads.readCanonicalDocument>[0][] = [];
          const readDocument = (id: Parameters<typeof reads.readCanonicalDocument>[0]) => {
            loaded.push(id);

            return reads.readCanonicalDocument(id);
          };
          const actual = f.context.transaction(() =>
            makeCitations(resources, readDocument).readCitations(claim.version.id)
          );

          assert.deepEqual(actual, expected);
          assert.ok(loaded.includes(retained.id));
          // Claim resolution only happens through support, proving callback forwarding there too.
          assert.ok(loaded.includes(claimDocument.id));
          const preview = yield* rpc('materials.previewDeletion', { materialId: later.id });

          yield* rpc('materials.requestDeletion', {
            materialId: later.id,
            token: preview.token,
            descendantIds: []
          });
          // Resolving the retired third owner would produce not_found; budget exhaustion must win first.
          assert.equal((yield* Effect.flip(snapshot(exact))).kind, 'invalid_input');
          assert.equal((yield* Effect.flip(snapshot(MAX_EXPORT_BYTES))).kind, 'not_found');
        })
      ).pipe(Effect.provide(f.handlers))
    );
  } finally {
    f.close();
  }
});

test('native capability reports local routes and keeps vision and absent-provider support conservative', async () => {
  const f = fixture();

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
            assert.deepEqual(yield* rpc('sources.importCapability', { kind, mime }), {
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
    f.close();
  }
});

test('JSON export budget matches UTF-8 at the public limit across controls, surrogates and cumulative values', () => {
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
  assert.equal(budget.remaining(), 0);
  assert.throws(() => budget.consume(null), { kind: 'invalid_input' });
  const exact = 'é'.repeat((MAX_EXPORT_BYTES - 2) / 2);

  exportBudget().consume(exact);
  assert.throws(() => exportBudget().consume(exact + 'a'), { kind: 'invalid_input' });
});
