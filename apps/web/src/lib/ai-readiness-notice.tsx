import { Button } from '@study/ui/button';
import { Link } from '@tanstack/react-router';

import type { AiReadiness } from '#web/lib/ai-readiness.ts';
import { useI18n } from '#web/lib/i18n.tsx';

export function AiReadinessNotice({ state }: { state: AiReadiness }) {
  const { t } = useI18n();

  if (state === 'ready') return null;

  return (
    <div role="status">
      <p>
        {t(
          state === 'checking'
            ? 'AiReadinessChecking'
            : state === 'unavailable'
              ? 'AiReadinessUnavailable'
              : 'AiReadinessSetup'
        )}
      </p>
      {state === 'setup' && (
        <Button size="sm" variant="ghost-muted" render={<Link to="/settings" />}>
          {t('Settings')}
        </Button>
      )}
    </div>
  );
}
