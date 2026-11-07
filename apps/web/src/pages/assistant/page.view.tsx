import { MessageScrollerLayout } from '@study/ui/message-scroller';
import { Sidebar } from '@study/ui/sidebar';
import { WorkspaceCard, WorkspaceSurface } from '@study/ui/workspace';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';

import {
  AssistantHistory,
  AssistantThread,
  AssistantComposer
} from '#web/features/assistant/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';

import type { usePage } from './use-page';

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
            <MessageScrollerLayout>
              <AssistantThread model={model} />
              <AssistantHistory
                panelRef={model.historyPanel}
                model={model}
                visible={model.cardVisible}
                onDismiss={() => model.setCardVisible(false)}
              />
            </MessageScrollerLayout>
            <Desk.NavigationHost />
            <AssistantComposer model={model} />
          </Desk.Notebook>
        </Desk.Root>
      </WorkspaceSurface.Root>
    </WorkspaceCard.Provider>
  );
}
