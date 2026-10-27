import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createStudyClient as browserClient } from '@study/backend/client';
import { createStudyClient as nativeClient } from '@study/backend/node';
import type { SourceId as ImportedSourceId } from '@study/backend/shared/ids';
import type { MessageId as ImportedMessageId } from '@study/backend/shared/ids';
import type { ArtifactId as ImportedArtifactId } from '@study/backend/shared/ids';
import type { Document as ImportedDocument } from '@study/backend/shared/sources';
import { TRPCClientError } from '@trpc/client';

import { createSession as dbCreateSession } from '#backend/procedures/conversations/create-session';
import { message as dbMessage } from '#backend/procedures/conversations/messages';
import { postMessage as dbPostMessage } from '#backend/procedures/conversations/post-message';
import { requestReply as dbRequestReply } from '#backend/procedures/conversations/reanswer';
import {
  beginVersion as dbBeginVersion,
  finishVersion as dbFinishVersion
} from '#backend/procedures/conversations/versions';
import { cancelJob as dbCancelJob } from '#backend/procedures/jobs/cancel-job';
import { listJobs as dbListJobs } from '#backend/procedures/jobs/job-overviews';
import {
  enqueueJob as dbEnqueueJob,
  claimJob as dbClaimJob
} from '#backend/procedures/jobs/worker';
import { finishMaterial as dbFinishMaterial } from '#backend/procedures/material/finish-material';
import { requestMaterial as dbRequestMaterial } from '#backend/procedures/material/update-material';
import { answerQuestion as dbAnswerQuestion } from '#backend/procedures/practice/answer-question';
import { finishQuestion as dbFinishQuestion } from '#backend/procedures/practice/finish-question';
import { createPractice as dbCreatePractice } from '#backend/procedures/practice/project-practice';
import { requestQuestion as dbRequestQuestion } from '#backend/procedures/practice/request-question';
import { createProject as dbCreateProject } from '#backend/procedures/projects/create-project';
import { createNote as dbCreateNote } from '#backend/procedures/sources/create-note';
import {
  saveDocument as dbSaveDocument,
  documentOf as dbDocumentOf
} from '#backend/procedures/sources/source-document';
import { serve } from '#backend/runtime/server';
import { App } from '#backend/runtime/service';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'study-backend-'));
  const path = join(dir, 'study.db');
  const app = await App.open({ path });
  const server = await serve(app);

  return {
    app,
    server,
    path,
    async close() {
      try {
        await server.close();
      } finally {
        try {
          await app.close();
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  };
}

const hasCode = (code: string) => (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === code;

for (const protocol of ['node', 'browser'] as const) {
  test(`${protocol} calls without credentials, validates IDs and preserves int64`, async () => {
    const f = await fixture();

    try {
      const create = protocol === 'node' ? nativeClient : browserClient;
      const baseUrl = protocol === 'node' ? f.server.url : f.server.url;
      const client = create({ baseUrl });

      assert.deepEqual((await client.projects.projects.query({})).items, []);
      await assert.rejects(
        client.projects.deleteProject.mutate({ id: 0n }),
        hasCode('BAD_REQUEST')
      );
      await assert.rejects(
        client.projects.deleteProject.mutate({ id: -1n }),
        hasCode('BAD_REQUEST')
      );
      await assert.rejects(
        client.projects.renameProject.mutate({ name: 'Missing' } as never),
        hasCode('BAD_REQUEST')
      );
      const db = new DatabaseSync(f.path);

      try {
        const insert = db.prepare(
          'INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)'
        );

        insert.setReadBigInts(true);
        insert.run(9007199254740993n, 'Large', 0, 0);
      } finally {
        db.close();
      }

      const project = (await client.projects.projects.query({})).items[0]!;

      assert.equal(project.id, 9007199254740993n);
      const session = await client.conversations.createSession.mutate({
        project: project.id,
        title: 'Session'
      });
      const source = await client.sources.uploadSource.mutate({
        name: 'hello.txt',
        bytes: new TextEncoder().encode('hello'),
        project: project.id
      });

      assert.deepEqual(
        (await client.sources.exportSource.query({ id: source.id! })).value,
        new TextEncoder().encode('hello')
      );
      const recording = await client.recordings.createRecording.mutate({
        id: session.id!
      });

      await assert.rejects(
        client.recordings.append.mutate({ id: recording.id, samples: [32768] }),
        hasCode('BAD_REQUEST')
      );
      await assert.rejects(
        client.recordings.append.mutate({
          id: recording.id,
          samples: [-32769]
        }),
        hasCode('BAD_REQUEST')
      );
      await client.recordings.append.mutate({
        id: recording.id,
        samples: [-32768, 0, 32767]
      });
      assert.equal(
        (await client.recordings.recording.query({ id: recording.id! })).value?.samples,
        3n
      );
      const message = await client.recordings.postRecording.mutate({
        session: session.id,
        recording: recording.id,
        name: 'voice.wav'
      });
      const wav = (
        await client.sources.exportSource.query({
          id: message.parts[0]!.content!.sourceId!
        })
      ).value;

      assert.equal(Buffer.from(wav).readInt16LE(44), -32768);
      assert.equal(Buffer.from(wav).readInt16LE(48), 32767);
      await assert.rejects(client.projects.createProject.mutate({ name: '' }), (error) => {
        assert.ok(error instanceof TRPCClientError);
        assert.equal(error.data?.code, 'BAD_REQUEST');
        assert.equal(error.data?.kind, 'invalid_input');

        return true;
      });
    } finally {
      await f.close();
    }
  });
}

test('browser CORS is restricted to desktop and development origins', async () => {
  const f = await fixture();

  try {
    for (const origin of [
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
      'http://localhost:5173'
    ]) {
      const response = await fetch(`${f.server.url}/trpc/projects.projects`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type'
        }
      });

      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }

    const denied = await fetch(`${f.server.url}/trpc/projects.projects`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST'
      }
    });

    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    const custom = await fetch(`${f.server.url}/api/listProjects`, {
      method: 'POST'
    });

    assert.equal(custom.status, 404);
  } finally {
    await f.close();
  }
});

