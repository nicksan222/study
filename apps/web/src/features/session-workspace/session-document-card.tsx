import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';

import { useI18n } from '#web/lib/i18n.tsx';

import { ItemContextMenu } from './item-context-menu';

export function SessionDocumentCard({
  document,
  onOpen,
  active
}: {
  document: StudyDocumentSummary;
  onOpen: (document: StudyDocumentSummary) => void;
  active: boolean;
}) {
  const { t } = useI18n();

  return (
    <ItemContextMenu
      label={t('SessionOpenPage')}
      target={<button type="button" onClick={() => onOpen(document)} />}
    >
      <Desk.DocumentCard
        title={document.title}
        openLabel={t('SessionOpenPage')}
        preview={document.description}
        meta={t('SourceDocument')}
        active={active}
        onOpen={() => onOpen(document)}
      />
    </ItemContextMenu>
  );
}
