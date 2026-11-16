import {
  projectIdSchema,
  materialDetailSchema,
  materialSummarySchema,
  materialVersionDetailSchema
} from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { learningVersion, materialRpc } from '#client/features/material-library/test/support.tsx';

import { ArchivedPracticeAction } from './archive-dialog';

const en = catalogs.english;

function fixture(kind: 'quiz' | 'flashcards', id: bigint) {
  const content =
    kind === 'quiz'
      ? {
          kind,
          questions: [
            {
              id: 4n,
              position: 0n,
              kind: 'single_choice',
              prompt: 'What is a prime number?',
              choices: [
                { id: 5n, position: 0n, text: 'Two', isCorrect: true },
                { id: 6n, position: 1n, text: 'Four', isCorrect: false }
              ],
              explanation: 'A prime has exactly two divisors.'
            }
          ]
        }
      : { kind, cards: [{ cardId: 11n, front: 'Smallest prime?', back: 'Two.' }] };
  const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
    ...learningVersion(102n, id),
    kind,
    content
  });
  const detail = Schema.decodeUnknownSync(materialDetailSchema)({
    id,
    kind,
    title: kind === 'quiz' ? 'Number theory quiz' : 'Prime flashcards',
    projectIds: [1n],
    created_at: 1n,
    updated_at: 1n,
    archived_at: 2n,
    version,
    latestPublishedVersion: version,
    latestDraftVersion: null
  });
  const summary = Schema.decodeUnknownSync(materialSummarySchema)({
    ...detail,
    latestVersion: version
  });

  return { detail, summary };
}

function mount(project = true, paginated = false, empty = false) {
  const base = materialRpc();
  const quiz = fixture('quiz', 41n);
  const cards = fixture('flashcards', 42n);
  const extra = fixture('quiz', 43n);
  let restored = false;
  const rpc = {
    ...base,
    'materials.materials': test.vi
      .fn<StudyClient['materials.materials']>()
      .mockImplementation(({ cursor, limit }) =>
        Effect.succeed({
          items: empty
            ? []
            : paginated && !cursor && limit <= 30
              ? [extra.summary]
              : restored
                ? [cards.summary]
                : [quiz.summary, cards.summary],
          nextCursor: paginated && !cursor && limit <= 30 ? extra.summary.id : null
        })
      ),
    'materials.material': test.vi
      .fn<StudyClient['materials.material']>()
      .mockImplementation(({ id }) =>
        Effect.succeed(
          id === cards.detail.id
            ? cards.detail
            : { ...quiz.detail, archived_at: restored ? null : 2n }
        )
      ),
    'materials.unarchive': test.vi.fn<StudyClient['materials.unarchive']>().mockImplementation(() =>
      Effect.sync(() => {
        restored = true;

        return { ...quiz.detail, archived_at: null };
      })
    )
  };

  const transport = test.rpcHandlersTransport(rpc);

  test.render(
    <ArchivedPracticeAction projectId={project ? projectIdSchema.make(1n) : undefined} />,
    {
      wrapper: transport.wrapper
    }
  );

  return { rpc, notify: transport.notify };
}

test.stable(
  'opens the sidebar archive, previews saved content, and restores through the real mutation',
  async () => {
    const { rpc } = mount();
    const user = test.userEvent.setup();
    const trigger = test.screen.getByRole('button', { name: en.PracticeArchived });

    test.expect(rpc['materials.materials']).not.toHaveBeenCalled();
    await user.click(trigger);
    const dialog = await test.screen.findByRole('dialog', { name: en.PracticeArchived });

    await user.click(
      await test.within(dialog).findByRole('button', { name: /Number theory quiz/ })
    );
    test
      .expect(await test.within(dialog).findByText('What is a prime number?'))
      .toBeInTheDocument();
    test
      .expect(test.within(dialog).getByRole('radio', { name: 'Two. ' + en.ReaderCorrectAnswer }))
      .toBeChecked();
    test
      .expect(
        test.within(dialog).getByRole('radio', { name: 'Four. ' + en.PracticeArchiveOtherOption })
      )
      .not.toBeChecked();
    test.expect(test.within(dialog).getByText(en.PracticeArchiveExplanation)).toBeInTheDocument();
    await user.click(test.within(dialog).getByRole('button', { name: en.PracticeRestore }));
    await test.waitFor(() =>
      test
        .expect(test.within(dialog).queryByRole('button', { name: /Number theory quiz/ }))
        .toBeNull()
    );
    test.expect(rpc['materials.unarchive']).toHaveBeenCalledExactlyOnceWith({ id: 41n });
    test.expect(rpc['materials.materials']).toHaveBeenCalledWith({
      projectId: 1n,
      archived: true,
      cursor: undefined,
      limit: 30
    });
    test.expect(rpc['materials.unarchive']).toHaveBeenCalledWith({ id: 41n });
    await user.click(test.within(dialog).getByRole('button', { name: en.Close }));
    await test.waitFor(() => test.expect(trigger).toHaveFocus());
  }
);

