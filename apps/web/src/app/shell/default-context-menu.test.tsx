import { projectIdSchema } from '@study/contracts/ids';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem
} from '@study/ui/context-menu';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { renderInRouter } from '#web/test/render-in-router.tsx';

import { DefaultContextMenu } from './default-context-menu';

vi.mock('#web/features/pages/index.ts', () => ({
  useNewBlankPage: () => ({ pending: false, create: async () => true })
}));

const en = catalogs.english;

testStable('offers creation and scoped destinations on otherwise unhandled content', async () => {
  renderInRouter(
    <DefaultContextMenu project={projectIdSchema.make(2n)}>
      <p>Workspace</p>
    </DefaultContextMenu>
  );

  fireEvent.contextMenu(await screen.findByText('Workspace'));
  expect(await screen.findByRole('menuitem', { name: en.NewNote })).toBeEnabled();
  expect(screen.getByRole('menuitem', { name: en.PageNew })).toBeEnabled();
  expect(screen.getByRole('menuitem', { name: en.SourcePage })).toHaveAttribute(
    'href',
    '/pages?project=2'
  );
  expect(screen.getByRole('menuitem', { name: en.Projects })).toHaveAttribute('href', '/projects');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
});

testStable('lets nested custom menus and handlers take precedence over the fallback', async () => {
  renderInRouter(
    <DefaultContextMenu>
      <ContextMenu>
        <ContextMenuTrigger>Custom target</ContextMenuTrigger>
        <ContextMenuPopup>
          <ContextMenuItem>Custom action</ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      <button onContextMenu={(event) => event.preventDefault()}>Handled target</button>
    </DefaultContextMenu>
  );

  fireEvent.contextMenu(await screen.findByText('Custom target'));
  expect(await screen.findByRole('menuitem', { name: 'Custom action' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: en.NewNote })).not.toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Handled target' }));
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
});
