import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { deleteMessage as opDeleteMessage } from '#backend/procedures/conversations/operations/delete-message';
import { editMessage as opEditMessage } from '#backend/procedures/conversations/operations/edit-message';
import { message as opMessage } from '#backend/procedures/conversations/operations/messages';
import { postMessage as opPostMessage } from '#backend/procedures/conversations/operations/post-message';
import { requestReply as opRequestReply } from '#backend/procedures/conversations/operations/reanswer';
import {
  createPendingVersion as opCreatePendingVersion,
  requestRewrite as opRequestRewrite
} from '#backend/procedures/conversations/operations/rewrite-message';
import { setActiveVersion as opSetActiveVersion } from '#backend/procedures/conversations/operations/set-active-version';
import { thread as opThread } from '#backend/procedures/conversations/operations/thread';
import {
  beginVersion as opBeginVersion,
  finishVersion as opFinishVersion
} from '#backend/procedures/conversations/versions';
import { cancelJob as opCancelJob } from '#backend/procedures/jobs/operations/cancel-job';
import { job as opJob } from '#backend/procedures/jobs/operations/job';
import { listJobs as opListJobs } from '#backend/procedures/jobs/operations/job-overviews';
import {
  enqueueJob as opEnqueueJob,
  claimJob as opClaimJob,
  recoverJobs as opRecoverJobs,
  finishJob as opFinishJob,
  failJob as opFailJob,
  releaseWaiting as opReleaseWaiting
} from '#backend/procedures/jobs/worker';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { appendRecording as opAppendRecording } from '#backend/procedures/recordings/operations/append-recording';
import { createRecording as opCreateRecording } from '#backend/procedures/recordings/operations/create-recording';
import { deleteRecording as opDeleteRecording } from '#backend/procedures/recordings/operations/delete-recording';
import { postRecording as opPostRecording } from '#backend/procedures/recordings/operations/post-recording';
import {
  recordingSamples as opRecordingSamples,
  recording as opRecording
} from '#backend/procedures/recordings/operations/recording';
import { listRecordings as opListRecordings } from '#backend/procedures/recordings/operations/recordings';
import { createNote as opCreateNote } from '#backend/procedures/sources/operations/create-note';
import { deleteSource as opDeleteSource } from '#backend/procedures/sources/operations/delete-source';
import {
  source as opSource,
  sourceBytes as opSourceBytes
} from '#backend/procedures/sources/operations/source';
import { BackendContext } from '#backend/runtime/context';
import { createBackendTest } from '#testing/backend-test';

test('message versions, attachments, threads and recordings persist', (t) => {
  const testDatabase = createBackendTest(t, { app: false });
  const store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      s = opCreateSession(store, p.id, 'Chat'),
      src = opCreateNote(store, 'N', 'content');
    const msg = opPostMessage(store, {
      sessionId: s.id,
      text: 'hello',
      attachments: [src.id]
    });

    assert.equal(msg.versions[0].text, 'hello');
    assert.equal(msg.parts[0].sourceId, src.id);
    const version = opEditMessage(store, msg.id, 'hello again')!;

    assert.equal(opMessage(store, msg.id)?.activeVersionId, version);
    assert.equal(opMessage(store, msg.id)?.versions.length, 2);
    const thread = opPostMessage(store, {
      sessionId: s.id,
      text: 'inside',
      threadRoot: msg.parts[0].id
    });

    assert.equal(opThread(store, msg.parts[0].id)?.messages[0].id, thread.id);
    opDeleteSource(store, src.id);
    assert.equal(opMessage(store, msg.id)?.parts[0].sourceId, null);
    const rec = opCreateRecording(store, s.id);

    opAppendRecording(store, rec.id, new Int16Array([1, 2, -3]));
    assert.deepEqual([...opRecordingSamples(store, rec.id)], [1, 2, -3]);
    assert.equal(opDeleteRecording(store, rec.id), true);
    opDeleteMessage(store, msg.id);
    assert.equal(opMessage(store, thread.id), null);
  } finally {
    store.close();
  }
});
test('generated versions activate only if the base version is still active', (t) => {
  const testDatabase = createBackendTest(t, { app: false });
  const store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      s = opCreateSession(store, p.id, 'S'),
      msg = opPostMessage(store, { sessionId: s.id, text: 'first' });
    const original = msg.activeVersionId!;

    opEditMessage(store, msg.id, 'changed');
    const pending = opCreatePendingVersion(store, msg.id, 'improve')!;
    const job = opEnqueueJob(store, {
      kind: 'rewrite',
      target: { type: 'message', id: msg.id },
      args: { versionId: pending.toString() }
    });

    opClaimJob(store, ['rewrite']);
    assert.equal(opBeginVersion(store, pending, job, 1n), true);
    assert.equal(opSetActiveVersion(store, msg.id, original), true);
    assert.equal(opFinishVersion(store, pending, job, 1n, 'generated'), true);
    assert.equal(opMessage(store, msg.id)?.activeVersionId, original);
    assert.equal(opSetActiveVersion(store, msg.id, pending), true);
    assert.equal(opMessage(store, msg.id)?.activeVersionId, pending);
  } finally {
    store.close();
  }
});

