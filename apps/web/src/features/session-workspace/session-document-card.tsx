import type { MaterialSummaryDto } from '@study/contracts/materials/schemas';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';

import { useI18n } from '../../lib/i18n';

export function SessionDocumentCard({
  material,
  onOpen,
  active
}: {
  material: MaterialSummaryDto;
  onOpen: (material: MaterialSummaryDto) => void;
  active: boolean;
}) {
  const { t, date } = useI18n();

  return (
    <Desk.DocumentCard
      title={material.title}
      openLabel={t('SessionOpenPage')}
      preview={material.description}
      meta={`${t('SourceDocument')} · ${date(material.updated_at)}`}
      active={active}
      onOpen={() => onOpen(material)}
    />
  );
}
