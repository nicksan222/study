import { catalogs, countText, text } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.use({
  microphoneEnabled: true,
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
  async ({ page, rpc, microphone, expect, expectScreenshot }) => {
    await rpc.runPromise(rpc.client['voice.install']({}));
    await page.goto('/notes');
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const original = 'Before the dictated words. After the dictated words.';

    await composer.fill(original);
    await composer.press('Home');

    for (let index = 0; index < 7; index++) await composer.press('ArrowRight');

    for (let index = 0; index < 18; index++) await composer.press('Shift+ArrowRight');

    const recording = await microphone.start(page, {
      holdPermission: true,
      segments: { failure: { error: 'transient' } }
    });
    const { failure } = recording.segments;

    await expect(page.getByRole('status', { name: copy.VoiceStarting, exact: true })).toBeVisible();
    await expectScreenshot('opening-microphone', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(original)
    });
    await recording.allow();
    const controls = page.getByRole('group', { name: copy.VoiceTitle, exact: true });

    await expect(controls.getByRole('button', { name: copy.VoiceStop, exact: true })).toBeEnabled();
    await expectScreenshot('recording', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(original)
    });
    await recording.stop();
    const input = await failure.requested;

    expect(input.samples.length).toBeGreaterThan(0);
    expect(input.samples.every(Number.isFinite)).toBe(true);
    expect(input.filterSilence).toBe(true);
    await expect(
      page.getByRole('status', { name: copy.VoiceTranscribing, exact: true })
    ).toBeVisible();
    await expectScreenshot('transcribing', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(original)
    });
    await failure.deliver();
    await expect(page.getByRole('alert')).toContainText(copy.VoiceTranscriptionFailed);
    await expect(composer).toHaveValue(original);
    const recovery = page.getByRole('button', { name: copy.VoiceRecoveryOptions, exact: true });

    await expectScreenshot('transcription-error', {
      target: 'viewport',
      ready: () => expect(recovery).toBeEnabled()
    });
    await recovery.click();
    const options = page.getByRole('dialog', { name: copy.VoiceTranscriptionFailedTitle });
    const retry = options.getByRole('button', { name: copy.Retry, exact: true });

    await expectScreenshot('transcription-recovery-options', {
      target: options,
      ready: () => expect(retry).toBeEnabled()
    });
    const recovered = recording.expectSegment('spoken field observation');

    await retry.click();
    const retried = await recovered.requested;

    expect(retried.samples).toEqual(input.samples);
    await recovered.deliver();
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

    await microphone.start(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled();
    await expect(composer).toHaveValue(changed);
    const cancelled = await microphone.start(page, {
      segments: { late: 'This late result must never enter the draft.' }
    });
    const { late } = cancelled.segments;

    await cancelled.stop();
    await late.requested;
    await cancelled.cancel();
    await late.aborted;
    await late.deliver();
    await expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled();
    await expect(composer).toHaveValue(changed);
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(page).toHaveURL(/\/notes\/.+/);
    await page.reload();
    await expect(
      page.getByRole('region', { name: copy.NoteNotebook }).locator('.chat-message-text')
    ).toHaveText(changed);

    const richNote = await rpc.runPromise(rpc.client['notes.createUntitledNote']({}));

    await rpc.runPromise(
      rpc.client['notes.postMessage']({
        noteId: richNote.id,
        format: 'document',
        requestReply: false,
        text: 'Keep the complete survey evidence',
        sourceIds: []
      })
    );
    await page.goto('/notes/' + String(richNote.id));
    await page
      .locator('.workspace-desk-page')
      .filter({ hasText: 'Keep the complete survey evidence' })
      .click();
    await page.getByRole('button', { name: copy.VersionHistory, exact: true }).click();
    const history = page.getByRole('dialog', { name: copy.VersionHistory });

    await history.locator('[data-role="user"]').hover();
    await page.getByRole('button', { name: copy.NoteEditNote, exact: true }).click();
    const edit = page.getByRole('dialog', { name: copy.NoteEditNote });
    const richEditor = edit.getByRole('textbox', { name: copy.NoteEditNote });
    const literal = '1. January is the deadline\n# Title\n---';

    await richEditor.fill('');
    const rich = await microphone.start(edit, { segments: { literal } });

    await rich.stop();
    await rich.segments.literal.deliver();
    await expect(richEditor).toHaveText(literal.replaceAll('\n', ''));
    await expect(richEditor.locator('ol, ul, h1, h2, hr')).toHaveCount(0);
    await edit.getByRole('button', { name: copy.NoteSaveNote, exact: true }).click();
    await expect(edit).toBeHidden();
    await page.reload();
    await page
      .locator('.workspace-desk-page')
      .filter({ hasText: '1. January is the deadline' })
      .click();
    const reopenedPage = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });

    await expect(reopenedPage).toHaveText(literal.replaceAll('\n', ''));
    await expect(reopenedPage.locator('ol, ul, h1, h2, hr')).toHaveCount(0);
    await page.getByRole('button', { name: copy.VersionHistory, exact: true }).click();
    const savedRich = history.locator('[data-role="user"] .rich-note-content');

    await expect(savedRich).toHaveText(literal.replaceAll('\n', ''));
    await expect(savedRich.locator('ol, ul, h1, h2, hr')).toHaveCount(0);
    await history.locator('[data-role="user"]').hover();
    await page.getByRole('button', { name: copy.NoteEditNote, exact: true }).click();
    await expect(richEditor).toHaveText(literal.replaceAll('\n', ''));
    await expect(richEditor.locator('ol, ul, h1, h2, hr')).toHaveCount(0);
  }
);