test('version writing follows current job attempt and commits completion with job', (t) => {
  const testDatabase = createBackendTest(t, { app: false });
  const store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      session = opCreateSession(store, p.id, 'S'),
      message = opPostMessage(store, { sessionId: session.id, text: 'hi' });
    const v = opCreatePendingVersion(store, message.id, 'improve')!;
    const j = opEnqueueJob(store, {
      kind: 'rewrite',
      target: { type: 'message', id: message.id },
      args: { versionId: v.toString() }
    });

    opClaimJob(store, ['rewrite']);
    assert.equal(opBeginVersion(store, v, j, 1n), true);
    opRecoverJobs(store);
    opClaimJob(store, ['rewrite']);
    assert.equal(opFinishVersion(store, v, j, 1n, 'stale'), false);
    assert.equal(opBeginVersion(store, v, j, 2n), true);
    assert.throws(() =>
      store.transaction(() => {
        assert.equal(opFinishVersion(store, v, j, 2n, 'fresh'), true);

        throw Error('rollback');
      })
    );
    assert.equal(opJob(store, j)?.status, 'running');
    assert.equal(opMessage(store, message.id)?.versions.find((x) => x.id === v)?.status, 'writing');
    assert.equal(opFinishVersion(store, v, j, 2n, 'fresh'), true);
    assert.equal(opJob(store, j)?.status, 'succeeded');
  } finally {
    store.close();
  }
});
test('assistant replies only to user messages in the same session and thread', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      a = opCreateSession(store, p.id, 'A'),
      b = opCreateSession(store, p.id, 'B'),
      user = opPostMessage(store, { sessionId: a.id, text: 'u' });

    assert.throws(() =>
      opPostMessage(store, {
        sessionId: b.id,
        role: 'assistant',
        replyTo: user.id,
        text: 'bad'
      })
    );
    const answer = opPostMessage(store, {
      sessionId: a.id,
      role: 'assistant',
      replyTo: user.id,
      text: 'yes'
    });

    assert.throws(() =>
      opPostMessage(store, {
        sessionId: a.id,
        role: 'assistant',
        replyTo: answer.id,
        text: 'bad'
      })
    );
  } finally {
    store.close();
  }
});
test('recording chunks are bounded before allocation', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      s = opCreateSession(store, p.id, 'S'),
      rec = opCreateRecording(store, s.id);

    assert.throws(() => opAppendRecording(store, rec.id, new Int16Array(16000 * 61)));
    assert.equal(opRecordingSamples(store, rec.id).length, 0);
  } finally {
    store.close();
  }
});
test('recording lookup and posting create a WAV attachment atomically', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      session = opCreateSession(store, p.id, 'S'),
      rec = opCreateRecording(store, session.id);

    opAppendRecording(store, rec.id, new Int16Array([1, -1]));
    assert.equal(opRecording(store, rec.id)?.sessionId, session.id);
    assert.equal(opListRecordings(store).length, 1);
    const msg = opPostRecording(store, rec.id, 'lecture.wav');

    assert.equal(msg.parts.length, 1);
    const source = opSource(store, msg.parts[0].sourceId!)!;

    assert.equal(source.kind, 'audio');
    const bytes = Buffer.from(opSourceBytes(store, source.id)!);

    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readInt16LE(44), 1);
    assert.equal(opRecording(store, rec.id), null);
  } finally {
    store.close();
  }
});
test('reply and rewrite requests enqueue their version atomically', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      s = opCreateSession(store, p.id, 'S'),
      user = opPostMessage(store, { sessionId: s.id, text: 'hi' });
    const reply = opRequestReply(store, user.id);

    assert.equal(opMessage(store, reply.messageId)?.replyTo, user.id);
    assert.equal(opJob(store, reply.jobId)?.target.id, reply.messageId);
    assert.equal(opMessage(store, reply.messageId)?.versions[0].id, reply.versionId);
    const rewrite = opRequestRewrite(store, user.id, 'improve');

    assert.equal(opJob(store, rewrite.jobId)?.kind, 'rewrite');
    assert.equal(opMessage(store, user.id)?.versions.at(-1)?.id, rewrite.versionId);
    assert.throws(() =>
      store.transaction(() => {
        opRequestReply(store, user.id);

        throw Error('rollback');
      })
    );
    assert.equal(opListJobs(store).length, 2);
  } finally {
    store.close();
  }
});
test('notes taken during a recording retain their timestamp and posted source', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      s = opCreateSession(store, p.id, 'S'),
      rec = opCreateRecording(store, s.id);

    opAppendRecording(store, rec.id, new Int16Array([1, 2]));
    const note = opPostMessage(store, {
      sessionId: s.id,
      text: 'note',
      recordingId: rec.id,
      recordingMs: 123n
    });
    const posted = opPostRecording(store, rec.id, 'audio.wav');
    const updated = opMessage(store, note.id)!;

    assert.equal(updated.recordingMs, 123n);
    assert.equal(updated.recordingId, null);
    assert.equal(updated.recordedIn, posted.parts[0].sourceId);
  } finally {
    store.close();
  }
});
test('generic finish cannot bypass generated version completion', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'p'),
      s = opCreateSession(store, p.id, 's'),
      m = opPostMessage(store, { sessionId: s.id, text: 'hi' });
    const req = opRequestRewrite(store, m.id, 'improve');

    opClaimJob(store, ['rewrite']);
    assert.equal(opBeginVersion(store, req.versionId, req.jobId, 1n), true);
    assert.equal(opFinishJob(store, req.jobId, 1n), false);
    assert.equal(opJob(store, req.jobId)?.status, 'running');
    assert.equal(opMessage(store, m.id)?.versions.at(-1)?.status, 'writing');
    assert.equal(opFinishVersion(store, req.versionId, req.jobId, 1n, 'done'), true);
  } finally {
    store.close();
  }
});
test('cancelled or edited generated work can be replaced and stale workers are fenced', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'p'),
      s = opCreateSession(store, p.id, 's'),
      m = opPostMessage(store, { sessionId: s.id, text: 'hi' });
    const old = opRequestRewrite(store, m.id, 'improve');

    opClaimJob(store, ['rewrite']);
    opBeginVersion(store, old.versionId, old.jobId, 1n);
    opCancelJob(store, old.jobId);
    const next = opRequestRewrite(store, m.id, 'summarize');

    assert.equal(opJob(store, old.jobId), null);
    assert.equal(opFinishVersion(store, old.versionId, old.jobId, 1n, 'stale'), false);
    opClaimJob(store, ['rewrite']);
    opBeginVersion(store, next.versionId, next.jobId, 1n);
    opEditMessage(store, m.id, 'edited');
    assert.equal(opJob(store, next.jobId), null);
    assert.equal(opFinishVersion(store, next.versionId, next.jobId, 1n, 'stale'), false);
    const third = opRequestRewrite(store, m.id, 'improve');

    assert.ok(opJob(store, third.jobId));
  } finally {
    store.close();
  }
});
test('replacement rollback restores unfinished version and job without publishing', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'p'),
      s = opCreateSession(store, p.id, 's'),
      m = opPostMessage(store, { sessionId: s.id, text: 'hi' });
    const old = opRequestRewrite(store, m.id, 'improve');
    const events: unknown[] = [];

    store.subscribe(() => events.push(undefined));
    assert.throws(() =>
      store.transaction(() => {
        opRequestRewrite(store, m.id, 'summarize');

        throw Error('rollback');
      })
    );
    assert.equal(opJob(store, old.jobId)?.status, 'queued');
    assert.equal(opMessage(store, m.id)?.versions.at(-1)?.id, old.versionId);
    assert.equal(events.length, 0);
  } finally {
    store.close();
  }
});
test('replacing pending work refreshes and releases dependents after commit', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'p'),
      s = opCreateSession(store, p.id, 's'),
      m = opPostMessage(store, { sessionId: s.id, text: 'hi' }),
      src = opCreateNote(store, 'n', 'text');
    const old = opRequestRewrite(store, m.id, 'improve');
    const dep = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: src.id },
      after: [old.jobId]
    });
    const events: undefined[] = [];

    store.subscribe(() => events.push(undefined));
    store.transaction(() => {
      opRequestRewrite(store, m.id, 'summarize');
      assert.equal(events.length, 0);
    });
    assert.equal(opJob(store, old.jobId), null);
    assert.equal(opJob(store, dep)?.status, 'queued');
    assert.ok(events.length > 0);
  } finally {
    store.close();
  }
});
test('generated jobs still support classified failures and retries', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'p'),
      s = opCreateSession(store, p.id, 's'),
      m = opPostMessage(store, { sessionId: s.id, text: 'hi' }),
      req = opRequestRewrite(store, m.id, 'improve');

    opClaimJob(store, ['rewrite']);
    opBeginVersion(store, req.versionId, req.jobId, 1n);
    assert.equal(
      opFailJob(store, req.jobId, 1n, {
        kind: 'auth',
        message: 'sign in',
        retryAfterMs: null
      }),
      true
    );
    assert.equal(opJob(store, req.jobId)?.status, 'waiting');
    opReleaseWaiting(store);
    opClaimJob(store, ['rewrite']);
    assert.equal(opBeginVersion(store, req.versionId, req.jobId, 2n), true);
    assert.equal(opFinishVersion(store, req.versionId, req.jobId, 2n, 'done'), true);
  } finally {
    store.close();
  }
});

