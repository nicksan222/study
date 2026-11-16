import { test } from '@study/testing';
import { Schema } from 'effect';

import { replySnapshotSchema } from '../src/notes/schemas.ts';

test.stable(
  'conversion provenance requires its captured target and cannot decorate other operations',
  ({ expect }) => {
    const decode = Schema.decodeUnknownSync(replySnapshotSchema);
    const snapshot = {
      requestId: 'conversion',
      noteId: 1n,
      messageId: 2n,
      versionId: 4n,
      contextRevision: 1n,
      messages: [{ messageId: 2n, versionId: 3n, role: 'user', text: 'Original', attachments: [] }],
      generation: {
        origin: 'convert',
        instruction: null,
        conversion: { strategyId: 'chatgpt', baseVersionId: 3n }
      }
    };

    expect(decode(snapshot).generation?.origin).toBe('convert');

    for (const generation of [
      { ...snapshot.generation, conversion: undefined },
      { ...snapshot.generation, origin: 'improve' },
      { ...snapshot.generation, questionVersionId: 3n },
      { ...snapshot.generation, conversion: { strategyId: 'chatgpt', baseVersionId: 9n } }
    ])
      expect(() => decode({ ...snapshot, generation })).toThrow();
  }
);
