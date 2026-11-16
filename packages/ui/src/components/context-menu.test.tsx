import { test } from '@study/testing';

import { ContextMenu, ContextMenuTrigger } from './context-menu';

test.stable.each([false, true])('preserves trigger class callbacks with fill %s', (fill) => {
  test.render(
    <ContextMenu>
      <ContextMenuTrigger
        fill={fill}
        className={() => 'state-dependent'}
        aria-label="Menu surface"
      />
    </ContextMenu>
  );

  const trigger = test.screen.getByLabelText('Menu surface');

  test.expect(trigger).toHaveClass('state-dependent');
  test.expect(trigger.classList.contains('h-full')).toBe(fill);
});
