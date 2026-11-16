import { test } from '@study/testing';

import { WorkspaceCard } from './workspace';

test.afterEach(test.cleanup);

test.stable('toggles the associated panel by keyboard and preserves its draft', async () => {
  const user = test.userEvent.setup();

  test.render(
    <WorkspaceCard.Provider>
      <WorkspaceCard.Toggle label="Note context" />
      <WorkspaceCard.Root aria-label="Note context">
        <input aria-label="Instruction" defaultValue="Preserve this draft" />
      </WorkspaceCard.Root>
    </WorkspaceCard.Provider>
  );
  const toggle = test.screen.getByRole('button', { name: 'Note context' });
  const panel = test.screen.getByRole('complementary', { name: 'Note context' });

  test.expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
  test.expect(toggle.getAttribute('aria-expanded')).toBe('true');
  toggle.focus();
  await user.keyboard('{Enter}');
  test.expect(toggle.getAttribute('aria-expanded')).toBe('false');
  test.expect(panel.hidden).toBe(true);
  await user.keyboard(' ');
  test.expect(toggle.getAttribute('aria-expanded')).toBe('true');
  test
    .expect(test.screen.getByRole('textbox', { name: 'Instruction' }).getAttribute('value'))
    .toBe('Preserve this draft');
  test.screen.getByRole('textbox', { name: 'Instruction' }).focus();
  await user.keyboard('{Escape}');
  test.expect(panel.hidden).toBe(true);
  test.expect(document.activeElement).toBe(toggle);
});
