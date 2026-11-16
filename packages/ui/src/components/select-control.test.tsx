import { test } from '@study/testing';
import { useState } from 'react';

import { SelectControl } from './select-control';

const options = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];

test.stable(
  'shows option labels and commits string values through keyboard selection',
  async () => {
    const user = test.userEvent.setup();
    const changed = test.vi.fn();

    function Example() {
      const [value, setValue] = useState('system');

      return (
        <SelectControl
          label="Appearance"
          value={value}
          options={options}
          onValueChange={(nextValue) => {
            changed(nextValue);
            setValue(nextValue);
          }}
        />
      );
    }

    test.render(<Example />);
    const trigger = test.screen.getByRole('combobox', { name: 'Appearance' });

    test.expect(trigger).toHaveTextContent('System');
    trigger.focus();
    await user.keyboard('{Enter}');
    test
      .expect(await test.screen.findByRole('listbox', { name: 'Appearance' }))
      .toBeInTheDocument();
    test
      .expect(await test.screen.findByRole('option', { name: 'System' }))
      .toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{Enter}');
    test.expect(changed).toHaveBeenCalledWith('light');
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('listbox')).not.toBeInTheDocument()
    );
    test.expect(trigger).toHaveTextContent('Light');
    test.expect(trigger).toHaveFocus();
  }
);

test.stable(
  'dismisses with Escape and outside click without changing the selected value',
  async () => {
    const user = test.userEvent.setup();
    const changed = test.vi.fn();

    test.render(
      <>
        <SelectControl label="Appearance" value="light" options={options} onValueChange={changed} />
        <button type="button">Elsewhere</button>
      </>
    );
    const trigger = test.screen.getByRole('combobox', { name: 'Appearance' });

    await user.click(trigger);
    test.expect(await test.screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Escape}');
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('listbox')).not.toBeInTheDocument()
    );
    test.expect(trigger).toHaveFocus();
    await user.click(trigger);
    test.expect(await test.screen.findByRole('listbox')).toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: 'Elsewhere' }));
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('listbox')).not.toBeInTheDocument()
    );
    test.expect(changed).not.toHaveBeenCalled();
  }
);

test.stable('does not open or change when disabled', async () => {
  const user = test.userEvent.setup();
  const changed = test.vi.fn();

  test.render(
    <SelectControl
      label="Appearance"
      value="dark"
      options={options}
      onValueChange={changed}
      disabled
    />
  );
  const trigger = test.screen.getByRole('combobox', { name: 'Appearance' });

  test.expect(trigger).toBeDisabled();
  test.expect(trigger).toHaveTextContent('Dark');
  await user.click(trigger);
  await user.keyboard('{Enter}{ArrowDown}');
  test.expect(test.screen.queryByRole('listbox')).not.toBeInTheDocument();
  test.expect(changed).not.toHaveBeenCalled();
});

test.stable(
  'keeps disabled options visible while skipping them during keyboard selection',
  async () => {
    const user = test.userEvent.setup();
    const changed = test.vi.fn();

    test.render(
      <SelectControl
        label="Appearance"
        value="system"
        options={options.map((option) => ({ ...option, disabled: option.value === 'light' }))}
        onValueChange={changed}
      />
    );
    await user.click(test.screen.getByRole('combobox', { name: 'Appearance' }));
    const unavailable = await test.screen.findByRole('option', { name: 'Light' });

    test.expect(unavailable).toHaveAttribute('aria-disabled', 'true');
    await user.click(unavailable);
    test.expect(changed).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}{Enter}');
    test.expect(changed).toHaveBeenCalledExactlyOnceWith('dark');
  }
);
