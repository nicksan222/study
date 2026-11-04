import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem
} from '@study/ui/context-menu';
import { Pencil, Sparkles, AlignLeft, SlidersHorizontal, Check } from 'lucide-react';
import { useRef } from 'react';
import type { ReactNode } from 'react';

import { ItemDeletionMenu } from './item-deletion-menu';
import type { useMessageActions } from './message-actions.queries';
import { MessageDeletion } from './message-deletion';

type Model = ReturnType<typeof useMessageActions>;

const actions = [
  { mode: 'edit', label: 'SessionEditNote', icon: Pencil },
  { mode: 'improve', label: 'SessionImprove', icon: Sparkles },
  { mode: 'summarize', label: 'SessionSummarize', icon: AlignLeft },
  { mode: 'instruction', label: 'SessionCustomTransform', icon: SlidersHorizontal },
  { mode: 'activate', label: 'SessionUseVersion', icon: Check }
] as const;

export function MessageContextMenu({ model, children }: { model: Model; children: ReactNode }) {
  const trigger = useRef<HTMLDivElement>(null);

  return (
    <MessageDeletion
      message={model.message}
      versionId={model.versionId}
      disabled={model.blocked || !!model.draft.mode}
      renderActions={(deletion) => (
        <ContextMenu>
          <ContextMenuTrigger
            ref={trigger}
            render={<div />}
            tabIndex={0}
            aria-label={model.t('SessionItemActions')}
          >
            {children}
          </ContextMenuTrigger>
          <ContextMenuPopup finalFocus={deletion.open ? false : trigger}>
            {actions
              .filter(({ mode }) => mode !== 'edit' || model.message.role === 'user')
              .map(({ mode, label, icon: Icon }) => (
                <ContextMenuItem
                  key={mode}
                  disabled={
                    model.blocked ||
                    !!model.draft.mode ||
                    (mode === 'activate' ? model.active : !model.active)
                  }
                  onClick={() => {
                    model.open(mode);
                    model.launcher.current = trigger.current;
                  }}
                >
                  <Icon aria-hidden="true" />
                  {model.t(label)}
                </ContextMenuItem>
              ))}
            <ItemDeletionMenu {...deletion} />
          </ContextMenuPopup>
        </ContextMenu>
      )}
    />
  );
}
