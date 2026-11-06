import type { ChatMessage } from '@study/contracts/conversations/messages';
import type { VersionId } from '@study/contracts/ids';
import { anchorLabel, text } from '@study/localization';
import type { Locale } from '@study/localization';
import { ChatMessageText, ChatQuestionAnswer } from '@study/ui/chat';
import { Citation, CitationEvidence, CitationSources } from '@study/ui/citation';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { CapturedInputLink } from '../source-library';
import { NoteContent } from './note-editor';
import { citationsOptions } from './session-workspace.queries';

export type MessageCitation = ChatMessage['citations'][number];

const emptyCitations: readonly MessageCitation[] = [];

export function useMessageCitations(message: ChatMessage, versionId?: VersionId) {
  const state = useQuery({
    ...citationsOptions(message.sessionId, message.id, versionId),
    enabled: !!versionId
  });

  return { ...state, items: state.data?.citations ?? emptyCitations };
}

function EvidenceReference({
  citation,
  inline = false
}: {
  citation: MessageCitation;
  inline?: boolean;
}) {
  const { t, locale } = useI18n();
  const location = citationLocation(locale, citation.anchor);

  return (
    <Citation
      marker={citation.marker}
      label={t('SessionOpenCitation', { number: citation.marker, source: citation.sourceName })}
      sourceName={inline ? undefined : citation.sourceName}
      closeLabel={t('Close')}
    >
      <CitationEvidence
        action={
          citation.input && (
            <CapturedInputLink
              input={citation.input}
              name={t('SessionCitationTakeMeThere')}
              action
            />
          )
        }
        title={
          citation.input ? (
            <CapturedInputLink input={citation.input} name={citation.sourceName} />
          ) : (
            citation.sourceName
          )
        }
        location={location}
        quote={
          citation.evidence?.availability === 'available'
            ? citation.evidence.excerpt
            : citation.quote
        }
        precision={t(
          citation.precision === 'exact'
            ? 'SessionExactEvidence'
            : citation.precision === 'approximate'
              ? 'SessionApproximateEvidence'
              : 'SessionEvidenceUnavailable'
        )}
      />
    </Citation>
  );
}

export function MessageSources({ citations }: { citations: readonly MessageCitation[] }) {
  const { t } = useI18n();

  if (!citations.length) return null;

  return (
    <CitationSources label={t('AnswerSources')}>
      {citations.map((citation) => (
        <EvidenceReference key={citation.marker} citation={citation} />
      ))}
    </CitationSources>
  );
}

/** Only persisted evidence markers become controls; code and unknown references remain text. */
export function MessageContent({
  message,
  version,
  citations
}: {
  message: ChatMessage;
  version: ChatMessage['versions'][number];
  citations: readonly MessageCitation[];
}) {
  const { t } = useI18n();
  const renderText = useCallback((value: string) => citationText(value, citations), [citations]);
  const citationRenderer = citations.length ? renderText : undefined;
  const answer = questionAnswerBody(message, version);

  if (answer !== undefined) {
    const original = message.versions.find((item) => item.id === version.basedOn)!;

    return (
      <ChatQuestionAnswer
        label={t('SessionAnswer')}
        question={<ChatMessageText text={original.text} renderText={citationRenderer} />}
        answer={<NoteContent value={answer} renderText={citationRenderer} />}
      />
    );
  }

  return message.format === 'document' ||
    message.role === 'assistant' ||
    version.origin === 'answer' ? (
    <NoteContent value={version.text} renderText={citationRenderer} />
  ) : (
    <ChatMessageText text={version.text} renderText={citationRenderer} />
  );
}

function citationLocation(locale: Locale, anchor: MessageCitation['anchor']) {
  switch (anchor.type) {
    case 'authored':
      return undefined;
    case 'time':
      return anchorLabel(locale, { kind: 'time', startMs: anchor.startMs, endMs: anchor.endMs });
    case 'page':
      return anchorLabel(locale, { kind: 'page', page: anchor.page });
    case 'text':
      return anchorLabel(locale, {
        kind: 'text',
        lineStart: anchor.lineStart,
        lineEnd: anchor.lineEnd
      });
    case 'slide':
    case 'paragraph':
      return anchorLabel(locale, { kind: anchor.type, index: anchor.index });
    case 'url':
      return anchorLabel(locale, { kind: 'url', fragment: anchor.fragment });
  }
}

function citationText(value: string, citations: readonly MessageCitation[]) {
  const content: ReactNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(/\[(\d+)\]/g)) {
    const citation = citations.find((item) => item.marker === Number(match[1]));

    content.push(value.slice(cursor, match.index));
    content.push(
      citation ? <EvidenceReference key={match.index} citation={citation} inline /> : match[0]
    );
    cursor = match.index + match[0].length;
  }

  content.push(value.slice(cursor));

  return content;
}

/** Presents generated Q&A without repeating the question label already in the entry heading. */
function questionAnswerBody(message: ChatMessage, version: ChatMessage['versions'][number]) {
  if (message.role !== 'user' || version.origin !== 'answer') return undefined;

  const original = message.versions.find((item) => item.id === version.basedOn);

  if (!original) return undefined;

  for (const locale of ['english', 'italian'] as const) {
    const prefix = `**${text(locale, 'SessionQuestion')}**\n\n${original.text}\n\n**${text(locale, 'SessionAnswer')}**\n\n`;

    if (version.text.startsWith(prefix)) return version.text.slice(prefix.length);
  }

  return undefined;
}
