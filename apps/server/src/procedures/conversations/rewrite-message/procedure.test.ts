import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#server/procedures/conversations/operations/create-session';
import { message as opMessage } from '#server/procedures/conversations/operations/messages';
import { postMessage as opPostMessage } from '#server/procedures/conversations/operations/post-message';
import { requestReply as opRequestReply } from '#server/procedures/conversations/operations/reanswer';
import {
  beginVersion as opBeginVersion,
  finishVersion as opFinishVersion
} from '#server/procedures/conversations/versions';
import { listJobs as opListJobs } from '#server/procedures/jobs/operations/job-overviews';
import { claimJob as opClaimJob, finishJob as opFinishJob } from '#server/procedures/jobs/worker';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { createServerTest } from '#testing/server-test';
test('rewriteMessage queues a rewrite on an assistant answer and validates its action', async (t) => {
  const f = await createServerTest(t);
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
