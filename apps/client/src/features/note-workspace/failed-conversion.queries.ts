import { StudyError } from '@study/contracts/errors';
import type { ChatMessage, MessageVersion } from '@study/contracts/notes/messages';
import { rpc } from '@study/contracts/react';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';

import { useNoteMutation } from './note-mutation.queries';

/** Retries retained conversion inputs or explicitly removes the failed empty version. */
export function useFailedConversion(message: ChatMessage, version: MessageVersion) {
  const readiness = useAiReadiness('tiny');
  const snapshot = rpc.notes.replySnapshot.useQuery(
    version.generationRequestId ? { requestId: version.generationRequestId } : undefined
  );
  const conversion = snapshot.data?.generation?.conversion;
  const mutation = useNoteMutation(message.noteId, async (action: 'retry' | 'discard') => {
    if (action === 'discard') {
      await rpc.notes.deleteMessageVersion.call({ messageId: message.id, versionId: version.id });

      return;
    }

    if (readiness !== 'ready') return;

    if (!conversion) throw new StudyError('invalid_input', 'Conversion input is unavailable');

    await rpc.notes.convertMessage.call({
      messageId: message.id,
      expectedActiveVersionId: conversion.baseVersionId,
      strategyId: conversion.strategyId
    });
  });

  return {
    snapshot,
    mutation,
    readiness,
    canRetry:
      readiness === 'ready' &&
      !!conversion &&
      !message.versions.some(
        (version) => version.status === 'pending' || version.status === 'writing'
      )
  };
}
