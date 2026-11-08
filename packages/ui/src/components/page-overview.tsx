import { ActionGroup } from './action-group';
import { Button } from './button';
import { semanticPart } from './semantic-part';

import './page-overview.css';

/** Readable document browsing surfaces; callers own data, links and actions. */
export const PageOverview = {
  Picker: semanticPart('div', 'page-note-picker'),
  NoteChoices: semanticPart('ul', 'page-note-choices'),
  NoteChoice: semanticPart(Button, 'page-note-choice'),
  Root: semanticPart('div', 'page-overview'),
  Heading: semanticPart('header', 'page-overview-heading'),
  Intro: semanticPart('div', 'page-overview-intro'),
  Title: semanticPart('h2', 'page-overview-title'),
  Description: semanticPart('p', 'page-overview-description'),
  Actions: semanticPart(ActionGroup, 'page-overview-actions'),
  Section: semanticPart('section', 'page-overview-section'),
  SectionHeading: semanticPart('h3', 'page-overview-section-heading'),
  Rows: semanticPart('ul', 'page-overview-rows'),
  SelectionRow: semanticPart(Button, 'page-selection-row'),
  Icon: semanticPart('span', 'page-overview-icon'),
  Copy: semanticPart('span', 'page-overview-copy'),
  Name: semanticPart('span', 'page-overview-name'),
  Preview: semanticPart('span', 'page-overview-preview'),
  Updated: semanticPart('span', 'page-overview-updated'),
  Footer: semanticPart('div', 'page-overview-footer'),
  Empty: semanticPart('div', 'page-overview-empty')
};
