import { structuredEditorLabels } from '@study/localization';

import { useI18n } from '#client/lib/i18n.tsx';

export function useStructuredEditorLabels() {
  const { t } = useI18n();

  return structuredEditorLabels(t);
}
