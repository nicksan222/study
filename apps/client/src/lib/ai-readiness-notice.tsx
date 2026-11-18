import { Button } from '@study/ui';
import { Link } from '@tanstack/react-router';

import type { AiReadiness } from '#client/lib/ai-readiness.ts';
import { useI18n } from '#client/lib/i18n.tsx';

export function AiReadinessNotice({
  state,
  setupLabel,
  onOpenSettings
}: {
  state: AiReadiness;
  setupLabel?: string;
  onOpenSettings?: () => void;
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
      {state === 'setup' &&
        (onOpenSettings ? (
          <Button size="sm" variant="ghost-muted" onClick={onOpenSettings}>
            {t('Settings')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost-muted" render={<Link to="/settings" />}>
            {t('Settings')}
          </Button>
        ))}
    </div>
  );
}
