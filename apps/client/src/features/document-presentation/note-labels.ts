import { noteEditorLabels } from '@study/localization';

import { useI18n } from '#client/lib/i18n.tsx';

export function useNoteLabels() {
  const { t } = useI18n();

  return noteEditorLabels(t);
}
