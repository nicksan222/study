import { sourceIdSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Page rich document behavior through real persistence            │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies rich authored pages round-trip native RPC and reopen with independent         │
 * │   identities, exact assets and Unicode ranges.                                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { MaterialsRpc } from '@study/contracts';
import { NotesRpc } from '@study/contracts';
import { PagesRpc } from '@study/contracts';
import { createBlock, validBlockTextRange } from '@study/contracts';
import { documentSchema } from '@study/contracts';
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { Notes } from '#server/features/notes/index';
import { NotesRpcLive } from '#server/features/notes/rpc/index';
import { Pages } from '#server/features/pages/index';
import { PagesRpcLive } from '#server/features/pages/rpc/index';
import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { testLiveQueries } from '#testing/live-queries';
import { materialRpcHandlers } from '#testing/material-rpc';

const text = (value: string) => [{ type: 'text' as const, text: value, marks: [] }];

test.stable(
  'rich authored pages round-trip native RPC and reopen with independent identities, exact assets and Unicode ranges',
  async ({ databases }) => {
    const location = await databases();
    let context = new ServerContext(await location.open());
    const services = () =>
      Layer.mergeAll(
        Pages.layer,
        Materials.layer,
        Sources.layer,
        Projects.layer,
        Notes.layer,
        Settings.layer
      ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));
    const handlers = () =>
      Layer.mergeAll(
        PagesRpcLive.pipe(Layer.provide(testLiveQueries)),
        NotesRpcLive.pipe(Layer.provide(testLiveQueries)),
        materialRpcHandlers
      ).pipe(Layer.provideMerge(services()));

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
            const rpc = yield* RpcTest.makeClient(PagesRpc.merge(MaterialsRpc, NotesRpc));
            const note = yield* rpc['notes.createNote']({ title: 'Asset copy' });
            const create = (title: string, document: typeof documentSchema.Type) =>
              rpc['pages.create']({
                createKey: crypto.randomUUID(),
                title,
                document,
                inputs: [],
                citations: [],
                projectId: setup.collection.id
              });
            const original = yield* rpc['pages.create']({
              createKey: crypto.randomUUID(),
              title: 'Rich',
              document: content,
              inputs: [],
              citations: [],
              noteId: note.id,
              projectId: setup.collection.id
            });

            test.assert.ok(original.version);
            test.expect(original.version.document).toStrictEqual(content);
            const copy = yield* create('Retained copy', copyContent);

            test.assert.ok(copy.version);
            const inserted = createBlock({ type: 'paragraph', inlines: text('Inserted') });
            const edit = yield* rpc['pages.save']({
              pageId: original.id,
              expectedVersionId: original.version.id,
              key: crypto.randomUUID(),
              document: { ...content, blocks: [inserted, ...content.blocks.toReversed()] }
            });
            const revised = yield* rpc['pages.version']({ id: edit.submittedVersionId });

            test
              .expect(revised.document.blocks.map((block) => block.id))
              .toStrictEqual([
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
              test.assert.ok(
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

              test.assert.ok(empty.version);
              test.expect(empty.version.document).toStrictEqual(emptyContent);
              test.assert.ok(
                (yield* Effect.flip(
                  rpc['materials.requestMaterialGeneration']({
                    projectId: setup.collection.id,
                    title: 'No fabricated text',
                    kind: 'flashcards',
                    inputs: [{ kind: 'page', versionId: empty.version.id }]
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

            test.assert.ok(table.version);
            const request = yield* rpc['materials.requestMaterialGeneration']({
              projectId: setup.collection.id,
              title: 'Actual cell text',
              kind: 'flashcards',
              inputs: [{ kind: 'page', versionId: table.version.id }]
            });
            const materials = yield* Materials;

            yield* materials.retryMaterialGenerationOnce({
              requestId: request.id,
              retryId: 'real-cell-retry'
            });
            yield* rpc['notes.deleteNote']({ id: note.id });

            return { original, copy, revised };
          }).pipe(Effect.provide(handlers()))
        )
      );

      test.assert.ok(saved.original.version);
      test.assert.ok(saved.copy.version);

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
        test.assert.ok(Schema.is(documentSchema)(invalid) === false);

      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const sources = yield* Sources;
          const invalid = {
            ...content,
            blocks: [{ ...content.blocks[0]!, anchor: { type: 'page' as const, page: 1 } }]
          };

          test.assert.ok(
            (yield* Effect.flip(
              docs.create({
                createKey: crypto.randomUUID(),
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
          test.assert.ok(
            (yield* Effect.flip(
              docs.create({
                createKey: crypto.randomUUID(),
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

      test.assert.ok(validBlockTextRange(content, range) === true);
      test.assert.ok(validBlockTextRange(content, { ...range, start: 7 }) === false);
      test.assert.ok(validBlockTextRange(content, { ...range, end: 100 }) === false);
      test.assert.ok(
        validBlockTextRange({ ...content, blocks: content.blocks.toReversed() }, range) === true
      );
      const snapshotId = saved.original.version.snapshotId;

      for (const statement of [
        sql`UPDATE blocks SET text='changed' WHERE document_id=${snapshotId}`,
        sql`UPDATE blocks SET editing_id='changed' WHERE document_id=${snapshotId}`,
        sql`UPDATE blocks SET content='{}' WHERE document_id=${snapshotId}`,
        sql`DELETE FROM document_assets WHERE document_id=${snapshotId}`
      ])
        test.assert.throws(() => context.db.orm.run(statement));

      context.close();
      context = new ServerContext(await location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const docs = yield* Pages;
          const sources = yield* Sources;

          yield* projects.deleteProject({ id: setup.collection.id });
          test
            .expect((yield* docs.version({ id: saved.original.version!.id })).document)
            .toStrictEqual(content);
          test
            .expect((yield* docs.version({ id: saved.copy.version!.id })).document)
            .toStrictEqual(copyContent);
          test
            .expect((yield* sources.sourceSnapshot({ id: setup.image.id, revision: 1 })).bytes)
            .toStrictEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
          test.assert.strictEqual(
            context.db.orm.get(
              sql`SELECT count(*) n FROM document_assets WHERE source_id=${setup.image.id}`
            )?.n,
            3n
          );
          test.expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
        }).pipe(Effect.provide(services()))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
