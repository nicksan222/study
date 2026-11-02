import { StudyError } from '@study/contracts/errors';
import { materialVersionDocumentSchema } from '@study/contracts/materials/rpc';
import {
  materialDetailSchema,
  materialSummarySchema,
  materialVersionDetailSchema
} from '@study/contracts/materials/schemas';
import { sourceSchema } from '@study/contracts/sources/schemas';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import { vi } from 'vite-plus/test';

import { Providers } from '../../../app/providers';
import { createAppRouter } from '../../../app/router';
import { runRequest } from '../../../lib/effect/runtime';
import { createStudyQueryClient } from '../../../lib/query-client';
import type { StudyClient } from '../../../lib/study-client/client';
import { toStudyError } from '../../../lib/study-client/errors';
import { request } from '../../../lib/study-client/request';
import { importReturn, libraryEntries, libraryReturn, librarySearches } from '../browse-state';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

export const importedSource = Schema.decodeUnknownSync(sourceSchema)({
  id: 7n,
  name: 'original.html',
  kind: 'web',
  mime: 'text/html',
  origin: 'web',
  projectId: null,
  projectName: null,
  sizeBytes: 3n,
  sha256: new Uint8Array(),
  uri: 'https://example.com',
  createdAt: 1n
});

export function importedVersion(id = 101n, owner = 41n, text = 'Historical extraction') {
  return Schema.decodeUnknownSync(materialVersionDetailSchema)({
    id,
    material_id: owner,
    number: id === 101n ? 1n : 2n,
    operation: 'original',
    creator: 'import',
    instruction: null,
    language: null,
    created_at: 1n,
    published_at: 1n,
    status: 'published',
    inputs: [],
    parents: [],
    kind: 'link',
    content: {
      kind: 'link',
      sourceId: importedSource.id,
      source: importedSource,
      extracted: {
        id: 1n,
        document: {
          blocks: [
            {
              id: 'b0',
              kind: 'paragraph',
              text,
              content: { type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] },
              anchor: { type: 'authored' }
            }
          ],
          meta: {
            extractor: null,
            extractorVersion: 1,
            provider: null,
            durationMs: null,
            pageCount: null,
            refiners: [],
            waitingFor: [],
            corrected: false,
            omissions: []
          }
        }
      }
    }
  });
}

export function exactDocument(id = 101n, text = 'Historical extraction') {
  const content = importedVersion(id, 41n, text).content;
  if (!('extracted' in content) || !content.extracted) throw new Error('Expected extraction');
  return Schema.decodeUnknownSync(materialVersionDocumentSchema)({
    id: id + 1000n,
    document: content.extracted.document
  });
}

export function material(id = 41n) {
  const version = importedVersion(102n, id, `Current extraction ${id}`);
  return Schema.decodeUnknownSync(materialDetailSchema)({
    id,
    title: `Material ${id}`,
    kind: 'link',
    created_at: 1n,
    updated_at: 1n,
    archived_at: null,
    projectIds: [],
    importProcessing: {
      sourceId: importedSource.id,
      revision: 2,
      requestId: 'r2',
      status: 'ready'
    },
    version,
    latestPublishedVersion: version,
    latestDraftVersion: null
  });
}

export function summary(id = 41n) {
  return Schema.decodeUnknownSync(materialSummarySchema)(material(id));
}

export function materialRpc() {
  return {
    'materials.materials': vi
      .fn<StudyClient['materials.materials']>()
      .mockReturnValue(Effect.succeed({ items: [summary()], nextCursor: null })),
    'materials.material': vi
      .fn<StudyClient['materials.material']>()
      .mockReturnValue(Effect.succeed(material())),
    'materials.materialVersion': vi
      .fn<StudyClient['materials.materialVersion']>()
      .mockImplementation(({ id }) => Effect.succeed(importedVersion(id))),
    'materials.materialVersionDocument': vi
      .fn<StudyClient['materials.materialVersionDocument']>()
      .mockImplementation(({ id }) =>
        Effect.succeed(
          exactDocument(id, id === 101n ? 'Historical extraction' : 'Current extraction 41')
        )
      ),
    'materials.materialVersionImage': vi.fn<StudyClient['materials.materialVersionImage']>(),
    'materials.importedMaterial': vi
      .fn<StudyClient['materials.importedMaterial']>()
      .mockReturnValue(Effect.succeed(summary())),
    'materials.deletion': vi
      .fn<StudyClient['materials.deletion']>()
      .mockReturnValue(Effect.fail(new StudyError('not_found', 'No deletion'))),
    'materials.retryDeletion': vi.fn<StudyClient['materials.retryDeletion']>(),
    'materials.createManualDocument': vi.fn<StudyClient['materials.createManualDocument']>(),
    'system.materialSearch': vi.fn<StudyClient['system.materialSearch']>(),
    'materials.materialVersions': vi
      .fn<StudyClient['materials.materialVersions']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'materials.materialVersionExport': vi.fn<StudyClient['materials.materialVersionExport']>(),
    'sources.addLink': vi
      .fn<StudyClient['sources.addLink']>()
      .mockReturnValue(Effect.succeed(importedSource)),
    'sources.createSource': vi.fn<StudyClient['sources.createSource']>(),
    'sources.sourceExport': vi.fn(),
    'projects.projects': vi
      .fn<StudyClient['projects.projects']>()
      .mockReturnValue(Effect.succeed({ items: [], next: null })),
    // Settings remains the production route; leave its unrelated appearance request pending.
    'settings.appSettings': vi.fn().mockReturnValue(Effect.never),
    'themes.selectedTheme': vi.fn().mockReturnValue(Effect.never),
    'settings.appearancePreferences': vi.fn().mockReturnValue(Effect.never)
  };
}

export function mountLibraryRoute(initial = '/library', rpc = materialRpc()) {
  libraryEntries.clear();
  librarySearches.clear();
  Object.assign(libraryReturn, { scroll: 0, row: '', fromReader: false });
  importReturn.previous = null;
  // Substitute the RPC transport only: production options, query cache, routes and components run.
  vi.mocked(request).mockImplementation((invoke, signal) =>
    runRequest(invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)), signal)
  );
  const queryClient = createStudyQueryClient();
  const history = createMemoryHistory({ initialEntries: [initial] });
  const router = createAppRouter(history, queryClient);
  const view = render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  );
  return { ...view, rpc, queryClient, history, router };
}

export async function settle() {
  // Query/mutation notifications are scheduled; flush them before asserting no late publication.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function scrollMain(scroll: number) {
  const main = await screen.findByRole('main');
  main.scrollTop = scroll;
  return main;
}

export async function locationIs(router: ReturnType<typeof createAppRouter>, pathname: string) {
  await waitFor(() => {
    if (router.state.location.pathname !== pathname || router.state.status !== 'idle') {
      throw new Error(`Waiting for ${pathname}`);
    }
  });
}
