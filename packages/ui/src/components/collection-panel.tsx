import { Button } from './button';

import './material-library.css';
import { semanticPart } from './semantic-part';

export const CollectionPanel = {
  Root: semanticPart(
    'div',
    'grid w-full min-w-0 grid-cols-1 items-start gap-4 p-4 text-sm md:p-6 xl:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]'
  ),
  Catalog: semanticPart('div', 'min-w-0 space-y-4'),
  Detail: semanticPart('div', 'min-w-0 xl:border-l xl:border-border xl:pl-6'),
  Muted: semanticPart('p', 'text-sm text-muted-foreground'),
  Collection: semanticPart(
    'section',
    'min-w-0 space-y-5 border-t border-border pt-5 xl:border-t-0 xl:pt-0'
  ),
  IdentityHeader: semanticPart('div', 'flex items-center gap-3'),
  Title: semanticPart('h2', 'text-lg font-semibold'),
  Navigation: semanticPart('div', 'flex gap-4'),
  LinkText: semanticPart('span', 'underline'),
  RenameForm: semanticPart('form', 'flex flex-wrap items-end gap-3'),
  NameField: semanticPart('label', 'flex min-w-0 flex-1 flex-col gap-2'),
  Delete: semanticPart('div', 'space-y-3'),
  DeleteActions: semanticPart('div', 'flex gap-3'),
  Members: semanticPart('section', 'space-y-3'),
  MemberHeading: semanticPart('h3', 'font-medium'),
  List: semanticPart('ul', 'divide-y divide-border'),
  CreateForm: semanticPart('form', 'flex flex-wrap items-end gap-3 border-b border-border pb-4'),
  CreateName: semanticPart('label', 'flex min-w-48 flex-1 flex-col gap-2'),
  CatalogRow: semanticPart('li', 'flex min-w-0 items-center justify-between gap-3 py-1'),
  SelectCollection: semanticPart(
    Button,
    'min-w-0 flex-1 justify-start truncate aria-pressed:bg-muted'
  ),
  ExamDate: semanticPart('span', 'text-sm text-muted-foreground'),
  MemberRow: semanticPart('li', 'flex items-center justify-between gap-3 py-2'),
  MemberTitle: semanticPart('span', 'min-w-0 [overflow-wrap:anywhere]'),
  MemberAction: semanticPart(Button, 'shrink-0')
};
