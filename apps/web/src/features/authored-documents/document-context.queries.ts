import type { SessionId, StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { mutationOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

/** Pins the exact document version without replacing the session's other selected context. */
export const documentConversationOptions = () =>
  mutationOptions({
    retry: false,
    mutationFn: async ({
      documentId,
      versionId,
      sessionId
    }: {
      documentId: StudyDocumentId;
      versionId: StudyDocumentVersionId;
      sessionId: SessionId;
    }) => {
      await request((rpc) => rpc['documents.attach']({ documentId, sessionId }));
      const selection = await request((rpc) =>
        rpc['conversations.sessionSelection']({ sessionId })
      );
      const included = selection.targets.some(
        (target) =>
          target.input.kind === 'document' &&
          target.input.versionId === versionId &&
          target.scope.kind === 'document'
      );

      if (!included)
        await request((rpc) =>
          rpc['conversations.updateSessionSelection']({
            sessionId,
            expectedRevision: selection.revision,
            targets: [
              ...selection.targets,
              { input: { kind: 'document', versionId }, scope: { kind: 'document' } }
            ]
          })
        );
    }
  });
