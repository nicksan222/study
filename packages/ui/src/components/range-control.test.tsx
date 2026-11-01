import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';

import { RangeControl } from './range-control';

it('keeps slider movement local until release and does not save twice on blur', () => {
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
});
