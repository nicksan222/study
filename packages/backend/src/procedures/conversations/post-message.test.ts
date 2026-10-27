import assert from 'node:assert/strict';
import test from 'node:test';

import { listJobs as opListJobs } from '#backend/procedures/jobs/job-overviews';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { createNote as opCreateNote } from '#backend/procedures/sources/create-note';
import { source as opSource } from '#backend/procedures/sources/source';
import { fixture } from '#testing/procedures';

import { createSession as opCreateSession } from './create-session.ts';
import { createUntitledSession as opCreateUntitledSession } from './create-untitled-session.ts';
import { listMessages as opListMessages } from './messages.ts';
test('postMessage attaches an unassigned source and requests assistant replies', async (t) => {
  const f = await fixture(t);
  const project = opCreateProject(f.store, 'One');
  const session = opCreateUntitledSession(f.store, project.id, 'Chat');
  const source = opCreateNote(f.store, 'Notes', 'Source body');
  const out = await f.caller.conversations.postMessage({
    place: {
      type: 'timeline',
      id: session.id
    },
    text: '@study Explain this',
    files: [],
    attachments: [source.id]
  });

  assert.equal(out.versions[0]?.text, '@study Explain this');
  const posted = opListMessages(f.store, session.id);

  assert.equal(posted.length, 2);
  assert.equal(
    posted.some(
      (message) =>
        message.role === 'assistant' &&
        message.versions.some((version) => version.status === 'pending')
    ),
    true
  );
  assert.equal(opSource(f.store, source.id)?.projectId, project.id);
  assert.equal(
    opListJobs(f.store).some((job) => job.kind === 'reply'),
    true
  );
});
test('postMessage rejects invalid destinations and rolls back foreign attachments', async (t) => {
  const f = await fixture(t);
  const project = opCreateProject(f.store, 'One');
  const session = opCreateSession(f.store, project.id, 'Chat');
  const otherProject = opCreateProject(f.store, 'Other');
  const foreign = opCreateNote(f.store, 'Private', 'Other project', otherProject.id);

  await assert.rejects(
    f.caller.conversations.postMessage({
      text: 'Hi',
      files: [],
      attachments: []
    } as never),
    (error: { kind?: string }) => error.kind === 'invalid_input'
  );
  await assert.rejects(
    f.caller.conversations.postMessage({
      place: {
        type: 'timeline',
        id: session.id
      },
      text: 'Hi',
      files: [],
      attachments: [foreign.id]
    }),
    (error: { kind?: string }) => error.kind === 'invalid_input'
  );
  assert.equal(opListMessages(f.store, session.id).length, 0);
  assert.equal(opSource(f.store, foreign.id)?.projectId, otherProject.id);
});
