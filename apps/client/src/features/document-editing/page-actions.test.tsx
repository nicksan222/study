import { StudyError, editOutcomeSchema, saveSchema, restoreSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { useState } from 'react';

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

async function edit(user: ReturnType<typeof test.userEvent.setup>) {
  await user.click(await test.screen.findByRole('button', { name: copy.PageEdit }));
  const textbox = test.screen.getByRole('textbox', { name: `${copy.PageText} 1` });

  await user.clear(textbox);
  await user.type(textbox, 'My unsaved correction');
}

test.stable(
  'authored draft survives route absence and is removed only by explicit discard',
  async () => {
    const fixture = test.rpcTestTransport(async (tag) => {
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

    test.render(<Route />, { wrapper: fixture.wrapper });
    const user = test.userEvent.setup();

    await edit(user);
    await user.click(test.screen.getByRole('button', { name: 'Route' }));
    await user.click(test.screen.getByRole('button', { name: 'Route' }));
    test
      .expect(test.screen.getByRole('textbox', { name: `${copy.PageText} 1` }))
      .toHaveValue('My unsaved correction');
    await user.click(test.screen.getByRole('button', { name: copy.PageCloseDraft }));
    await user.click(test.screen.getByRole('button', { name: copy.PageEdit }));
    test
      .expect(test.screen.getByRole('textbox', { name: `${copy.PageText} 1` }))
      .toHaveValue('Historical extraction');
  }
);

test.stable(
  'explicit save and undo retries retain exact payload identities after lost responses',
  async () => {
    const saves: (typeof saveSchema.Type)[] = [];
    const restores: (typeof restoreSchema.Type)[] = [];
    const fixture = test.rpcTestTransport(async (tag, input) => {
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

    test.render(<PageActions version={version} current={version.id} />, {
      wrapper: fixture.wrapper
    });
    const user = test.userEvent.setup();

    await edit(user);
    await user.click(test.screen.getByRole('button', { name: copy.PageSave }));
    await test.screen.findByText(copy.PageActionFailed);
    await user.click(test.screen.getByRole('button', { name: copy.PageSave }));
    await test.screen.findByText(copy.PageSaved);
    test.expect(saves).toHaveLength(2);
    test.expect(saves[1]).toEqual(saves[0]);
    await user.click(test.screen.getByRole('button', { name: copy.PageUndo }));
    await test.waitFor(() => test.expect(restores).toHaveLength(1));
    await user.click(test.screen.getByRole('button', { name: copy.PageUndo }));
    await test.screen.findByText(copy.PageUndone);
    test.expect(restores[1]).toEqual(restores[0]);
  }
);

test.stable('rapid repeated save activation cannot start a concurrent write', async () => {
  let complete!: (value: unknown) => void;
  const save = test.vi.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const fixture = test.rpcTestTransport(async (tag) => (tag === 'pages.save' ? save() : undefined));
  const version = page().version!;

  test.render(<PageActions version={version} current={version.id} />, { wrapper: fixture.wrapper });
  await edit(test.userEvent.setup());
  const button = test.screen.getByRole('button', { name: copy.PageSave });

  test.fireEvent.click(button);
  test.fireEvent.click(button);
  await test.waitFor(() => test.expect(save).toHaveBeenCalledTimes(1));
  complete(receipt());
  await test.screen.findByText(copy.PageSaved);
});
