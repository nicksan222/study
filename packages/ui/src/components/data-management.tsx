import { DialogPopup } from './dialog';

import './material-library.css';
import { semanticPart } from './semantic-part';

export const DataManagement = {
  Description: semanticPart('p', 'mb-4 text-sm text-muted-foreground'),
  File: semanticPart('input', 'max-w-56 text-sm'),
  Actions: semanticPart('div', 'flex flex-wrap justify-end gap-2'),
  PreviewPopup: semanticPart(DialogPopup, 'overflow-y-auto'),
  DialogContent: semanticPart('div', 'space-y-4 px-6 pb-6 text-sm'),
  DetailsToggle: semanticPart('summary', 'cursor-pointer text-muted-foreground'),
  Details: semanticPart('dl', 'mt-3 space-y-2 break-all'),
  Scope: semanticPart(
    'table',
    'w-full text-start tabular-nums [&_th]:py-2 [&_td]:py-2 [&_td]:text-end [&_tr]:border-b [&_tr]:border-border'
  ),
  ScopeCaption: semanticPart('caption', 'text-start'),
  ScopeLabel: semanticPart('th', 'text-start font-normal'),
  Consent: semanticPart('label', 'flex items-start gap-2'),
  Identity: semanticPart('p', 'break-all'),
  Submitted: semanticPart('details', 'mb-4 break-all text-sm'),
  Receipt: semanticPart('p', 'mb-4 text-sm')
};
