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

function dimensions(host: HTMLElement, height: number, viewport = 200) {
  Object.defineProperty(host, 'scrollHeight', { configurable: true, value: height });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: viewport });
}

test.unit.stable(
  'uses the workspace scroll host for reading position and the Latest action',
  async ({ render, vi, fireEvent, screen, expect }) => {
    const view = render(<Note />);
    const host = view.container.querySelector<HTMLElement>('[data-notebook-scroll-host]')!;
    const overlay = view.container.querySelector('[data-notebook-navigation-host]')!;

    dimensions(host, 1000);
    host.scrollTop = 100;
    const scroll = vi.fn();

    host.scrollTo = scroll;
    fireEvent.scroll(host);
    const latest = await screen.findByRole('button', { name: 'Latest' });

    expect(overlay).toContainElement(latest);
    expect(overlay).toContainElement(screen.getByRole('navigation', { name: 'Page index' }));
    fireEvent.click(latest);
    expect(scroll).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  }
);

test.unit.stable(
  'preserves the reader position when older entries are prepended in the workspace host',
  async ({ render, fireEvent, screen, waitFor, expect }) => {
    const view = render(<Note />);
    const host = view.container.querySelector<HTMLElement>('[data-notebook-scroll-host]')!;

    dimensions(host, 1000);
    host.scrollTop = 100;
    fireEvent.scroll(host);
    await screen.findByRole('button', { name: 'Latest' });
    dimensions(host, 1200);
    view.rerender(<Note count={3} first="older" />);
    await waitFor(() => expect(host.scrollTop).toBe(300));
  }
);

test.unit.stable(
  'updates Latest after resizing while preserving readers and following the end',
  async ({ render, vi, fireEvent, screen, act, expect }) => {
    let resize = (_target: Element) => {};

    vi.stubGlobal(
      'ResizeObserver',
      class implements ResizeObserver {
        private readonly targets = new Set<Element>();

        constructor(callback: ResizeObserverCallback) {
          resize = (target) => {
            if (this.targets.has(target)) callback([], this);
          };
        }

        observe(target: Element) {
          this.targets.add(target);
        }

        unobserve(target: Element) {
          this.targets.delete(target);
        }

        disconnect() {
          this.targets.clear();
        }
      }
    );

    const view = render(<Note />);
    const host = view.container.querySelector<HTMLElement>('[data-notebook-scroll-host]')!;

    const content = view.container.querySelector('.chat-content')!;
    let top = 0;

    Object.defineProperty(host, 'scrollTop', {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, host.scrollHeight - host.clientHeight));
      }
    });

    dimensions(host, 1000);
    host.scrollTop = 100;
    fireEvent.scroll(host);
    expect(screen.getByRole('button', { name: 'Latest' })).toBeVisible();
    dimensions(host, 1000, 250);
    await act(async () => resize(host));
    expect(host.scrollTop).toBe(100);
    expect(screen.getByRole('button', { name: 'Latest' })).toBeVisible();
    dimensions(host, 350, 250);
    await act(async () => resize(content));
    expect(host.scrollTop).toBe(100);
    expect(screen.queryByRole('button', { name: 'Latest' })).not.toBeInTheDocument();
    dimensions(host, 1050, 250);
    await act(async () => resize(content));
    expect(host.scrollTop).toBe(800);
    expect(screen.queryByRole('button', { name: 'Latest' })).not.toBeInTheDocument();
  }
);
