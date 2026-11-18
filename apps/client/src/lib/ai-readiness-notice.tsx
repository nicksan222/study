import { Button } from '@study/ui';
import { Link } from '@tanstack/react-router';

import type { AiReadiness } from '#client/lib/ai-readiness.ts';
import { useI18n } from '#client/lib/i18n.tsx';

export function AiReadinessNotice({
  state,
  setupLabel
}: {
  state: AiReadiness;
  setupLabel?: string;
}) {
  const { t } = useI18n();

  if (state === 'ready') return null;

  return (
    <div role="status">
      <p>
        {(state === 'setup' && setupLabel) ||
          t(
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
