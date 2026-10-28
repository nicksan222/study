import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  saveDocument,
  document as readDocument
} from '#backend/procedures/sources/operations/source-document';
import { createBackendTest } from '#testing/backend-test';
import { document } from '#testing/procedures';

import { replacePassages } from './index.ts';
import { search } from './operations/search.ts';

test('ordinary passage search excludes older extraction text but retains document history', async (t) => {
  const f = await createBackendTest(t);
  const project = await f.caller.projects.createProject({ name: 'Snapshots' });
  const source = await f.caller.sources.createNote({
    project: project.id,
    title: 'Notes',
    text: 'Original bytes'
  });
  const snapshot = (text: string) => {
    const doc = { ...document, blocks: document.blocks.map((block) => ({ ...block, text })) };
    const id = saveDocument(f.store, source.id, doc);

    replacePassages(f.store, id, [
      { firstBlock: 0, lastBlock: 0, anchor: doc.blocks[0]!.anchor, text }
    ]);

    return id;
  };
  const old = snapshot('Obsolete fossils');

  assert.equal(search(f.store, 'obsolete', { kinds: ['passage'] }).length, 1);
  const current = snapshot('Current molecules');

  assert.equal(search(f.store, 'obsolete', { kinds: ['passage'] }).length, 0);
  const hits = search(f.store, 'molecules', { kinds: ['passage'], projectId: project.id });

  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.target.type, 'passage');

  if (hits[0]?.target.type === 'passage') assert.equal(hits[0].target.documentId, current);

  assert.equal(readDocument(f.store, old)?.blocks[0]?.text, 'Obsolete fossils');
});
