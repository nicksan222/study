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
test('rewriteMessage queues a rewrite on an assistant answer and validates its action', async (t) => {
  const f = await fixture(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const user = opPostMessage(f.store, {
    sessionId: s.id,
    text: 'Question'
  });
  const pending = opRequestReply(f.store, user.id);
  const replyJob = opClaimJob(f.store, ['reply']);

  assert.ok(replyJob);
  opBeginVersion(f.store, pending.versionId, replyJob.id, replyJob.attempts);
  opFinishVersion(f.store, pending.versionId, replyJob.id, replyJob.attempts, 'Answer');
  opFinishJob(f.store, replyJob.id, replyJob.attempts);
  const answer = opMessage(f.store, pending.messageId)!;
  const out = await f.caller.conversations.rewriteMessage({
    id: answer.id,
    how: {
      type: 'instruction',
      instruction: 'Use simpler wording'
    }
  });

  assert.equal(out.type, 'queued');
  assert.equal(
    opListJobs(f.store).some(
      (j) => j.kind === 'rewrite' && j.target.type === 'message' && j.target.id === answer.id
    ),
    true
  );
  await assert.rejects(
    f.caller.conversations.rewriteMessage({
      id: answer.id,
      how: {
        type: undefined
      }
    } as never),
    (error: { kind?: string }) => error.kind === 'invalid_input'
  );
  await assert.rejects(
    f.caller.conversations.rewriteMessage({
      id: answer.id,
      how: {
        type: 'instruction',
        instruction: '  '
      }
    }),
    (error: { kind?: string }) => error.kind === 'invalid_input'
  );
});
