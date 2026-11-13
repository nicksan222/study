import type { NoteId } from '@study/contracts/ids';
import { MessageScrollerLayout } from '@study/ui/message-scroller';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';

import { AssistantThread, AssistantComposer } from './chat';
import { useAssistant } from './use-assistant';
import { useAssistantComposer } from './use-composer';

/** A persistent chat whose capabilities and identity are bound to this notebook on the server. */
export function NoteAssistantPanel({ noteId }: { noteId: NoteId }) {
  const note = useAssistant(noteId);
  const composer = useAssistantComposer(note);

  return (
    <Desk.Notebook>
      <MessageScrollerLayout>
        <AssistantThread model={note} scoped />
      </MessageScrollerLayout>
      <AssistantComposer model={{ ...note, ...composer }} />
    </Desk.Notebook>
  );
}
