import { SuccessIcon } from '@study/icons';

import { semanticPart } from './semantic-part';

import './data-management.css';

export const DataManagement = {
  Description: semanticPart(
    'p',
    'mb-5 text-[0.8125rem] leading-[1.6] text-(--contrast-muted-foreground)'
  ),
  Groups: semanticPart('div', 'data-backup-groups'),
  ProviderForm: semanticPart('form', 'data-backup-form'),
  ProviderFields: semanticPart('div', 'data-backup-fields'),
  ProviderHint: semanticPart('span', 'data-backup-hint'),
  File: semanticPart('input', 'sr-only'),
  Actions: semanticPart('div', 'flex flex-nowrap items-center justify-end gap-1.5'),
  StatusIcon,
  PreviewContent: semanticPart('div', 'space-y-4 text-sm'),
  Scope: semanticPart(
    'table',
    'w-full text-start tabular-nums [&_th]:py-2 [&_td]:py-2 [&_td]:text-end [&_tr]:border-b [&_tr]:border-border'
  ),
  ScopeCaption: semanticPart('caption', 'text-start'),
  ScopeLabel: semanticPart('th', 'text-start font-normal')
};

/** A healthy idle restore status is a completed state, with no progress indicator. */
function StatusIcon({ idle }: { idle: boolean }) {
  return idle ? (
    <SuccessIcon size={17} aria-hidden="true" className="text-(--contrast-muted-foreground)" />
  ) : null;
}
