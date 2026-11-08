import type { VersionId } from '@study/contracts/ids';
import type { convertMessageInputSchema } from '@study/contracts/notes/conversion';
import { canConvertMessage } from '@study/contracts/notes/conversion';
import type { ChatMessage } from '@study/contracts/notes/messages';

import { useConversionStrategies } from '#web/lib/study-client/conversion.queries.ts';
import { request } from '#web/lib/study-client/request.ts';
import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

import { useNoteMutation } from './note-mutation.queries';

/** Discovers eligible methods and retains immutable request variables for transport retries. */
export function useMessageConversion(message: ChatMessage, versionId: VersionId) {
  const strategies = useConversionStrategies();
  const preferences = useWorkspacePreferences();
  const strategy = strategies.data?.find(
    (strategy) => strategy.id === preferences.textConversionStrategy
  );
  const available = !!strategy && canConvertMessage(message, versionId, strategy.supportedInputs);
  const mutation = useNoteMutation(message.noteId, (input: typeof convertMessageInputSchema.Type) =>
    request((rpc) => rpc['notes.convertMessage'](input))
  );

  return {
    available,
    mutation,
    convert: () =>
      mutation.mutate({
        messageId: message.id,
        expectedActiveVersionId: versionId,
        strategyId: preferences.textConversionStrategy
      }),
    retry: () => {
      if (mutation.variables) mutation.mutate(mutation.variables);
    },
    blocked: message.versions.some(
      (version) => version.status === 'pending' || version.status === 'writing'
    )
  };
}
