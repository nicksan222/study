import { test } from '@study/testing';

import { RangeControl } from './range-control';

test.unit.stable(
  'keeps slider movement local until release and does not save twice on blur',
  ({ vi, render, screen, fireEvent, expect }) => {
    const onCommit = vi.fn();

    render(
      <RangeControl
        label="Contrast"
        resetLabel="Reset contrast"
        value={100}
        defaultValue={100}
        min={75}
        max={150}
        onCommit={onCommit}
      />
    );
    const slider = screen.getByRole('slider', { name: 'Contrast' });

    fireEvent.change(slider, { target: { value: '120' } });
    expect(screen.getByText('120%')).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(120);
  }
);
