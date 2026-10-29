import assert from 'node:assert/strict';
import test from 'node:test';

import * as schema from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { createSession as opCreateSession } from '#server/procedures/conversations/operations/create-session';
import { listMessages as opListMessages } from '#server/procedures/conversations/operations/messages';
import { postMessage as opPostMessage } from '#server/procedures/conversations/operations/post-message';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { createNote } from '#server/procedures/sources/operations/create-note';
import { createServerTest } from '#testing/server-test';
test('messages returns timeline entries in order', async (t) => {
  const f = await createServerTest(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');

  opPostMessage(f.store, {
    sessionId: s.id,
    text: 'First'
  });
  opPostMessage(f.store, {
    sessionId: s.id,
    text: 'Second'
  });
  const out = await f.caller.conversations.messages({
    id: s.id
  });

  assert.deepEqual(
    out.items.map((m) => m.id),
    opListMessages(f.store, s.id).map((m) => m.id)
  );
  assert.deepEqual(
    opListMessages(f.store, s.id).map(
      (m) => m.versions.find((v) => v.id === m.activeVersionId)?.text
    ),
    ['First', 'Second']
  );
  assert.deepEqual(
    (
      await f.caller.conversations.messages({
        id: 999999n
      })
    ).items,
    []
  );
});

test('message parts summarize only their own thread and preserve last reply order', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'One');
  const session = opCreateSession(f.store, project.id, 'Chat');
  const source = createNote(f.store, 'Notes', 'Body', project.id);
  const root = opPostMessage(f.store, {
    sessionId: session.id,
    text: '',
    attachments: [source.id, source.id]
  });
  const firstPart = root.parts[0]!;
  const secondPart = root.parts[1]!;
  const first = opPostMessage(f.store, {
    sessionId: session.id,
    threadRoot: firstPart.id,
    text: 'First'
  });
  const latest = opPostMessage(f.store, {
    sessionId: session.id,
    threadRoot: firstPart.id,
    text: 'Last'
  });

  opPostMessage(f.store, { sessionId: session.id, threadRoot: secondPart.id, text: 'Other' });
  f.store.transaction(() => {
    f.store.db.orm
      .update(schema.messages)
      .set({ created_at: 200n })
      .where(eq(schema.messages.id, first.id))
      .run();
    f.store.db.orm
      .update(schema.messages)
      .set({ created_at: 100n })
      .where(eq(schema.messages.id, latest.id))
      .run();
  });
  const result = await f.caller.conversations.messages({ id: session.id });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0]?.parts[0]?.thread, { replies: 2n, lastReplyAt: 100n });
  assert.equal(result.items[0]?.parts[1]?.thread.replies, 1n);
  assert.equal(result.items[0]?.activeVersion, root.activeVersionId);
  assert.equal(result.items[0]?.reply, null);
});
