import type { ModelTier } from '@study/contracts/settings/schemas';
import { AiButton } from '@study/ui/ai-button';
import type { ComponentProps } from 'react';

import { useAiReadiness } from './ai-readiness';
import { useI18n } from './i18n';

/** App AI actions check readiness at presentation and click time. */
export function AiActionButton({
  tier,
  disabled,
  onClick,
  ...props
}: ComponentProps<typeof AiButton> & { tier: ModelTier }) {
  const readiness = useAiReadiness(tier);
  const { t } = useI18n();
  const blocked = readiness !== 'ready';

  return (
    <AiButton
      {...props}
      disabled={disabled || blocked}
      disabledReason={
        blocked
          ? t(
              readiness === 'checking'
                ? 'AiReadinessChecking'
                : readiness === 'unavailable'
                  ? 'AiReadinessUnavailable'
                  : 'AiReadinessSetup'
            )
          : props.disabledReason
      }
      onClick={(event) => {
        if (!blocked && !disabled) onClick?.(event);
      }}
    />
  );
}
