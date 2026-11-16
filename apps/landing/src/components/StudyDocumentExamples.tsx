import { createLocalization, structuredEditorLabels } from '@study/localization';
import { landingCopy } from '@study/localization';
import { Button } from '@study/ui';
import { ChatMessage, ChatEntryLabel, ChatQuestionAnswer, ChatMessageText } from '@study/ui';
import { CitationSources, EvidenceReference } from '@study/ui';
import { NotebookComposer } from '@study/ui';
import { RichNoteContent } from '@study/ui';
import { StructuredEditor } from '@study/ui';
import type { StructuredEditorValue } from '@study/ui';
import { WorkspaceDeskSurface as Desk } from '@study/ui';
import { useId, useState } from 'react';

export interface DocumentExampleProps {
  lang: 'en' | 'it';
  ready: boolean;
  phase?: 'start' | 'result';
}

export function NoteExample({ lang, ready, phase }: DocumentExampleProps) {
  const c = landingCopy[lang].examples;
  const { t } = createLocalization(lang === 'it' ? 'italian' : 'english');
  const id = useId();
  const [text, setText] = useState<string>(phase === 'result' ? '' : c.noteDraft);
  const [entries, setEntries] = useState<{ id: string; text: string }[]>(
    phase === 'result' ? [{ id: 'sample-note', text: c.noteDraft }] : []
  );
  const save = () => {
    if (!ready || !text.trim()) return;

    setEntries((previous) => [...previous, { id: crypto.randomUUID(), text }]);
    setText('');
  };

  return (
    <>
      {entries.map((entry) => (
        <ChatMessage key={entry.id}>
          <ChatEntryLabel>{t('NoteEntryNote')}</ChatEntryLabel>
          <ChatMessageText text={entry.text} />
        </ChatMessage>
      ))}
      <NotebookComposer
        role="group"
        inputId={id}
        label={t('NoteCompose')}
        hint={t('NoteNotebookHint')}
        placeholder={t('NoteComposeHint')}
        submitLabel={t('NoteSaveNote')}
        value={text}
        onChange={setText}
        onSubmit={save}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            save();
          }
        }}
        disabled={!ready || !text.trim()}
      />
      <p role="status">{entries.length ? c.saved : ''}</p>
    </>
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
