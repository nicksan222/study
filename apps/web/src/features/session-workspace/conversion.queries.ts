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
  const version = message.versions.find((version) => version.id === versionId);
  const available =
    message.role === 'user' &&
    !!strategy &&
    ((strategy.supportedInputs.includes('text') && !!version?.text.trim()) ||
      (strategy.supportedInputs.includes('pdf') &&
        message.parts.some((part) => part.sourceKind === 'pdf' && part.sourceId !== null)));
  const mutation = useMutation({
    mutationFn: () =>
      request((rpc) =>
        rpc['conversations.convertMessage']({
          messageId: message.id,
          expectedActiveVersionId: versionId,
          strategyId: preferences.textConversionStrategy
        })
      ),
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
    blocked: message.versions.some((version) => version.status !== 'complete')
  };
}
