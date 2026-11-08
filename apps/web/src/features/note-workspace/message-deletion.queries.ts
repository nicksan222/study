import type { MessageId, VersionId } from '@study/contracts/ids';
import { mutationOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

export const messageDeletionOptions = (messageId: MessageId) =>
  mutationOptions({
    retry: false,
    mutationFn: async (intent: 'item' | VersionId) => {
      if (intent === 'item') await request((rpc) => rpc['notes.deleteMessage']({ id: messageId }));
      else
        await request((rpc) => rpc['notes.deleteMessageVersion']({ messageId, versionId: intent }));
    }
  });
