import { Button } from './button';
import { semanticPart } from './semantic-part';

import './document-overview.css';

/** Readable document browsing surfaces; callers own data, links and actions. */
export const DocumentOverview = {
  Picker: semanticPart('div', 'document-session-picker'),
  SessionChoices: semanticPart('ul', 'document-session-choices'),
  SessionChoice: semanticPart(Button, 'document-session-choice'),
  Root: semanticPart('div', 'document-overview'),
  Heading: semanticPart('header', 'document-overview-heading'),
  Intro: semanticPart('div', 'document-overview-intro'),
  Title: semanticPart('h2', 'document-overview-title'),
  Description: semanticPart('p', 'document-overview-description'),
  Actions: semanticPart('div', 'document-overview-actions'),
  Section: semanticPart('section', 'document-overview-section'),
  SectionHeading: semanticPart('h3', 'document-overview-section-heading'),
  Rows: semanticPart('ul', 'document-overview-rows'),
  SelectionRow: semanticPart(Button, 'document-selection-row'),
  Icon: semanticPart('span', 'document-overview-icon'),
  Copy: semanticPart('span', 'document-overview-copy'),
  Name: semanticPart('span', 'document-overview-name'),
  Preview: semanticPart('span', 'document-overview-preview'),
  Updated: semanticPart('span', 'document-overview-updated'),
  Footer: semanticPart('div', 'document-overview-footer'),
  Empty: semanticPart('div', 'document-overview-empty')
};
