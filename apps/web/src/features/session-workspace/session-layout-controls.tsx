import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { WorkspaceCard } from '@study/ui/workspace';
import { PanelBottom, PanelRight } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { useWorkbench } from './workbench.queries';

export function SessionLayoutControls({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const model = useWorkbench(id);
  const unavailable = model.tabs.length === 0;
  return (
    <Desk.LayoutControls aria-label={t('SessionLayout')}>
      <WorkspaceCard.Toggle
        label={t('SessionActions')}
        open={model.cardVisible}
        onOpenChange={model.toggleCard}
      />
      <Button
        size="icon-sm"
        variant={model.visible && model.dock === 'bottom' ? 'secondary' : 'ghost-muted'}
        aria-label={t('SessionDockBelow')}
        title={t(unavailable ? 'SessionDockUnavailable' : 'SessionDockBelow')}
        aria-pressed={model.visible && model.dock === 'bottom'}
        disabled={unavailable}
        onClick={() => model.showEditor('bottom')}
      >
        <PanelBottom aria-hidden="true" />
      </Button>
      <Button
        size="icon-sm"
        variant={model.visible && model.dock === 'side' ? 'secondary' : 'ghost-muted'}
        aria-label={t('SessionDockBeside')}
        title={t(unavailable ? 'SessionDockUnavailable' : 'SessionDockBeside')}
        aria-pressed={model.visible && model.dock === 'side'}
        disabled={unavailable}
        onClick={() => model.showEditor('side')}
      >
        <PanelRight aria-hidden="true" />
      </Button>
    </Desk.LayoutControls>
  );
}
