import { StudyError, editOutcomeSchema, saveSchema, restoreSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { useState } from 'react';
import { expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { PageActions } from './page-actions';
import { authoredPage } from './test-support';

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

async function edit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: copy.PageEdit }));
  const textbox = screen.getByRole('textbox', { name: `${copy.PageText} 1` });

  await user.clear(textbox);
  await user.type(textbox, 'My unsaved correction');
}

testStable(
  'authored draft survives route absence and is removed only by explicit discard',
  async () => {
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

    await edit(user);
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

testStable(
  'explicit save and undo retries retain exact payload identities after lost responses',
  async () => {
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

    render(<PageActions version={version} current={version.id} />, { wrapper: fixture.wrapper });
    const user = userEvent.setup();

    await edit(user);
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

testStable('rapid repeated save activation cannot start a concurrent write', async () => {
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
  await edit(userEvent.setup());
  const button = screen.getByRole('button', { name: copy.PageSave });

  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  complete(receipt());
  await screen.findByText(copy.PageSaved);
});