test.stable('pages through the global archive, and searches quizzes and flashcards', async () => {
  const { rpc } = mount(false, true);
  const user = test.userEvent.setup();

  await user.click(test.screen.getByRole('button', { name: en.PracticeArchived }));
  const dialog = await test.screen.findByRole('dialog', { name: en.PracticeArchived });

  await user.click(await test.within(dialog).findByRole('button', { name: en.LibraryMore }));
  test
    .expect(await test.within(dialog).findByRole('button', { name: /Prime flashcards/ }))
    .toBeInTheDocument();
  test.expect(rpc['materials.materials']).toHaveBeenLastCalledWith({
    projectId: undefined,
    archived: true,
    cursor: undefined,
    limit: 60
  });
  await user.type(
    test.within(dialog).getByRole('searchbox', { name: en.PracticeSearchArchived }),
    'Prime'
  );
  test
    .expect(test.within(dialog).getByRole('button', { name: /Prime flashcards/ }))
    .toBeInTheDocument();
  test.expect(test.within(dialog).queryByRole('button', { name: /Number theory quiz/ })).toBeNull();
  await user.click(test.within(dialog).getByRole('button', { name: /Prime flashcards/ }));
  test
    .expect(await test.within(dialog).findByRole('heading', { name: 'Smallest prime?' }))
    .toBeInTheDocument();
  test.expect(test.within(dialog).getByText('Two.')).toBeInTheDocument();
  test.expect(test.within(dialog).getByText(en.CardBack)).toBeInTheDocument();
});

test.stable(
  'uses the shared empty presentation and automatically previews available archived items',
  async () => {
    const { rpc, notify } = mount(true, false, true);
    const user = test.userEvent.setup();

    await user.click(test.screen.getByRole('button', { name: en.PracticeArchived }));
    const dialog = await test.screen.findByRole('dialog', { name: en.PracticeArchived });
    const empty = await test.within(dialog).findByRole('status');

    test.expect(empty).toHaveTextContent(en.PracticeArchiveEmpty);
    test.expect(empty).toHaveTextContent(en.PracticeArchiveHelp);
    test.expect(empty).toHaveClass('ui-selection-empty');
    test.expect(empty).toHaveAttribute('aria-live', 'polite');
    test.expect(test.within(dialog).queryByRole('button', { name: en.PracticeRestore })).toBeNull();
    rpc['materials.materials'].mockReturnValue(
      Effect.succeed({ items: [fixture('flashcards', 42n).summary], nextCursor: null })
    );
    await notify();
    test
      .expect(await test.within(dialog).findByRole('heading', { name: 'Smallest prime?' }))
      .toBeInTheDocument();
    test.expect(test.within(dialog).queryByText(en.PracticeChooseArchived)).toBeNull();
    await user.type(
      test.within(dialog).getByRole('searchbox', { name: en.PracticeSearchArchived }),
      'no matching material'
    );
    const noMatches = await test.within(dialog).findByRole('status');

    test.expect(noMatches).toHaveTextContent(en.SearchNoResults);
    test.expect(noMatches).toHaveTextContent(en.PracticeArchiveSearchHelp);
    test.expect(noMatches).toHaveClass('ui-selection-empty');
  }
);
