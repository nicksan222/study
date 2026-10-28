import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { postMessage as opPostMessage } from '#backend/procedures/conversations/operations/post-message';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createNote as opCreateNote } from '#backend/procedures/sources/operations/create-note';
import { createBackendTest } from '#testing/backend-test';
test('thread returns replies for an attached source part and empty for a missing part', async (t) => {
  const f = await createBackendTest(t);
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
