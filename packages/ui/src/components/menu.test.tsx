import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { Button } from './button';
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from './menu';

afterEach(cleanup);

it('opens from the keyboard, skips disabled items, and restores trigger focus on Escape', async () => {
  const user = userEvent.setup();

  render(
    <Menu>
      <MenuTrigger>Actions</MenuTrigger>
      <MenuPopup>
        <MenuItem disabled>Unavailable</MenuItem>
        <MenuSeparator />
        <MenuItem>Rename</MenuItem>
      </MenuPopup>
    </Menu>
  );
  const trigger = screen.getByRole('button', { name: 'Actions' });

  trigger.focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('menuitem', { name: 'Rename' })).toHaveFocus();
  await user.keyboard('{Escape}');
  await waitFor(() =>
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument()
  );
  expect(trigger).toHaveFocus();
});

it('runs a selected action, dismisses the menu, and dismisses on outside click', async () => {
  const user = userEvent.setup();
  const rename = vi.fn();

  render(
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
  const trigger = screen.getByRole('button', { name: 'Actions' });

  await user.click(trigger);
  await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
  expect(rename).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument()
  );
  await user.click(trigger);
  expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
  await waitFor(() =>
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument()
  );
});

it('keeps keyboard operation when the trigger renders the shared Button', async () => {
  const user = userEvent.setup();

  render(
    <Menu>
      <MenuTrigger render={<Button variant="ghost" />}>More actions</MenuTrigger>
      <MenuPopup>
        <MenuItem>Rename</MenuItem>
      </MenuPopup>
    </Menu>
  );
  const trigger = screen.getByRole('button', { name: 'More actions' });

  trigger.focus();
  await user.keyboard('{Enter}');
  const item = await screen.findByRole('menuitem', { name: 'Rename' });

  await waitFor(() => expect(item).toHaveFocus());
});
