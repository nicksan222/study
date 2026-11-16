import { test } from '@study/testing';

import { AiButton, AiActivity } from './ai-button';
import { TooltipProvider } from './tooltip';

test.stable(
  'keeps a pending AI action disabled while exposing its task on hover and keyboard focus',
  async () => {
    const clicked = test.vi.fn();
    const user = test.userEvent.setup();

    test.render(
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
    const button = test.screen.getByRole('button', { name: 'Suggest title' });

    test.expect(button).toBeDisabled();
    test.expect(button).toHaveAttribute('aria-busy', 'true');
    test.expect(test.screen.getByRole('status')).toHaveClass('sr-only');
    await user.hover(button.parentElement!);
    test.expect(await test.screen.findByRole('tooltip')).toHaveTextContent('Writing a title');
    await user.unhover(button.parentElement!);
    await user.tab();
    test.expect(await test.screen.findByRole('tooltip')).toHaveTextContent('Writing a title');
    await user.click(button);
    test.expect(clicked).not.toHaveBeenCalled();
  }
);

test.stable('shows the current task without requiring hover or keyboard discovery', async () => {
  test.render(
    <TooltipProvider delay={0}>
      <AiActivity label="Reading your pages" />
    </TooltipProvider>
  );
  const status = test.screen.getByRole('status');

  test.expect(status).toHaveAccessibleName('Reading your pages');
  test.expect(test.within(status).getByText('Reading your pages')).toBeVisible();
  test.expect(status).toHaveAttribute('data-state', 'running');
});

test.stable.each(['waiting', 'stopping', 'attention'] as const)(
  'keeps %s work visible without an active-generation animation',
  (state) => {
    test.render(<AiActivity label="Current work" state={state} />);
    const status = test.screen.getByRole('status', { name: 'Current work' });

    test.expect(status).toHaveAttribute('data-state', state);
    test.expect(test.within(status).getByText('Current work')).toBeVisible();
    test.expect(status.querySelector('[data-working="true"]')).toBeNull();
  }
);
