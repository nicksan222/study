/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies rich canonical Documents across native RPC and durable SQLite storage.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises immutable rich content and managed image revision retention.                 │
 * │ - Checks exact editing identities and Unicode range boundary validation.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public services and migrated SQLite without contacting remote providers.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import type { MaterialContentInput } from '@study/contracts/materials/schemas';
import { createBlock, validDocumentTextRange } from '@study/contracts/sources/document';
import { blockIdSchema, documentSchema } from '@study/contracts/sources/schemas';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Conversations } from '#server/features/conversations/service/index';
import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

const text = (value: string) => [{ type: 'text' as const, text: value, marks: [] }];

test('rich Documents round-trip native RPC and reopen with exact identities, assets and Unicode ranges', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const services = () =>
    Layer.mergeAll(
      Materials.layer,
      Sources.layer,
      Projects.layer,
      Conversations.layer,
      Settings.layer
    ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));
  const handlers = () =>
    Layer.mergeAll(MaterialsRpcLive, ConversationsRpcLive).pipe(Layer.provide(services()));

  try {
    const setup = await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* Sources;
        const projects = yield* Projects;
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
      kind: 'document',
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
        createBlock({ type: 'reference', href: 'https://example.test/book', inlines: text('Book') })
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
    } satisfies MaterialContentInput;
    const saved = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const chats = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
          const session = yield* chats('conversations.createSession', { title: 'Asset copy' });
          const material = yield* client('materials.create', {
            title: 'Rich',
            content,
            sessionId: session.id,
            projectId: setup.collection.id
          });

          assert.deepEqual(material.version.content, content);
          const copy = yield* client('materials.create', { title: 'Retained copy', content });
          const inserted = createBlock({ type: 'paragraph', inlines: text('Inserted') });
          const revised = yield* client('materials.createVersion', {
            materialId: material.id,
            content: { ...content, blocks: [inserted, ...content.blocks.toReversed()] }
          });

          assert.deepEqual(
            revised.content.kind === 'document' && revised.content.blocks.map((block) => block.id),
            [inserted.id, ...content.blocks.toReversed().map((block) => block.id)]
          );
          const badImage = createBlock({
            type: 'image',
            sourceId: setup.image.id,
            revision: 999,
            alt: ''
          });

          assert.equal(
            (yield* Effect.flip(
              client('materials.create', {
                title: 'Missing revision',
                content: { ...content, blocks: [badImage] }
              })
            )).kind,
            'invalid_input'
          );
          const missingImage = createBlock({
            type: 'image',
            sourceId: Schema.decodeUnknownSync(
              (yield* Effect.promise(() => import('@study/contracts/ids'))).sourceIdSchema
            )(999999n),
            revision: 1,
            alt: ''
          });

          assert.equal(
            (yield* Effect.flip(
              client('materials.create', {
                title: 'Missing image',
                content: { ...content, blocks: [missingImage] }
              })
            )).kind,
            'invalid_input'
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
            const empty = yield* client('materials.create', {
              title: 'Empty structure',
              projectId: setup.collection.id,
              content: emptyContent
            });

            assert.deepEqual(empty.version.content, emptyContent);
            assert.equal(
              (yield* Effect.flip(
                client('materials.requestMaterialGeneration', {
                  projectId: setup.collection.id,
                  title: 'No fabricated text',
                  kind: 'diagram',
                  inputVersionIds: [empty.version.id]
                })
              )).kind,
              'invalid_input'
            );
          }
          const table = yield* client('materials.create', {
            title: 'Real table evidence',
            projectId: setup.collection.id,
            content: {
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
            }
          });
          const request = yield* client('materials.requestMaterialGeneration', {
            projectId: setup.collection.id,
            title: 'Actual cell text',
            kind: 'diagram',
            inputVersionIds: [table.version.id]
          });
          yield* Effect.flatMap(Materials, (materials) =>
            materials.retryMaterialGenerationOnce({
              requestId: request.id,
              retryId: 'real-cell-retry'
            })
          ).pipe(Effect.provide(services()));
          yield* chats('conversations.deleteSession', { id: session.id });

          return { material, copy, revised };
        }).pipe(Effect.provide(handlers()))
      )
    );

    assert.equal(
      Schema.is(documentSchema)({ ...content, blocks: [content.blocks[0], content.blocks[0]] }),
      false
    );
    assert.equal(
      Schema.is(documentSchema)({
        ...content,
        blocks: [{ ...content.blocks[0], text: 'disagrees' }]
      }),
      false
    );
    assert.equal(
      Schema.is(documentSchema)({
        ...content,
        blocks: [
          createBlock({
            type: 'list_item',
            items: [{ depth: 2, ordered: false, start: 1, inlines: [] }]
          })
        ]
      }),
      false
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const sources = yield* Sources;
        const invalidDocuments = [
          { ...content, blocks: [content.blocks[0]!, content.blocks[0]!] },
          { ...content, blocks: [{ ...content.blocks[0]!, text: 'drift' }] },
          {
            ...content,
            blocks: [{ ...content.blocks[0]!, anchor: { type: 'page' as const, page: 1 } }]
          },
          {
            ...content,
            blocks: [
              createBlock({
                type: 'list_item',
                items: [{ depth: 2, ordered: false, start: 1, inlines: [] }]
              })
            ]
          }
        ];

        for (const invalid of invalidDocuments) {
          assert.equal(
            (yield* Effect.flip(materials.create({ title: 'Invalid', content: invalid }))).kind,
            'invalid_input'
          );
        }

        yield* sources.replaceSource({
          id: setup.image.id,
          expectedRevision: 1,
          name: 'replacement.txt',
          bytes: new TextEncoder().encode('Different current bytes')
        });
        const wrongMedia = createBlock({
          type: 'image',
          sourceId: setup.image.id,
          revision: 2,
          alt: ''
        });

        assert.equal(
          (yield* Effect.flip(
            materials.create({
              title: 'Wrong media revision',
              content: { ...content, blocks: [wrongMedia] }
            })
          )).kind,
          'invalid_input'
        );
      }).pipe(Effect.provide(services()))
    );
    const documentId = context.db.orm.get<{ document_id: bigint }>(
      sql`SELECT document_id FROM material_document_versions WHERE version_id = ${saved.material.version.id}`
    )!.document_id;
    const rangeTarget = {
      versionId: saved.material.version.id,
      documentId: Schema.decodeUnknownSync((await import('@study/contracts/ids')).documentIdSchema)(
        documentId
      )
    };
    const range = { ...rangeTarget, blockId: content.blocks[0]!.id, start: 6, end: 8 };

    assert.equal(validDocumentTextRange(content, rangeTarget, range), true);
    assert.equal(
      validDocumentTextRange(content, rangeTarget, {
        ...range,
        blockId: Schema.decodeUnknownSync(blockIdSchema)('unrelated')
      }),
      false
    );
    assert.equal(
      validDocumentTextRange(
        content,
        {
          ...rangeTarget,
          documentId: Schema.decodeUnknownSync(
            (await import('@study/contracts/ids')).documentIdSchema
          )(documentId + 1n)
        },
        range
      ),
      false
    );
    assert.equal(
      validDocumentTextRange(content, rangeTarget, { ...range, start: 4, end: 5 }),
      true
    );

    assert.equal(validDocumentTextRange(content, rangeTarget, { ...range, start: 7 }), false);
    assert.equal(validDocumentTextRange(content, rangeTarget, { ...range, end: 100 }), false);
    assert.equal(
      validDocumentTextRange(content, rangeTarget, { ...range, versionId: saved.revised.id }),
      false
    );
    assert.equal(
      validDocumentTextRange(
        { ...content, blocks: content.blocks.toReversed() },
        rangeTarget,
        range
      ),
      true
    );

    for (const statement of [
      sql`UPDATE blocks SET text='changed' WHERE document_id=${documentId}`,
      sql`UPDATE blocks SET editing_id='changed' WHERE document_id=${documentId}`,
      sql`UPDATE blocks SET content='{}' WHERE document_id=${documentId}`,
      sql`DELETE FROM document_assets WHERE document_id=${documentId}`
    ])
      assert.throws(() => context.db.orm.run(statement));

    context.close();
    context = new ServerContext(location.open());
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const materials = yield* Materials;
        const sources = yield* Sources;

        yield* projects.deleteProject({ id: setup.collection.id });
        assert.deepEqual(
          (yield* materials.materialVersion({ id: saved.material.version.id })).content,
          content
        );
        assert.deepEqual(
          (yield* materials.material({ id: saved.copy.id })).version.content,
          content
        );
        assert.deepEqual(
          (yield* sources.sourceSnapshot({ id: setup.image.id, revision: 1 })).bytes,
          new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
        );
        assert.equal(
          context.db.orm.get<{ n: bigint }>(
            sql`SELECT count(*) AS n FROM document_assets WHERE source_id=${setup.image.id}`
          )?.n,
          3n
        );
        assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      }).pipe(Effect.provide(services()))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
