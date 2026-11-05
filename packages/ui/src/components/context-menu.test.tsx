import { testStable } from '@study/testing/vitest';
import { render, screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { ContextMenu, ContextMenuTrigger } from './context-menu';

testStable.each([false, true])('preserves trigger class callbacks with fill %s', (fill) => {
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
});
