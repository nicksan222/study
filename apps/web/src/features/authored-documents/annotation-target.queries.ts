import type { annotationTargetSchema } from '@study/contracts/documents/evidence';
import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { validBlockTextRange } from '@study/contracts/sources/document';
import { queryOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

type Target = typeof annotationTargetSchema.Type;

export const annotationDocumentOptions = (
  documentId: StudyDocumentId,
  version: StudyDocumentVersionId
) =>
  queryOptions({
    queryKey: ['documents', 'annotationDocument', String(documentId), String(version)],
    queryFn: async ({ signal }) => {
      const exact = await request((rpc) => rpc['documents.version']({ id: version }), signal);
      return exact.documentId === documentId && exact.status === 'published' ? exact : null;
    }
  });

export const retainedRangeOptions = (target: Target, enabled = true) =>
  queryOptions({
    queryKey: [
      'documents',
      'retainedRange',
      [
        target.documentId,
        target.range.versionId,
        target.range.snapshotId,
        target.range.blockId,
        target.range.start,
        target.range.end
      ].join(':')
    ],
    enabled,
    queryFn: async ({ signal }) => {
      const exact = await request(
        (rpc) => rpc['documents.version']({ id: target.range.versionId }),
        signal
      );
      if (
        exact.documentId !== target.documentId ||
        exact.status !== 'published' ||
        exact.snapshotId !== target.range.snapshotId ||
        !validBlockTextRange(exact.document, target.range)
      )
        return null;
      return exact.document.blocks.find((block) => block.id === target.range.blockId)?.text ?? null;
    }
  });