test("correction compares the client's document identity even when replacement text matches", async () => {
  const f = await fixture();

  try {
    const client = nativeClient({
      baseUrl: f.server.url
    });
    const source = await client.sources.createNote.mutate({
      title: 'Notes',
      text: 'same'
    });
    const coreId = source.id as ImportedSourceId;
    const doc: ImportedDocument = {
      blocks: [
        {
          kind: 'paragraph',
          text: 'same',
          anchor: { type: 'paragraph', index: 0 }
        }
      ],
      meta: {
        extractor: 'text',
        extractorVersion: 1,
        provider: null,
        durationMs: null,
        pageCount: null,
        refiners: [],
        waitingFor: [],
        corrected: false
      }
    };

    dbSaveDocument(f.app.store, coreId, doc);
    const original = (await client.sources.sourceDocument.query({ id: source.id! })).value!;

    assert.ok(original.id);
    const replacement = dbSaveDocument(f.app.store, coreId, structuredClone(doc));

    assert.notEqual(original.id, replacement);
    assert.equal(
      (
        await client.sources.correctBlock.mutate({
          id: source.id,
          documentId: original.id,
          ordinal: 0,
          before: 'same',
          after: 'overwritten'
        })
      ).value,
      false
    );
    assert.equal(dbDocumentOf(f.app.store, coreId)?.document.blocks[0]?.text, 'same');
    await assert.rejects(
      client.sources.correctBlock.mutate({
        id: source.id,
        ordinal: 0,
        before: 'same',
        after: 'bad'
      } as never),
      hasCode('BAD_REQUEST')
    );
    assert.equal(
      (
        await client.sources.correctBlock.mutate({
          id: source.id,
          documentId: replacement,
          ordinal: 0,
          before: 'same',
          after: 'updated'
        })
      ).value,
      true
    );
  } finally {
    await f.close();
  }
});

