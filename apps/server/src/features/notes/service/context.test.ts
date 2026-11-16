import type { PageVersionId, SourceId } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises exact note context capture through native RPC and migrated SQLite.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks immutable historical inputs, bounded history and intent replay fences.          │
 * │ - Verifies selected image revisions and note-owned capture cleanup.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public feature services and real persistence without replacing workflow ownership.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { pageVersionIdSchema } from '@study/contracts';
import { NotesRpc } from '@study/contracts';
import type { chatMessageSchema } from '@study/contracts';
import { createBlock } from '@study/contracts';
import { eq, sql } from '@study/db';
import * as s from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Notes } from '#server/features/notes/index';
import { NotesRpcLive } from '#server/features/notes/rpc/index';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { SourceStore } from '#server/features/sources/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { testLiveQueries } from '#testing/live-queries';
import { withTestPublication } from '#testing/publication';

const content = (value: string) => ({
  blocks: [createBlock({ type: 'paragraph', inlines: [{ type: 'text', text: value, marks: [] }] })],
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
});

test.stable(
  'native selection guards exact historic ranges, captures once and survives edits and reopen',
  async ({ databases }) => {
    const location = await databases();
    let context = new ServerContext(await location.open());
    const services = () =>
      Layer.mergeAll(Notes.layer, Pages.layer, Settings.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const handlers = () =>
      NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(Layer.provideMerge(services()));

    try {
      const captured = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const documents = yield* Pages;
            const first = yield* client('notes.createNote', { title: 'Quick' });
            const second = yield* client('notes.createNote', { title: 'Other' });
            const body = content('before 😀 selected after');
            const material = yield* documents.create({
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              title: 'Shared',
              noteId: first.id,
              document: body
            });
            const documentId = material.version!.snapshotId;
            const range = {
              blockId: body.blocks[0]!.id,
              start: 10,
              end: 18
            };
            const target = {
              input: { kind: 'page' as const, versionId: material.version!.id },
              scope: { kind: 'ranges' as const, ranges: [range] }
            };

            yield* client('notes.updateNoteSelection', {
              noteId: first.id,
              expectedRevision: 0n,
              targets: [target]
            });
            test.assert.ok(
              (yield* Effect.flip(
                client('notes.updateNoteSelection', {
                  noteId: first.id,
                  expectedRevision: 0n,
                  targets: []
                })
              )).kind === 'invalid_input'
            );
            test
              .expect((yield* client('notes.noteSelection', { noteId: second.id })).targets)
              .toStrictEqual([]);
            const bad = {
              ...target,
              scope: { kind: 'ranges' as const, ranges: [{ ...range, start: 8 }] }
            };

            test.assert.ok(
              (yield* Effect.flip(
                client('notes.updateNoteSelection', {
                  noteId: second.id,
                  expectedRevision: 0n,
                  targets: [bad]
                })
              )).kind === 'invalid_input'
            );
            test.assert.ok(
              (yield* Effect.flip(
                client('notes.updateNoteSelection', {
                  noteId: second.id,
                  expectedRevision: 0n,
                  targets: [
                    {
                      ...target,
                      input: {
                        kind: 'page',
                        versionId: Schema.decodeUnknownSync(pageVersionIdSchema)(999n)
                      }
                    }
                  ]
                })
              )).kind === 'not_found'
            );
            const intent = {
              noteId: first.id,
              intentKey: 'selection-only',
              instruction: 'Explain',
              preferences: { detail: 'brief' as const, language: 'english' as const }
            };
            const snapshot = yield* client('notes.captureNoteContext', intent);

            test.assert.ok(snapshot.inputs[0]!.excerpts[0]!.text === body.blocks[0]!.text);
            test.expect(snapshot.messages).toStrictEqual([]);
            yield* client('notes.updateNoteSelection', {
              noteId: first.id,
              expectedRevision: 1n,
              targets: []
            });
            test.expect(yield* client('notes.captureNoteContext', intent)).toStrictEqual(snapshot);
            test
              .expect(
                yield* client('notes.captureNoteContext', {
                  preferences: { language: 'english', detail: 'brief' },
                  instruction: intent.instruction,
                  intentKey: intent.intentKey,
                  noteId: intent.noteId,
                  threadRoot: undefined,
                  throughMessageId: undefined
                })
              )
              .toStrictEqual(snapshot);
            test.assert.ok(
              (yield* Effect.flip(
                client('notes.captureNoteContext', {
                  ...intent,
                  instruction: 'Changed'
                })
              )).kind === 'invalid_input'
            );
            test.assert.ok(
              (yield* Effect.flip(
                client('notes.captureNoteContext', {
                  ...intent,
                  preferences: { detail: 'detailed' }
                })
              )).kind === 'invalid_input'
            );
            yield* client('notes.updateNoteSelection', {
              noteId: first.id,
              expectedRevision: 2n,
              targets: [target]
            });
            const message = yield* client('notes.postMessage', {
              noteId: first.id,
              text: 'Question'
            });
            const request = yield* client('notes.requestReply', {
              noteId: first.id,
              intentKey: 'reply',
              instruction: 'Use selected passage'
            });
            const before = yield* client('notes.replySnapshot', {
              requestId: request.requestId
            });

            yield* documents.save({
              pageId: material.id,
              expectedVersionId: material.version!.id,
              key: crypto.randomUUID(),
              document: content('new content')
            });

            yield* client('notes.editMessage', {
              messageId: message.id,
              text: 'Changed later'
            });
            yield* client('notes.updateNoteSelection', {
              noteId: first.id,
              expectedRevision: 3n,
              targets: []
            });
            test
              .expect(yield* client('notes.replySnapshot', { requestId: request.requestId }))
              .toStrictEqual(before);
            test
              .expect(
                yield* client('notes.requestReply', {
                  noteId: first.id,
                  intentKey: 'reply',
                  instruction: 'Use selected passage'
                })
              )
              .toStrictEqual(request);
            const notes = yield* Notes;

            test.assert.ok(
              (yield* Effect.flip(
                withTestPublication(
                  context,
                  notes
                    .publishReply({
                      requestId: request.requestId,
                      text: 'Outside [1]',
                      citations: [
                        {
                          marker: 1,
                          sourceId: null,
                          input: { kind: 'page' as const, versionId: material.version!.id },
                          selectedRange: {
                            blockId: range.blockId,
                            start: 0,
                            end: body.blocks[0]!.text.length
                          },
                          documentId,
                          blockOrdinal: 0,
                          quote: 'absent words'
                        }
                      ]
                    })
                    .pipe(Effect.asVoid)
                )
              )).kind === 'invalid_input'
            );
            const publication = {
              requestId: request.requestId,
              text: 'Inside [1] and [2]',
              citations: [
                {
                  marker: 1,
                  sourceId: null,
                  input: { kind: 'page' as const, versionId: material.version!.id },
                  selectedRange: {
                    blockId: range.blockId,
                    start: 0,
                    end: body.blocks[0]!.text.length
                  },
                  documentId,
                  blockOrdinal: 0,
                  quote: 'selected'
                },
                {
                  marker: 2,
                  sourceId: null,
                  input: { kind: 'page' as const, versionId: material.version!.id },
                  selectedRange: {
                    blockId: range.blockId,
                    start: 0,
                    end: body.blocks[0]!.text.length
                  },
                  documentId,
                  blockOrdinal: 0,
                  quote: 'selected'
                }
              ]
            };

            for (const selectedRange of [undefined, range, { ...range, start: range.start - 1 }])
              test.assert.ok(
                (yield* Effect.flip(
                  withTestPublication(
                    context,
                    notes
                      .publishReply({
                        ...publication,
                        citations: publication.citations.map((citation) => ({
                          ...citation,
                          selectedRange
                        }))
                      })
                      .pipe(Effect.asVoid)
                  )
                )).kind === 'invalid_input'
              );

            for (let replay = 0; replay < 2; replay++)
              yield* withTestPublication(
                context,
                notes.publishReply(publication).pipe(Effect.asVoid)
              );

            const answer = yield* client('notes.message', { id: request.messageId });

            test.expect(answer.citations[0]!.input).toStrictEqual({
              kind: 'page',
              versionId: material.version!.id
            });
            test.assert.strictEqual(answer.citations[0]!.rangeStart, 0);
            test.assert.strictEqual(answer.citations[0]!.rangeEnd, body.blocks[0]!.text.length);
            test.assert.ok(answer.citations[0]!.origin === 'agent');
            test.assert.ok(answer.citations[0]!.precision === 'exact');
            const evidence = answer.citations[0]!.evidence;

            test.assert.ok(evidence?.availability === 'available');

            if (evidence?.availability === 'available') {
              test.assert.ok(evidence.precision === 'exact');
              test.assert.ok(evidence.excerpt === body.blocks[0]!.text);
              test.assert.strictEqual(evidence.snapshotId, documentId);
            }

            const thread = yield* client('notes.thread', {
              noteId: first.id,
              limit: 20
            });

            test
              .expect(thread.items.find((message) => message.id === answer.id)?.citations)
              .toStrictEqual(answer.citations);
            const edited = yield* client('notes.editMessage', {
              messageId: request.messageId,
              text: 'Edited wording [2]'
            });

            test.expect(edited.citations).toStrictEqual([{ ...answer.citations[1]!, marker: 1 }]);
            test.assert.ok(edited.versions.at(-1)?.text === 'Edited wording [1]');
            test.expect(edited.citations[0]!.support).toStrictEqual({ state: 'unassessed' });
            test.assert.strictEqual(edited.citations[0]!.rangeStart, 0);
            test.assert.strictEqual(edited.citations[0]!.rangeEnd, body.blocks[0]!.text.length);
            yield* client('notes.setActiveVersion', {
              messageId: request.messageId,
              versionId: answer.activeVersionId!
            });
            test
              .expect((yield* client('notes.message', { id: request.messageId })).citations)
              .toStrictEqual(answer.citations);
            yield* client('notes.deleteMessage', { id: request.messageId });
            test.assert.ok(
              (yield* Effect.flip(
                client('notes.requestReply', {
                  noteId: first.id,
                  intentKey: 'reply',
                  instruction: 'Use selected passage'
                })
              )).kind === 'not_found'
            );
            const regenerated = yield* client('notes.requestReply', {
              noteId: first.id,
              intentKey: 'regenerated'
            });

            test.assert.notStrictEqual(regenerated.requestId, request.requestId);
            const regeneratedSnapshot = yield* client('notes.replySnapshot', {
              requestId: regenerated.requestId
            });

            test.assert.ok(regeneratedSnapshot.messages[0]!.text === 'Changed later');
            test.assert.strictEqual(
              regeneratedSnapshot.context!.inputs[0]!.excerpts[0]!.text,
              'new content'
            );

            return snapshot;
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(await location.open());
      const reopened = await Effect.runPromise(
        Effect.flatMap(Notes, (c) => c.noteContext({ requestId: captured.requestId })).pipe(
          Effect.provide(services())
        )
      );

      test.expect(reopened).toStrictEqual(captured);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'reply outbox rejection rolls back the logical context and retry uses original message versions',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Notes.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const note = yield* notes.createNote({ title: 'Rollback' });

          yield* notes.postMessage({ noteId: note.id, text: 'Original' });
          context.db.orm.run(
            sql`CREATE TRIGGER reject_context_event BEFORE INSERT ON workflow_events BEGIN SELECT RAISE(ABORT, 'rejected'); END`
          );
          yield* Effect.flip(notes.requestReply({ noteId: note.id, intentKey: 'retry' }));
          test.assert.strictEqual(
            context.db.orm.select().from(s.note_run_contexts).all().length,
            0
          );
          test.assert.strictEqual(
            context.db.orm.select().from(s.note_reply_requests).all().length,
            0
          );
          context.db.orm.run(sql`DROP TRIGGER reject_context_event`);
          const request = yield* notes.requestReply({
            noteId: note.id,
            intentKey: 'retry'
          });

          test.assert.ok((yield* notes.noteContext(request)).messages[0]!.text === 'Original');
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'active membership controls capture independently of selection and all notes are retained',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Layer.mergeAll(Notes.layer, Pages.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const documents = yield* Pages;
          const first = yield* notes.createNote({ title: 'One' });
          const second = yield* notes.createNote({ title: 'Two' });

          test.assert.ok(
            (yield* Effect.flip(
              notes.captureNoteContext({
                noteId: first.id,
                intentKey: 'empty',
                instruction: '',
                preferences: {}
              })
            )).kind === 'invalid_input'
          );
          const a = yield* documents.create({
            createKey: crypto.randomUUID(),
            inputs: [],
            citations: [],
            title: 'A',
            noteId: first.id,
            document: content('Alpha')
          });
          const b = yield* documents.create({
            createKey: crypto.randomUUID(),
            inputs: [],
            citations: [],
            title: 'B',
            document: content('Beta')
          });

          test.expect((yield* notes.noteSelection({ noteId: first.id })).targets).toStrictEqual([]);
          yield* documents.detach({ noteId: first.id, pageId: a.id });
          yield* documents.attach({ noteId: first.id, pageId: b.id });
          const targets = [a, b].map((item) => ({
            input: { kind: 'page' as const, versionId: item.version!.id },
            scope: { kind: 'document' as const }
          }));

          yield* notes.updateNoteSelection({
            noteId: first.id,
            expectedRevision: 0n,
            targets
          });
          yield* notes.updateNoteSelection({
            noteId: second.id,
            expectedRevision: 0n,
            targets: [targets[0]!]
          });
          yield* notes.updateNoteSelection({
            noteId: first.id,
            expectedRevision: 1n,
            targets: targets.toReversed()
          });
          const ordered = yield* notes.captureNoteContext({
            noteId: first.id,
            intentKey: 'ordered',
            instruction: '',
            preferences: {}
          });

          test
            .expect(ordered.inputs.map((item) => item.input))
            .toStrictEqual([{ kind: 'page', versionId: b.version!.id }]);
          test.assert.strictEqual(
            (yield* notes.noteSelection({ noteId: second.id })).targets.length,
            1
          );
          const draftOwner = yield* documents.create({
            createKey: crypto.randomUUID(),
            inputs: [],
            citations: [],
            title: 'Draft',
            document: content('Unpublished')
          });

          yield* documents.save({
            pageId: draftOwner.id,
            expectedVersionId: draftOwner.version!.id,
            key: crypto.randomUUID(),
            document: content('Published replacement')
          });
          const draft = yield* documents.save({
            pageId: draftOwner.id,
            expectedVersionId: draftOwner.version!.id,
            key: crypto.randomUUID(),
            document: content('Retained alternative')
          });

          test.assert.ok(
            (yield* Effect.flip(
              notes.updateNoteSelection({
                noteId: second.id,
                expectedRevision: 1n,
                targets: [
                  {
                    input: { kind: 'page', versionId: draft.submittedVersionId },
                    scope: { kind: 'document' }
                  }
                ]
              })
            )).kind === 'invalid_input'
          );
          test.assert.ok(
            (yield* Effect.flip(
              notes.updateNoteSelection({
                noteId: second.id,
                expectedRevision: 1n,
                targets: [targets[0]!, targets[0]!]
              })
            )).kind === 'invalid_input'
          );

          for (let i = 0; i < 55; i++)
            yield* notes.postMessage({ noteId: first.id, text: 'Message ' + i });

          const history = yield* notes.captureNoteContext({
            noteId: first.id,
            intentKey: 'bounded',
            instruction: '',
            preferences: {}
          });

          test.assert.throws(() =>
            context.db.orm
              .update(s.note_run_contexts)
              .set({ snapshot: '{}' })
              .where(eq(s.note_run_contexts.request_id, history.requestId))
              .run()
          );
          test.assert.strictEqual(history.messages.length, 55);
          test.assert.strictEqual(history.excludedMessages, 0);
          test.assert.ok(history.messages[0]!.text === 'Message 0');
          yield* notes.deleteMessage(history.messages[0]!.messageId);
          test
            .expect(yield* notes.inspectNoteContext({ requestId: history.requestId }))
            .toStrictEqual(history);
          test.assert.ok(
            (yield* Effect.flip(notes.noteContext({ requestId: history.requestId }))).kind ===
              'not_found'
          );
          test.assert.ok(
            (yield* Effect.flip(
              notes.captureNoteContext({
                noteId: first.id,
                intentKey: 'bounded',
                instruction: '',
                preferences: {}
              })
            )).kind === 'not_found'
          );
          test.assert.ok(
            (yield* notes.noteContext({ requestId: ordered.requestId })).inputs[0]!.excerpts[0]!
              .text === 'Beta'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'active image documents retain whole bodies and exact asset revisions despite manual range selection',
  async ({ databases }) => {
    const location = await databases();
    let context = new ServerContext(await location.open());
    const services = () =>
      Layer.mergeAll(Notes.layer, Pages.layer, Sources.layer, Settings.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const handlers = () =>
      NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(Layer.provideMerge(services()));
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const documents = yield* Pages;
            const sources = yield* Sources;
            const note = yield* client('notes.createNote', {
              title: 'Selected image'
            });
            const image = yield* sources.createSource({
              projectId: null,
              name: 'figure.png',
              bytes
            });
            const block = createBlock({
              type: 'image',
              sourceId: image.id,
              revision: 1,
              alt: 'Selected figure caption'
            });
            const material = yield* documents.create({
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              title: 'Illustrated document',
              noteId: note.id,

              document: {
                ...content('Hidden surrounding text'),
                blocks: [content('Hidden surrounding text').blocks[0]!, block]
              }
            });

            yield* client('notes.updateNoteSelection', {
              noteId: note.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: { kind: 'page', versionId: material.version!.id },
                  scope: { kind: 'blocks', blockIds: [block.id] }
                }
              ]
            });
            const intent = {
              noteId: note.id,
              intentKey: 'image',
              instruction: 'Explain this figure',
              preferences: {}
            };
            const snapshot = yield* client('notes.captureNoteContext', intent);
            const input = snapshot.inputs[0]!;

            test.assert.ok(input.document);
            test.assert.strictEqual(input.excerpts.length, 2);
            test.assert.strictEqual(input.excerpts[1]!.blockOrdinal, 1);
            test.expect(input.excerpts[1]!.content).toStrictEqual(block.content);
            test.assert.ok(input.excerpts[1]!.text === 'Selected figure caption');
            yield* client('notes.updateNoteSelection', {
              noteId: note.id,
              expectedRevision: 1n,
              targets: [
                {
                  input: { kind: 'page', versionId: material.version!.id },
                  scope: {
                    kind: 'ranges',
                    ranges: [
                      {
                        blockId: block.id,
                        start: 0,
                        end: 8
                      }
                    ]
                  }
                }
              ]
            });
            const range = yield* client('notes.captureNoteContext', {
              ...intent,
              intentKey: 'alt-text-only'
            });

            test.expect(range.inputs).toStrictEqual(snapshot.inputs);
            yield* sources.replaceSource({
              id: image.id,
              expectedRevision: 1,
              name: 'figure.png',
              bytes: new Uint8Array([...bytes, 0])
            });
            yield* documents.save({
              pageId: material.id,
              expectedVersionId: material.version!.id,
              key: crypto.randomUUID(),

              document: {
                ...content('New surrounding text'),
                blocks: [
                  createBlock(
                    { type: 'image', sourceId: image.id, revision: 2, alt: 'Replacement caption' },
                    block.anchor,
                    block.id
                  )
                ]
              }
            });

            test.expect(yield* client('notes.captureNoteContext', intent)).toStrictEqual(snapshot);
            test
              .expect((yield* sources.sourceSnapshot({ id: image.id, revision: 1 })).bytes)
              .toStrictEqual(bytes);

            return { snapshot, range, material, note, image };
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(await location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const documents = yield* Pages;
          const sources = yield* Sources;

          test
            .expect(yield* notes.noteContext({ requestId: saved.snapshot.requestId }))
            .toStrictEqual(saved.snapshot);
          test
            .expect(yield* notes.noteContext({ requestId: saved.range.requestId }))
            .toStrictEqual(saved.range);
          yield* notes.deleteNote(saved.note.id);
          test.assert.ok(
            (yield* Effect.flip(
              notes.inspectNoteContext({
                requestId: saved.snapshot.requestId
              })
            )).kind === 'not_found'
          );
          test.assert.strictEqual(
            (yield* documents.page({ id: saved.material.id })).id,
            saved.material.id
          );
          test
            .expect((yield* sources.sourceSnapshot({ id: saved.image.id, revision: 1 })).bytes)
            .toStrictEqual(bytes);
        }).pipe(Effect.provide(services()))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

function assertRetainedCitationShapes(
  read: typeof chatMessageSchema.Type,
  anchor: Extract<(typeof chatMessageSchema.Type.citations)[number]['anchor'], { type: 'text' }>,
  versionId: PageVersionId,
  _latestVersionId: PageVersionId,
  draftVersionId: PageVersionId,
  sourceId: SourceId
) {
  const [incomplete, mismatch, unpublished, attachment] = read.citations;

  for (const citation of read.citations) {
    test.assert.ok(citation.precision === 'unavailable');
    test.expect(citation.evidence).toStrictEqual({
      availability: 'unavailable',
      precision: 'unavailable',
      reason: 'captured_input_unavailable'
    });
    test.expect(citation.anchor).toStrictEqual(anchor);
  }

  test.expect(incomplete!.input).toStrictEqual({ kind: 'page', versionId });
  test.assert.ok(incomplete!.documentId === null);
  test.expect(mismatch!.input).toStrictEqual({ kind: 'page', versionId });
  test.expect(unpublished!.input).toStrictEqual({ kind: 'page', versionId: draftVersionId });
  test.assert.strictEqual(attachment!.sourceId, sourceId);
  test.assert.ok(attachment!.quote === 'Retained attachment');
}

test.stable(
  'retained legacy and attachment citations keep bounded precision; wrong exact identities never use latest content',
  async ({ databases }) => {
    const location = await databases();
    let context = new ServerContext(await location.open());
    const handlers = () =>
      NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
        Layer.provideMerge(Layer.mergeAll(Notes.layer, Pages.layer, Sources.layer, Settings.layer)),
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

    try {
      const retained = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const documents = yield* Pages;
            const note = yield* rpc('notes.createNote', { title: 'Historic shapes' });
            const body = content('Same words in distinct documents');
            const material = yield* documents.create({
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              title: 'Published',
              document: body
            });
            const latestOutcome = yield* documents.save({
              pageId: material.id,
              expectedVersionId: material.version!.id,
              key: crypto.randomUUID(),
              document: content(body.blocks[0]!.text)
            });
            const draftOutcome = yield* documents.save({
              pageId: material.id,
              expectedVersionId: material.version!.id,
              key: crypto.randomUUID(),
              document: body
            });
            const documentId = material.version!.snapshotId;
            const latest = yield* documents.version({ id: latestOutcome.submittedVersionId });
            const draft = yield* documents.version({ id: draftOutcome.submittedVersionId });
            const latestDocumentId = latest.snapshotId;
            const source = yield* (yield* Sources).createSource({
              projectId: null,
              name: 'attachment.txt',
              bytes: new TextEncoder().encode('Retained attachment')
            });
            const message = yield* rpc('notes.postMessage', {
              noteId: note.id,
              text: 'Legacy [1], mismatch [2], unpublished [3], attachment [4]'
            });
            const anchor = {
              type: 'text' as const,
              lineStart: 4,
              lineEnd: 4,
              start: 100,
              end: 140
            };
            const base = {
              version_id: message.activeVersionId!,
              source_id: null,
              authored_version_id: material.version!.id,
              document_id: null,
              block_id: null,
              range_start: null,
              range_end: null,
              source_name: 'Retained original name',
              anchor: JSON.stringify(anchor),
              quote: 'Same words'
            };

            // Seed retained legacy shapes; keep all foreign keys and permanent retention guards enabled.
            context.db.orm
              .insert(s.citations)
              .values([
                { ...base, marker: 1n },
                {
                  ...base,
                  marker: 2n,
                  document_id: latestDocumentId,
                  block_id: body.blocks[0]!.id,
                  range_start: 0n,
                  range_end: 10n
                },
                {
                  ...base,
                  marker: 3n,
                  authored_version_id: draft.id,
                  document_id: documentId,
                  block_id: body.blocks[0]!.id,
                  range_start: 0n,
                  range_end: 10n
                },
                {
                  ...base,
                  marker: 4n,
                  authored_version_id: null,
                  source_id: source.id,
                  quote: 'Retained attachment'
                }
              ])
              .run();
            const rows = context.db.orm.select().from(s.citations).all();
            const read = yield* rpc('notes.message', { id: message.id });

            assertRetainedCitationShapes(
              read,
              anchor,
              material.version!.id,
              latest.id,
              draft.id,
              source.id
            );

            test
              .expect(
                (yield* rpc('notes.thread', { noteId: note.id, limit: 10 })).items[0]!.citations
              )
              .toStrictEqual(read.citations);
            const edited = yield* rpc('notes.editMessage', {
              messageId: message.id,
              text: 'Reordered [4] [2] [1] [3]'
            });

            test.expect(edited.citations).toStrictEqual(read.citations);
            const exactVersion = yield* rpc('notes.messageVersionCitations', {
              noteId: note.id,
              messageId: message.id,
              versionId: message.activeVersionId!
            });

            test.expect(exactVersion.citations).toStrictEqual(read.citations);
            test
              .expect(
                (yield* rpc('notes.setActiveVersion', {
                  messageId: message.id,
                  versionId: message.activeVersionId!
                })).citations
              )
              .toStrictEqual(read.citations);
            test
              .expect(
                context.db.orm
                  .select()
                  .from(s.citations)
                  .where(eq(s.citations.version_id, message.activeVersionId!))
                  .all()
              )
              .toStrictEqual(rows);

            return {
              id: message.id,
              noteId: note.id,
              versionId: message.activeVersionId!,
              citations: read.citations
            };
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(await location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(NotesRpc, { flatten: true });

            test
              .expect((yield* rpc('notes.message', { id: retained.id })).citations)
              .toStrictEqual(retained.citations);
            test
              .expect(
                (yield* rpc('notes.messageVersionCitations', {
                  noteId: retained.noteId,
                  messageId: retained.id,
                  versionId: retained.versionId
                })).citations
              )
              .toStrictEqual(retained.citations);
          }).pipe(Effect.provide(handlers()))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'native capture rejects foreign or deleted boundaries and preserves exact bounded replay',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const handlers = NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
      Layer.provideMerge(
        Layer.mergeAll(Notes.layer, Pages.layer, Settings.layer, Sources.layer).pipe(
          Layer.provideMerge(Layer.succeed(Database, { store: context }))
        )
      )
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
          const sources = yield* Sources;
          const note = yield* client('notes.createNote', { title: 'Bounded' });
          const other = yield* client('notes.createNote', { title: 'Other' });
          const first = yield* client('notes.postMessage', {
            noteId: note.id,
            text: 'First'
          });
          const deleted = yield* client('notes.postMessage', {
            noteId: note.id,
            text: 'Deleted'
          });

          yield* client('notes.deleteMessage', { id: deleted.id });
          const foreign = yield* client('notes.postMessage', {
            noteId: other.id,
            text: 'Foreign'
          });
          const source = yield* sources.createSource({
            name: 'thread.txt',
            projectId: null,
            bytes: new TextEncoder().encode('Attachment')
          });
          const processing = yield* sources.sourceProcessing(source.id);

          yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 1,
              requestId: processing.requestId!,
              document: content('Attachment')
            })
          );
          const root = yield* client('notes.postMessage', {
            noteId: note.id,
            text: 'Root',
            sourceIds: [source.id]
          });
          const siblingRoot = yield* client('notes.postMessage', {
            noteId: note.id,
            text: 'Sibling',
            sourceIds: [source.id]
          });
          const threadRoot = root.parts[0]!.id;
          const sibling = yield* client('notes.postMessage', {
            noteId: note.id,
            threadRoot: siblingRoot.parts[0]!.id,
            text: 'Sibling child'
          });
          const child = yield* client('notes.postMessage', {
            noteId: note.id,
            threadRoot,
            text: 'Child'
          });
          const intent = {
            noteId: note.id,
            intentKey: 'exact-boundary',
            throughMessageId: first.id,
            instruction: '',
            preferences: {}
          };

          for (const [index, scope] of [
            { throughMessageId: deleted.id },
            { throughMessageId: foreign.id },
            { throughMessageId: child.id },
            { threadRoot, throughMessageId: sibling.id },
            { threadRoot, throughMessageId: siblingRoot.id }
          ].entries()) {
            test.assert.ok(
              (yield* Effect.flip(
                client('notes.captureNoteContext', {
                  ...intent,
                  ...scope,
                  intentKey: 'invalid-' + index
                })
              )).kind === 'invalid_input'
            );
          }

          test.assert.strictEqual(
            context.db.orm.select().from(s.note_run_contexts).all().length,
            0
          );
          const captured = yield* client('notes.captureNoteContext', intent);

          test
            .expect(captured.messages.map((message) => message.messageId))
            .toStrictEqual([first.id]);
          const rootOnly = yield* client('notes.captureNoteContext', {
            ...intent,
            intentKey: 'root-only',
            threadRoot,
            throughMessageId: root.id
          });

          test
            .expect(rootOnly.messages.map((message) => message.messageId))
            .toStrictEqual([root.id]);
          const threaded = yield* client('notes.captureNoteContext', {
            ...intent,
            intentKey: 'threaded',
            threadRoot,
            throughMessageId: child.id
          });

          test
            .expect(threaded.messages.map((message) => message.messageId))
            .toStrictEqual([root.id, child.id]);
          yield* client('notes.editMessage', {
            messageId: first.id,
            text: 'Changed afterwards'
          });
          yield* client('notes.postMessage', { noteId: note.id, text: 'Later' });
          test.expect(yield* client('notes.captureNoteContext', intent)).toStrictEqual(captured);

          for (let index = 0; index < 3; index++)
            yield* client('notes.postMessage', {
              noteId: note.id,
              threadRoot,
              text: String(index).repeat(80000)
            });

          test.assert.strictEqual(
            (yield* Effect.flip(
              client('notes.captureNoteContext', {
                noteId: note.id,
                threadRoot,
                intentKey: 'oversized-thread',
                instruction: '',
                preferences: {}
              })
            )).kind,
            'not_enough'
          );
        }).pipe(Effect.scoped, Effect.provide(handlers))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
