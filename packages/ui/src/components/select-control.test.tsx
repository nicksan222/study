import { testStable } from '@study/testing/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, vi } from 'vite-plus/test';

import { SelectControl } from './select-control';

const options = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];

testStable('shows option labels and commits string values through keyboard selection', async () => {
  const user = userEvent.setup();
  const changed = vi.fn();

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

  render(<Example />);
  const trigger = screen.getByRole('combobox', { name: 'Appearance' });

  expect(trigger).toHaveTextContent('System');
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('option', { name: 'System' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await user.keyboard('{ArrowDown}{Enter}');
  expect(changed).toHaveBeenCalledWith('light');
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  expect(trigger).toHaveTextContent('Light');
  expect(trigger).toHaveFocus();
});

testStable(
  'dismisses with Escape and outside click without changing the selected value',
  async () => {
    const user = userEvent.setup();
    const changed = vi.fn();

    render(
      <>
        <SelectControl label="Appearance" value="light" options={options} onValueChange={changed} />
        <button type="button">Elsewhere</button>
      </>
    );
    const trigger = screen.getByRole('combobox', { name: 'Appearance' });

    await user.click(trigger);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(changed).not.toHaveBeenCalled();
  }
);

testStable('does not open or change when disabled', async () => {
  const user = userEvent.setup();
  const changed = vi.fn();

  render(
    <SelectControl
      label="Appearance"
      value="dark"
      options={options}
      onValueChange={changed}
      disabled
    />
  );
  const trigger = screen.getByRole('combobox', { name: 'Appearance' });

  expect(trigger).toBeDisabled();
  expect(trigger).toHaveTextContent('Dark');
  await user.click(trigger);
  await user.keyboard('{Enter}{ArrowDown}');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
});
