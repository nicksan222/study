import {
  eq,
  message_section_titles,
  message_versions,
  messages,
  sql,
  workflowEvents,
  workflow_executions
} from '@study/db';
import { ServerContext } from '@study/server';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { Notes } from '#server/features/notes/index';
import { noteSectionTitleRegistration } from '#server/features/notes/workflows/section-title';
import { withTestPublication } from '#testing/publication';
import { domain as services, titleEvents } from '#testing/section-titles';
import { admitTestExecution } from '#testing/workflow-admission';

test.server.stable(
  'section titles deduplicate legacy backfill and commit atomically with new captures',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const note = yield* notes.createNote({ title: 'Lesson dump' });
          const first = yield* notes.postMessage({
            noteId: note.id,
            text: 'Retrieval strengthens a memory.',
            requestReply: false
          });

          expect(first.sectionTitle).toBeUndefined();
          expect(titleEvents(context)).toMatchObject([
            { noteId: note.id, messageId: first.id, versionId: first.activeVersionId }
          ]);
          context.db.orm
            .delete(workflowEvents)
            .where(eq(workflowEvents.type, 'NoteSectionTitleRequested'))
            .run();
          yield* notes.thread({ noteId: note.id, limit: 30 });
          yield* notes.thread({ noteId: note.id, limit: 30 });
          expect(titleEvents(context)).toHaveLength(1);

          const counts = () =>
            [messages, message_versions, workflowEvents].map(
              (table) => context.db.orm.select().from(table).all().length
            );
          const before = counts();

          context.db.orm.run(
            sql`CREATE TRIGGER reject_section_title BEFORE INSERT ON workflow_events WHEN NEW.type='NoteSectionTitleRequested' BEGIN SELECT RAISE(ABORT,'injected title outbox failure'); END`
          );
          yield* Effect.flip(
            notes.postMessage({
              noteId: note.id,
              text: 'This capture must roll back.',
              requestReply: false
            })
          );
          expect(counts()).toStrictEqual(before);
          context.db.orm.run(sql`DROP TRIGGER reject_section_title`);
          const saved = yield* notes.postMessage({
            noteId: note.id,
            text: 'Spacing makes retrieval harder.',
            requestReply: false
          });

          expect(titleEvents(context).filter((event) => event.messageId === saved.id)).toHaveLength(
            1
          );
        }).pipe(Effect.provide(services(context)))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'section titles preserve raw text and manual descriptions, reject stale publication and survive reopening',
  async ({ databases, expect }) => {
    const location = await databases();
    let context = new ServerContext(await location.open());

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const note = yield* notes.createNote({ title: 'Learning' });
          const first = yield* notes.postMessage({
            noteId: note.id,
            text: 'Retrieving a memory strengthens it.',
            requestReply: false
          });
          const firstVersion = first.activeVersionId!;

          yield* notes.updateMessageDescription({
            messageId: first.id,
            description: 'My own card description',
            expectedDescription: null
          });
          yield* withTestPublication(
            context,
            notes.publishSectionTitle({
              messageId: first.id,
              expectedActiveVersionId: firstVersion,
              title: 'Retrieval practice'
            })
          );
          const titled = yield* notes.message(first.id);

          expect(titled.sectionTitle).toStrictEqual({
            versionId: firstVersion,
            title: 'Retrieval practice'
          });
          expect(titled.description).toBe('My own card description');
          expect(titled.versions[0]?.text).toBe(first.versions[0]?.text);
          const edited = yield* notes.editMessage({
            messageId: first.id,
            text: 'Spacing practice improves later recall.'
          });

          expect(edited.sectionTitle).toBeUndefined();
          const stale = yield* Effect.flip(
            withTestPublication(
              context,
              notes.publishSectionTitle({
                messageId: first.id,
                expectedActiveVersionId: firstVersion,
                title: 'Stale generation'
              })
            )
          );

          expect(stale.kind).toBe('invalid_input');
          yield* withTestPublication(
            context,
            notes.publishSectionTitle({
              messageId: first.id,
              expectedActiveVersionId: edited.activeVersionId!,
              title: 'Spacing effect'
            })
          );

          return { id: first.id, firstVersion, currentVersion: edited.activeVersionId! };
        }).pipe(Effect.provide(services(context)))
      );

      context.close();
      context = new ServerContext(await location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const restored = yield* notes.message(saved.id);

          expect(restored.sectionTitle).toStrictEqual({
            versionId: saved.currentVersion,
            title: 'Spacing effect'
          });
          yield* notes.setActiveVersion({ messageId: saved.id, versionId: saved.firstVersion });
          expect((yield* notes.message(saved.id)).sectionTitle?.title).toBe('Retrieval practice');
          yield* notes.setActiveVersion({ messageId: saved.id, versionId: saved.currentVersion });
          yield* notes.deleteMessageVersion({ messageId: saved.id, versionId: saved.firstVersion });
          expect(
            context.db.orm
              .select()
              .from(message_section_titles)
              .where(eq(message_section_titles.version_id, saved.firstVersion))
              .get()
          ).toBeUndefined();
          expect((yield* notes.message(saved.id)).sectionTitle?.title).toBe('Spacing effect');
        }).pipe(Effect.provide(services(context)))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'merged sections retain their own titles while archives and deletion fence late results',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const first = yield* notes.createNote({ title: 'First lesson' });
          const second = yield* notes.createNote({ title: 'Second lesson' });
          const capture = yield* notes.postMessage({
            noteId: first.id,
            text: 'Explaining from memory reveals the gaps.',
            requestReply: false
          });

          yield* notes.postMessage({
            noteId: second.id,
            text: 'Compare answers with the source.',
            requestReply: false
          });
          yield* withTestPublication(
            context,
            notes.publishSectionTitle({
              messageId: capture.id,
              expectedActiveVersionId: capture.activeVersionId!,
              title: 'Active recall'
            })
          );
          const merged = yield* notes.mergeNotes({
            noteIds: [first.id, second.id],
            intentKey: 'section-title-merge'
          });
          const copied = (yield* notes.thread({ noteId: merged.id, limit: 30 })).items[0]!;

          expect(copied.id).not.toBe(capture.id);
          expect(copied.sectionTitle).toStrictEqual({
            versionId: copied.activeVersionId,
            title: 'Active recall'
          });
          yield* notes.setItemArchived({
            noteId: merged.id,
            target: { kind: 'message', id: copied.id },
            archived: true
          });
          const publication = {
            messageId: copied.id,
            expectedActiveVersionId: copied.activeVersionId!,
            title: 'Late title'
          };
          const archived = yield* Effect.flip(
            withTestPublication(context, notes.publishSectionTitle(publication))
          );

          expect(archived.kind).toBe('invalid_input');
          const events = titleEvents(context).length;

          yield* notes.thread({ noteId: merged.id, limit: 30 });
          expect(titleEvents(context)).toHaveLength(events);
          yield* notes.setItemArchived({
            noteId: merged.id,
            target: { kind: 'message', id: copied.id },
            archived: false
          });
          expect((yield* notes.message(copied.id)).sectionTitle?.title).toBe('Active recall');
          yield* notes.deleteNote(merged.id);
          const deleted = yield* Effect.flip(
            withTestPublication(context, notes.publishSectionTitle(publication))
          );

          expect(deleted.kind).toBe('invalid_input');
          expect(
            context.db.orm
              .select()
              .from(message_section_titles)
              .where(eq(message_section_titles.version_id, copied.activeVersionId!))
              .get()
          ).toBeUndefined();
        }).pipe(Effect.provide(services(context)))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'section title work follows the current visible version rather than superseded or completed requests',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const note = yield* notes.createNote({ title: 'Title work' });
          const first = yield* notes.postMessage({
            noteId: note.id,
            text: 'Recall strengthens memory.',
            requestReply: false
          });
          const initial = titleEvents(context)[0]!;

          admitTestExecution(context, noteSectionTitleRegistration.definition, 'original-title', {
            event: initial
          });
          context.db.orm
            .update(workflow_executions)
            .set({ status: 'suspended' })
            .where(eq(workflow_executions.execution_id, 'original-title'))
            .run();
          expect(
            (yield* notes.noteWork({ noteId: note.id, limit: 30 })).items.map(
              (item) => item.requestId
            )
          ).toEqual([initial.correlationId]);
          const edited = yield* notes.editMessage({
            messageId: first.id,
            text: 'Spaced practice improves later recall.'
          });

          expect((yield* notes.noteWork({ noteId: note.id, limit: 30 })).items).toHaveLength(0);
          const current = titleEvents(context).find(
            (event) => event.versionId === edited.activeVersionId
          )!;

          admitTestExecution(context, noteSectionTitleRegistration.definition, 'current-title', {
            event: current
          });
          expect(
            (yield* notes.noteWork({ noteId: note.id, limit: 30 })).items.map(
              (item) => item.requestId
            )
          ).toEqual([current.correlationId]);
          yield* notes.setItemArchived({
            noteId: note.id,
            target: { kind: 'message', id: first.id },
            archived: true
          });
          expect((yield* notes.noteWork({ noteId: note.id, limit: 30 })).items).toHaveLength(0);
          yield* notes.setItemArchived({
            noteId: note.id,
            target: { kind: 'message', id: first.id },
            archived: false
          });
          yield* withTestPublication(
            context,
            notes.publishSectionTitle({
              messageId: first.id,
              expectedActiveVersionId: edited.activeVersionId!,
              title: 'Spaced practice'
            })
          );
          expect((yield* notes.noteWork({ noteId: note.id, limit: 30 })).items).toHaveLength(0);
        }).pipe(Effect.provide(services(context)))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
