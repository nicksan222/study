import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { editMessage as opEditMessage } from '#backend/procedures/conversations/operations/edit-message';
import {
  versionCitations as opVersionCitations,
  message as opMessage,
  listMessages as opListMessages
} from '#backend/procedures/conversations/operations/messages';
import { postMessage as opPostMessage } from '#backend/procedures/conversations/operations/post-message';
import { requestRewrite as opRequestRewrite } from '#backend/procedures/conversations/operations/rewrite-message';
import { setActiveVersion as opSetActiveVersion } from '#backend/procedures/conversations/operations/set-active-version';
import {
  finishVersion as opFinishVersion,
  beginVersion as opBeginVersion
} from '#backend/procedures/conversations/versions';
import { job as opJob } from '#backend/procedures/jobs/operations/job';
import {
  claimJob as opClaimJob,
  recoverJobs as opRecoverJobs
} from '#backend/procedures/jobs/worker';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createNote as opCreateNote } from '#backend/procedures/sources/operations/create-note';
import { deleteSource as opDeleteSource } from '#backend/procedures/sources/operations/delete-source';
import { BackendContext } from '#backend/runtime/context';
import type { SourceId } from '#backend/shared/ids';
import * as core from '#backend/shared/sources/citations';
import type { Citation } from '#backend/shared/sources/citations';
import { createBackendTest } from '#testing/backend-test';

test('citation helpers preserve ordinary brackets and renumber known markers', (_t) => {
  assert.equal(typeof core.citedMarkers, 'function');
  assert.deepEqual(core.citedMarkers('[2] [1, 2][3] [0] [4294967296] [here]', 3), [2, 1, 3]);
  assert.deepEqual(core.citedMarkers('[+2; 1] [3', 3), [2, 1]);
  assert.equal(
    core.renumberCitations('ATP [2], chain [5][2, 9]. [2024] a[+1] [2, 7]', [2, 5, 9], [2, 5]),
    'ATP [1], chain [2][1]. [2024] a[+1] [2, 7]'
  );
  assert.equal(
    core.withoutCitations('Cells [1]. Phases [1, 2][3]. [this] [] [1', [1, 2, 3]),
    'Cells. Phases. [this] [] [1'
  );
});

function fixture(t: TestContext, run: (store: BackendContext, events: undefined[]) => void) {
  const testDatabase = createBackendTest(t, { app: false });
  const store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));
  const events: undefined[] = [];

  store.subscribe(() => events.push(undefined));

  try {
    run(store, events);
  } finally {
    store.close();
  }
}

function citation(sourceId: SourceId | null, marker = 1): Citation {
  return {
    marker,
    sourceId,
    sourceName: 'Snapshot',
    anchor: { type: 'page', page: 2 },
    quote: 'Evidence'
  };
}

test('active version citations survive deletion and edits renumber kept markers', (t) =>
  fixture(t, (store) => {
    const project = opCreateProject(store, 'p'),
      session = opCreateSession(store, project.id, 's');
    const source = opCreateNote(store, 'source', 'evidence');
    const message = opPostMessage(store, {
      sessionId: session.id,
      text: 'initial'
    });
    const initial = message.activeVersionId!;
    const req = opRequestRewrite(store, message.id, 'improve');

    opClaimJob(store, ['rewrite']);
    opBeginVersion(store, req.versionId, req.jobId, 1n);
    opDeleteSource(store, source.id);
    assert.equal(
      opFinishVersion(store, req.versionId, req.jobId, 1n, 'One [2]. Two [5].', [
        citation(source.id, 5),
        citation(null, 2)
      ]),
      true
    );
    assert.deepEqual(opMessage(store, message.id)?.citations, [
      citation(null, 2),
      citation(null, 5)
    ]);
    assert.deepEqual(opListMessages(store, session.id)[0].citations, [
      citation(null, 2),
      citation(null, 5)
    ]);
    const edit = opEditMessage(store, message.id, 'Keep [5], ordinary [2024] and [4, 7].')!;

    assert.equal(
      opMessage(store, message.id)?.versions.find((v) => v.id === edit)?.text,
      'Keep [1], ordinary [2024] and [4, 7].'
    );
    assert.deepEqual(opMessage(store, message.id)?.citations, [citation(null)]);
    opSetActiveVersion(store, message.id, initial);
    assert.deepEqual(opMessage(store, message.id)?.citations, []);
    assert.deepEqual(opVersionCitations(store, req.versionId), [
      citation(null, 2),
      citation(null, 5)
    ]);
    opSetActiveVersion(store, message.id, req.versionId);
    assert.deepEqual(opMessage(store, message.id)?.citations, [
      citation(null, 2),
      citation(null, 5)
    ]);
  }));
