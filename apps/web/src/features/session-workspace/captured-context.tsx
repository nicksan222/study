import {
  runSelectionContextSchema,
  selectionReferenceKey
} from '@study/contracts/conversations/context';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  LockKeyhole,
  MessageSquare,
  SlidersHorizontal,
  Sparkles,
  User
} from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { CapturedInputLink } from '../source-library';
import { NoteContent } from './note-editor';
import { contextOptions } from './session-workspace.queries';
import { SessionReadError } from './status';

export function CapturedContext({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const state = useQuery(contextOptions(requestId));
  const context = state.isError ? undefined : state.data;

  return (
    <Notebook.Captured>
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {context && <ContextSnapshot context={context} />}
    </Notebook.Captured>
  );
}

function ContextSnapshot({ context }: { context: typeof runSelectionContextSchema.Type }) {
  const { t } = useI18n();
  return (
    <>
      <Notebook.ContextNotice>
        <LockKeyhole aria-hidden="true" />
        <p>{t('SessionContextSnapshot')}</p>
      </Notebook.ContextNotice>
      {context.instruction && (
        <Notebook.ContextCard>
          <Notebook.ContextCardHeading>
            <SlidersHorizontal aria-hidden="true" />
            <h4>{t('SessionContextInstructions')}</h4>
          </Notebook.ContextCardHeading>
          <NoteContent value={context.instruction} />
        </Notebook.ContextCard>
      )}
      {context.inputs.length > 0 && (
        <Notebook.ContextGroup>
          <Notebook.ContextGroupHeading>
            <h4>{t('SessionContextSources')}</h4>
            <Notebook.ContextCount>{context.inputs.length}</Notebook.ContextCount>
          </Notebook.ContextGroupHeading>
          <Notebook.ContextSources>
            {context.inputs.map((input) => (
              <Notebook.ContextSource key={selectionReferenceKey(input.input)}>
                <Notebook.ContextCardHeading>
                  <FileText aria-hidden="true" />
                  <CapturedInputLink input={input.input} name={input.name} />
                </Notebook.ContextCardHeading>
                <Notebook.ContextScope>
                  {t(
                    input.scope.kind === 'document'
                      ? 'SessionWhole'
                      : input.scope.kind === 'blocks'
                        ? 'SessionBlocks'
                        : 'SessionRanges'
                  )}
                </Notebook.ContextScope>
                {input.excerpts.map((excerpt) => (
                  <Notebook.ContextExcerpt
                    key={`${excerpt.blockId}-${excerpt.start}-${excerpt.end}`}
                  >
                    {excerpt.text}
                  </Notebook.ContextExcerpt>
                ))}
              </Notebook.ContextSource>
            ))}
          </Notebook.ContextSources>
        </Notebook.ContextGroup>
      )}
      {context.messages.length > 0 && (
        <Notebook.ContextGroup>
          <Notebook.ContextGroupHeading>
            <h4>{t('SessionCapturedNotes')}</h4>
            <Notebook.ContextCount>{context.messages.length}</Notebook.ContextCount>
          </Notebook.ContextGroupHeading>
          <Notebook.ContextTimeline>
            {context.messages.map((message) => (
              <Notebook.ContextEvent key={`${message.messageId}-${message.versionId}`}>
                <Notebook.ContextMarker aria-hidden="true">
                  {message.role === 'user' ? <User /> : <Sparkles />}
                </Notebook.ContextMarker>
                <Notebook.ContextCard>
                  <Notebook.ContextCardHeading>
                    <h5>{t(message.role === 'user' ? 'SessionContextYou' : 'AnswerAuthor')}</h5>
                  </Notebook.ContextCardHeading>
                  <NoteContent value={message.text} />
                </Notebook.ContextCard>
              </Notebook.ContextEvent>
            ))}
          </Notebook.ContextTimeline>
        </Notebook.ContextGroup>
      )}
      {!context.instruction && context.inputs.length === 0 && context.messages.length === 0 && (
        <Notebook.ContextNotice>
          <MessageSquare aria-hidden="true" />
          <p>{t('SessionContextEmpty')}</p>
        </Notebook.ContextNotice>
      )}
      {context.excludedMessages > 0 && (
        <Notebook.ContextNotice>
          <MessageSquare aria-hidden="true" />
          <p>
            {t('SessionExcludedNotes')} {context.excludedMessages}
          </p>
        </Notebook.ContextNotice>
      )}
    </>
  );
}
