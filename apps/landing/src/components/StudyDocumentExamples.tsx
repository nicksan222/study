import { createLocalization, noteEditorLabels, structuredEditorLabels } from '@study/localization';
import { landingCopy } from '@study/localization';
import { Button } from '@study/ui';
import { ChatMessage, ChatEntryLabel, ChatQuestionAnswer, ChatMessageText } from '@study/ui';
import { CitationSources, EvidenceReference } from '@study/ui';
import { RichNoteContent, RichNoteEditor, WritingSurface } from '@study/ui';
import { StructuredEditor } from '@study/ui';
import type { StructuredEditorValue } from '@study/ui';
import { WorkspaceDeskSurface as Desk } from '@study/ui';
import { useState } from 'react';

export interface DocumentExampleProps {
  lang: 'en' | 'it';
  ready: boolean;
  phase?: 'start' | 'result';
}

export function NoteExample({ lang, ready }: DocumentExampleProps) {
  const c = landingCopy[lang].examples;
  const { t } = createLocalization(lang === 'it' ? 'italian' : 'english');
  const [text, setText] = useState<string>(c.noteDraft);

  return (
    <WritingSurface heading={<h3>{c.noteTitle}</h3>} status={c.noteDemoHint}>
      {ready ? (
        <RichNoteEditor
          value={text}
          onChange={setText}
          label={t('NotePageEditor')}
          placeholder={t('NotePagePlaceholder')}
          labels={noteEditorLabels(t)}
          variant="writing"
        />
      ) : (
        <RichNoteContent value={text} />
      )}
    </WritingSurface>
  );
}

export function AnswerExample({ lang, ready, phase }: DocumentExampleProps) {
  const c = landingCopy[lang].examples;
  const { t } = createLocalization(lang === 'it' ? 'italian' : 'english');
  const [revealed, setRevealed] = useState(phase === 'result');

  return (
    <>
      <ChatMessage>
        <ChatEntryLabel>{t('NoteQuestion')}</ChatEntryLabel>
        {revealed ? (
          <ChatQuestionAnswer
            label={t('NoteAnswer')}
            question={<ChatMessageText text={c.question} />}
            answer={<RichNoteContent value={c.answer} />}
          />
        ) : (
          <ChatMessageText text={c.question} />
        )}
        {revealed && (
          <CitationSources label={t('AnswerSources')}>
            <EvidenceReference
              marker={1}
              label={t('NoteOpenCitation', { number: 1, source: c.source })}
              sourceName={c.source}
              closeLabel={t('Close')}
              title={c.source}
              location={c.sourceLocator}
              quote={c.sourceText}
              precision={t('NoteExactEvidence')}
            />
          </CitationSources>
        )}
      </ChatMessage>
      <Button disabled={!ready} onClick={() => setRevealed(!revealed)} aria-expanded={revealed}>
        {revealed ? c.hide : c.ask}
      </Button>
    </>
  );
}

function pageFixture(
  c: (typeof landingCopy)['en']['examples'] | (typeof landingCopy)['it']['examples']
): StructuredEditorValue {
  const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const heading = (text: string, level: number) => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }]
  });

  return {
    type: 'doc',
    content: [
      heading(c.pageTitle, 1),
      paragraph(c.pageIntro),
      heading(c.pageHeading, 2),
      heading(c.passive, 3),
      paragraph(c.passiveBody),
      heading(c.active, 3),
      paragraph(c.activeBody)
    ]
  };
}

export function PageExample({ lang, ready }: DocumentExampleProps) {
  const c = landingCopy[lang].examples;
  const { t } = createLocalization(lang === 'it' ? 'italian' : 'english');
  const [value, setValue] = useState(() => pageFixture(c));

  return ready ? (
    <Desk.Editor>
      <StructuredEditor
        value={value}
        onChange={setValue}
        label={t('NotePageEditor')}
        placeholder={t('NotePagePlaceholder')}
        labels={structuredEditorLabels(t)}
      />
    </Desk.Editor>
  ) : (
    <RichNoteContent
      value={`# ${c.pageTitle}\n\n${c.pageIntro}\n\n## ${c.pageHeading}\n\n### ${c.passive}\n\n${c.passiveBody}\n\n### ${c.active}\n\n${c.activeBody}`}
    />
  );
}
