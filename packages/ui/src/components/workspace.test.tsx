import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vite-plus/test';

import { WorkspaceCard } from './workspace';

afterEach(cleanup);

it('toggles the associated panel by keyboard and preserves its draft', async () => {
  const user = userEvent.setup();
  render(
    <WorkspaceCard.Provider>
      <WorkspaceCard.Toggle label="Session context" />
      <WorkspaceCard.Root aria-label="Session context">
        <input aria-label="Instruction" defaultValue="Preserve this draft" />
      </WorkspaceCard.Root>
    </WorkspaceCard.Provider>
  );
  const toggle = screen.getByRole('button', { name: 'Session context' });
  const panel = screen.getByRole('complementary', { name: 'Session context' });
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
  screen.getByRole('textbox', { name: 'Instruction' }).focus();
  await user.keyboard('{Escape}');
  expect(panel.hidden).toBe(true);
  expect(document.activeElement).toBe(toggle);
});
