import type { convertMessageInputSchema } from '@study/contracts/conversations/conversion';
import { canConvertMessage } from '@study/contracts/conversations/conversion';
import type { ChatMessage } from '@study/contracts/conversations/messages';
import type { VersionId } from '@study/contracts/ids';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useConversionStrategies } from '#web/lib/study-client/conversion.queries.ts';
import { request } from '#web/lib/study-client/request.ts';
import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

import { sessionKey } from './session-workspace.queries';

export function useMessageConversion(message: ChatMessage, versionId: VersionId) {
  const strategies = useConversionStrategies();
  const preferences = useWorkspacePreferences();
  const cache = useQueryClient();
  const strategy = strategies.data?.find(
    (strategy) => strategy.id === preferences.textConversionStrategy
  );
  const available = !!strategy && canConvertMessage(message, versionId, strategy.supportedInputs);
  const mutation = useMutation({
    mutationFn: (input: typeof convertMessageInputSchema.Type) =>
      request((rpc) => rpc['conversations.convertMessage'](input)),
    onSettled: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: sessionKey(message.sessionId) }),
        cache.invalidateQueries({ queryKey: ['sessions'] })
      ]);
    }
  });

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
    blocked: message.versions.some((version) => version.status !== 'complete')
  };
}
