import { Button } from '@study/ui/button';
import { Identity } from '@study/ui/identity';
import { List } from '@study/ui/list';
import { OnboardingNotebook } from '@study/ui/onboarding';
import { RichNoteContent } from '@study/ui/rich-note';
import { FileText, MessagesSquare, ArrowRight } from 'lucide-react';
import { useState } from 'react';

/** Shows the subject identity and its real navigation primitives without creating saved data. */
export function OnboardingSubject({
  label,
  name,
  monogram,
  notesLabel,
  note,
  pagesLabel,
  document
}: {
  label: string;
  name: string;
  monogram: string;
  notesLabel: string;
  note: string;
  pagesLabel: string;
  document: string;
}) {
  return (
    <figure className="ui-onboarding-preview">
      <figcaption>{label}</figcaption>
      <div className="ui-onboarding-subject-heading">
        <Identity text={monogram} />
        <span>{name}</span>
      </div>
      <List.Root bleed={false}>
        <List.Row>
          <List.Leading>
            <List.Icon>
              <MessagesSquare aria-hidden="true" />
            </List.Icon>
          </List.Leading>
          <List.Main>
            <List.Title>{notesLabel}</List.Title>
            <List.Description>{note}</List.Description>
          </List.Main>
        </List.Row>
        <List.Row>
          <List.Leading>
            <List.Icon>
              <FileText aria-hidden="true" />
            </List.Icon>
          </List.Leading>
          <List.Main>
            <List.Title>{pagesLabel}</List.Title>
            <List.Description>{document}</List.Description>
          </List.Main>
        </List.Row>
      </List.Root>
    </figure>
  );
}

/** Uses the document's Markdown renderer for a quiet, read-only sample page. */
export function OnboardingPage({
  label,
  title,
  content
}: {
  label: string;
  title: string;
  content: string;
}) {
  return (
    <figure className="ui-onboarding-preview">
      <figcaption>
        <FileText aria-hidden="true" />
        {label}
      </figcaption>
      <article className="ui-onboarding-document">
        <h3>{title}</h3>
        <RichNoteContent value={content} />
      </article>
    </figure>
  );
}

/** Lets the learner inspect a labeled example transformation without invoking model work. */
export function OnboardingWorkflow({
  label,
  note,
  file,
  title,
  content,
  transformLabel,
  captureLabel,
  pagesLabel
}: {
  label: string;
  note: string;
  file: string;
  title: string;
  content: string;
  transformLabel: string;
  captureLabel: string;
  pagesLabel: string;
}) {
  const [document, setPage] = useState(false);

  return (
    <div className="ui-onboarding-workflow">
      <div className="ui-onboarding-workflow-path">
        <span data-current={!document}>{captureLabel}</span>
        <ArrowRight aria-hidden="true" />
        <span data-current={document}>{pagesLabel}</span>
      </div>
      <div aria-live="polite">
        {document ? (
          <OnboardingPage label={label} title={title} content={content} />
        ) : (
          <OnboardingNotebook label={label} note={note} file={file} />
        )}
      </div>
      <Button variant="outline" onClick={() => setPage((value) => !value)}>
        {document ? captureLabel : transformLabel}
        {!document && <ArrowRight aria-hidden="true" />}
      </Button>
    </div>
  );
}
