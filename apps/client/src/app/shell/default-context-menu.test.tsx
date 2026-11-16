import { projectIdSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { ContextMenu, ContextMenuTrigger, ContextMenuPopup, ContextMenuItem } from '@study/ui';

import { DefaultContextMenu } from './default-context-menu';

test.mock('#client/features/pages/index.ts', () => ({
  useNewBlankPage: () => ({ pending: false, create: async () => true })
}));

const en = catalogs.english;

test.stable('offers creation and scoped destinations on otherwise unhandled content', async () => {
  test.renderInRouter(
    <DefaultContextMenu project={projectIdSchema.make(2n)}>
      <p>Workspace</p>
    </DefaultContextMenu>
  );

  test.fireEvent.contextMenu(await test.screen.findByText('Workspace'));
  test.expect(await test.screen.findByRole('menuitem', { name: en.NewNote })).toBeEnabled();
  test.expect(test.screen.getByRole('menuitem', { name: en.PageNew })).toBeEnabled();
  test
    .expect(test.screen.getByRole('menuitem', { name: en.SourcePage }))
    .toHaveAttribute('href', '/pages?project=2');
  test
    .expect(test.screen.getByRole('menuitem', { name: en.Projects }))
    .toHaveAttribute('href', '/projects');
  await test.userEvent.keyboard('{Escape}');
  await test.waitFor(() => test.expect(test.screen.queryByRole('menu')).not.toBeInTheDocument());
});

test.stable('lets nested custom menus and handlers take precedence over the fallback', async () => {
  test.renderInRouter(
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

  test.fireEvent.contextMenu(await test.screen.findByText('Custom target'));
  test
    .expect(await test.screen.findByRole('menuitem', { name: 'Custom action' }))
    .toBeInTheDocument();
  test.expect(test.screen.queryByRole('menuitem', { name: en.NewNote })).not.toBeInTheDocument();
  await test.userEvent.keyboard('{Escape}');
  await test.waitFor(() => test.expect(test.screen.queryByRole('menu')).not.toBeInTheDocument());
  test.fireEvent.contextMenu(test.screen.getByRole('button', { name: 'Handled target' }));
  await test.waitFor(() => test.expect(test.screen.queryByRole('menu')).not.toBeInTheDocument());
});