test.browser.stable(
  'Voice setup requires installation consent and persists bilingual settings',
  async ({ page, rpc, microphone, expect, expectScreenshot }) => {
    const catalog = await rpc.runPromise(rpc.client['voice.status']({}));
    const model = catalog.models.find(({ id }) => id === catalog.modelId);

    if (!model) throw new Error('Voice status must include the active model in its catalog');

    const modelLabel = text('english', 'VoiceActiveModel', { model: model.name });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/notes');
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });

    await composer.fill('A private draft stays intact while voice is configured.');
    await page.getByRole('button', { name: copy.VoiceStart, exact: true }).click();
    const setup = page.getByRole('dialog', { name: copy.VoiceSetupTitle });

    await expect(setup).toBeVisible();
    await expect(setup.getByText(modelLabel, { exact: true })).toBeVisible();
    expect(microphone.model.downloads).toBe(0);
    await expectScreenshot('download-consent', {
      target: setup,
      ready: () => expect(setup.getByRole('button', { name: copy.VoiceDownload })).toBeEnabled()
    });
    await setup.getByRole('button', { name: copy.Close, exact: true }).last().click();
    await expect(setup).toBeHidden();
    expect(microphone.model.downloads).toBe(0);
    await expect(composer).toHaveValue('A private draft stays intact while voice is configured.');
    await page.getByRole('button', { name: copy.VoiceStart, exact: true }).click();
    const held = microphone.model.holdDownload();

    await setup.getByRole('button', { name: copy.VoiceDownload }).click();
    await held.requested;
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
    await expect(settings.getByText(modelLabel, { exact: true })).toBeVisible();
    await expect(settings.getByText(copy.VoiceAutomatic, { exact: true })).toBeVisible();
    await expect(
      settings.getByText(countText('english', 'supportedLanguage', model.languages.length))
    ).toBeVisible();
    const length = settings.getByRole('combobox', { name: copy.VoiceChunkDuration });
    const denoise = settings.getByRole('switch', { name: copy.VoiceDenoise, exact: true });

    await length.click();
    await page.getByRole('option', { name: '10 seconds', exact: true }).click();
    await expect(length).toHaveText('10 seconds');
    await expect(denoise).not.toBeChecked();
    await denoise.click();
    await expect(denoise).toBeChecked();
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
    await expect(length).toHaveText('10 seconds');
    await expect(denoise).toBeChecked();
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
    await expect(
      localized.getByText(text('italian', 'VoiceActiveModel', { model: model.name }), {
        exact: true
      })
    ).toBeVisible();
    await expect(
      localized.getByText(countText('italian', 'supportedLanguage', model.languages.length))
    ).toBeVisible();
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
  'Live dictation inserts each segment into the note while recording',
  async ({ page, rpc, microphone, expect, expectScreenshot }) => {
    await rpc.runPromise(rpc.client['voice.install']({}));
    await rpc.runPromise(
      rpc.client['settings.saveVoiceSettings']({
        filterSilence: true,
        chunkSeconds: 10,
        denoise: true
      })
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/notes');

    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const draft = 'Field notes.';
    const firstText = 'The river rose overnight.';
    const secondText = 'The footbridge is still open.';
    const finalText = 'Check again tomorrow.';
    const firstDraft = `${draft} ${firstText}`;
    const secondDraft = `${firstDraft} ${secondText}`;
    const complete = `${secondDraft} ${finalText}`;
    const starting = page.getByRole('button', { name: copy.VoiceStart, exact: true });
    const controls = page.getByRole('group', { name: copy.VoiceTitle, exact: true });
    const stop = controls.getByRole('button', { name: copy.VoiceStop, exact: true });

    await composer.fill(draft);
    await composer.press('End');
    const recording = await microphone.start(page, {
      segments: { first: firstText, second: secondText, final: finalText }
    });
    const { first, second, final } = recording.segments;
    const movingBar = controls
      .locator(
        '.voice-capture-waveform > span[style*="--voice-amplitude"]:not([style*="--voice-amplitude: 0;"])'
      )
      .first();

    await expect(movingBar).toBeVisible();
    const firstChunk = await first.requested;

    expect(firstChunk.samples.length).toBeGreaterThan(0);
    expect(firstChunk.samples.length).toBeLessThanOrEqual(160_000);
    expect(firstChunk.denoise).toBe(true);
    await expectScreenshot('waiting-for-first-segment', {
      target: 'viewport',
      ready: async () => {
        await expect(stop).toBeEnabled();
        await expect(
          controls.getByRole('button', { name: copy.VoiceCancel, exact: true })
        ).toBeEnabled();
        await expect(composer).toHaveValue(draft);
      }
    });
    await first.deliver();
    await expectScreenshot('first-segment-in-draft', {
      target: 'viewport',
      ready: async () => {
        await expect(stop).toBeEnabled();
        await expect(composer).toHaveValue(firstDraft);
      }
    });

    await second.deliver();
    await expectScreenshot('second-segment-in-draft', {
      target: 'viewport',
      ready: async () => {
        await expect(stop).toBeEnabled();
        await expect(composer).toHaveValue(secondDraft);
      }
    });
    await recording.stop();
    await final.requested;
    await expectScreenshot('waiting-for-final-segment', {
      target: 'viewport',
      ready: async () => {
        await expect(
          page.getByRole('status', { name: copy.VoiceTranscribing, exact: true })
        ).toBeVisible();
        await expect(composer).toHaveValue(secondDraft);
      }
    });
    await final.deliver();
    await expectScreenshot('complete-transcript-in-draft', {
      target: 'viewport',
      ready: async () => {
        await expect(composer).toHaveValue(complete);
        await expect(composer).toBeFocused();
        await expect(starting).toBeEnabled();
      }
    });

    await page.getByRole('button', { name: copy.NoteSaveNote, exact: true }).click();
    await expect(page).toHaveURL(/\/notes\/.+/);
    await page.reload();
    const saved = page
      .getByRole('region', { name: copy.NoteNotebook })
      .locator('.chat-message-text');

    await expectScreenshot('complete-transcript-in-saved-note', {
      target: saved,
      ready: () => expect(saved).toHaveText(complete)
    });
  }
);

