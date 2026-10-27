import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { expect, it, vi } from 'vite-plus/test';

import { List } from './list';

it('keeps a rendered list row a native keyboard-operable button with its ref', async () => {
  const click = vi.fn();
  const ref = createRef<HTMLButtonElement>();

  render(
    <List.Root>
      <List.Row
        render={<button ref={ref} type="button" onClick={click} aria-label="Cell biology" />}
      >
        <List.Main>
          <List.Title>Cell biology</List.Title>
        </List.Main>
      </List.Row>
    </List.Root>
  );
  const row = screen.getByRole('button', { name: 'Cell biology' });

  expect(ref.current).toBe(row);
  row.focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(click).toHaveBeenCalledOnce();
});
