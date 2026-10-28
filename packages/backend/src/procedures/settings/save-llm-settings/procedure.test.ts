import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as dbCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { job as dbJob } from '#backend/procedures/jobs/operations/job';
import {
  enqueueJob as dbEnqueueJob,
  claimJob as dbClaimJob,
  failJob as dbFailJob
} from '#backend/procedures/jobs/worker';
import { createProject as dbCreateProject } from '#backend/procedures/projects/operations/create-project';
import { loadPreferences as dbLoadPreferences } from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';

test('saveLlmSettings persists valid tiers, releases waiting jobs, and rejects incomplete configuration', async (t) => {
  const f = await createBackendTest(t);
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
  const incomplete = {
    tiny: { provider: 1, model: 1 },
    medium: { provider: 1, model: 2 },
    smart: { provider: 1, model: 3 }
  } as const;

  Reflect.deleteProperty(incomplete, 'tiny');
  Reflect.deleteProperty(incomplete, 'medium');
  Reflect.deleteProperty(incomplete, 'smart');
  await assert.rejects(f.caller.settings.saveLlmSettings(incomplete), {
    kind: 'invalid_input'
  });

  assert.equal(dbLoadPreferences(f.store, 'llm').smart, 3);
});

test('saveLlmSettings accepts omitted and undefined models and rejects null', async (t) => {
  const f = await createBackendTest(t);

  await f.caller.settings.saveLlmSettings({
    tiny: { provider: 1 },
    medium: { provider: 1, model: undefined },
    smart: { provider: 1, model: 3 }
  });

  assert.equal(dbLoadPreferences(f.store, 'llm').tiny, null);
  assert.equal(dbLoadPreferences(f.store, 'llm').medium, null);
  assert.equal(dbLoadPreferences(f.store, 'llm').smart, 3);
  const invalid = {
    tiny: { provider: 1, model: 1 },
    medium: { provider: 1, model: 2 },
    smart: { provider: 1, model: 3 }
  } as const;

  Object.defineProperty(invalid.tiny, 'model', { value: null });
  await assert.rejects(f.caller.settings.saveLlmSettings(invalid), { code: 'BAD_REQUEST' });
  assert.equal(dbLoadPreferences(f.store, 'llm').tiny, null);
  assert.equal(dbLoadPreferences(f.store, 'llm').medium, null);
  assert.equal(dbLoadPreferences(f.store, 'llm').smart, 3);
});