test('invalid citations roll back completion and stale owners cannot write citations', (t) =>
  fixture(t, (store, events) => {
    const project = opCreateProject(store, 'p'),
      session = opCreateSession(store, project.id, 's');
    const source = opCreateNote(store, 'source', 'evidence');
    const message = opPostMessage(store, {
      sessionId: session.id,
      text: 'initial'
    });
    const req = opRequestRewrite(store, message.id, 'improve');

    opClaimJob(store, ['rewrite']);
    opBeginVersion(store, req.versionId, req.jobId, 1n);

    for (const citations of [
      [citation(source.id, 0)],
      [citation(source.id, 1.5)],
      [citation(source.id, 4294967296)],
      [citation(source.id), citation(source.id)],
      [citation(-1n as SourceId)]
    ]) {
      const before = events.length;

      assert.throws(
        () => opFinishVersion(store, req.versionId, req.jobId, 1n, 'generated [1]', citations),
        { kind: 'invalid_input' }
      );
      assert.equal(opJob(store, req.jobId)?.status, 'running');
      assert.equal(opMessage(store, message.id)?.versions.at(-1)?.status, 'writing');
      assert.deepEqual(opMessage(store, message.id)?.citations, []);
      assert.equal(events.length, before);
    }

    opRecoverJobs(store);
    opClaimJob(store, ['rewrite']);
    assert.equal(
      opFinishVersion(store, req.versionId, req.jobId, 1n, 'stale', [citation(source.id, 0)]),
      false
    );
    opBeginVersion(store, req.versionId, req.jobId, 2n);
    assert.equal(
      opFinishVersion(store, req.versionId, req.jobId, 2n, 'generated [1]', [citation(source.id)]),
      true
    );
    opDeleteSource(store, source.id);
    assert.deepEqual(opMessage(store, message.id)?.citations, [citation(null)]);
    assert.equal(opJob(store, req.jobId)?.status, 'succeeded');
  }));

test('completion keeps citations on an inactive version without replacing active citations', (t) =>
  fixture(t, (store) => {
    const project = opCreateProject(store, 'p'),
      session = opCreateSession(store, project.id, 's');
    const message = opPostMessage(store, {
      sessionId: session.id,
      text: 'initial'
    });
    const original = message.activeVersionId!;

    opEditMessage(store, message.id, 'base');
    const req = opRequestRewrite(store, message.id, 'improve');

    opClaimJob(store, ['rewrite']);
    opBeginVersion(store, req.versionId, req.jobId, 1n);
    opSetActiveVersion(store, message.id, original);
    assert.equal(
      opFinishVersion(store, req.versionId, req.jobId, 1n, 'generated [1]', [citation(null)]),
      true
    );
    assert.equal(opMessage(store, message.id)?.activeVersionId, original);
    assert.deepEqual(opMessage(store, message.id)?.citations, []);
    assert.deepEqual(opVersionCitations(store, req.versionId), [citation(null)]);
    opSetActiveVersion(store, message.id, req.versionId);
    assert.deepEqual(opMessage(store, message.id)?.citations, [citation(null)]);
  }));
