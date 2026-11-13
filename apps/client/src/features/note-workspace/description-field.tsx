import { Notebook } from '@study/ui/note-workspace';
import { Textarea } from '@study/ui/textarea';

import { useI18n } from '#client/lib/i18n.tsx';

export function DescriptionField({
  id,
  value,
  onChange,
  disabled
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      <Notebook.Label htmlFor={id}>{t('NoteDescriptionLabel')}</Notebook.Label>
      <Textarea
        size="compact"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={240}
        rows={3}
        disabled={disabled}
        placeholder={t('NoteDescriptionPlaceholder')}
      />
      <Notebook.Muted>{value.length} / 240</Notebook.Muted>
    </>
  );
}
