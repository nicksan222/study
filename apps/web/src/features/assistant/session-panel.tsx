import type { SessionId } from '@study/contracts/ids';
import { MessageScrollerLayout } from '@study/ui/message-scroller';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';

import { AssistantThread, AssistantComposer } from './chat';
import { useAssistant } from './use-assistant';
import { useAssistantComposer } from './use-composer';

/** A persistent chat whose capabilities and identity are bound to this notebook on the server. */
export function SessionAssistantPanel({ sessionId }: { sessionId: SessionId }) {
  const conversation = useAssistant(sessionId);
  const composer = useAssistantComposer(conversation);

  return (
    <Desk.Notebook>
      <MessageScrollerLayout>
        <AssistantThread model={conversation} scoped />
      </MessageScrollerLayout>
      <AssistantComposer model={{ ...conversation, ...composer }} />
    </Desk.Notebook>
  );
}
