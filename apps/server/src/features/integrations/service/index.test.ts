/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises integration imports through real SQLite HTTP and Workflow execution.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies publication replay restart recovery and cancellation.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use production services and real temporary database ownership and listeners.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { Integrations } from '#server/features/integrations/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { serve } from '#server/runtime/server';
import { withTestPublication } from '#testing/publication';
import { createStudyTest } from '#testing/server-test';

const input = (text = '# Cells\n\nSee [[DNA]].') => ({
  providerId: 'obsidian',
  sourceKey: 'Biology',
  files: [
    { path: 'Cells.md', content: Buffer.from(text).toString('base64') },
    { path: 'DNA.md', content: Buffer.from('# DNA\n\nGenetic material.').toString('base64') }
  ]
});

testStable(
  'imports through real HTTP RPC and native Workflow into editable session documents',
  async (t) => {
    const fixture = await createStudyTest(t);
    const server = fixture.manage(await serve(fixture.app));

    await fixture.app.workers.start();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
          const preview = yield* client['integrations.previewImport'](input());

          expect(preview.status).toBe('preview');
          expect((yield* client['conversations.sessions']({ limit: 100 })).items).toHaveLength(0);
          yield* client['integrations.startImport']({ id: preview.id, excludedKeys: [] });
          let result = yield* client['integrations.import']({ id: preview.id });

          while (result.status === 'running') {
            yield* Effect.sleep('20 millis');
            result = yield* client['integrations.import']({ id: preview.id });
          }

          expect(result.status).toBe('completed');
          expect(result.items.map((item) => item.status)).toEqual(['imported', 'imported']);
          const sessions = yield* client['conversations.sessions']({ limit: 100 });

          expect(sessions.items.map((session) => session.title).sort()).toEqual(['Cells', 'DNA']);
          const docs = yield* client['documents.documents']({ limit: 100, archived: false });
          const cells = docs.items.find((doc) => doc.title === 'Cells')!;
          const document = yield* client['documents.document']({ id: cells.id });

          expect(document.version?.document.blocks.map((block) => block.text).join('\n')).toContain(
            'Cells'
          );
          expect(document.version?.document.blocks.map((block) => block.text).join('\n')).toContain(
            'DNA'
          );
          expect(JSON.stringify(document.version?.document)).toContain('"type":"link"');
          const original = document.version!;

          const edit = yield* client['documents.save']({
            documentId: cells.id,
            expectedVersionId: original.id,
            key: randomUUID(),
            document: original.document
          });

          expect(edit.outcome).toBe('saved');
        })
      ),
      { signal: AbortSignal.timeout(20000) }
    );
  }
);

testStable(
  'resumes a cancelled import after destination reservation without duplicate sessions',
  async (t) => {
    const fixture = await createStudyTest(t);
    const preview = await fixture.run(
      Effect.flatMap(Integrations, (service) => service.previewImport(input()))
    );

    await fixture.run(
      Effect.flatMap(Integrations, (service) =>
        service.startImport({ id: preview.id, excludedKeys: [] })
      )
    );
    await fixture.run(
      Effect.flatMap(Integrations, (service) =>
        withTestPublication(
          fixture.store,
          service.reserveImport({ id: preview.id, attempt: 1 }).pipe(Effect.asVoid)
        )
      )
    );
    const reserved = await fixture.run(
      Effect.flatMap(Integrations, (service) => service.import({ id: preview.id }))
    );

    expect(reserved.items.every((item) => item.sessionId !== null)).toBe(true);
    await fixture.run(
      Effect.flatMap(Integrations, (service) => service.cancelImport({ id: preview.id }))
    );
    const resumed = await fixture.run(
      Effect.flatMap(Integrations, (service) => service.retryImport({ id: preview.id }))
    );

    expect(resumed.status).toBe('running');
    expect(resumed.attempt).toBe(2);
    await fixture.app.workers.start();
    await fixture.run(
      Effect.gen(function* () {
        const service = yield* Integrations;
        let state = yield* service.import({ id: preview.id });

        while (state.status === 'running') {
          yield* Effect.sleep('20 millis');
          state = yield* service.import({ id: preview.id });
        }

        expect(state.status).toBe('completed');
        expect(state.items.map((item) => item.sessionId)).toEqual(
          reserved.items.map((item) => item.sessionId)
        );
        expect(state.items.every((item) => item.status === 'imported')).toBe(true);
        const conversations = yield* Conversations;

        expect((yield* conversations.sessions({ limit: 100 })).items).toHaveLength(2);
      }),
      { signal: AbortSignal.timeout(20000) }
    );
  }
);

