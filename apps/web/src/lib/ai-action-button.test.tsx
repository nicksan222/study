import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { TooltipProvider } from '@study/ui/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { AiActionButton } from './ai-action-button';
import type { AiReadiness } from './ai-readiness';

const state = vi.hoisted(() => ({ readiness: 'ready' as AiReadiness }));

vi.mock('./ai-readiness', () => ({ useAiReadiness: () => state.readiness }));

testStable('blocks each unavailable state and becomes actionable after setup', async () => {
  const click = vi.fn();
  const user = userEvent.setup();
  const view = (key: number) => (
    <TooltipProvider delay={0}>
      <AiActionButton key={key} tier="medium" label="Generate" onClick={click} />
    </TooltipProvider>
  );

  state.readiness = 'checking';
  const mounted = render(view(0));

  for (const [index, readiness] of (['checking', 'unavailable', 'setup'] as const).entries()) {
    state.readiness = readiness;
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

  state.readiness = 'ready';
  mounted.rerender(view(4));
  const button = screen.getByRole('button', { name: 'Generate' });

  expect(button).toBeEnabled();
  await user.click(button);
  expect(click).toHaveBeenCalledOnce();
});
