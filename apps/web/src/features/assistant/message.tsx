import type { ChatMessage as ConversationMessage } from '@study/contracts/conversations/messages';
import { ChatEntryLabel, ChatMessage, ChatMessageText } from '@study/ui/chat';
import { Loading } from '@study/ui/loading';
import { RichNoteContent } from '@study/ui/rich-note';

import { useI18n } from '#web/lib/i18n.tsx';

import { AssistantReply } from './reply';

const roleLabels = { user: 'SessionContextYou', assistant: 'Assistant' } as const;

/** Final replies use the same safe Markdown/math renderer as streamed replies. */
export function AssistantMessage({
  message,
  requestId
}: {
  message: ConversationMessage;
  requestId?: string;
}) {
  const { t } = useI18n();
  const version = message.versions.find((version) => version.id === message.activeVersionId);
  const pending = message.role === 'assistant' && version?.status !== 'complete';

  return (
    <ChatMessage data-role={message.role} aria-label={t(roleLabels[message.role])}>
      <ChatEntryLabel>{t(roleLabels[message.role])}</ChatEntryLabel>
      {pending ? (
        requestId ? (
          <AssistantReply requestId={requestId} messageId={message.id} />
        ) : (
          <Loading label={t('AssistantThinking')} />
        )
      ) : message.role === 'assistant' ? (
        <RichNoteContent value={version?.text ?? ''} />
      ) : (
        <ChatMessageText text={version?.text ?? ''} />
      )}
    </ChatMessage>
  );
}
