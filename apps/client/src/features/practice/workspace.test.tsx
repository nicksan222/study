import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { PracticeWorkspace } from './workspace';

for (const [width, initiallyOpen] of [
  [959, false],
  [960, true],
  [992, true]
] as const) {
  test.unit.stable(
    `uses the available ${width}px container to initialize practice actions`,
    async ({ vi, userEvent, render, screen, expect }) => {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
      const user = userEvent.setup();

      render(
        <div>
          <PracticeWorkspace title="Recall" actions={<button>Source action</button>}>
            <h2>Core question</h2>
          </PracticeWorkspace>
        </div>
      );
      const toggle = screen.getByRole('button', { name: catalogs.english.PracticeActions });
      const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;

      expect(toggle).toHaveAttribute('aria-expanded', String(initiallyOpen));
      expect(panel.hidden).toBe(!initiallyOpen);
      await user.click(toggle);
      expect(panel.hidden).toBe(initiallyOpen);
      expect(screen.getByRole('heading', { name: 'Core question' })).toBeInTheDocument();

      if (initiallyOpen) await user.click(toggle);

      screen.getByRole('button', { name: 'Source action' }).focus();
      await user.keyboard('{Escape}');
      expect(panel.hidden).toBe(true);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveFocus();
    }
  );
}
