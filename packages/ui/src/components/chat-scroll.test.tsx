import { test } from '@study/testing';

import { ChatNote } from './chat';

function Note({ count = 2, first = 'first' }: { count?: number; first?: string }) {
  return (
    <div className="workspace-desk-notebook">
      <div data-notebook-scroll-host>
        <ChatNote
          label="Notebook"
          jumpLabel="Latest"
          itemCount={count}
          firstItemKey={first}
          navigation={<nav aria-label="Page index">Markers</nav>}
        >
          <p>Notebook content</p>
        </ChatNote>
      </div>
      <div data-notebook-navigation-host />
    </div>
  );
}

function dimensions(host: HTMLElement, height: number) {
  Object.defineProperty(host, 'scrollHeight', { configurable: true, value: height });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 200 });
}

test.stable(
  'uses the workspace scroll host for reading position and the Latest action',
  async () => {
    const view = test.render(<Note />);
    const host = view.container.querySelector<HTMLElement>('[data-notebook-scroll-host]')!;
    const overlay = view.container.querySelector('[data-notebook-navigation-host]')!;

    dimensions(host, 1000);
    host.scrollTop = 100;
    const scroll = test.vi.fn();

    host.scrollTo = scroll;
    test.fireEvent.scroll(host);
    const latest = await test.screen.findByRole('button', { name: 'Latest' });

    test.expect(overlay).toContainElement(latest);
    test
      .expect(overlay)
      .toContainElement(test.screen.getByRole('navigation', { name: 'Page index' }));
    test.fireEvent.click(latest);
    test.expect(scroll).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  }
);

test.stable(
  'preserves the reader position when older entries are prepended in the workspace host',
  async () => {
    const view = test.render(<Note />);
    const host = view.container.querySelector<HTMLElement>('[data-notebook-scroll-host]')!;

    dimensions(host, 1000);
    host.scrollTop = 100;
    test.fireEvent.scroll(host);
    await test.screen.findByRole('button', { name: 'Latest' });
    dimensions(host, 1200);
    view.rerender(<Note count={3} first="older" />);
    await test.waitFor(() => test.expect(host.scrollTop).toBe(300));
  }
);
