import { test } from '@study/testing';

import { ContextMenu, ContextMenuTrigger } from './context-menu';

test.stable.for([false, true])(
  'preserves trigger class callbacks with fill %s',
  (fill, { render, screen, expect }) => {
    render(
      <ContextMenu>
        <ContextMenuTrigger
          fill={fill}
          className={() => 'state-dependent'}
          aria-label="Menu surface"
        />
      </ContextMenu>
    );

    const trigger = screen.getByLabelText('Menu surface');

    expect(trigger).toHaveClass('state-dependent');
    expect(trigger.classList.contains('h-full')).toBe(fill);
  }
);
