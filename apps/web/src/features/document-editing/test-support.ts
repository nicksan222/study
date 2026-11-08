import { detailSchema } from '@study/contracts/pages/schemas';
import { plainBlock } from '@study/contracts/sources/document';
import { Schema } from 'effect';

import { blankDocument } from './block-editor';

export function authoredPage(id = 2n, text = '', versionId = 10n) {
  return Schema.decodeUnknownSync(detailSchema)({
    id,
    projectIds: [],
    title: 'New page',
    description: null,
    createdAt: 1n,
    updatedAt: 1n,
    archivedAt: null,
    headVersionId: versionId,
    version: {
      id: versionId,
      pageId: id,
      number: versionId,
      operation: 'original',
      creator: 'user',
      instruction: null,
      language: null,
      createdAt: 1n,
      publishedAt: 1n,
      snapshotId: versionId + 100n,
      status: 'published',
      inputs: [],
      citations: [],
      parents: [],
      document: {
        ...blankDocument(),
        blocks: [plainBlock('paragraph', text, { type: 'authored' })]
      }
    }
  });
}
