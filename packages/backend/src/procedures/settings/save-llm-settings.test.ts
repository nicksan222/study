import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as dbCreateSession } from '#backend/procedures/conversations/create-session';
import { job as dbJob } from '#backend/procedures/jobs/job';
import {
  enqueueJob as dbEnqueueJob,
  claimJob as dbClaimJob,
  failJob as dbFailJob
} from '#backend/procedures/jobs/worker';
import { createProject as dbCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { loadPreferences as dbLoadPreferences } from './preferences.ts';
test('saveLlmSettings persists valid tiers, releases waiting jobs, and rejects incomplete configuration', async (t) => {
  const f = await fixture(t);
  const p = dbCreateProject(f.store, 'P'),
    s = dbCreateSession(f.store, p.id, 'S');
  const id = dbEnqueueJob(f.store, {
    kind: 'title',
    target: {
      type: 'session',
      id: s.id
    }
  });
  const claim = dbClaimJob(f.store, ['title'])!;

  dbFailJob(f.store, id, claim.attempts, {
    kind: 'config',
    message: 'Choose model',
    retryAfterMs: null
  });
  await f.caller.settings.saveLlmSettings({
    tiny: {
      provider: 1,
      model: 1
    },
    medium: {
      provider: 1,
      model: 2
    },
    smart: {
      provider: 1,
      model: 3
    }
  });
  assert.equal(dbLoadPreferences(f.store, 'llm').smart, 3);
  assert.equal(dbJob(f.store, id)?.status, 'queued');
  await assert.rejects(f.caller.settings.saveLlmSettings({} as never), {
    kind: 'invalid_input'
  });
  assert.equal(dbLoadPreferences(f.store, 'llm').smart, 3);
});
