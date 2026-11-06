import { ChatConversation, ChatMessage, ChatMessageText } from '@study/ui/chat';
import { ChatDrawer, ChatEmptyState } from '@study/ui/chat-drawer';
import type { ChatDrawerHandle } from '@study/ui/chat-drawer';
import { ComposerSurface } from '@study/ui/composer';
import { WorkspaceSurface } from '@study/ui/workspace';
import { ArrowUp } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

/** Owns an in-memory conversation across drawer dismissal and application navigation. */
export function StudyChat({ handle }: { handle: ChatDrawerHandle }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<{ id: string; text: string }[]>([]);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  function send() {
    const text = draft.trim();

    if (!text) return;

    setMessages((previous) => [...previous, { id: crypto.randomUUID(), text }]);
    setDraft('');
    input.current?.focus();
  }

  return (
    <ChatDrawer
      title={t('StudyChatTitle')}
      handle={handle}
      closeLabel={t('Close')}
      description={t('StudyChatPreview')}
      footer={
        <ComposerSurface.Root variant="notebook">
          <ComposerSurface.Input
            ref={input}
            rows={1}
            aria-label={t('StudyChatMessage')}
            aria-describedby={hintId}
            placeholder={t('StudyChatPlaceholder')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

              event.preventDefault();
              send();
            }}
          />
          <ComposerSurface.Footer variant="notebook">
            <WorkspaceSurface.ComposerSubmit
              aria-label={t('SendMessage')}
              disabled={!draft.trim()}
              onClick={send}
            >
              <ArrowUp size={18} aria-hidden="true" />
            </WorkspaceSurface.ComposerSubmit>
          </ComposerSurface.Footer>
          <WorkspaceSurface.ComposerHint id={hintId}>
            {t('StudyChatSendHint')}
          </WorkspaceSurface.ComposerHint>
        </ComposerSurface.Root>
      }
    >
      <ChatConversation
        label={t('StudyChatTitle')}
        jumpLabel={t('JumpToLatest')}
        itemCount={messages.length}
        firstItemKey={messages[0]?.id}
      >
        {messages.length === 0 && (
          <ChatEmptyState
            title={t('StudyChatEmptyTitle')}
            description={t('StudyChatEmptyDescription')}
          />
        )}
        {messages.map((message) => (
          <ChatMessage key={message.id} aria-label={t('SessionContextYou')}>
            <ChatMessageText text={message.text} />
          </ChatMessage>
        ))}
      </ChatConversation>
    </ChatDrawer>
  );
}
