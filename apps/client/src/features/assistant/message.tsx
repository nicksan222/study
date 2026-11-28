import type { ChatMessage as NoteMessage } from '@study/contracts';
import {
  Bubble,
  BubbleContent,
  CodeBlockCopyButton,
  Message,
  MessageContent,
  MessageHeader,
  MessageFooter,
  RichNoteContent
} from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

import { AssistantReply, AssistantThinking } from './reply';
import { AssistantToolActivity } from './tool-activity';

const roleLabels = { user: 'NoteContextYou', assistant: 'Assistant' } as const;

/** Final replies use the same safe Markdown/math renderer as streamed replies. */
export function AssistantMessage({
  message,
  requestId
}: {
  message: NoteMessage;
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
        {message.role === 'assistant' ? (
          <>
            <MessageHeader>{t('Assistant')}</MessageHeader>
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

function AssistantBody({ message, requestId }: { message: NoteMessage; requestId?: string }) {
  const { t } = useI18n();
  const version = message.versions.find((version) => version.id === message.activeVersionId);

  if (version?.status === 'complete') return <RichNoteContent value={version.text} />;

  return requestId ? (
    <AssistantReply requestId={requestId} messageId={message.id} />
  ) : (
    <AssistantThinking label={t('AssistantThinking')} />
  );
}