test('assistant mentions queue replies, and reanswer writes a version of the same answer', async () => {
  const f = await fixture();

  try {
    const client = nativeClient({
      baseUrl: f.server.url
    });
    const project = await client.projects.createProject.mutate({
      name: 'Physics'
    });
    const session = await client.conversations.createSession.mutate({
      project: project.id,
      title: 'Notes'
    });

    await client.conversations.postMessage.mutate({
      place: { type: 'timeline', id: session.id },
      text: 'Plain note'
    });
    const asked = await client.conversations.postMessage.mutate({
      place: { type: 'timeline', id: session.id },
      text: '@study Explain gravity'
    });
    const messages = (await client.conversations.messages.query({ id: session.id! })).items;
    const answer = messages.find((m) => m.replyTo === asked.id)!;

    assert.ok(answer);
    assert.equal(answer.versions.length, 1);
    const claim = dbClaimJob(f.app.store, ['reply'])!;
    const version = dbMessage(f.app.store, answer.id as ImportedMessageId)!.versions[0]!;

    assert.equal(dbBeginVersion(f.app.store, version.id, claim.id, claim.attempts), true);
    assert.equal(
      dbFinishVersion(f.app.store, version.id, claim.id, claim.attempts, 'Gravity attracts masses'),
      true
    );
    const again = await client.conversations.reanswer.mutate({
      id: answer.id!
    });

    assert.equal(again.type, 'queued');
    const after = (await client.conversations.messages.query({ id: session.id! })).items;

    assert.equal(after.length, 3);
    assert.equal(after.find((m) => m.id === answer.id)?.versions.length, 2);
    assert.equal(
      (await client.conversations.reanswer.mutate({ id: asked.id! })).type,
      'unavailable'
    );
  } finally {
    await f.close();
  }
});

test('typed settings validate, persist, and do not expose private credentials', async () => {
  const f = await fixture();

  try {
    const client = browserClient({
      baseUrl: f.server.url
    });
    const before = await client.settings.getAppSettings.query({});

    await client.settings.saveAppSettings.mutate({
      ...before,
      language: 2,
      appearance: 1,
      zoomPercent: 125,
      onboarded: true
    });
    assert.equal((await client.settings.getAppSettings.query({})).zoomPercent, 125);
    await assert.rejects(
      client.settings.saveAppSettings.mutate({
        ...before,
        language: 0 as never
      }),
      hasCode('BAD_REQUEST')
    );
    await assert.rejects(
      client.settings.saveAppSettings.mutate({ ...before, zoomPercent: 201 }),
      hasCode('BAD_REQUEST')
    );
    await client.settings.saveReviewSettings.mutate({ newCardsPerDay: 4 });
    assert.equal((await client.settings.getReviewSettings.query({})).newCardsPerDay, 4);
    await assert.rejects(
      client.settings.saveLlmSettings.mutate({} as never),
      hasCode('BAD_REQUEST')
    );
    await client.settings.saveLlmSettings.mutate({
      tiny: { provider: 1, model: 1 },
      medium: { provider: 1, model: 2 },
      smart: { provider: 1, model: 3 }
    });
    assert.equal((await client.settings.getLlmSettings.query({})).smart?.model, 3);
    assert.equal((await client.auth.connections.query({})).chatgpt, undefined);
    const project = await client.projects.createProject.mutate({
      name: 'Calendar'
    });

    await assert.rejects(
      client.projects.setExam.mutate({
        id: project.id,
        examOn: '2026-02-29'
      }),
      hasCode('BAD_REQUEST')
    );
    assert.equal(
      (
        await client.projects.setExam.mutate({
          id: project.id,
          examOn: '2028-02-29'
        })
      ).value,
      true
    );
  } finally {
    await f.close();
  }
});

test(
  'closing the listener cancels SSE, sign-in and an incomplete HTTP body',
  { timeout: 5000 },
  async () => {
    const f = await fixture();
    const client = nativeClient({ baseUrl: f.server.url });
    const endpoint = new URL(f.server.url);
    const socket = createConnection({
      host: endpoint.hostname,
      port: Number(endpoint.port)
    });
    let subscription: { unsubscribe(): void } | undefined;

    try {
      await once(socket, 'connect', { signal: AbortSignal.timeout(2000) });
      socket.resume();
      const attempt = await client.auth.startChatgptSignIn.mutate({});
      const pending = client.auth.finishChatgptSignIn
        .mutate({ attemptId: attempt.attemptId })
        .catch(() => {});

      await new Promise<void>((resolve, reject) => {
        subscription = client.system.subscribe.subscribe(
          {},
          { onData: () => resolve(), onError: reject }
        );
      });
      socket.write(
        `POST /trpc/projects.createProject HTTP/1.1\r\nHost: ${endpoint.host}\r\nContent-Type: application/json\r\nContent-Length: 1000000\r\n\r\n{`
      );
      const disconnected = new Promise<void>((resolve) => socket.once('close', () => resolve()));

      socket.on('error', (error: NodeJS.ErrnoException) => assert.equal(error.code, 'ECONNRESET'));
      await f.server.close();
      await pending;
      await disconnected;
      assert.equal(socket.destroyed, true);
      assert.equal(f.app.signInStatus().signedIn, false);
    } finally {
      subscription?.unsubscribe();
      socket.destroy();
      await f.close();
    }
  }
);

