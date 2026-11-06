import { ActionGroup } from './action-group';
import { semanticPart } from './semantic-part';

import './material-library.css';

export const DocumentEditing = {
  Comparison: semanticPart('div', 'document-comparison'),
  CreationForm: semanticPart('form', 'library-import'),
  Submitted: semanticPart('section', 'space-y-2 rounded-md border border-border p-3'),
  SubmittedHeading: semanticPart('h3', 'text-sm font-medium'),
  SubmittedTitle: semanticPart('p', 'font-medium'),
  Actions: semanticPart(ActionGroup, 'material-actions'),
  Editor: semanticPart('section', 'reader-history document-writing'),
  CreationReview: semanticPart('section', 'space-y-3'),
  Muted: semanticPart('p', 'text-sm text-muted-foreground'),
  ReviewList: semanticPart('ul', 'max-h-60 overflow-auto divide-y divide-border'),
  ReviewRow: semanticPart('li', 'py-2'),
  Blocks: semanticPart('fieldset', 'document-editor'),
  BlockActions: semanticPart('div', 'document-block-actions'),
  Proposal: semanticPart('section', 'reader-history')
};
