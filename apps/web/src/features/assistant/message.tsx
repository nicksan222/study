import type { ChatMessage as ConversationMessage } from '@study/contracts/conversations/messages';
import { ChatEntryLabel, ChatMessage, ChatMessageText } from '@study/ui/chat';
import { Loading } from '@study/ui/loading';
import { RichNoteContent } from '@study/ui/rich-note';

import { useI18n } from '#web/lib/i18n.tsx';

import { AssistantReply } from './reply';
import { AssistantToolActivity } from './tool-activity';

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

  return (
    <ChatMessage data-role={message.role} aria-label={t(roleLabels[message.role])}>
      <ChatEntryLabel>{t(roleLabels[message.role])}</ChatEntryLabel>
      {message.role === 'assistant' ? (
        <>
          <AssistantToolActivity message={message} />
          <AssistantBody message={message} requestId={requestId} />
        </>
      ) : (
        <ChatMessageText text={version?.text ?? ''} />
      )}
    </ChatMessage>
  );
}

function AssistantBody({
  message,
  requestId
}: {
  message: ConversationMessage;
  requestId?: string;
}) {
  const { t } = useI18n();
  const version = message.versions.find((version) => version.id === message.activeVersionId);

  if (version?.status === 'complete') return <RichNoteContent value={version.text} />;

  return requestId ? (
    <AssistantReply requestId={requestId} messageId={message.id} />
  ) : (
    <Loading label={t('AssistantThinking')} />
  );
}
