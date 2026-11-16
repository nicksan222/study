import { test } from '@study/testing';
import { NotebookRail } from '@study/ui';

test.afterEach(() => test.vi.restoreAllMocks());

function mount() {
  test.render(
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
  const rail = test.screen.getByRole('navigation', { name: 'Notebook navigation' });
  const markers = test.within(rail).getAllByRole('button');

  markers.forEach((marker, index) => {
    test.vi
      .spyOn(marker, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, index * 10, 20, 8));
  });

  return { rail, markers };
}

const scale = (marker: HTMLElement) =>
  Number(marker.style.getPropertyValue('--notebook-marker-scale') || 1);

test.stable(
  'starts every marker at rest and magnifies a smooth symmetric neighborhood without moving hitboxes',
  () => {
    const { rail, markers } = mount();

    test.expect(markers.map(scale)).toEqual([1, 1, 1, 1, 1]);
    test.fireEvent(rail, new MouseEvent('pointermove', { bubbles: true, clientY: 24 }));
    const scales = markers.map(scale);

    test.expect(scales[2]).toBeGreaterThan(scales[1]!);
    test.expect(scales[1]).toBeGreaterThan(scales[0]!);
    test.expect(scales[0]).toBeGreaterThan(1);
    test.expect(scales[1]).toBe(scales[3]);
    test.fireEvent(rail, new MouseEvent('pointermove', { bubbles: true, clientY: 29 }));
    test.expect(scale(markers[2]!)).toBe(scale(markers[3]!));
    test
      .expect(markers.every((marker) => marker.style.height === '' && marker.style.width === ''))
      .toBe(true);
    test.fireEvent.pointerLeave(rail);
    test.expect(markers.map(scale)).toEqual([1, 1, 1, 1, 1]);
  }
);

test.stable(
  'uses the same tapered wave for keyboard focus, keeps it on pointer leave, and resets after blur',
  () => {
    const { rail, markers } = mount();

    test.act(() => markers[3]!.focus());
    test.expect(scale(markers[3]!)).toBeGreaterThan(scale(markers[2]!));
    test.expect(scale(markers[2]!)).toBeGreaterThan(scale(markers[0]!));
    const focused = markers.map(scale);

    test.fireEvent.pointerLeave(rail);
    test.expect(markers.map(scale)).toEqual(focused);
    test.act(() => test.screen.getByRole('button', { name: 'Outside rail' }).focus());
    test.expect(markers.map(scale)).toEqual([1, 1, 1, 1, 1]);
  }
);
