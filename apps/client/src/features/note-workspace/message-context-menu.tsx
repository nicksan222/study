import { ChatMessageContent } from '@study/ui/chat';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator
} from '@study/ui/context-menu';
import {
  Pencil,
  Sparkles,
  AlignLeft,
  SlidersHorizontal,
  Check,
  ListChecks,
  FileText
} from 'lucide-react';
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
  { mode: 'edit', label: 'NoteEditNote', icon: Pencil },
  { mode: 'improve', label: 'NoteImprove', icon: Sparkles },
  { mode: 'summarize', label: 'NoteSummarize', icon: AlignLeft },
  { mode: 'instruction', label: 'NoteCustomTransform', icon: SlidersHorizontal },
  { mode: 'activate', label: 'NoteUseVersion', icon: Check }
] as const;

/** Exposes selection-aware message actions through the shared context menu. */
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
              render={<ChatMessageContent />}
              tabIndex={0}
              aria-label={model.t('NoteItemActions')}
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
                      (mode !== 'edit' && mode !== 'activate' && model.readiness !== 'ready') ||
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
              {model.conversion.available && (
                <ContextMenuItem
                  disabled={
                    !model.active ||
                    model.blocked ||
                    !!model.draft.mode ||
                    model.conversion.readiness !== 'ready' ||
                    model.conversion.blocked ||
                    model.conversion.mutation.isPending
                  }
                  onClick={model.conversion.convert}
                >
                  <FileText aria-hidden="true" />
                  {model.t('NoteConvertText')}
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => {
                  setWorkTarget({
                    noteId: model.message.noteId,
                    messageId: model.message.id,
                    versionId: model.versionId
                  });
                  setWorkOpen(true);
                }}
              >
                <ListChecks aria-hidden="true" />
                {model.t('NoteWorkDetails')}
              </ContextMenuItem>
              <ArchiveMenuItem
                noteId={model.message.noteId}
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