test('stored browser uploads attach to messages and stay scoped to their project', async () => {
  const f = await fixture();

  try {
    const client = browserClient({
      baseUrl: f.server.url
    });
    const one = await client.projects.createProject.mutate({ name: 'One' });
    const two = await client.projects.createProject.mutate({ name: 'Two' });
    const session = await client.conversations.createSession.mutate({
      project: one.id,
      title: 'One'
    });
    const upload = await client.sources.uploadSource.mutate({
      project: one.id,
      name: 'notes.txt',
      bytes: new TextEncoder().encode('Physics')
    });
    const message = await client.conversations.postMessage.mutate({
      place: { type: 'timeline', id: session.id },
      attachments: [upload.id!]
    });

    assert.equal(message.parts[0]?.sourceId, upload.id);
    const foreign = await client.sources.createNote.mutate({
      project: two.id,
      title: 'Other',
      text: 'Unrelated'
    });

    await assert.rejects(
      client.conversations.postMessage.mutate({
        place: { type: 'timeline', id: session.id },
        attachments: [foreign.id!]
      }),
      hasCode('BAD_REQUEST')
    );
    assert.equal((await client.conversations.messages.query({ id: session.id! })).items.length, 1);
  } finally {
    await f.close();
  }
});

test('material, flashcard review, practice answers, and typed job controls use persisted domain data', async () => {
  const f = await fixture();

  try {
    const client = nativeClient({
      baseUrl: f.server.url
    });
    const project = await client.projects.createProject.mutate({
      name: 'Physics'
    });
    const session = await client.conversations.createSession.mutate({
      project: project.id,
      title: 'Notes'
    });

    await client.conversations.postMessage.mutate({
      place: { type: 'timeline', id: session.id },
      text: 'Gravity attracts masses.'
    });
    const id = await client.material.updateMaterial.mutate({
      project: project.id,
      kind: 'flashcards'
    });
    const job = dbClaimJob(f.app.store, ['artifact'])!;

    assert.equal(
      dbFinishMaterial(
        f.app.store,
        id.id as ImportedArtifactId,
        job.id,
        job.attempts,
        {
          type: 'flashcards',
          cards: [{ front: 'Gravity?', back: 'Attraction', cites: [] }]
        },
        []
      ),
      true
    );
    assert.equal(
      (await client.material.material.query({ id: project.id! })).items[0]?.current?.id,
      id.id
    );
    const due = await client.practice.dueCards.query({
      project: project.id,
      limit: 10
    });

    assert.equal(due.items.length, 1);
    const card = due.items[0]!.card!;

    assert.equal(
      (await client.practice.review.mutate({ card: card.id, rating: 3 })).value?.reps,
      1
    );
    assert.equal(
      (
        await client.practice.reviewTimes.query({
          project: project.id,
          since: 0n
        })
      ).items.length,
      1
    );
    assert.equal(
      (
        await client.material.setCard.mutate({
          artifact: id.id,
          index: 0,
          change: { type: 'write', front: 'Force?', back: 'Gravity' }
        })
      ).value,
      true
    );
    const practice = await client.practice.projectPractice.mutate({
      id: project.id!
    });
    const questionJob = dbClaimJob(f.app.store, ['question'])!;

    assert.equal(questionJob.target.type, 'question');

    if (questionJob.target.type !== 'question') throw new Error('Wrong target');

    const question = questionJob.target.id;

    dbFinishQuestion(
      f.app.store,
      question,
      questionJob.id,
      questionJob.attempts,
      {
        type: 'choice',
        question: 'Gravity is?',
        choices: ['Attraction', 'Heat', 'Light'],
        answer: 0,
        explanation: 'Mass attracts mass',
        cites: []
      },
      'Gravity',
      []
    );
    const loaded = (await client.practice.practice.query(practice)).value!;

    assert.equal(loaded.questions.find((q) => q.id === question)?.body?.type, 'choice');
    const answered = await client.practice.answerQuestion.mutate({
      id: question,
      answer: { type: 'choice', choice: 0 }
    });

    assert.equal(answered.type, 'graded');
    assert.equal(answered.type === 'graded' ? answered.verdict : null, 'correct');
    assert.equal((await client.practice.practices.query({})).items[0]?.score?.correct, 1);
    const pending = dbListJobs(f.app.store).find(
      (j) => j.kind === 'question' && j.status === 'queued'
    )!;

    assert.equal((await client.jobs.cancelJob.mutate({ id: pending.id })).value, true);
    assert.equal((await client.jobs.retryJob.mutate({ id: pending.id })).value, true);
    assert.equal((await client.material.deleteArtifact.mutate({ id: id.id })).value, true);
    assert.equal((await client.practice.deletePractice.mutate(practice)).value, true);
  } finally {
    await f.close();
  }
});

