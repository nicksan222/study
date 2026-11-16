import { test } from '@study/testing';

import { IconButton } from './icon-button';
import { TooltipProvider } from './tooltip';

test.stable('keeps disabled action help reachable without enabling its action', async () => {
  const activate = test.vi.fn();
  const user = test.userEvent.setup();

  test.render(
    <TooltipProvider delay={0}>
      <IconButton label="Previous version" disabled onClick={activate} />
    </TooltipProvider>
  );
  const button = test.screen.getByRole('button', { name: 'Previous version' });

  test.expect(button).toBeDisabled();
  await user.tab();
  test.expect(await test.screen.findByRole('tooltip')).toHaveTextContent('Previous version');
  await user.click(button);
  test.expect(activate).not.toHaveBeenCalled();
});
