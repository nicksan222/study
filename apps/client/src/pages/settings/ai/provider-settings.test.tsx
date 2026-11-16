import { test } from '@study/testing';

import { ProviderKeyRow } from './provider-settings';

const provider = {
  id: 'anthropic',
  name: 'Anthropic',
  configured: true,
  models: ['claude-sonnet-4-6'],
  defaults: { tiny: 'claude-sonnet-4-6', medium: 'claude-sonnet-4-6', smart: 'claude-sonnet-4-6' }
};

test.stable(
  'provider keys are password inputs, saved explicitly, and cleared after success',
  async () => {
    const save = test.vi.fn().mockResolvedValue(undefined);

    test.render(<ProviderKeyRow provider={provider} pending={false} save={save} />);
    const input = test.screen.getByLabelText('API key');

    test.expect(input).toHaveAttribute('type', 'password');
    test.expect(input).toHaveValue('');
    test.expect(test.screen.getByRole('button', { name: 'Save key' })).toBeDisabled();
    await test.userEvent.type(input, 'test-secret');
    await test.userEvent.click(test.screen.getByRole('button', { name: 'Save key' }));
    test.expect(save).toHaveBeenCalledWith('anthropic', 'test-secret');
    await test.waitFor(() => test.expect(input).toHaveValue(''));
    await test.userEvent.click(test.screen.getByRole('button', { name: 'Remove key' }));
    test.expect(save).toHaveBeenLastCalledWith('anthropic', null);
  }
);

test.stable('a failed key save preserves the draft for retry', async () => {
  const save = test.vi.fn().mockRejectedValue(new Error('offline'));

  test.render(<ProviderKeyRow provider={provider} pending={false} save={save} />);
  const input = test.screen.getByLabelText('API key');

  await test.userEvent.type(input, 'test-secret');
  await test.userEvent.click(test.screen.getByRole('button', { name: 'Save key' }));
  await test.waitFor(() => test.expect(save).toHaveBeenCalledOnce());
  test.expect(input).toHaveValue('test-secret');
});
