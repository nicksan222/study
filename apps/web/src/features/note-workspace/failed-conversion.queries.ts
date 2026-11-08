import { StudyError } from '@study/contracts/errors';
import type { ChatMessage, MessageVersion } from '@study/contracts/notes/messages';
import { useQuery } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

import { useNoteMutation } from './note-mutation.queries';
import { noteKey } from './note-workspace.queries';

/** Retries retained conversion inputs or explicitly removes the failed empty version. */
export function useFailedConversion(message: ChatMessage, version: MessageVersion) {
  const snapshot = useQuery({
    queryKey: [...noteKey(message.noteId), 'conversion-recovery', version.generationRequestId],
    queryFn: () =>
      request((rpc) => rpc['notes.replySnapshot']({ requestId: version.generationRequestId! })),
    enabled: !!version.generationRequestId
  });
  const conversion = snapshot.data?.generation?.conversion;
  const mutation = useNoteMutation(message.noteId, async (action: 'retry' | 'discard') => {
    if (action === 'discard') {
      await request((rpc) =>
        rpc['notes.deleteMessageVersion']({
          messageId: message.id,
          versionId: version.id
        })
      );

      return;
    }

    if (!conversion) throw new StudyError('invalid_input', 'Conversion input is unavailable');

    await request((rpc) =>
      rpc['notes.convertMessage']({
        messageId: message.id,
        expectedActiveVersionId: conversion.baseVersionId,
        strategyId: conversion.strategyId
      })
    );
  });

  return {
    snapshot,
    mutation,
    canRetry:
      !!conversion &&
      !message.versions.some(
        (version) => version.status === 'pending' || version.status === 'writing'
      )
  };
}
