import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ChatConversation } from '@study/ui/chat';
import { ComposerSurface } from '@study/ui/composer';
import { ContextUsage } from '@study/ui/context-usage';
import { ErrorState } from '@study/ui/error-state';
import { Notebook } from '@study/ui/session-workspace';
import { Sidebar } from '@study/ui/sidebar';
import { WorkspaceCard, WorkspaceSurface } from '@study/ui/workspace';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { ArrowUp } from 'lucide-react';

import { AssistantMessage, AssistantHistory } from '#web/features/assistant/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';

import type { usePage } from './use-page';

/** Shares the session notebook canvas, reading column and floating composer. */
export function PageView({ model }: { model: ReturnType<typeof usePage> }) {
  const { t } = useI18n();

  return (
    <WorkspaceCard.Provider>
      <WorkspaceSurface.Root variant="desk" data-conversation="assistant">
        <Sidebar.Topbar parent={t('AppName')} title={t('Assistant')}>
          <Desk.LayoutControls aria-label={t('AssistantHistory')}>
            <WorkspaceCard.Toggle
              label={t('AssistantHistory')}
              open={model.cardVisible}
              onOpenChange={model.setCardVisible}
            />
          </Desk.LayoutControls>
        </Sidebar.Topbar>
        <Desk.Root open={false} expanded={false} cardOpen={model.cardVisible}>
          <Desk.Notebook>
            <Desk.ScrollArea>
              <Desk.NotebookLayout>
                <Desk.Board>
                  <Desk.BoardBody>
                    <ChatConversation
                      key={String(model.session.data?.id)}
                      label={t('Assistant')}
                      jumpLabel={t('JumpToLatest')}
                      itemCount={model.messages.length}
                      firstItemKey={model.messages[0]?.id.toString()}
                    >
                      <Notebook.History aria-label={t('Assistant')}>
                        <Notebook.NotesHeading>
                          <Notebook.PageHeading>
                            <p>{t('AssistantIntro')}</p>
                          </Notebook.PageHeading>
                        </Notebook.NotesHeading>
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
                          <WorkspaceSurface.Heading>
                            <h3>{t('StudyChatEmptyTitle')}</h3>
                            <p>{t('AssistantEmptyDescription')}</p>
                          </WorkspaceSurface.Heading>
                        )}
                        {model.messages.map((message) => (
                          <AssistantMessage
                            key={String(message.id)}
                            message={message}
                            requestId={
                              model.pending?.id === message.id ? model.requestId : undefined
                            }
                          />
                        ))}
                      </Notebook.History>
                    </ChatConversation>
                  </Desk.BoardBody>
                </Desk.Board>
                <AssistantHistory
                  panelRef={model.historyPanel}
                  model={model}
                  visible={model.cardVisible}
                  onDismiss={() => model.setCardVisible(false)}
                />
              </Desk.NotebookLayout>
            </Desk.ScrollArea>
            <Desk.NavigationHost />
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
                        value={
                          model.context.data.estimatedTokens + Math.ceil(model.draft.length / 4)
                        }
                        max={model.context.data.maxTokens}
                        label={t('AssistantContextUsage', {
                          used:
                            model.context.data.estimatedTokens + Math.ceil(model.draft.length / 4),
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
          </Desk.Notebook>
        </Desk.Root>
      </WorkspaceSurface.Root>
    </WorkspaceCard.Provider>
  );
}
