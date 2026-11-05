import { studyDocumentIdSchema } from '@study/contracts/ids';
import { studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';

import { DocumentPage } from '../features/authored-documents';
import { sessionDocumentOptions } from '../features/session-workspace';
import { sidebarOwner } from '../lib/navigation/sidebar-config';
import { documentVersionOptions } from '../lib/study-client/documents.queries';

export const Route = createFileRoute('/documents/$documentId')({
  staticData: {
    title: 'SourceDocument',
    section: 'library',
    scope: 'project',
    sidebar: {
      content: 'workspace',
      owner: sidebarOwner(
        studyDocumentIdSchema,
        ({ documentId }) => documentId,
        sessionDocumentOptions
      )
    }
  },
  beforeLoad: ({ params }) => {
    Schema.decodeUnknownSync(studyDocumentIdSchema)(BigInt(params.documentId));
  },
  loaderDeps: ({ search }) => ({ documentVersion: search.documentVersion }),
  loader: ({ context, params, deps }) =>
    Promise.all([
      context.queryClient.prefetchQuery(
        sessionDocumentOptions(
          Schema.decodeUnknownSync(studyDocumentIdSchema)(BigInt(params.documentId))
        )
      ),
      deps.documentVersion
        ? context.queryClient.prefetchQuery(
            documentVersionOptions(
              Schema.decodeUnknownSync(studyDocumentVersionIdSchema)(BigInt(deps.documentVersion))
            )
          )
        : undefined
    ]),
  component: DocumentPage
});
