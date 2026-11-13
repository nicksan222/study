import type { configurationWaitReasonSchema } from '@study/contracts/workflows/schemas';
import { Button } from '@study/ui/button';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#client/lib/i18n.tsx';

const labels = {
  auth: 'NoteWaitAuth',
  config: 'NoteWaitConfig',
  model_unavailable: 'NoteWaitModel'
} as const;

export function ConfigurationWait({
  reason
}: {
  reason: typeof configurationWaitReasonSchema.Type;
}) {
  const { t } = useI18n();

  return (
    <div>
      <p>{t(labels[reason])}</p>
      <Button size="sm" variant="ghost-muted" render={<Link to="/settings" />}>
        {t('Settings')}
      </Button>
    </div>
  );
}
