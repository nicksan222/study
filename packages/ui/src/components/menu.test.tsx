import { test } from '@study/testing';

import { Button } from './button';
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from './menu';

test.afterEach(test.cleanup);

test.stable(
  'opens from the keyboard, skips disabled items, and restores trigger focus on Escape',
  async () => {
    const user = test.userEvent.setup();

    test.render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuPopup>
          <MenuItem disabled>Unavailable</MenuItem>
          <MenuSeparator />
          <MenuItem>Rename</MenuItem>
        </MenuPopup>
      </Menu>
    );
    const trigger = test.screen.getByRole('button', { name: 'Actions' });

    trigger.focus();
    await user.keyboard('{Enter}');
    test.expect(await test.screen.findByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument()
    );
    test.expect(trigger).toHaveFocus();
  }
);

test.stable(
  'runs a selected action, dismisses the menu, and dismisses on outside click',
  async () => {
    const user = test.userEvent.setup();
    const rename = test.vi.fn();

    test.render(
      <>
        <Menu>
          <MenuTrigger>Actions</MenuTrigger>
          <MenuPopup>
            <MenuItem onClick={rename}>Rename</MenuItem>
          </MenuPopup>
        </Menu>
        <button type="button">Elsewhere</button>
      </>
    );
    const trigger = test.screen.getByRole('button', { name: 'Actions' });

    await user.click(trigger);
    await user.click(await test.screen.findByRole('menuitem', { name: 'Rename' }));
    test.expect(rename).toHaveBeenCalledOnce();
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument()
    );
    await user.click(trigger);
    test.expect(await test.screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: 'Elsewhere' }));
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument()
    );
  }
);

test.stable('keeps keyboard operation when the trigger renders the shared Button', async () => {
  const user = test.userEvent.setup();

  test.render(
    <Menu>
      <MenuTrigger render={<Button variant="ghost" />}>More actions</MenuTrigger>
      <MenuPopup>
        <MenuItem>Rename</MenuItem>
      </MenuPopup>
    </Menu>
  );
  const trigger = test.screen.getByRole('button', { name: 'More actions' });

  trigger.focus();
  await user.keyboard('{Enter}');
  const item = await test.screen.findByRole('menuitem', { name: 'Rename' });

  await test.waitFor(() => test.expect(item).toHaveFocus());
});
