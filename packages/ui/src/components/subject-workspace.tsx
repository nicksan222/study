import { semanticPart as part } from './semantic-part';

import './subject-workspace.css';

/** Full-height selection canvas and the selected subject's content workspace. */
export const SubjectWorkspace = {
  Empty: part('section', 'ui-subject-empty'),
  EmptyContent: part('div', 'ui-subject-empty-content'),
  EmptyIcon: part('div', 'ui-subject-empty-icon'),
  EmptyTitle: part('h2', 'ui-subject-empty-title'),
  EmptyDescription: part('p', 'ui-subject-empty-description'),
  Root: part('div', 'ui-subject-workspace'),
  Header: part('header', 'ui-subject-header'),
  Identity: part('div', 'ui-subject-heading'),
  Title: part('h2', 'ui-subject-title'),
  Actions: part('div', 'ui-subject-actions'),
  Content: part('div', 'ui-subject-content'),
  Section: part('section', 'ui-subject-section'),
  SectionTitle: part('h3', 'ui-subject-section-title'),
  EmptyList: part('p', 'ui-subject-empty-list')
};
