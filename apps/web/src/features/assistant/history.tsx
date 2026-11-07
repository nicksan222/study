import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { WorkspaceCard } from '@study/ui/workspace';
import { MessageSquare, Plus } from 'lucide-react';
import type { Ref } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import type { useAssistant } from './use-assistant';

export function AssistantHistory({
  model,
  visible,
  onDismiss,
  panelRef
}: {
  model: Pick<
    ReturnType<typeof useAssistant>,
    'chats' | 'createChat' | 'newChat' | 'session' | 'selectChat'
  >;
  visible: boolean;
  onDismiss: () => void;
  panelRef?: Ref<HTMLElement>;
}) {
  const { t } = useI18n();

  return (
    <WorkspaceCard.Root
      ref={panelRef}
      hidden={!visible}
      onDismiss={onDismiss}
      aria-label={t('AssistantHistory')}
    >
      <WorkspaceCard.Group>
        <WorkspaceCard.Primary disabled={model.createChat.isPending} onClick={model.newChat}>
          <Plus size={16} />
          {t('AssistantNewChat')}
        </WorkspaceCard.Primary>
        {model.createChat.isError && (
          <ErrorState layout="inline" title={t('AssistantActionFailed')} />
        )}
      </WorkspaceCard.Group>
      <WorkspaceCard.Group>
        <WorkspaceCard.Caption>{t('AssistantHistory')}</WorkspaceCard.Caption>
        {model.chats.isPending && <Loading label={t('AssistantLoading')} />}
        {model.chats.isError && <ErrorState layout="inline" title={t('AssistantLoadFailed')} />}
        <nav aria-label={t('AssistantHistory')}>
          {model.chats.data?.pages
            .flatMap((page) => page.items)
            .map((chat) => (
              <WorkspaceCard.Item
                key={String(chat.id)}
                aria-current={model.session.data?.id === chat.id ? 'page' : undefined}
                onClick={() => model.selectChat(chat.id)}
              >
                <MessageSquare size={16} />
                <span>{chat.title || t('Assistant')}</span>
              </WorkspaceCard.Item>
            ))}
        </nav>
        {model.chats.hasNextPage && (
          <Button
            size="sm"
            variant="ghost"
            disabled={model.chats.isFetchingNextPage}
            onClick={() => void model.chats.fetchNextPage()}
          >
            {t('AssistantOlderChats')}
          </Button>
        )}
      </WorkspaceCard.Group>
    </WorkspaceCard.Root>
  );
}
