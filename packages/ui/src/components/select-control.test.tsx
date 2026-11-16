import { test } from '@study/testing';
import { useState } from 'react';

import { SelectControl } from './select-control';

const options = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];

test.unit.stable(
  'shows option labels and commits string values through keyboard selection',
  async ({ userEvent, vi, render, screen, expect, waitFor }) => {
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
    expect(await screen.findByRole('listbox', { name: 'Appearance' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'System' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await user.keyboard('{ArrowDown}{Enter}');
    expect(changed).toHaveBeenCalledWith('light');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger).toHaveTextContent('Light');
    expect(trigger).toHaveFocus();
  }
);

test.unit.stable(
  'dismisses with Escape and outside click without changing the selected value',
  async ({ userEvent, vi, render, screen, expect, waitFor }) => {
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

test.unit.stable(
  'does not open or change when disabled',
  async ({ userEvent, vi, render, screen, expect }) => {
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
  }
);

test.unit.stable(
  'keeps disabled options visible while skipping them during keyboard selection',
  async ({ userEvent, vi, render, screen, expect }) => {
    const user = userEvent.setup();
    const changed = vi.fn();

    render(
      <SelectControl
        label="Appearance"
        value="system"
        options={options.map((option) => ({ ...option, disabled: option.value === 'light' }))}
        onValueChange={changed}
      />
    );
    await user.click(screen.getByRole('combobox', { name: 'Appearance' }));
    const unavailable = await screen.findByRole('option', { name: 'Light' });

    expect(unavailable).toHaveAttribute('aria-disabled', 'true');
    await user.click(unavailable);
    expect(changed).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(changed).toHaveBeenCalledExactlyOnceWith('dark');
  }
);
