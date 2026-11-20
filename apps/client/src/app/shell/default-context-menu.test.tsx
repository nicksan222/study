import { projectIdSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { ContextMenu, ContextMenuTrigger, ContextMenuPopup, ContextMenuItem } from '@study/ui';

import type * as __StudyMockType0 from '#client/app/shell/default-context-menu.tsx';

let DefaultContextMenu: typeof __StudyMockType0.DefaultContextMenu;

test.unit.beforeEach(async () => {
  const __studyMockModule0 = await import('./default-context-menu');

  DefaultContextMenu = __studyMockModule0.DefaultContextMenu;
});

const en = catalogs.english;

test.unit.stable(
  'offers creation and scoped destinations on otherwise unhandled content',
  async ({ renderInRouter, fireEvent, screen, expect, userEvent, waitFor }) => {
    renderInRouter(
      <DefaultContextMenu project={projectIdSchema.make(2n)}>
        <p>Workspace</p>
      </DefaultContextMenu>
    );

    fireEvent.contextMenu(await screen.findByText('Workspace'));
    expect(await screen.findByRole('menuitem', { name: en.NewNote })).toBeEnabled();
    expect(screen.queryByRole('menuitem', { name: en.PageNew })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: en.Practice })).toHaveAttribute(
      'href',
      '/practice?project=2'
    );
    expect(screen.getByRole('menuitem', { name: en.Projects })).toHaveAttribute(
      'href',
      '/projects'
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  }
);

test.unit.stable(
  'lets nested custom menus and handlers take precedence over the fallback',
  async ({ renderInRouter, fireEvent, screen, expect, userEvent, waitFor }) => {
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
  }
);
