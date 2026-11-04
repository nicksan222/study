/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Document rich document behavior through real persistence        │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies rich authored documents round-trip native RPC and reopen with independent     │
 * │   identities, exact assets and Unicode ranges.                                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { DocumentsRpc } from '@study/contracts/documents/rpc';
import { sourceIdSchema } from '@study/contracts/ids';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { createBlock, validBlockTextRange } from '@study/contracts/sources/document';
import { documentSchema } from '@study/contracts/sources/schemas';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Documents } from '#server/features/documents/index';
import { DocumentsRpcLive } from '#server/features/documents/rpc/index';
import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { materialRpcHandlers } from '#testing/material-rpc';

const text = (value: string) => [{ type: 'text' as const, text: value, marks: [] }];

testStable(
  'rich authored documents round-trip native RPC and reopen with independent identities, exact assets and Unicode ranges',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const services = () =>
      Layer.mergeAll(
        Documents.layer,
        Materials.layer,
        Sources.layer,
        Projects.layer,
        Conversations.layer,
        Settings.layer
      ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));
    const handlers = () =>
      Layer.mergeAll(DocumentsRpcLive, ConversationsRpcLive, materialRpcHandlers).pipe(
        Layer.provideMerge(services())
      );

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const sources = yield* Sources;
          const collection = yield* projects.createProject({ name: 'Images' });
          const image = yield* sources.createSource({
            projectId: collection.id,
            name: 'pixel.png',
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          });

          return { collection, image };
        }).pipe(Effect.provide(services()))
      );
      const content = {
        blocks: [
          createBlock({
            type: 'paragraph',
            inlines: [
              { type: 'text', text: 'Caffè 😀 end', marks: ['strong'] },
              { type: 'link', text: ' cite', href: 'https://example.test/reference' }
            ]
          }),
          createBlock({ type: 'heading', level: 3, inlines: text('Heading') }),
          createBlock({
            type: 'list_item',
            items: [
              { depth: 0, ordered: true, start: 3, inlines: text('Parent') },
              { depth: 1, ordered: false, start: 1, inlines: text('Child') }
            ]
          }),
          createBlock({
            type: 'table',
            rows: [
              {
                cells: [
                  { header: true, paragraphs: [text('Cell'), text('Second paragraph')] },
                  { header: false, paragraphs: [[]] }
                ]
              }
            ]
          }),
          createBlock({ type: 'code', language: 'typescript', code: 'const n = 1;\n' }),
          createBlock({ type: 'math', expression: 'x² + y²' }),
          createBlock({ type: 'image', sourceId: setup.image.id, revision: 1, alt: '' }),
          createBlock({
            type: 'reference',
            href: 'https://example.test/book',
            inlines: text('Book')
          })
        ],
        meta: {
          extractor: null,
          extractorVersion: 1,
          provider: null,
          durationMs: null,
          pageCount: null,
          refiners: [],
          waitingFor: [],
          corrected: false,
          omissions: []
        }
      } satisfies typeof documentSchema.Type;
      const copyContent = {
        ...content,
        blocks: content.blocks.map((block) => createBlock(block.content))
      };
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(
              DocumentsRpc.merge(MaterialsRpc, ConversationsRpc)
            );
            const session = yield* rpc['conversations.createSession']({ title: 'Asset copy' });
            const create = (title: string, document: typeof documentSchema.Type) =>
              rpc['documents.create']({
                createKey: randomUUID(),
                title,
                document,
                inputs: [],
                citations: [],
                projectId: setup.collection.id
              });
            const original = yield* rpc['documents.create']({
              createKey: randomUUID(),
              title: 'Rich',
              document: content,
              inputs: [],
              citations: [],
              sessionId: session.id,
              projectId: setup.collection.id
            });

            assert.ok(original.version);
            expect(original.version.document).toStrictEqual(content);
            const copy = yield* create('Retained copy', copyContent);

            assert.ok(copy.version);
            const inserted = createBlock({ type: 'paragraph', inlines: text('Inserted') });
            const edit = yield* rpc['documents.save']({
              documentId: original.id,
              expectedVersionId: original.version.id,
              key: randomUUID(),
              document: { ...content, blocks: [inserted, ...content.blocks.toReversed()] }
            });
            const revised = yield* rpc['documents.version']({ id: edit.submittedVersionId });

            expect(revised.document.blocks.map((block) => block.id)).toStrictEqual([
              inserted.id,
              ...content.blocks.toReversed().map((block) => block.id)
            ]);

            for (const image of [
              createBlock({ type: 'image', sourceId: setup.image.id, revision: 999, alt: '' }),
              createBlock({
                type: 'image',
                sourceId: Schema.decodeUnknownSync(sourceIdSchema)(999999n),
                revision: 1,
                alt: ''
              })
            ])
              assert.ok(
                (yield* Effect.flip(
                  create('Missing image revision', { ...content, blocks: [image] })
                )).kind === 'invalid_input'
              );

            for (const rows of [
              [],
              [
                {
                  cells: [
                    { header: false, paragraphs: [[]] },
                    { header: false, paragraphs: [[]] }
                  ]
                }
              ],
              [
                {
                  cells: [
                    { header: false, paragraphs: [text('  ')] },
                    { header: false, paragraphs: [text('\n')] }
                  ]
                }
              ]
            ]) {
              const emptyContent = { ...content, blocks: [createBlock({ type: 'table', rows })] };
              const empty = yield* create('Empty structure', emptyContent);

              assert.ok(empty.version);
              expect(empty.version.document).toStrictEqual(emptyContent);
              assert.ok(
                (yield* Effect.flip(
                  rpc['materials.requestMaterialGeneration']({
                    projectId: setup.collection.id,
                    title: 'No fabricated text',
                    kind: 'diagram',
                    inputs: [{ kind: 'document', versionId: empty.version.id }]
                  })
                )).kind === 'invalid_input'
              );
            }

            const table = yield* create('Real table', {
              ...content,
              blocks: [
                createBlock({
                  type: 'table',
                  rows: [
                    {
                      cells: [
                        { header: false, paragraphs: [text(' | ')] },
                        { header: false, paragraphs: [[]] }
                      ]
                    }
                  ]
                })
              ]
            });

            assert.ok(table.version);
            const request = yield* rpc['materials.requestMaterialGeneration']({
              projectId: setup.collection.id,
              title: 'Actual cell text',
              kind: 'diagram',
              inputs: [{ kind: 'document', versionId: table.version.id }]
            });
            const materials = yield* Materials;

            yield* materials.retryMaterialGenerationOnce({
              requestId: request.id,
              retryId: 'real-cell-retry'
            });
            yield* rpc['conversations.deleteSession']({ id: session.id });

            return { original, copy, revised };
          }).pipe(Effect.provide(handlers()))
        )
      );

      assert.ok(saved.original.version);
      assert.ok(saved.copy.version);

      for (const invalid of [
        { ...content, blocks: [content.blocks[0]!, content.blocks[0]!] },
        { ...content, blocks: [{ ...content.blocks[0]!, text: 'drift' }] },
        {
          ...content,
          blocks: [
            createBlock({
              type: 'list_item',
              items: [{ depth: 2, ordered: false, start: 1, inlines: [] }]
            })
          ]
        }
      ])
        assert.ok(Schema.is(documentSchema)(invalid) === false);

      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const sources = yield* Sources;
          const invalid = {
            ...content,
            blocks: [{ ...content.blocks[0]!, anchor: { type: 'page' as const, page: 1 } }]
          };

          assert.ok(
            (yield* Effect.flip(
              docs.create({
                createKey: randomUUID(),
                title: 'Foreign location',
                document: invalid,
                inputs: [],
                citations: []
              })
            )).kind === 'invalid_input'
          );
          yield* sources.replaceSource({
            id: setup.image.id,
            expectedRevision: 1,
            name: 'replacement.txt',
            bytes: new TextEncoder().encode('Different current bytes')
          });
          assert.ok(
            (yield* Effect.flip(
              docs.create({
                createKey: randomUUID(),
                title: 'Wrong media',
                document: {
                  ...content,
                  blocks: [
                    createBlock({ type: 'image', sourceId: setup.image.id, revision: 2, alt: '' })
                  ]
                },
                inputs: [],
                citations: []
              })
            )).kind === 'invalid_input'
          );
        }).pipe(Effect.provide(services()))
      );
      const range = { blockId: content.blocks[0]!.id, start: 6, end: 8 };

      assert.ok(validBlockTextRange(content, range) === true);
      assert.ok(validBlockTextRange(content, { ...range, start: 7 }) === false);
      assert.ok(validBlockTextRange(content, { ...range, end: 100 }) === false);
      assert.ok(
        validBlockTextRange({ ...content, blocks: content.blocks.toReversed() }, range) === true
      );
      const snapshotId = saved.original.version.snapshotId;

      for (const statement of [
        sql`UPDATE blocks SET text='changed' WHERE document_id=${snapshotId}`,
        sql`UPDATE blocks SET editing_id='changed' WHERE document_id=${snapshotId}`,
        sql`UPDATE blocks SET content='{}' WHERE document_id=${snapshotId}`,
        sql`DELETE FROM document_assets WHERE document_id=${snapshotId}`
      ])
        assert.throws(() => context.db.orm.run(statement));

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const docs = yield* Documents;
          const sources = yield* Sources;

          yield* projects.deleteProject({ id: setup.collection.id });
          expect((yield* docs.version({ id: saved.original.version!.id })).document).toStrictEqual(
            content
          );
          expect((yield* docs.version({ id: saved.copy.version!.id })).document).toStrictEqual(
            copyContent
          );
          expect(
            (yield* sources.sourceSnapshot({ id: setup.image.id, revision: 1 })).bytes
          ).toStrictEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
          assert.strictEqual(
            context.db.orm.get(
              sql`SELECT count(*) n FROM document_assets WHERE source_id=${setup.image.id}`
            )?.n,
            3n
          );
          expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
        }).pipe(Effect.provide(services()))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