test('reply and rewrite wait for attachment reads', (t) =>
  fixture(t, (store) => {
    const project = opCreateProject(store, 'P'),
      session = opCreateSession(store, project.id, 'S');
    const source = opCreateNote(store, 'N', 'body');
    const read = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: source.id }
    });
    const message = opPostMessage(store, {
      sessionId: session.id,
      text: 'Explain',
      attachments: [source.id]
    });
    const rewrite = opRequestRewrite(store, message.id, 'improve');
    const reply = opRequestReply(store, message.id);

    assert.equal(opClaimJob(store, ['reply', 'rewrite']), null);
    opClaimJob(store, ['extract']);
    opFinishJob(store, read, 1n);
    assert.equal(opJob(store, rewrite.jobId)?.status, 'queued');
    assert.equal(opJob(store, reply.jobId)?.status, 'queued');
  }));

test('message text is normalized and bounded before state changes', (t) =>
  fixture(t, (store) => {
    const project = opCreateProject(store, 'P'),
      session = opCreateSession(store, project.id, 'S');

    assert.throws(() => opPostMessage(store, { sessionId: session.id, text: 'x'.repeat(100001) }));
    const message = opPostMessage(store, {
      sessionId: session.id,
      text: ' a\r\nb\rc '
    });

    assert.equal(message.versions[0].text, 'a\r\nb\rc');
    assert.throws(() => opEditMessage(store, message.id, 'x'.repeat(100001)));
    assert.throws(() => opRequestRewrite(store, message.id, 'instruction', 'x'.repeat(100001)));
    const request = opRequestRewrite(store, message.id, 'improve');

    opClaimJob(store, ['rewrite']);
    opBeginVersion(store, request.versionId, request.jobId, 1n);

    for (const text of ['  ', 'x'.repeat(100001)])
      assert.throws(() => opFinishVersion(store, request.versionId, request.jobId, 1n, text));

    assert.equal(opJob(store, request.jobId)?.status, 'running');
  }));

function fixture(t: TestContext, run: (store: BackendContext) => void) {
  const testDatabase = createBackendTest(t, { app: false });
  const store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    run(store);
  } finally {
    store.close();
  }
}
