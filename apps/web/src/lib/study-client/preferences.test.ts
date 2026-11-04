import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { updateAppSettings } from './operations';
import { loadAppSettings, saveLanguage, saveReviewSettings } from './preferences';

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), review: vi.fn(), closed: 0 }));

vi.mock('./client', async () => {
  const { Effect } = await import('effect');

  return {
    studyClient: Effect.acquireRelease(
      Effect.succeed({
        'settings.appSettings': () => api.read(),
        'settings.saveAppSettings': (input: unknown) => api.save(input),
        'settings.saveReviewSettings': (input: unknown) => api.review(input)
      }),
      () =>
        Effect.sync(() => {
          api.closed++;
        })
    )
  };
});

beforeEach(() => {
  api.closed = 0;
  api.read.mockReset();
  api.save.mockReset().mockReturnValue(Effect.succeed({}));
  api.review.mockReset().mockReturnValue(Effect.succeed({}));
});

testStable(
  'reads the latest appearance, zoom and onboarding before saving only the language',
  async () => {
    const latest = { language: 1, appearance: 3, zoomPercent: 145, onboarded: true };

    api.read.mockReturnValue(Effect.succeed(latest));
    expect(await saveLanguage(2)).toEqual({ ...latest, language: 2 });
    expect(api.save).toHaveBeenCalledWith({ ...latest, language: 2 });
    expect(api.closed).toBe(1);
  }
);

testStable('does not overwrite settings when the fresh read fails', async () => {
  api.read.mockReturnValue(Effect.fail({ kind: 'transient', message: 'offline' }));
  await expect(saveLanguage(2)).rejects.toMatchObject({ kind: 'transient' });
  expect(api.save).not.toHaveBeenCalled();
  expect(api.closed).toBe(1);
});

testStable('loads the persisted language and saves zero as a valid daily allowance', async () => {
  api.read.mockReturnValue(Effect.succeed({ language: 2 }));
  expect(await loadAppSettings()).toMatchObject({ language: 2 });
  await saveReviewSettings({ newCardsPerDay: 0 });
  expect(api.review).toHaveBeenCalledWith({ newCardsPerDay: 0 });
  expect(api.closed).toBe(2);
});

testStable('preserves a recently changed language when appearance and zoom save', async () => {
  const latest = { language: 2, appearance: 3, zoomPercent: 145, onboarded: true };

  api.read.mockReturnValue(Effect.succeed(latest));
  await updateAppSettings({ appearance: 2 });
  expect(api.save).toHaveBeenLastCalledWith({ ...latest, appearance: 2 });
  await updateAppSettings({ zoomPercent: 120 });
  expect(api.save).toHaveBeenLastCalledWith({ ...latest, zoomPercent: 120 });
  expect(api.closed).toBe(2);
});

testStable('does not save an appearance patch when current settings cannot be read', async () => {
  api.read.mockReturnValue(Effect.fail({ kind: 'transient', message: 'offline' }));
  await expect(updateAppSettings({ appearance: 2 })).rejects.toMatchObject({ kind: 'transient' });
  expect(api.save).not.toHaveBeenCalled();
});