test('RPC reports current reply and grading work and reanswers wait for attachments', async () => {
  const f = await fixture();

  try {
    const client = nativeClient({
      baseUrl: f.server.url
    });
    const store = f.app.store;
    const project = dbCreateProject(store, 'P'),
      session = dbCreateSession(store, project.id, 'S');
    const source = dbCreateNote(store, 'N', 'body', project.id);
    const user = dbPostMessage(store, {
      sessionId: session.id,
      text: 'Question',
      attachments: [source.id]
    });
    const first = dbRequestReply(store, user.id);

    dbClaimJob(store, ['reply']);
    dbBeginVersion(store, first.versionId, first.jobId, 1n);
    dbFinishVersion(store, first.versionId, first.jobId, 1n, 'First answer');
    dbEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: source.id }
    });
    const again = await client.conversations.reanswer.mutate({
      id: first.messageId
    });

    assert.equal(again.type, 'queued');

    if (again.type !== 'queued') throw new Error('Not queued');

    const loaded = (await client.conversations.messages.query({ id: session.id })).items.find(
      (m) => m.id === first.messageId
    )!;

    assert.equal(loaded.reply?.id, again.jobId);
    assert.equal(dbClaimJob(store, ['reply']), null);

    dbCancelJob(store, dbListJobs(store).find((j) => j.kind === 'extract')!.id);
    const practice = dbCreatePractice(store, project.id);

    for (const job of dbListJobs(store)) if (job.kind === 'question') dbCancelJob(store, job.id);

    const request = dbRequestQuestion(store, practice.id, 'open');
    const job = dbClaimJob(store, ['question'])!;

    dbFinishQuestion(
      store,
      request.questionId,
      job.id,
      job.attempts,
      { type: 'open', question: 'Explain', reference: 'Reference', cites: [] },
      'Gist',
      []
    );
    dbAnswerQuestion(store, request.questionId, {
      type: 'open',
      answer: 'Answer'
    });
    const grade = dbListJobs(store).find((j) => j.kind === 'grade')!;
    const question = (
      await client.practice.practice.query({ id: practice.id })
    ).value?.questions.find((q) => q.id === request.questionId);

    assert.equal(question?.job?.id, grade.id);
  } finally {
    await f.close();
  }
});

test('daily card allowance is consumed across requests and projects', async () => {
  const f = await fixture();

  try {
    const client = nativeClient({
      baseUrl: f.server.url
    });
    const store = f.app.store;

    await client.settings.saveReviewSettings.mutate({ newCardsPerDay: 1 });
    const projects = [dbCreateProject(store, 'A'), dbCreateProject(store, 'B')];

    for (const p of projects) {
      const request = dbRequestMaterial(store, p.id, 'flashcards', 'Cards', []);
      const job = dbClaimJob(store, ['artifact'])!;

      dbFinishMaterial(
        store,
        request.artifactId,
        job.id,
        job.attempts,
        { type: 'flashcards', cards: [{ front: 'Q', back: 'A', cites: [] }] },
        []
      );
    }

    const due = await client.practice.dueCards.query({ limit: 10 });

    assert.equal(due.items.length, 1);
    await client.practice.review.mutate({
      card: due.items[0]!.card!.id,
      rating: 3
    });
    assert.equal((await client.practice.dueCards.query({ limit: 10 })).items.length, 0);
    assert.equal((await client.practice.dueCount.query({})).value, 0);
    assert.equal(
      (
        await client.practice.dueBy.query({
          until: BigInt(Math.floor(Date.now() / 1000))
        })
      ).value,
      0
    );
  } finally {
    await f.close();
  }
});
