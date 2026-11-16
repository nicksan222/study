import { test } from '@study/testing';
import { NotebookRail } from '@study/ui';

test.afterEach(({ vi }) => vi.restoreAllMocks());

function mount({
  render,
  screen,
  within,
  vi
}: Pick<test.Context, 'render' | 'screen' | 'within' | 'vi'>) {
  render(
    <>
      <NotebookRail.Root label="Notebook navigation">
        {(
          [
            ['a', 'note'],
            ['b', 'reply'],
            ['c', 'page'],
            ['d', 'attachment'],
            ['e', 'note']
          ] as const
        ).map(([key, kind], index) => (
          <NotebookRail.Marker
            key={key}
            target={String(index)}
            kind={kind}
            label={`Entry ${index}`}
            preview={`Preview ${index}`}
            onSelect={() => undefined}
          />
        ))}
      </NotebookRail.Root>
      <button type="button">Outside rail</button>
    </>
  );
  const rail = screen.getByRole('navigation', { name: 'Notebook navigation' });
  const markers = within(rail).getAllByRole('button');

  markers.forEach((marker, index) => {
    vi.spyOn(marker, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 10, 20, 8));
  });

  return { rail, markers };
}

const scale = (marker: HTMLElement) =>
  Number(marker.style.getPropertyValue('--notebook-marker-scale') || 1);

test.stable(
  'starts every marker at rest and magnifies a smooth symmetric neighborhood without moving hitboxes',
  ({ expect, fireEvent, render, screen, within, vi }) => {
    const { rail, markers } = mount({ render, screen, within, vi });

    expect(markers.map(scale)).toEqual([1, 1, 1, 1, 1]);
    fireEvent(rail, new MouseEvent('pointermove', { bubbles: true, clientY: 24 }));
    const scales = markers.map(scale);

    expect(scales[2]).toBeGreaterThan(scales[1]!);
    expect(scales[1]).toBeGreaterThan(scales[0]!);
    expect(scales[0]).toBeGreaterThan(1);
    expect(scales[1]).toBe(scales[3]);
    fireEvent(rail, new MouseEvent('pointermove', { bubbles: true, clientY: 29 }));
    expect(scale(markers[2]!)).toBe(scale(markers[3]!));
    expect(markers.every((marker) => marker.style.height === '' && marker.style.width === '')).toBe(
      true
    );
    fireEvent.pointerLeave(rail);
    expect(markers.map(scale)).toEqual([1, 1, 1, 1, 1]);
  }
);

test.stable(
  'uses the same tapered wave for keyboard focus, keeps it on pointer leave, and resets after blur',
  ({ act, expect, fireEvent, screen, render, within, vi }) => {
    const { rail, markers } = mount({ render, screen, within, vi });

    act(() => markers[3]!.focus());
    expect(scale(markers[3]!)).toBeGreaterThan(scale(markers[2]!));
    expect(scale(markers[2]!)).toBeGreaterThan(scale(markers[0]!));
    const focused = markers.map(scale);

    fireEvent.pointerLeave(rail);
    expect(markers.map(scale)).toEqual(focused);
    act(() => screen.getByRole('button', { name: 'Outside rail' }).focus());
    expect(markers.map(scale)).toEqual([1, 1, 1, 1, 1]);
  }
);
