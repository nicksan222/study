import assert from 'node:assert/strict';
import test from 'node:test';

import { listJobs as opListJobs } from '#backend/procedures/jobs/job-overviews';
import { claimJob as opClaimJob, finishJob as opFinishJob } from '#backend/procedures/jobs/worker';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createSession as opCreateSession } from './create-session.ts';
import { message as opMessage } from './messages.ts';
import { postMessage as opPostMessage } from './post-message.ts';
import { requestReply as opRequestReply } from './reanswer.ts';
import { beginVersion as opBeginVersion, finishVersion as opFinishVersion } from './versions.ts';
test('reanswer queues another answer only after a completed answer', async (t) => {
  const f = await fixture(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const user = opPostMessage(f.store, {
    sessionId: s.id,
    text: 'Question'
  });
  const initial = opRequestReply(f.store, user.id);
  const initialJob = opClaimJob(f.store, ['reply']);

  assert.ok(initialJob);
  assert.equal(
    opBeginVersion(f.store, initial.versionId, initialJob.id, initialJob.attempts),
    true
  );
  assert.equal(
    opFinishVersion(f.store, initial.versionId, initialJob.id, initialJob.attempts, 'First answer'),
    true
  );
  opFinishJob(f.store, initialJob.id, initialJob.attempts);
  const answer = opMessage(f.store, initial.messageId)!;
  const queued = await f.caller.conversations.reanswer({
    id: answer.id
  });

  assert.equal(queued.type, 'queued');
  assert.equal(
    opListJobs(f.store).filter(
      (j) =>
        j.kind === 'reply' &&
        j.target.type === 'message' &&
        j.target.id === answer.id &&
        ['queued', 'blocked', 'waiting', 'running'].includes(j.status)
    ).length,
    1
  );
  assert.equal(opMessage(f.store, answer.id)?.versions.length, 2);
  assert.equal(
    opMessage(f.store, answer.id)?.versions.some((v) => v.status === 'pending'),
    true
  );
  const busy = await f.caller.conversations.reanswer({
    id: answer.id
  });

  assert.equal(busy.type, 'busy');
  const unavailable = await f.caller.conversations.reanswer({
    id: user.id
  });

  assert.equal(unavailable.type, 'unavailable');
});
