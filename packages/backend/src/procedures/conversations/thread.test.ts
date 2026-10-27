import assert from 'node:assert/strict';
import test from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { createNote as opCreateNote } from '#backend/procedures/sources/create-note';
import { fixture } from '#testing/procedures';

import { createSession as opCreateSession } from './create-session.ts';
import { postMessage as opPostMessage } from './post-message.ts';
test('thread returns replies for an attached source part and empty for a missing part', async (t) => {
  const f = await fixture(t);
  const session = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const source = opCreateNote(f.store, 'Notes', 'Body');
  const root = opPostMessage(f.store, {
    sessionId: session.id,
    text: 'Root',
    attachments: [source.id]
  });
  const part = root.parts[0]!;

  opPostMessage(f.store, {
    sessionId: session.id,
    text: 'Reply',
    threadRoot: part.id
  });
  const result = await f.caller.conversations.thread({
    id: part.id
  });

  assert.equal(result.value?.replies.length, 1);
  assert.equal(result.value?.root?.id, part.id);
  assert.equal(
    (
      await f.caller.conversations.thread({
        id: 999999n
      })
    ).value,
    null
  );
});
