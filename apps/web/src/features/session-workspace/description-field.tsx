import { Notebook } from '@study/ui/session-workspace';
import { Textarea } from '@study/ui/textarea';

import { useI18n } from '#web/lib/i18n.tsx';

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
      <Notebook.Label htmlFor={id}>{t('SessionDescriptionLabel')}</Notebook.Label>
      <Textarea
        size="compact"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={240}
        rows={3}
        disabled={disabled}
        placeholder={t('SessionDescriptionPlaceholder')}
      />
      <Notebook.Muted>{value.length} / 240</Notebook.Muted>
    </>
  );
}
