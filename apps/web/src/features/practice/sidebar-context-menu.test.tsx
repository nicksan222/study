import { materialSummarySchema } from '@study/contracts/materials/schemas';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { summary } from '#web/features/material-library/test/support.tsx';
import { runRequest } from '#web/lib/effect/runtime.ts';
import type { StudyClient } from '#web/lib/study-client/client.ts';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';
import { renderInRouter } from '#web/test/render-in-router.tsx';

import { LibraryListView } from '../library/library-list.view';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

for (const kind of ['quiz', 'flashcards'] as const) {
  testStable(
    `${kind} sidebar items expose scoped destinations and archive without opening the row`,
    async () => {
      const user = userEvent.setup();
      const material = Schema.decodeUnknownSync(materialSummarySchema)({
        ...summary(),
        kind,
        title: 'Cell biology'
      });
      const archive = vi.fn<StudyClient['materials.archive']>().mockReturnValue(Effect.never);
      const rpc = { 'materials.archive': archive };

      vi.mocked(request).mockImplementation((invoke, signal) =>
        runRequest(
          invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)),
          signal
        )
      );
      const cache = new QueryClient();

      renderInRouter(
        <QueryClientProvider client={cache}>
          <LibraryListView
            state={{ status: 'success', data: [{ type: 'material', value: material }] }}
            subjects={[]}
            blocked={false}
            query=""
            search={{ project: '1' }}
            reload={() => {}}
          />
        </QueryClientProvider>
      );
      await user.pointer({
        target: await screen.findByRole('link', { name: material.title }),
        keys: '[MouseRight]'
      });
      const open = await screen.findByRole('menuitem', { name: catalogs.english.OpenPractice });

      expect(open).toHaveAttribute(
        'href',
        `/${kind === 'quiz' ? 'practice' : 'flashcards'}/${material.id}?project=1`
      );
      expect(
        screen.getByRole('menuitem', { name: catalogs.english.PracticeViewMaterial })
      ).toHaveAttribute('href', `/materials/${material.id}?project=1`);
      expect(
        screen.queryByRole('menuitem', { name: catalogs.english.PracticeAttempts }) !== null
      ).toBe(kind === 'quiz');
      await user.click(
        screen.getByRole('menuitem', { name: catalogs.english.PracticeArchiveMaterial })
      );
      await waitFor(() => expect(archive).toHaveBeenCalledWith({ id: material.id }));
      expect(screen.getByRole('link', { name: material.title })).toBeVisible();
    }
  );
}