testStable(
  'reports changed link destinations for review when previously excluded notes are included',
  async (t) => {
    const fixture = await createStudyTest(t);

    await fixture.app.workers.start();
    await fixture.run(
      Effect.gen(function* () {
        const service = yield* Integrations;
        const first = yield* service.previewImport(input());

        yield* service.startImport({ id: first.id, excludedKeys: ['DNA.md'] });
        let state = yield* service.import({ id: first.id });

        while (state.status === 'running') {
          yield* Effect.sleep('20 millis');
          state = yield* service.import({ id: first.id });
        }

        expect(state.items.map((item) => item.status)).toEqual(['imported', 'excluded']);
        const second = yield* service.previewImport(input());

        yield* service.startImport({ id: second.id, excludedKeys: [] });
        state = yield* service.import({ id: second.id });

        while (state.status === 'running') {
          yield* Effect.sleep('20 millis');
          state = yield* service.import({ id: second.id });
        }

        expect(state.items.map((item) => item.status)).toEqual(['conflict', 'imported']);
      }),
      { signal: AbortSignal.timeout(20000) }
    );
  }
);

testStable(
  'shares one retained attachment Source across notes in the same vault import',
  async (t) => {
    const fixture = await createStudyTest(t);

    await fixture.app.workers.start();
    await fixture.run(
      Effect.gen(function* () {
        const service = yield* Integrations;
        const preview = yield* service.previewImport({
          providerId: 'obsidian',
          sourceKey: 'Shared attachment',
          files: [
            { path: 'A.md', content: Buffer.from('# A\n\n![[shared.txt]]').toString('base64') },
            { path: 'B.md', content: Buffer.from('# B\n\n![[shared.txt]]').toString('base64') },
            {
              path: 'shared.txt',
              content: Buffer.from('One original attachment.').toString('base64')
            }
          ]
        });

        yield* service.startImport({ id: preview.id, excludedKeys: [] });
        let state = yield* service.import({ id: preview.id });

        while (state.status === 'running') {
          yield* Effect.sleep('20 millis');
          state = yield* service.import({ id: preview.id });
        }

        expect(state.status).toBe('completed');
        const sources = yield* Sources;
        const conversations = yield* Conversations;

        for (const item of state.items) {
          const thread = yield* conversations.thread({ sessionId: item.sessionId!, limit: 100 });

          expect(
            thread.items.flatMap((message) => message.parts).map((part) => part.sourceName)
          ).toContain('shared.txt');
        }

        expect(
          (yield* sources.sources({ limit: 100 })).items.map((source) => source.name).sort()
        ).toEqual(['A.md', 'B.md', 'shared.txt']);
      }),
      { signal: AbortSignal.timeout(20000) }
    );
  }
);

testStable(
  'replays a start, resumes after restart, skips unchanged notes and reports changed-note conflicts',
  async (t) => {
    const fixture = createStudyTest(t, { app: false });
    const first = await fixture.openApp();
    const preview = await first.nativeRuntime.runPromise(
      Effect.flatMap(Integrations, (service) => service.previewImport(input()))
    );

    await first.nativeRuntime.runPromise(
      Effect.flatMap(Integrations, (service) =>
        service.startImport({ id: preview.id, excludedKeys: [] })
      )
    );
    await first.close();
    const second = await fixture.openApp();

    await second.workers.start();
    await second.nativeRuntime.runPromise(
      Effect.gen(function* () {
        const service = yield* Integrations;
        let result = yield* service.import({ id: preview.id });

        while (result.status === 'running') {
          yield* Effect.sleep('20 millis');
          result = yield* service.import({ id: preview.id });
        }

        expect(result.items.every((item) => item.status === 'imported')).toBe(true);
        yield* service.startImport({ id: preview.id, excludedKeys: [] });
        const next = yield* service.previewImport(input('# Changed externally'));

        yield* service.startImport({ id: next.id, excludedKeys: [] });
        let repeated = yield* service.import({ id: next.id });

        while (repeated.status === 'running') {
          yield* Effect.sleep('20 millis');
          repeated = yield* service.import({ id: next.id });
        }

        expect(repeated.items.map((item) => item.status)).toEqual(['conflict', 'unchanged']);
        const conversations = yield* Conversations;
        const documents = yield* Documents;

        expect((yield* conversations.sessions({ limit: 100 })).items).toHaveLength(2);
        expect((yield* documents.documents({ limit: 100, archived: false })).items).toHaveLength(2);
      }),
      { signal: AbortSignal.timeout(20000) }
    );
  }
);

