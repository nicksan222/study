import {
  MessageScrollerLayout,
  Sidebar,
  WorkspaceCard,
  WorkspaceSurface,
  WorkspaceDeskSurface as Desk
} from '@study/ui';

import {
  AssistantHistory,
  AssistantThread,
  AssistantComposer
} from '#client/features/assistant/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import type { usePage } from './use-page';

export function PageView({ model }: { model: ReturnType<typeof usePage> }) {
  const { t } = useI18n();

  return (
    <WorkspaceCard.Provider
      open={model.cardVisible}
      onOpenChange={model.setCardVisible}
      triggerRef={model.historyToggle}
    >
      <WorkspaceSurface.Root variant="desk" data-note="assistant">
        <Sidebar.Topbar parent={t('AppName')} title={t('Assistant')}>
          <Desk.LayoutControls aria-label={t('AssistantHistory')}>
            <WorkspaceCard.Toggle label={t('AssistantHistory')} />
          </Desk.LayoutControls>
        </Sidebar.Topbar>
        <Desk.Root open={false} expanded={false} cardOpen={model.cardVisible}>
          <Desk.Notebook>
            <MessageScrollerLayout>
              <AssistantThread model={model} />
              <AssistantHistory panelRef={model.historyPanel} model={model} />
            </MessageScrollerLayout>
            <Desk.NavigationHost />
            <AssistantComposer model={model} />
          </Desk.Notebook>
        </Desk.Root>
      </WorkspaceSurface.Root>
    </WorkspaceCard.Provider>
  );
}
