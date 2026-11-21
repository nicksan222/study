/** @file Verifies Markdown notebook writes and exact practice evidence over native RPC. */

import { notebookBodyCaptureKey } from '@study/contracts';
import { test } from '@study/testing';
import { Effect } from 'effect';

test.server.stable(
  'notebook upgrades preserve prior captures and version autosaves',
  async ({ rpc, expect }) => {
    const saved = await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;
        const project = yield* client['projects.createProject']({ name: 'Notes' });
        const note = yield* client['notes.createNote']({ project: project.id, title: 'Notebook' });
        const input = { noteId: note.id };
        const scope = { ...input, projectId: project.id };
        const first = yield* client['notes.postMessage']({ ...input, text: 'First capture' });
        const second = yield* client['notes.postMessage']({ ...input, text: 'Second capture' });
        const archived = yield* client['notes.postMessage']({ ...input, text: 'Archived capture' });

        yield* client['notes.setItemArchived']({
          ...input,
          target: { kind: 'message', id: archived.id },
          archived: true
        });
        const original = yield* client['notes.captureStudyEvidence'](scope);

        expect(yield* client['notes.body'](input)).toStrictEqual({
          text: 'First capture\n\nSecond capture',
          versionId: null
        });

        const save = { ...input, text: '# Combined\n\n  Spaced\n', expectedVersionId: null };
        const body = yield* client['notes.saveBody'](save);

        expect(body.text).toBe(save.text);
        expect(body.versionId).not.toBeNull();
        expect(yield* client['notes.saveBody'](save)).toStrictEqual(body);
        expect(
          yield* Effect.flip(client['notes.saveBody']({ ...save, text: 'Outdated' }))
        ).toMatchObject({ kind: 'invalid_input' });

        const revised = yield* client['notes.captureStudyEvidence'](scope);
        const context = (contextId: string) =>
          client['notes.inspectNoteContext']({ requestId: contextId });

        expect((yield* context(revised.contextId)).messages.map((item) => item.text)).toStrictEqual(
          [save.text]
        );
        expect(
          (yield* context(original.contextId)).messages.map((item) => item.messageId)
        ).toStrictEqual([first.id, second.id]);

        const empty = yield* client['notes.saveBody']({
          ...input,
          text: '',
          expectedVersionId: body.versionId
        });

        expect(empty.text).toBe('');
        expect(empty.versionId).not.toBe(body.versionId);
        expect(yield* client['notes.body'](input)).toStrictEqual(empty);
        expect(yield* Effect.flip(client['notes.captureStudyEvidence'](scope))).toMatchObject({
          kind: 'invalid_input'
        });
        expect((yield* context(revised.contextId)).messages[0]?.text).toBe(save.text);

        return { input, empty };
      })
    );

    await rpc.reopen();
    expect(await rpc.runPromise(rpc.client['notes.body'](saved.input))).toStrictEqual(saved.empty);
  }
);

test.server.stable(
  'a new Markdown notebook persists the original whitespace in a selected version',
  async ({ rpc, expect }) => {
    await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;
        const text = '    indented code\n';
        const note = yield* client['notes.createUntitledNote']({
          initialMessage: { text, notebookBody: true }
        });
        const body = yield* client['notes.body']({ noteId: note.id });

        expect(body.text).toBe(text);
        expect(body.versionId).not.toBeNull();
        expect(
          yield* Effect.flip(
            client['notes.postMessage']({
              noteId: note.id,
              text,
              requestReply: false,
              captureKey: notebookBodyCaptureKey
            })
          )
        ).toMatchObject({ kind: 'invalid_input' });
        expect(
          yield* Effect.flip(
            client['notes.createUntitledNote']({
              initialMessage: { text: ' \n', notebookBody: true }
            })
          )
        ).toMatchObject({ kind: 'invalid_input' });
      })
    );
  }
);

test.server.stable(
  'merged Markdown bodies use the latest text of each notebook and retain copied history',
  async ({ rpc, expect }) => {
    await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;
        const first = yield* client['notes.createNote']({ title: 'First notebook' });
        const second = yield* client['notes.createNote']({ title: 'Second notebook' });

        yield* client['notes.postMessage']({ noteId: first.id, text: 'Replaced capture' });
        yield* client['notes.saveBody']({
          noteId: first.id,
          text: 'Current body',
          expectedVersionId: null
        });
        yield* client['notes.postMessage']({ noteId: second.id, text: 'Legacy body' });
        const input = { noteIds: [second.id, first.id], intentKey: 'merge-markdown' };
        const merged = yield* client['notes.mergeNotes'](input);
        const noteId = merged.id;

        expect((yield* client['notes.body']({ noteId })).text).toBe('Current body\n\nLegacy body');
        const thread = yield* client['notes.thread']({ noteId, limit: 10 });

        const versions = thread.items.flatMap((item) => item.versions);

        expect(versions.map((version) => version.text)).toContain('Replaced capture');
        expect((yield* client['notes.mergeNotes'](input)).id).toBe(noteId);
      })
    );
  }
);
