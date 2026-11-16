import { createBlock } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies note tool isolation and versioned edits against real SQLite.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises forbidden reads, edits, detached content and deletion ownership.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use production feature services with temporary databases and no external model     │
 * │ requests.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Option } from 'effect';

import { Notes } from '#server/features/notes/index';
import { NoteDeletionCorrelationStore } from '#server/features/notes/store/deletion';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { useStore } from '#server/platform/definitions/define-store';

import { noteAssistantTools } from './note-assistant.ts';

const environment = { language: 'en', searchSources: () => Effect.succeed([]) };

const body = (text: string) => ({
  blocks: [
    createBlock(
      { type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] },
      { type: 'authored' }
    )
  ],
  meta: {
    extractor: null,
    extractorVersion: 0,
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
  'note tools enforce scope for every note, document and source and preserve edit versions',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;
          const docs = yield* Pages;
          const sources = yield* Sources;
          const a = yield* c.createNote({ title: 'Visible notebook' });
          const b = yield* c.createNote({ title: 'PRIVATE OTHER NOTEBOOK' });
          const note = yield* c.postMessage({ noteId: a.id, text: 'Original note' });
          const otherNote = yield* c.postMessage({ noteId: b.id, text: 'PRIVATE OTHER NOTE' });
          const document = yield* docs.create({
            createKey: 'visible',
            title: 'Visible document',
            document: body('Original body'),
            inputs: [],
            citations: [],
            noteId: a.id
          });
          const otherPage = yield* docs.create({
            createKey: 'other',
            title: 'PRIVATE OTHER DOCUMENT',
            document: body('PRIVATE BODY'),
            inputs: [],
            citations: [],
            noteId: b.id
          });
          const source = yield* sources.createSource({
            name: 'private.txt',
            bytes: new TextEncoder().encode('PRIVATE SOURCE'),
            projectId: null
          });

          yield* sources.attachSource({ noteId: b.id, sourceId: source.id });
          const tools = noteAssistantTools(a.id);
          const initial = yield* tools.read_note_context.execute({}, environment);

          test.expect(initial.notes.items.map((item) => item.id)).toEqual([note.id]);
          test.expect(initial.pages.items.map((item) => item.id)).toEqual([document.id]);
          test.expect(initial.sources).toEqual([]);
          test.expect(Object.keys(tools)).not.toContain('read_settings');
          test.expect(Object.keys(tools)).not.toContain('list_notes');
          test.expect(Object.keys(tools)).not.toContain('link_page_note');
          test
            .expect(
              (yield* Effect.flip(
                tools.edit_note_message.execute(
                  {
                    messageId: otherNote.id,
                    expectedActiveVersionId: otherNote.activeVersionId!,
                    text: 'Wrong'
                  },
                  environment
                )
              )).kind
            )
            .toBe('not_found');
          test
            .expect(
              (yield* Effect.flip(tools.read_page.execute({ id: otherPage.id }, environment))).kind
            )
            .toBe('not_found');
          test.assert.ok(otherPage.headVersionId);
          test
            .expect(
              (yield* Effect.flip(
                tools.save_page.execute(
                  {
                    pageId: otherPage.id,
                    expectedVersionId: otherPage.headVersionId,
                    key: 'forbidden',
                    document: body('Wrong')
                  },
                  environment
                )
              )).kind
            )
            .toBe('not_found');
          test
            .expect(
              (yield* Effect.flip(tools.read_note_source.execute({ id: source.id }, environment)))
                .kind
            )
            .toBe('not_found');
          const edited = yield* tools.edit_note_message.execute(
            {
              messageId: note.id,
              expectedActiveVersionId: note.activeVersionId!,
              text: 'Improved note'
            },
            environment
          );

          test
            .expect(edited.versions.some((version) => version.text === 'Original note'))
            .toBe(true);
          test
            .expect(edited.versions.find((version) => version.id === edited.activeVersionId)?.text)
            .toBe('Improved note');
          test
            .expect(
              (yield* Effect.result(
                tools.edit_note_message.execute(
                  {
                    messageId: note.id,
                    expectedActiveVersionId: note.activeVersionId!,
                    text: 'Stale overwrite'
                  },
                  environment
                )
              ))._tag
            )
            .toBe('Failure');
          test.assert.ok(document.headVersionId);
          const saved = yield* tools.save_page.execute(
            {
              pageId: document.id,
              expectedVersionId: document.headVersionId,
              key: 'improve',
              document: body('Improved body')
            },
            environment
          );

          test.expect(saved.outcome).toBe('saved');
          test
            .expect((yield* docs.page({ id: otherPage.id })).version?.document)
            .toEqual(otherPage.version!.document);
          yield* sources.attachSource({ noteId: a.id, sourceId: source.id });
          test
            .expect(yield* tools.read_note_source.execute({ id: source.id }, environment))
            .toBeNull();
          yield* sources.detachSource({ noteId: a.id, sourceId: source.id });
          test
            .expect(
              (yield* Effect.flip(tools.read_note_source.execute({ id: source.id }, environment)))
                .kind
            )
            .toBe('not_found');
          yield* docs.detach({ pageId: document.id, noteId: a.id });
          test
            .expect(
              (yield* Effect.flip(
                tools.save_page.execute(
                  {
                    pageId: document.id,
                    expectedVersionId: saved.currentVersionId,
                    key: 'after-detach',
                    document: body('Wrong')
                  },
                  environment
                )
              )).kind
            )
            .toBe('not_found');
        }).pipe(
          Effect.provide(Notes.layer),
          Effect.provide(Pages.layer),
          Effect.provide(Sources.layer),
          Effect.provideService(Database, { store: context })
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'deleting a notebook retires scoped chat correlations before cascading its private messages',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Notes;
          const parent = yield* service.createNote({ title: 'Notebook' });
          const chat = yield* service.noteAssistant({ noteId: parent.id });
          const reply = yield* service.assistantAsk({
            noteId: chat.id,
            text: 'PRIVATE CHAT CONTENT',
            intentKey: 'scoped-delete'
          });
          const other = yield* service.createNote({ title: 'Other' });
          const otherChat = yield* service.noteAssistant({ noteId: other.id });

          yield* service.deleteNote(parent.id);
          const correlations = yield* useStore(NoteDeletionCorrelationStore);

          test
            .expect((yield* correlations.deletionCorrelation(parent.id)).correlations)
            .toContain(reply.requestId);
          test.expect(Option.isNone(yield* service.findNote(chat.id))).toBe(true);
          test.expect(Option.isSome(yield* service.findNote(otherChat.id))).toBe(true);
          test
            .expect(
              (yield* Effect.result(service.replySnapshot({ requestId: reply.requestId })))._tag
            )
            .toBe('Failure');
        }).pipe(Effect.provide(Notes.layer), Effect.provideService(Database, { store: context }))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
