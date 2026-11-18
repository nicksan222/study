import type { ModelTier } from '@study/contracts';
import { AiButton } from '@study/ui';
import type { ComponentProps } from 'react';

import type { AiReadinessProvider } from './ai-readiness';
import { useAiReadiness } from './ai-readiness';
import { useI18n } from './i18n';

/** App AI actions check readiness at presentation and click time. */
export function AiActionButton({
  tier,
  provider,
  disabled,
  onClick,
  ...props
}: ComponentProps<typeof AiButton> & { tier: ModelTier; provider?: AiReadinessProvider }) {
  const readiness = useAiReadiness(tier, provider);
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