testStable(
  'cancels before publication and excludes selected notes without creating sessions',
  async (t) => {
    const fixture = await createStudyTest(t);

    await fixture.run(
      Effect.gen(function* () {
        const service = yield* Integrations;
        const preview = yield* service.previewImport(input());

        yield* service.startImport({ id: preview.id, excludedKeys: ['DNA.md'] });
        const cancelled = yield* service.cancelImport({ id: preview.id });

        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.items.find((item) => item.key === 'DNA.md')?.status).toBe('excluded');
        const conversations = yield* Conversations;

        expect((yield* conversations.sessions({ limit: 100 })).items).toHaveLength(0);
      })
    );
  }
);

testStable(
  'can cancel and settle an import after its destination project is deleted',
  async (t) => {
    const fixture = await createStudyTest(t);
    const id = await fixture.run(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const integrations = yield* Integrations;
        const project = yield* projects.createProject({ name: 'Temporary destination' });
        const preview = yield* integrations.previewImport(input());

        yield* integrations.startImport({
          id: preview.id,
          projectId: project.id,
          excludedKeys: []
        });
        yield* projects.deleteProject({ id: project.id });
        expect((yield* integrations.cancelImport({ id: preview.id })).status).toBe('cancelled');
        expect((yield* integrations.retryImport({ id: preview.id })).status).toBe('running');

        return preview.id;
      })
    );

    await fixture.app.workers.start();
    await fixture.run(
      Effect.gen(function* () {
        const integrations = yield* Integrations;
        let state = yield* integrations.import({ id });

        while (state.status === 'running') {
          yield* Effect.sleep('20 millis');
          state = yield* integrations.import({ id });
        }

        expect(state.status).toBe('failed');
        expect(state.errorKind).toBe('not_found');
        const conversations = yield* Conversations;

        expect((yield* conversations.sessions({ limit: 100 })).items).toHaveLength(0);
      }),
      { signal: AbortSignal.timeout(20000) }
    );
  }
);

testStable('a cancelled preview cannot bypass import confirmation through retry', async (t) => {
  const fixture = await createStudyTest(t);

  await fixture.run(
    Effect.gen(function* () {
      const service = yield* Integrations;
      const preview = yield* service.previewImport(input());
      const cancelled = yield* service.cancelImport({ id: preview.id });

      expect(cancelled.attempt).toBe(0);
      expect((yield* Effect.flip(service.retryImport({ id: preview.id }))).kind).toBe(
        'invalid_input'
      );
      expect((yield* service.import({ id: preview.id })).status).toBe('cancelled');
      expect((yield* (yield* Conversations).sessions({ limit: 100 })).items).toHaveLength(0);
    })
  );
});

testStable(
  'a finish failure preserves imported items and retries without republishing documents',
  async (t) => {
    const fixture = await createStudyTest(t);

    fixture.store.db.orm.run(
      sql`CREATE TRIGGER reject_import_completion BEFORE UPDATE OF state ON integration_imports WHEN json_extract(NEW.state, '$.status') = 'completed' BEGIN SELECT RAISE(ABORT, 'injected finish failure'); END`
    );
    await fixture.app.workers.start();
    await fixture.run(
      Effect.gen(function* () {
        const service = yield* Integrations;
        const preview = yield* service.previewImport(input());

        yield* service.startImport({ id: preview.id, excludedKeys: [] });
        let failed = yield* service.import({ id: preview.id });

        while (failed.status === 'running') {
          yield* Effect.sleep('20 millis');
          failed = yield* service.import({ id: preview.id });
        }

        expect(failed.status).toBe('failed');
        expect(failed.items.map((item) => item.status)).toEqual(['imported', 'imported']);
        fixture.store.db.orm.run(sql`DROP TRIGGER reject_import_completion`);
        yield* service.retryImport({ id: preview.id });
        let retried = yield* service.import({ id: preview.id });

        while (retried.status === 'running') {
          yield* Effect.sleep('20 millis');
          retried = yield* service.import({ id: preview.id });
        }

        expect(retried.status).toBe('completed');
        expect(retried.items.map((item) => item.sessionId)).toEqual(
          failed.items.map((item) => item.sessionId)
        );
        expect(
          (yield* (yield* Documents).documents({ limit: 100, archived: false })).items
        ).toHaveLength(2);
        expect((yield* (yield* Conversations).sessions({ limit: 100 })).items).toHaveLength(2);
      }),
      { signal: AbortSignal.timeout(20000) }
    );
  }
);
