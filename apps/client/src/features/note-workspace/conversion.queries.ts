import { canConvertMessage } from '@study/contracts';
import type { VersionId, convertMessageInputSchema, ChatMessage } from '@study/contracts';
import { rpc } from '@study/contracts/react';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { useNoteMutation } from './note-mutation.queries';

/** Discovers eligible methods and retains immutable request variables for transport retries. */
export function useMessageConversion(message: ChatMessage, versionId: VersionId) {
  const readiness = useAiReadiness('tiny');
  const strategies = rpc.sources.conversionStrategies.useQuery({});
  const preferences = useWorkspacePreferences();
  const strategy = strategies.data?.find(
    (strategy) => strategy.id === preferences.textConversionStrategy
  );
  const available = !!strategy && canConvertMessage(message, versionId, strategy.supportedInputs);
  const mutation = useNoteMutation(message.noteId, (input: typeof convertMessageInputSchema.Type) =>
    rpc.notes.convertMessage.call(input)
  );

  return {
    available,
    readiness,
    mutation,
    convert: () => {
      if (readiness !== 'ready') return;

      void mutation
        .mutate({
          messageId: message.id,
          expectedActiveVersionId: versionId,
          strategyId: preferences.textConversionStrategy
        })
        .catch(() => {});
    },
    retry:
      readiness === 'ready'
        ? () => {
            if (readiness === 'ready' && mutation.variables)
              void mutation.mutate(mutation.variables).catch(() => {});
          }
        : undefined,
    blocked: message.versions.some(
      (version) => version.status === 'pending' || version.status === 'writing'
    )
  };
}
