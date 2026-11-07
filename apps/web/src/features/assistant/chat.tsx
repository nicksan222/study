import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { ContextUsage } from '@study/ui/context-usage';
import { ErrorState } from '@study/ui/error-state';
import {
  MessageScrollerProvider,
  MessageScrollerEmpty,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton
} from '@study/ui/message-scroller';
import { Notebook } from '@study/ui/session-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { AssistantMessage } from './message';
import type { useAssistant } from './use-assistant';
import type { useAssistantComposer } from './use-composer';

type Model = ReturnType<typeof useAssistant>;

type ComposerModel = Model & ReturnType<typeof useAssistantComposer>;

export function AssistantThread({ model, scoped = false }: { model: Model; scoped?: boolean }) {
  const { t } = useI18n();

  return (
    <MessageScrollerProvider
      key={String(model.session.data?.id)}
      autoScroll
      defaultScrollPosition="last-anchor"
    >
      <MessageScroller>
        <MessageScrollerViewport data-notebook-scroll-host aria-label={t('Assistant')}>
          <MessageScrollerContent aria-label={t('Assistant')}>
            {model.error && (
              <ErrorState
                layout="inline"
                title={t('AssistantLoadFailed')}
                action={
                  <RetryButton
                    size="sm"
                    variant="outline"
                    label={t('Retry')}
                    onClick={model.retry}
                  />
                }
              />
            )}
            {model.history.hasNextPage && (
              <Button
                size="sm"
                variant="ghost"
                disabled={model.history.isFetchingNextPage}
                onClick={() => void model.history.fetchNextPage()}
              >
                {t('AssistantEarlier')}
              </Button>
            )}
            {model.history.isSuccess && model.messages.length === 0 && (
              <MessageScrollerEmpty>
                <h3>{t('StudyChatEmptyTitle')}</h3>
                <p>{t(scoped ? 'SessionAssistantDescription' : 'AssistantEmptyDescription')}</p>
              </MessageScrollerEmpty>
            )}
            {model.messages.map((message) => (
              <MessageScrollerItem
                key={String(message.id)}
                messageId={String(message.id)}
                scrollAnchor={message.role === 'user'}
              >
                <AssistantMessage
                  message={message}
                  requestId={model.pending?.id === message.id ? model.requestId : undefined}
                />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label={t('JumpToLatest')}>
          <ArrowDown aria-hidden="true" />
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export function AssistantComposer({ model }: { model: ComposerModel }) {
  const { t } = useI18n();

  return (
    <Desk.FloatingComposer>
      <WorkspaceSurface.Dock>
        <ComposerSurface.Root variant="notebook">
          <Notebook.Label htmlFor={model.inputId}>{t('StudyChatMessage')}</Notebook.Label>
          <ComposerSurface.Input
            id={model.inputId}
            ref={model.input}
            rows={1}
            aria-describedby={model.hintId}
            placeholder={t('StudyChatPlaceholder')}
            value={model.draft}
            disabled={!model.history.isSuccess}
            onChange={(event) => model.setDraft(event.target.value)}
            onKeyDown={model.onKeyDown}
          />
          <ComposerSurface.Footer variant="notebook">
            {model.context.data && (
              <ContextUsage
                value={model.context.data.estimatedTokens + Math.ceil(model.draft.length / 4)}
                max={model.context.data.maxTokens}
                label={t('AssistantContextUsage', {
                  used: model.context.data.estimatedTokens + Math.ceil(model.draft.length / 4),
                  max: model.context.data.maxTokens
                })}
              />
            )}

            <WorkspaceSurface.ComposerSubmit
              aria-label={t('SendMessage')}
              disabled={model.blocked || !model.draft.trim()}
              onClick={model.send}
            >
              <ArrowUp size={18} aria-hidden="true" />
            </WorkspaceSurface.ComposerSubmit>
          </ComposerSurface.Footer>
          <WorkspaceSurface.ComposerHint id={model.hintId}>
            {t('StudyChatSendHint')}
          </WorkspaceSurface.ComposerHint>
        </ComposerSurface.Root>
      </WorkspaceSurface.Dock>
    </Desk.FloatingComposer>
  );
}
