import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { TooltipProvider } from '@study/ui';

import { AiActionButton } from './ai-action-button';
import type { AiReadiness } from './ai-readiness';

const state = test.hoisted(() => ({ readiness: 'ready' as AiReadiness }));

test.mock('./ai-readiness', () => ({ useAiReadiness: () => state.readiness }));

test.stable('blocks each unavailable state and becomes actionable after setup', async () => {
  const click = test.vi.fn();
  const user = test.userEvent.setup();
  const view = (key: number) => (
    <TooltipProvider delay={0}>
      <AiActionButton key={key} tier="medium" label="Generate" onClick={click} />
    </TooltipProvider>
  );

  state.readiness = 'checking';
  const mounted = test.render(view(0));

  for (const [index, readiness] of (['checking', 'unavailable', 'setup'] as const).entries()) {
    state.readiness = readiness;
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

  state.readiness = 'ready';
  mounted.rerender(view(4));
  const button = test.screen.getByRole('button', { name: 'Generate' });

  test.expect(button).toBeEnabled();
  await user.click(button);
  test.expect(click).toHaveBeenCalledOnce();
});
