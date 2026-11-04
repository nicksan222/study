import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator
} from '@study/ui/context-menu';
import { Pencil, Sparkles, AlignLeft, SlidersHorizontal, Check, ListChecks } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { ArchiveMenuItem } from './archive-menu-item';
import { ItemDeletionMenu } from './item-deletion-menu';
import type { useMessageActions } from './message-actions.queries';
import { MessageDeletion } from './message-deletion';
import { MessageWorkDetails } from './message-work-details';
import type { MessageWorkTarget } from './message-work-details';

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
  const [workOpen, setWorkOpen] = useState(false);
  const [workTarget, setWorkTarget] = useState<MessageWorkTarget>();

  return (
    <>
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
            <ContextMenuPopup finalFocus={workOpen || deletion.open ? false : trigger}>
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
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => {
                  setWorkTarget({
                    sessionId: model.message.sessionId,
                    messageId: model.message.id,
                    versionId: model.versionId
                  });
                  setWorkOpen(true);
                }}
              >
                <ListChecks aria-hidden="true" />
                {model.t('SessionWorkDetails')}
              </ContextMenuItem>
              <ArchiveMenuItem
                sessionId={model.message.sessionId}
                target={{ kind: 'message', id: model.message.id }}
                disabled={model.blocked || !!model.draft.mode}
              />
              <ItemDeletionMenu {...deletion} />
            </ContextMenuPopup>
          </ContextMenu>
        )}
      />
      <MessageWorkDetails
        open={workOpen}
        onOpenChange={setWorkOpen}
        target={workTarget}
        finalFocus={trigger}
      />
    </>
  );
}
