import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.use({
  voiceEnabled: true,
  video: 'on',
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${Bun.fileURLToPath(new URL('../../../../tooling/testing/fixtures/voice/it_it_0228.wav', import.meta.url))}`
    ]
  }
});

test.browser.stable(
  'Dictation preserves a note through recording failure retry and cancellation',
  async ({ page, rpc, voice, microphone, expect, expectScreenshot }) => {
    await rpc.runPromise(rpc.client['voice.install']({}));
    await page.goto('/notes');
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const original = 'Before the dictated words. After the dictated words.';

    await composer.fill(original);
    await composer.press('Home');

    for (let index = 0; index < 7; index++) await composer.press('ArrowRight');

    for (let index = 0; index < 18; index++) await composer.press('Shift+ArrowRight');

    const failure = voice.next({ error: 'transient' }, { hold: true });
    const firstAudio = microphone.nextAudio();

    await page.getByRole('button', { name: copy.VoiceStart, exact: true }).click();
    await microphone.requested;
    await expect(
      page.getByRole('button', { name: copy.VoiceStarting, exact: true })
    ).toBeDisabled();
    await expectScreenshot('opening-microphone', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(original)
    });
    microphone.release();
    await expect(page.getByRole('button', { name: copy.VoiceStop, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expectScreenshot('recording', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(original)
    });
    await firstAudio;
    await page.getByRole('button', { name: copy.VoiceStop, exact: true }).click();
    const input = await failure.called;

    expect(input.samples.length).toBeGreaterThan(0);
    expect(input.samples.every(Number.isFinite)).toBe(true);
    expect(input.filterSilence).toBe(true);
    await expect(
      page.getByRole('button', { name: copy.VoiceTranscribing, exact: true })
    ).toBeDisabled();
    await expectScreenshot('transcribing', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(original)
    });
    failure.release();
    await expect(page.getByRole('alert')).toContainText(copy.VoiceTranscriptionFailed);
    await expect(composer).toHaveValue(original);
    await expectScreenshot('transcription-error', {
      target: 'viewport',
      ready: () => expect(page.getByRole('button', { name: copy.Retry, exact: true })).toBeVisible()
    });
    const recovered = voice.next({ text: 'spoken field observation' }, { hold: true });

    await page.getByRole('button', { name: copy.Retry, exact: true }).click();
    const retried = await recovered.called;

    expect(retried.samples).toEqual(input.samples);
    recovered.release();
    await expect(composer).toHaveValue(
      'Before spoken field observation. After the dictated words.'
    );
    await expect(composer).toBeFocused();
    await expectScreenshot('transcript-inserted', {
      target: 'viewport',
      ready: () =>
        expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled()
    });
    const changed = await composer.inputValue();

    await page.getByRole('button', { name: copy.VoiceStart, exact: true }).click();
    await expect(page.getByRole('button', { name: copy.VoiceStop, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled();
    await expect(composer).toHaveValue(changed);
    const audioReady = microphone.nextAudio();
    const cancelledInference = voice.next(
      { text: 'This late result must never enter the draft.' },
      { hold: true }
    );

    await page.getByRole('button', { name: copy.VoiceStart, exact: true }).click();
    await expect(page.getByRole('button', { name: copy.VoiceStop, exact: true })).toBeVisible();
    await audioReady;
    await page.getByRole('button', { name: copy.VoiceStop, exact: true }).click();
    await cancelledInference.called;
    await page.getByRole('button', { name: copy.VoiceCancel, exact: true }).click();
    await cancelledInference.aborted;
    cancelledInference.release();
    await expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled();
    await expect(composer).toHaveValue(changed);
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(page).toHaveURL(/\/notes\/.+/);
    await page.reload();
    await expect(
      page.getByRole('region', { name: copy.NoteNotebook }).locator('.chat-message-text')
    ).toHaveText(changed);
  }
);

test.browser.stable(
  'Voice setup requires installation consent and persists bilingual settings',
  async ({ page, rpc, voice, expect, expectScreenshot }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/notes');
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });

    await composer.fill('A private draft stays intact while voice is configured.');
    await page.getByRole('button', { name: copy.VoiceStart, exact: true }).click();
    const setup = page.getByRole('dialog', { name: copy.VoiceSetupTitle });

    await expect(setup).toBeVisible();
    expect(voice.downloads).toBe(0);
    await expectScreenshot('download-consent', {
      target: setup,
      ready: () => expect(setup.getByRole('button', { name: copy.VoiceDownload })).toBeEnabled()
    });
    await setup.getByRole('button', { name: copy.Close, exact: true }).last().click();
    await expect(setup).toBeHidden();
    expect(voice.downloads).toBe(0);
    await expect(composer).toHaveValue('A private draft stays intact while voice is configured.');
    await page.getByRole('button', { name: copy.VoiceStart, exact: true }).click();
    const held = voice.holdDownload();

    await setup.getByRole('button', { name: copy.VoiceDownload }).click();
    await held.called;
    await expect(setup.getByRole('button', { name: copy.VoiceCancelDownload })).toBeEnabled();
    await expectScreenshot('downloading', {
      target: setup,
      ready: () => expect(setup.getByRole('progressbar')).toBeVisible()
    });
    await setup.getByRole('button', { name: copy.VoiceCancelDownload }).click();
    await held.aborted;
    await expect(setup.getByRole('button', { name: copy.VoiceDownload })).toBeEnabled();
    await setup.getByRole('button', { name: copy.VoiceDownload }).click();
    await expect(setup.getByText(copy.VoiceModelReady, { exact: true })).toBeVisible();
    await setup.getByRole('button', { name: copy.Close, exact: true }).last().click();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const settings = page.getByRole('dialog', { name: copy.Settings });

    await settings.getByRole('button', { name: copy.VoiceTitle, exact: true }).click();
    await expect(settings.getByText(copy.VoiceAutomatic, { exact: true })).toBeVisible();
    await expect(settings.getByText(copy.VoiceLanguages, { exact: true })).toBeVisible();
    const filter = settings.getByRole('switch', { name: copy.VoiceFilterSilence, exact: true });

    await expect(filter).toBeChecked();
    await filter.click();
    await expect(filter).not.toBeChecked();
    await expect(filter).toBeEnabled();
    await expectScreenshot('voice-settings-english', {
      target: settings,
      ready: () => expect(filter).not.toBeChecked()
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await settings.getByRole('button', { name: copy.VoiceTitle, exact: true }).click();
    await expect(filter).not.toBeChecked();
    await settings.getByRole('button', { name: copy.GeneralSettingsTitle, exact: true }).click();
    await settings.getByRole('combobox', { name: copy.GeneralSettingsLanguage }).click();
    await page.getByRole('option', { name: copy.ItalianOwnName }).click();
    const italian = catalogs.italian;
    const localized = page.getByRole('dialog', { name: italian.Settings });

    await localized.getByRole('button', { name: italian.VoiceTitle, exact: true }).click();
    await page.setViewportSize({ width: 760, height: 900 });
    const localizedFilter = localized.getByRole('switch', {
      name: italian.VoiceFilterSilence,
      exact: true
    });

    await expect(localizedFilter).not.toBeChecked();
    await expect(localized.getByText(italian.VoiceAutomatic, { exact: true })).toBeVisible();
    await expectScreenshot('voice-settings-italian-compact', {
      target: 'viewport',
      ready: () => expect(localizedFilter).toBeInViewport({ ratio: 1 })
    });
    await localized.getByRole('button', { name: italian.VoiceRemove }).click();
    await expect(localized.getByText(italian.VoiceModelMissing, { exact: true })).toBeVisible();
    const status = await rpc.runPromise(rpc.client['voice.status']({}));

    expect(status.state).toBe('missing');
  }
);

test.browser.stable(
  'Closing saved notebook capture cancels transcription and preserves its draft',
  async ({ page, rpc, voice, microphone, expect, expectScreenshot }) => {
    await rpc.runPromise(rpc.client['voice.install']({}));
    const note = await rpc.runPromise(rpc.client['notes.createUntitledNote']({}));

    await page.goto('/notes/' + String(note.id));
    const addCapture = page.getByRole('button', { name: copy.NoteAddCapture, exact: true });

    await addCapture.click();
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const original = 'Keep this unsent observation when capture is closed.';

    await composer.fill(original);
    const pending = voice.next(
      { text: 'A cancelled result must never enter this draft.' },
      {
        hold: true
      }
    );
    const audioReady = microphone.nextAudio();

    await page.getByRole('button', { name: copy.VoiceStart, exact: true }).click();
    await microphone.requested;
    microphone.release();
    await expect(page.getByRole('button', { name: copy.VoiceStop, exact: true })).toBeVisible();
    await audioReady;
    await page.getByRole('button', { name: copy.VoiceStop, exact: true }).click();
    await pending.called;
    await expect(
      page.getByRole('button', { name: copy.VoiceTranscribing, exact: true })
    ).toBeDisabled();
    await page.getByRole('button', { name: copy.NoteHideCapture, exact: true }).click();
    await pending.aborted;
    pending.release();
    await expect(addCapture).toHaveAttribute('aria-expanded', 'false');
    await expect(composer).toBeHidden();
    await addCapture.click();
    await expect(composer).toHaveValue(original);
    await expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled();
    await expectScreenshot('capture-reopened-after-cancelled-transcription', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(original)
    });
  }
);
