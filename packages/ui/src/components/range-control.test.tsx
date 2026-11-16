import { test } from '@study/testing';

import { RangeControl } from './range-control';

test.stable('keeps slider movement local until release and does not save twice on blur', () => {
  const onCommit = test.vi.fn();

  test.render(
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
  const slider = test.screen.getByRole('slider', { name: 'Contrast' });

  test.fireEvent.change(slider, { target: { value: '120' } });
  test.expect(test.screen.getByText('120%')).toBeInTheDocument();
  test.expect(onCommit).not.toHaveBeenCalled();
  test.fireEvent.pointerUp(slider);
  test.fireEvent.blur(slider);
  test.expect(onCommit).toHaveBeenCalledExactlyOnceWith(120);
});
