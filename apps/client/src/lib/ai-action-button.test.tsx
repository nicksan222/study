import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { TooltipProvider } from '@study/ui';

import type * as AiActionModule from './ai-action-button.tsx';

let AiActionButton: typeof AiActionModule.AiActionButton;

import type { AiReadiness } from './ai-readiness';

let currentReadiness: AiReadiness;

test.beforeEach(async ({ mock }) => {
  currentReadiness = 'ready';
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => currentReadiness }));
  ({ AiActionButton } = await import('./ai-action-button.tsx'));
});

test.stable(
  'blocks each unavailable state and becomes actionable after setup',
  async ({ vi, userEvent, render, screen, expect, fireEvent }) => {
    const click = vi.fn();
    const user = userEvent.setup();
    const view = (key: number) => (
      <TooltipProvider delay={0}>
        <AiActionButton key={key} tier="medium" label="Generate" onClick={click} />
      </TooltipProvider>
    );

    currentReadiness = 'checking';
    const mounted = render(view(0));

    for (const [index, readiness] of (['checking', 'unavailable', 'setup'] as const).entries()) {
      currentReadiness = readiness;
      mounted.rerender(view(index));
      const button = screen.getByRole('button', { name: 'Generate' });

      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(click).not.toHaveBeenCalled();
      await user.hover(button.parentElement!);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        catalogs.english[
          readiness === 'checking'
            ? 'AiReadinessChecking'
            : readiness === 'unavailable'
              ? 'AiReadinessUnavailable'
              : 'AiReadinessSetup'
        ]
      );
      await user.unhover(button.parentElement!);
    }

    currentReadiness = 'ready';
    mounted.rerender(view(4));
    const button = screen.getByRole('button', { name: 'Generate' });

    expect(button).toBeEnabled();
    await user.click(button);
    expect(click).toHaveBeenCalledOnce();
  }
);
