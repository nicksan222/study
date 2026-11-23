import { DockBelowIcon, DockBesideIcon, GenerateIcon } from '@study/icons';
import { IconButton, WorkspaceCard, WorkspaceDeskSurface as Desk } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

import type { useWorkbench } from './workbench.queries';

export function NoteLayoutControls({ model }: { model: ReturnType<typeof useWorkbench> }) {
  const { t } = useI18n();
  const unavailable = model.tabs.length === 0;

  return (
    <Desk.LayoutControls aria-label={t('NoteLayout')}>
      <IconButton
        size="icon-sm"
        variant={model.visible && model.active === 'assistant' ? 'secondary' : 'ghost-muted'}
        label={t('NoteAssistantOpen')}
        onClick={() => model.open({ kind: 'assistant' })}
      >
        <GenerateIcon aria-hidden="true" />
      </IconButton>
      <WorkspaceCard.Toggle label={t('NoteActions')} />
      <Desk.DesktopControls>
        <IconButton
          size="icon-sm"
          variant={model.visible && model.dock === 'bottom' ? 'secondary' : 'ghost-muted'}
          label={t('NoteDockBelow')}

          aria-pressed={model.visible && model.dock === 'bottom'}
          disabled={unavailable}
          onClick={() => model.showEditor('bottom')}
        >
          <DockBelowIcon aria-hidden="true" />
        </IconButton>
      </Desk.DesktopControls>
      <Desk.DesktopControls>
        <IconButton
          size="icon-sm"
          variant={model.visible && model.dock === 'side' ? 'secondary' : 'ghost-muted'}
          label={t('NoteDockBeside')}

          aria-pressed={model.visible && model.dock === 'side'}
          disabled={unavailable}
          onClick={() => model.showEditor('side')}
        >
          <DockBesideIcon aria-hidden="true" />
        </IconButton>
      </Desk.DesktopControls>
    </Desk.LayoutControls>
  );
}
