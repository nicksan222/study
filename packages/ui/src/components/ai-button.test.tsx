import { testStable } from '@study/testing/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { AiButton, AiActivity } from './ai-button';
import { TooltipProvider } from './tooltip';

testStable(
  'keeps a pending AI action disabled while exposing its task on hover and keyboard focus',
  async () => {
    const clicked = vi.fn();
    const user = userEvent.setup();

    render(
      <TooltipProvider delay={0}>
        <AiButton
          label="Suggest title"
          workingLabel="Writing a title"
          pending
          disabled
          onClick={clicked}
        />
      </TooltipProvider>
    );
    const button = screen.getByRole('button', { name: 'Suggest title' });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    await user.hover(button.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Writing a title');
    await user.unhover(button.parentElement!);
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Writing a title');
    await user.click(button);
    expect(clicked).not.toHaveBeenCalled();
  }
);

testStable('shows the current task without requiring hover or keyboard discovery', async () => {
  render(
    <TooltipProvider delay={0}>
      <AiActivity label="Reading your pages" />
    </TooltipProvider>
  );
  const status = screen.getByRole('status');

  expect(status).toHaveAccessibleName('Reading your pages');
  expect(within(status).getByText('Reading your pages')).toBeVisible();
  expect(status).toHaveAttribute('data-state', 'running');
});

testStable.each(['waiting', 'stopping', 'attention'] as const)(
  'keeps %s work visible without an active-generation animation',
  (state) => {
    render(<AiActivity label="Current work" state={state} />);
    const status = screen.getByRole('status', { name: 'Current work' });

    expect(status).toHaveAttribute('data-state', state);
    expect(within(status).getByText('Current work')).toBeVisible();
    expect(status.querySelector('[data-working="true"]')).toBeNull();
  }
);
