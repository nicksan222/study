import type { NoteId } from '@study/contracts/ids';
import { IconButton } from '@study/ui/icon-button';
import { WorkspaceCard } from '@study/ui/workspace';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { PanelBottom, PanelRight, Sparkles } from 'lucide-react';

import { useI18n } from '#client/lib/i18n.tsx';

import { useWorkbench } from './workbench.queries';

export function NoteLayoutControls({ id }: { id: NoteId }) {
  const { t } = useI18n();
  const model = useWorkbench(id);
  const unavailable = model.tabs.length === 0;

  return (
    <Desk.LayoutControls aria-label={t('NoteLayout')}>
      <IconButton
        size="icon-sm"
        variant={model.visible && model.active === 'assistant' ? 'secondary' : 'ghost-muted'}
        label={t('NoteAssistantOpen')}
        onClick={() => model.open({ kind: 'assistant' })}
      >
        <Sparkles aria-hidden="true" />
      </IconButton>
      <WorkspaceCard.Toggle
        label={t('NoteActions')}
        open={model.cardVisible}
        onOpenChange={model.toggleCard}
      />
      <IconButton
        size="icon-sm"
        variant={model.visible && model.dock === 'bottom' ? 'secondary' : 'ghost-muted'}
        label={t('NoteDockBelow')}

        aria-pressed={model.visible && model.dock === 'bottom'}
        disabled={unavailable}
        onClick={() => model.showEditor('bottom')}
      >
        <PanelBottom aria-hidden="true" />
      </IconButton>
      <IconButton
        size="icon-sm"
        variant={model.visible && model.dock === 'side' ? 'secondary' : 'ghost-muted'}
        label={t('NoteDockBeside')}

        aria-pressed={model.visible && model.dock === 'side'}
        disabled={unavailable}
        onClick={() => model.showEditor('side')}
      >
        <PanelRight aria-hidden="true" />
      </IconButton>
    </Desk.LayoutControls>
  );
}
