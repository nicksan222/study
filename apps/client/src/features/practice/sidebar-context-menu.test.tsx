import { materialSummarySchema } from '@study/contracts/materials/schemas';
import { RpcProvider } from '@study/contracts/react';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { summary } from '#client/features/material-library/test/support.tsx';
import { renderInRouter } from '#client/test/render-in-router.tsx';
import { rpcHandlersTransport } from '#client/test/rpc.tsx';
import type { StudyClient } from '#client/test/rpc.tsx';

import { LibraryListView } from '../library/library-list.view';

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

      const fixture = rpcHandlersTransport(rpc);

      renderInRouter(
        <RpcProvider transport={fixture.transport}>
          <LibraryListView
            state={{ status: 'success', data: [{ type: 'material', value: material }] }}
            subjects={[]}
            blocked={false}
            query=""
            search={{ project: '1' }}
            reload={() => {}}
          />
        </RpcProvider>
      );
      await user.pointer({
        target: await screen.findByRole('link', { name: new RegExp(material.title) }),
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
      expect(screen.getByRole('link', { name: new RegExp(material.title) })).toBeVisible();
    }
  );
}
