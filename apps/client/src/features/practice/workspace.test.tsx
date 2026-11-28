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

test.unit.stable(
  'settles the default context panel with container layout while preserving explicit toggles',
  async ({ vi, render, screen, userEvent, act, expect }) => {
    let width = 992;
    let resize = (_target: Element) => {};

    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.dataset.variant === 'page' ? width : 540;
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private target?: Element;

        constructor(callback: () => void) {
          resize = (target) => {
            if (this.target === target) callback();
          };
        }

        observe(target: Element) {
          this.target = target;
        }

        disconnect() {}
      }
    );
    let unmount: (() => void) | undefined;

    try {
      const view = render(
        <PracticeWorkspace title="Recall" actions={<button>Source action</button>}>
          <button>Core question</button>
        </PracticeWorkspace>
      );

      unmount = view.unmount;
      const container = view.container.querySelector('[data-variant="page"]')!;
      const toggle = screen.getByRole('button', { name: catalogs.english.PracticeActions });
      const question = screen.getByRole('button', { name: 'Core question' });

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      screen.getByRole('button', { name: 'Source action' }).focus();
      act(() => {
        width = 736;
        resize(container);
      });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveFocus();
      act(() => {
        width = 992;
        resize(container);
      });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      question.focus();
      act(() => {
        width = 736;
        resize(container);
      });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(question).toHaveFocus();
      act(() => {
        width = 992;
        resize(container);
      });
      await userEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      act(() => {
        width = 736;
        resize(container);
        width = 992;
        resize(container);
      });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(toggle);
      const source = screen.getByRole('button', { name: 'Source action' });

      source.focus();
      act(() => {
        width = 736;
        resize(container);
      });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(source).toHaveFocus();
    } finally {
      try {
        unmount?.();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  }
);

test.unit.stable(
  'measures the workspace again on window resize without ResizeObserver',
  ({ vi, render, screen, act, expect }) => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(992);

    vi.stubGlobal('ResizeObserver', undefined);

    try {
      const view = render(
        <PracticeWorkspace title="Recall" actions={<button>Source action</button>}>
          <button>Core question</button>
        </PracticeWorkspace>
      );

      try {
        const toggle = screen.getByRole('button', { name: catalogs.english.PracticeActions });

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        act(() => {
          width.mockReturnValue(736);
          window.dispatchEvent(new Event('resize'));
        });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
      } finally {
        view.unmount();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  }
);
