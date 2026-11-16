import { test } from '@study/testing';

import { IconButton } from './icon-button';
import { TooltipProvider } from './tooltip';

test.unit.stable(
  'keeps disabled action help reachable without enabling its action',
  async ({ vi, userEvent, render, screen, expect }) => {
    const activate = vi.fn();
    const user = userEvent.setup();

    render(
      <TooltipProvider delay={0}>
        <IconButton label="Previous version" disabled onClick={activate} />
      </TooltipProvider>
    );
    const button = screen.getByRole('button', { name: 'Previous version' });

    expect(button).toBeDisabled();
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Previous version');
    await user.click(button);
    expect(activate).not.toHaveBeenCalled();
  }
);
