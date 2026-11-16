import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { PracticeWorkspace } from './workspace';

for (const [width, initiallyOpen] of [
  [959, false],
  [960, true],
  [992, true]
] as const) {
  test.stable(
    `uses the available ${width}px container to initialize practice actions`,
    async () => {
      test.vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
      const user = test.userEvent.setup();

      test.render(
        <div>
          <PracticeWorkspace title="Recall" actions={<button>Source action</button>}>
            <h2>Core question</h2>
          </PracticeWorkspace>
        </div>
      );
      const toggle = test.screen.getByRole('button', { name: catalogs.english.PracticeActions });
      const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;

      test.expect(toggle).toHaveAttribute('aria-expanded', String(initiallyOpen));
      test.expect(panel.hidden).toBe(!initiallyOpen);
      await user.click(toggle);
      test.expect(panel.hidden).toBe(initiallyOpen);
      test.expect(test.screen.getByRole('heading', { name: 'Core question' })).toBeInTheDocument();

      if (initiallyOpen) await user.click(toggle);

      test.screen.getByRole('button', { name: 'Source action' }).focus();
      await user.keyboard('{Escape}');
      test.expect(panel.hidden).toBe(true);
      test.expect(toggle).toHaveAttribute('aria-expanded', 'false');
      test.expect(toggle).toHaveFocus();
    }
  );
}
