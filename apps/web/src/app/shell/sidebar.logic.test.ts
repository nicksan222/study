import { searchResultSchema } from '@study/contracts/system/schemas';
import { Schema } from 'effect';
import { expect, it } from 'vite-plus/test';

import { filterSearchHits } from './sidebar.logic';

it('includes messages in session filters and excludes other kinds', () => {
  const hits = Schema.decodeUnknownSync(searchResultSchema)({
    semantic: true,
    hits: [
      {
        kind: 'session',
        title: 'Session',
        at: 0n,
        target: { type: 'session', projectId: 1n, sessionId: 1n }
      },
      {
        kind: 'message',
        title: 'Message',
        at: 0n,
        target: { type: 'session', projectId: 1n, sessionId: 1n }
      },
      { kind: 'project', title: 'Project', at: 0n, target: { type: 'project', id: 1n } }
    ]
  }).hits;

  expect(filterSearchHits(hits, 'session').map((hit) => hit.title)).toEqual(['Session', 'Message']);
  expect(filterSearchHits(hits, 'all')).toHaveLength(3);
});