test.browser.stable(
  'Closing saved notebook capture cancels transcription and preserves its draft',
  async ({ page, rpc, microphone, expect, expectScreenshot }) => {
    await rpc.runPromise(rpc.client['voice.install']({}));
    await rpc.runPromise(
      rpc.client['settings.saveVoiceSettings']({ filterSilence: true, chunkSeconds: 10 })
    );
    const note = await rpc.runPromise(rpc.client['notes.createUntitledNote']({}));

    await page.goto('/notes/' + String(note.id));
    const addCapture = page.getByRole('button', { name: copy.NoteAddCapture, exact: true });

    await addCapture.click();
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const original = 'Keep this unsent observation when capture is closed.';

    await composer.fill(original);
    const partialText = 'A live transcript arrives before stopping.';
    const delivered = `${original} ${partialText}`;
    const recording = await microphone.start(page, {
      segments: {
        first: partialText,
        pending: 'A cancelled result must never enter this draft.'
      }
    });
    const { first, pending } = recording.segments;
    const firstChunk = await first.requested;

    expect(firstChunk.samples.length).toBeGreaterThan(0);
    expect(firstChunk.samples.length).toBeLessThanOrEqual(160_000);
    await first.deliver();
    await expect(composer).toHaveValue(delivered);
    const controls = page.getByRole('group', { name: copy.VoiceTitle, exact: true });
    const stop = controls.getByRole('button', { name: copy.VoiceStop, exact: true });

    await expect(stop).toBeEnabled();
    await recording.stop();
    await pending.requested;
    await expectScreenshot('partial-transcript-before-cancel', {
      target: 'viewport',
      ready: async () => {
        await expect(
          page.getByRole('status', { name: copy.VoiceTranscribing, exact: true })
        ).toBeVisible();
        await expect(composer).toHaveValue(delivered);
      }
    });
    await page.getByRole('button', { name: copy.NoteHideCapture, exact: true }).click();
    await pending.aborted;
    await pending.deliver();
    await expect(addCapture).toHaveAttribute('aria-expanded', 'false');
    await expectScreenshot('capture-closed-after-cancel', {
      target: 'viewport',
      ready: () => expect(composer).toBeHidden()
    });
    await addCapture.click();
    await expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled();
    await expectScreenshot('capture-reopened-after-cancelled-transcription', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(delivered)
    });
  }
);
