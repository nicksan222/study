import { testStable } from '@study/testing/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { ProviderKeyRow } from './provider-settings';

const provider = {
  id: 'anthropic',
  name: 'Anthropic',
  configured: true,
  models: ['claude-sonnet-4-6'],
  defaults: { tiny: 'claude-sonnet-4-6', medium: 'claude-sonnet-4-6', smart: 'claude-sonnet-4-6' }
};

testStable(
  'provider keys are password inputs, saved explicitly, and cleared after success',
  async () => {
    const save = vi.fn().mockResolvedValue(undefined);

    render(<ProviderKeyRow provider={provider} pending={false} save={save} />);
    const input = screen.getByLabelText('API key');

    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled();
    await userEvent.type(input, 'test-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save key' }));
    expect(save).toHaveBeenCalledWith('anthropic', 'test-secret');
    await waitFor(() => expect(input).toHaveValue(''));
    await userEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(save).toHaveBeenLastCalledWith('anthropic', null);
  }
);

testStable('a failed key save preserves the draft for retry', async () => {
  const save = vi.fn().mockRejectedValue(new Error('offline'));

  render(<ProviderKeyRow provider={provider} pending={false} save={save} />);
  const input = screen.getByLabelText('API key');

  await userEvent.type(input, 'test-secret');
  await userEvent.click(screen.getByRole('button', { name: 'Save key' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(input).toHaveValue('test-secret');
});
