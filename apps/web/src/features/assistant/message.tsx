import type { ChatMessage as ConversationMessage } from '@study/contracts/conversations/messages';
import { Bubble, BubbleContent } from '@study/ui/bubble';
import { CodeBlockCopyButton } from '@study/ui/code-block';
import { Message, MessageContent, MessageHeader, MessageFooter } from '@study/ui/message';
import { RichNoteContent } from '@study/ui/rich-note';

import { useI18n } from '#web/lib/i18n.tsx';

import { AssistantReply, AssistantThinking } from './reply';
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
    <Message
      align={message.role === 'user' ? 'end' : 'start'}
      role="article"
      data-role={message.role}
      aria-label={t(roleLabels[message.role])}
    >
      <MessageContent>
        <MessageHeader>{t(roleLabels[message.role])}</MessageHeader>
        {message.role === 'assistant' ? (
          <>
            <AssistantToolActivity message={message} />
            <Bubble variant="ghost">
              <BubbleContent>
                <AssistantBody message={message} requestId={requestId} />
              </BubbleContent>
            </Bubble>
          </>
        ) : (
          <Bubble align="end" variant="muted">
            <BubbleContent>{version?.text ?? ''}</BubbleContent>
          </Bubble>
        )}
        {message.role === 'assistant' && version?.status === 'complete' && version.text && (
          <MessageFooter>
            <CodeBlockCopyButton
              value={version.text}
              copyLabel={t('CopyText')}
              copiedLabel={t('MaterialCopied')}
            />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
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
    <AssistantThinking label={t('AssistantThinking')} />
  );
}
