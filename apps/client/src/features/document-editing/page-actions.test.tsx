import { StudyError, editOutcomeSchema, saveSchema, restoreSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { useState } from 'react';

import { readyVoiceStatus } from '#client/test/page-values.ts';

import type { PageActions as PageActionsView } from './page-actions';
import { authoredPage } from './test-support';

let PageActions: typeof PageActionsView;

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/lib/host.ts', async (original) => ({
    ...(await original<typeof Host>()),
    microphoneAvailable: () => true,
    captureMicrophone: async () => ({ stop: async () => [0.5], cancel: () => {} })
  }));
  ({ PageActions } = await import('./page-actions'));
});

const copy = catalogs.english;

const page = () => authoredPage(41n, 'Historical extraction', 101n);

const receipt = (expected = 101n, submitted = 103n) =>
  Schema.decodeUnknownSync(editOutcomeSchema)({
    outcome: 'saved',
    replayed: false,
    expectedVersionId: expected,
    currentVersionId: submitted,
    submittedVersionId: submitted
  });

async function edit(
  { screen }: Pick<test.unit.Context, 'screen'>,
  user: ReturnType<test.unit.Context['userEvent']['setup']>
) {
  await user.click(await screen.findByRole('button', { name: copy.PageEdit }));
  const textbox = screen.getByRole('textbox', { name: `${copy.PageText} 1` });

  await user.clear(textbox);
  await user.type(textbox, 'My unsaved correction');
}

test.unit.stable(
  'Page Save waits for the final segment and submits the resulting document',
  async ({ rpcTestTransport, render, userEvent, screen, expect, waitFor, vi }) => {
    const recognition = Promise.withResolvers<{ text: string }>();
    const transcribe = vi.fn(() => recognition.promise);
    const save = vi.fn((_input: unknown) => receipt());
    const fixture = rpcTestTransport(async (tag, input) => {
      if (tag === 'voice.status') return readyVoiceStatus;

      if (tag === 'settings.voiceSettings') return { filterSilence: true };

      if (tag === 'voice.transcribe') return transcribe();

      if (tag === 'pages.save') return save(input);

      throw new Error(`Unexpected ${tag}`);
    });
    const version = page().version!;

    render(<PageActions version={version} current={version.id} />, {
      wrapper: fixture.wrapper
    });
    const user = userEvent.setup();

    await edit({ screen }, user);
    await user.click(await screen.findByRole('button', { name: copy.VoiceStart }));
    await user.click(await screen.findByRole('button', { name: copy.VoiceStop }));
    await waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
    const submit = screen.getByRole('button', { name: copy.PageSave });

    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(save).not.toHaveBeenCalled();
    recognition.resolve({ text: 'from speech' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            blocks: [expect.objectContaining({ text: 'My unsaved correction from speech' })]
          })
        })
      )
    );
  }
);

test.unit.stable(
  'authored draft survives route absence and is removed only by explicit discard',
  async ({ rpcTestTransport, render, userEvent, screen, expect }) => {
    const fixture = rpcTestTransport(async (tag) => {
      throw new Error(`Unexpected ${tag}`);
    });

    function Route() {
      const [visible, setVisible] = useState(true);
      const version = page().version!;

      return (
        <>
          <button onClick={() => setVisible((value) => !value)}>Route</button>
          {visible && <PageActions version={version} current={version.id} />}
        </>
      );
    }

    render(<Route />, { wrapper: fixture.wrapper });
    const user = userEvent.setup();

    await edit({ screen }, user);
    await user.click(screen.getByRole('button', { name: 'Route' }));
    await user.click(screen.getByRole('button', { name: 'Route' }));
    expect(screen.getByRole('textbox', { name: `${copy.PageText} 1` })).toHaveValue(
      'My unsaved correction'
    );
    await user.click(screen.getByRole('button', { name: copy.PageCloseDraft }));
    await user.click(screen.getByRole('button', { name: copy.PageEdit }));
    expect(screen.getByRole('textbox', { name: `${copy.PageText} 1` })).toHaveValue(
      'Historical extraction'
    );
  }
);

test.unit.stable(
  'explicit save and undo retries retain exact payload identities after lost responses',
  async ({ rpcTestTransport, render, userEvent, screen, expect, waitFor }) => {
    const saves: (typeof saveSchema.Type)[] = [];
    const restores: (typeof restoreSchema.Type)[] = [];
    const fixture = rpcTestTransport(async (tag, input) => {
      if (tag === 'pages.save') {
        saves.push(Schema.decodeUnknownSync(saveSchema)(input));

        if (saves.length === 1) throw new StudyError('transient', 'Receipt lost');

        return receipt();
      }

      if (tag === 'pages.restore') {
        restores.push(Schema.decodeUnknownSync(restoreSchema)(input));

        if (restores.length === 1) throw new StudyError('transient', 'Receipt lost');

        return receipt(103n, 104n);
      }

      throw new Error(`Unexpected ${tag}`);
    });
    const version = page().version!;

    render(<PageActions version={version} current={version.id} />, {
      wrapper: fixture.wrapper
    });
    const user = userEvent.setup();

    await edit({ screen }, user);
    await user.click(screen.getByRole('button', { name: copy.PageSave }));
    await screen.findByText(copy.PageActionFailed);
    await user.click(screen.getByRole('button', { name: copy.PageSave }));
    await screen.findByText(copy.PageSaved);
    expect(saves).toHaveLength(2);
    expect(saves[1]).toEqual(saves[0]);
    await user.click(screen.getByRole('button', { name: copy.PageUndo }));
    await waitFor(() => expect(restores).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: copy.PageUndo }));
    await screen.findByText(copy.PageUndone);
    expect(restores[1]).toEqual(restores[0]);
  }
);

test.unit.stable(
  'rapid repeated save activation cannot start a concurrent write',
  async ({ vi, rpcTestTransport, render, userEvent, screen, fireEvent, waitFor, expect }) => {
    let complete!: (value: unknown) => void;
    const save = vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const fixture = rpcTestTransport(async (tag) => (tag === 'pages.save' ? save() : undefined));
    const version = page().version!;

    render(<PageActions version={version} current={version.id} />, { wrapper: fixture.wrapper });
    await edit({ screen }, userEvent.setup());
    const button = screen.getByRole('button', { name: copy.PageSave });

    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    complete(receipt());
    await screen.findByText(copy.PageSaved);
  }
);
import type * as Host from '#client/lib/host.ts';
