import { test } from '@study/testing';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { WorkspaceCard } from './workspace';

test.unit.afterEach(({ cleanup }) => cleanup());

test.unit.stable(
  'toggles the associated panel by keyboard and preserves its draft',
  async ({ userEvent, render, screen, expect }) => {
    const user = userEvent.setup();

    function ControlledCard() {
      const [open, setOpen] = useState(true);

      return (
        <WorkspaceCard.Provider open={open} onOpenChange={setOpen}>
          <WorkspaceCard.Toggle label="Note context" />
          <WorkspaceCard.Root aria-label="Note context">
            <input aria-label="Instruction" defaultValue="Preserve this draft" />
            {createPortal(<button>Portal action</button>, document.body)}
          </WorkspaceCard.Root>
        </WorkspaceCard.Provider>
      );
    }

    render(<ControlledCard />);
    const toggle = screen.getByRole('button', { name: 'Note context' });
    const panel = screen.getByRole('complementary', { name: 'Note context' });

    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    await user.keyboard(' ');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Instruction' }).getAttribute('value')).toBe(
      'Preserve this draft'
    );
    screen.getByRole('button', { name: 'Portal action' }).focus();
    await user.keyboard('{Escape}');
    expect(panel.hidden).toBe(false);
    screen.getByRole('textbox', { name: 'Instruction' }).focus();
    await user.keyboard('{Escape}');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    await user.keyboard('{Enter}');
    expect(panel.hidden).toBe(false);
    await user.keyboard('{Escape}');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  }
);
