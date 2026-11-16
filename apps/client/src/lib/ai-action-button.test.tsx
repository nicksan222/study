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

test.stable('blocks each unavailable state and becomes actionable after setup', async () => {
  const click = test.vi.fn();
  const user = test.userEvent.setup();
  const view = (key: number) => (
    <TooltipProvider delay={0}>
      <AiActionButton key={key} tier="medium" label="Generate" onClick={click} />
    </TooltipProvider>
  );

  currentReadiness = 'checking';
  const mounted = test.render(view(0));

  for (const [index, readiness] of (['checking', 'unavailable', 'setup'] as const).entries()) {
    currentReadiness = readiness;
    mounted.rerender(view(index));
    const button = test.screen.getByRole('button', { name: 'Generate' });

    test.expect(button).toBeDisabled();
    test.fireEvent.click(button);
    test.expect(click).not.toHaveBeenCalled();
    await user.hover(button.parentElement!);
    test
      .expect(await test.screen.findByRole('tooltip'))
      .toHaveTextContent(
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
  const button = test.screen.getByRole('button', { name: 'Generate' });

  test.expect(button).toBeEnabled();
  await user.click(button);
  test.expect(click).toHaveBeenCalledOnce();
});
