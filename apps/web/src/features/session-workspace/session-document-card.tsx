import type { MaterialSummaryDto } from '@study/contracts/materials/schemas';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';

import { useI18n } from '#web/lib/i18n.tsx';

export function SessionDocumentCard({
  material,
  onOpen,
  active
}: {
  material: MaterialSummaryDto;
  onOpen: (material: MaterialSummaryDto) => void;
  active: boolean;
}) {
  const { t } = useI18n();

  return (
    <Desk.DocumentCard
      title={material.title}
      openLabel={t('SessionOpenPage')}
      preview={material.description}
      meta={t('SourceDocument')}
      active={active}
      onOpen={() => onOpen(material)}
    />
  );
}
