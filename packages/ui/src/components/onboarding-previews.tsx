import { PageIcon, NoteIcon, NextIcon } from '@study/icons';
import { useState } from 'react';

import { Button } from './button.tsx';
import { Identity } from './identity.tsx';
import { List } from './list.tsx';
import { OnboardingNotebook } from './onboarding.tsx';
import { RichNoteContent } from './rich-note.tsx';

/** Shows the subject identity and its real navigation primitives without creating saved data. */
export function OnboardingSubject({
  label,
  name,
  monogram,
  notesLabel,
  note,
  pagesLabel,
  page
}: {
  label: string;
  name: string;
  monogram: string;
  notesLabel: string;
  note: string;
  pagesLabel: string;
  page: string;
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
              <NoteIcon aria-hidden="true" />
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
              <PageIcon aria-hidden="true" />
            </List.Icon>
          </List.Leading>
          <List.Main>
            <List.Title>{pagesLabel}</List.Title>
            <List.Description>{page}</List.Description>
          </List.Main>
        </List.Row>
      </List.Root>
    </figure>
  );
}

/** Uses the page's Markdown renderer for a quiet, read-only sample page. */
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
        <PageIcon aria-hidden="true" />
        {label}
      </figcaption>
      <article className="ui-onboarding-page">
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
  const [showPage, setShowPage] = useState(false);

  return (
    <div className="ui-onboarding-workflow">
      <div className="ui-onboarding-workflow-path">
        <span data-current={!showPage}>{captureLabel}</span>
        <NextIcon aria-hidden="true" />
        <span data-current={showPage}>{pagesLabel}</span>
      </div>
      <div aria-live="polite">
        {showPage ? (
          <OnboardingPage label={label} title={title} content={content} />
        ) : (
          <OnboardingNotebook label={label} note={note} file={file} />
        )}
      </div>
      <Button variant="outline" onClick={() => setShowPage((value) => !value)}>
        {showPage ? captureLabel : transformLabel}
        {!showPage && <NextIcon aria-hidden="true" />}
      </Button>
    </div>
  );
}
