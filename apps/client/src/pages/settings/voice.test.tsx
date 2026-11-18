import { test } from '@study/testing';

import { readyVoiceStatus } from '#client/test/page-values.ts';

import { VoiceSettings } from './voice';

test.unit.stable(
  'recovers from a failed preferences read and retries only the failed edit',
  async ({ screen, expect, fireEvent, rpcTestTransport, render, waitFor, vi }) => {
    const initial = { filterSilence: false, chunkSeconds: 20, denoise: false } as const;
    let preferences = { ...initial, denoise: false as boolean };
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('Preferences unavailable'))
      .mockImplementation(async () => preferences);
    const save = vi.fn().mockRejectedValueOnce(new Error('Save unavailable'));
    const fixture = rpcTestTransport(async (tag, input) => {
      if (tag === 'voice.status') return readyVoiceStatus;

      if (tag === 'settings.voiceSettings') return read();

      if (tag === 'settings.saveVoiceSettings') {
        await save(input);
        preferences = { ...preferences, denoise: true };
        await fixture.notify();

        return {};
      }

      throw new Error(`Unexpected endpoint ${tag}`);
    });

    render(<VoiceSettings />, { wrapper: fixture.wrapper });
    expect(await screen.findByText('Could not load voice settings. Try again.')).toBeVisible();
    expect(screen.queryByText('Could not save your changes. Try again.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    const denoise = screen.getByRole('switch', { name: 'Reduce background noise' });

    await waitFor(() => expect(denoise).toBeEnabled());
    fireEvent.click(denoise);
    await waitFor(() =>
      expect(screen.getByText('Could not save your changes. Try again.')).toBeVisible()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(denoise).toBeChecked());
    expect(save.mock.calls).toEqual([[{ denoise: true }], [{ denoise: true }]]);
  }
);

test.unit.stable(
  'waits for the voice preferences snapshot before enabling a saved switch',
  async ({ act, screen, expect, fireEvent, rpcTestTransport, render }) => {
    const initial = { filterSilence: false, chunkSeconds: 20, denoise: false } as const;
    const acknowledged = { filterSilence: false, chunkSeconds: 20, denoise: true };
    const saved = Promise.withResolvers<object>();
    const snapshot = Promise.withResolvers<typeof acknowledged>();
    let liveSnapshot = snapshot.promise;
    let savedEdit = false;
    const fixture = rpcTestTransport(async (tag) => {
      if (tag === 'voice.status') return readyVoiceStatus;

      if (tag === 'settings.voiceSettings') return savedEdit ? liveSnapshot : initial;

      if (tag === 'settings.saveVoiceSettings') {
        savedEdit = true;

        return saved.promise;
      }

      throw new Error(`Unexpected endpoint ${tag}`);
    });

    render(<VoiceSettings />, { wrapper: fixture.wrapper });
    const filter = await screen.findByRole('switch', {
      name: 'Filter silence before transcription'
    });
    const denoise = screen.getByRole('switch', { name: 'Reduce background noise' });

    expect(filter).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(denoise);
    expect(denoise).toHaveAttribute('aria-disabled', 'true');
    await act(async () => saved.resolve({}));
    expect(denoise).toHaveAttribute('aria-disabled', 'true');

    await act(async () => snapshot.resolve(acknowledged));
    expect(denoise).toBeChecked();
    expect(denoise).not.toHaveAttribute('aria-disabled', 'true');

    liveSnapshot = Promise.resolve({ ...acknowledged, filterSilence: true });
    await act(async () => fixture.notify());
    expect(filter).toBeChecked();
  }
);
