import { test } from '@study/testing';
import { createRef } from 'react';

import { List } from './list';

test.stable(
  'keeps a rendered list row a native keyboard-operable button with its ref',
  async () => {
    const click = test.vi.fn();
    const ref = createRef<HTMLButtonElement>();

    test.render(
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
    const row = test.screen.getByRole('button', { name: 'Cell biology' });

    test.expect(ref.current).toBe(row);
    row.focus();
    await test.userEvent.setup().keyboard('{Enter}');
    test.expect(click).toHaveBeenCalledOnce();
  }
);
