import { StudyError } from '@study/contracts/errors';
import {
  materialDetailSchema,
  materialSummarySchema,
  materialVersionDetailSchema
} from '@study/contracts/materials/schemas';
import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { sourceSchema } from '@study/contracts/sources/schemas';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import { vi } from 'vite-plus/test';

import { Providers } from '#web/app/providers.tsx';
import { createAppRouter } from '#web/app/router.ts';
import { authoredDocument } from '#web/features/document-editing/test-support.ts';
import { runRequest } from '#web/lib/effect/runtime.ts';
import { createStudyQueryClient } from '#web/lib/query-client.ts';
import type { StudyClient } from '#web/lib/study-client/client.ts';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

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

export function learningVersion(id = 101n, owner = 41n, text = 'Historical extraction') {
  return Schema.decodeUnknownSync(materialVersionDetailSchema)({
    id,
    material_id: owner,
    number: id === 101n ? 1n : 2n,
    operation: 'original',
    creator: 'user',
    instruction: null,
    language: null,
    created_at: 1n,
    published_at: 1n,
    status: 'published',
    inputs: [],
    parents: [],
    kind: 'diagram',
    content: { kind: 'diagram', format: 'mermaid', payload: `flowchart TD\nA["${text}"]` }
  });
}
/** Canonical snapshot fixture, independent of authored or learning identities. */
function exactDocument(id = 101n, text = 'Historical extraction') {
  const version = authoredDocument(41n, text, id).version!;
  return { id: version.snapshotId, document: version.document };
}

function material(id = 41n) {
  const version = learningVersion(102n, id, `Current extraction ${id}`);

  return Schema.decodeUnknownSync(materialDetailSchema)({
    id,
    title: `Material ${id}`,
    kind: 'diagram',
    created_at: 1n,
    updated_at: 1n,
    archived_at: null,
    projectIds: [],
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
    'documents.create': vi.fn<StudyClient['documents.create']>(),
    'documents.documents': vi
      .fn<StudyClient['documents.documents']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'documents.document': vi.fn<StudyClient['documents.document']>().mockReturnValue(
      Effect.succeed({
        ...authoredDocument(41n, 'Historical extraction', 101n),
        title: 'Material 41'
      })
    ),
    'documents.version': vi
      .fn<StudyClient['documents.version']>()
      .mockImplementation(({ id }) =>
        Effect.succeed(authoredDocument(41n, 'Historical extraction', id).version!)
      ),
    'documents.versions': vi
      .fn<StudyClient['documents.versions']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'documents.updateMetadata': vi.fn<StudyClient['documents.updateMetadata']>(),
    'documents.annotations': vi
      .fn<StudyClient['documents.annotations']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'documents.assessments': vi
      .fn<StudyClient['documents.assessments']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'documents.exportFile': vi.fn<StudyClient['documents.exportFile']>(),
    'documents.exportVersion': vi.fn<StudyClient['documents.exportVersion']>(),
    'materials.materials': vi
      .fn<StudyClient['materials.materials']>()
      .mockReturnValue(Effect.succeed({ items: [summary()], nextCursor: null })),
    'materials.material': vi
      .fn<StudyClient['materials.material']>()
      .mockReturnValue(Effect.succeed(material())),
    'materials.materialVersion': vi
      .fn<StudyClient['materials.materialVersion']>()
      .mockImplementation(({ id }) =>
        Effect.succeed(
          learningVersion(id, 41n, id === 101n ? 'Historical extraction' : 'Current extraction 41')
        )
      ),
    'materials.deletion': vi
      .fn<StudyClient['materials.deletion']>()
      .mockReturnValue(Effect.fail(new StudyError('not_found', 'No deletion'))),
    'materials.retryDeletion': vi.fn<StudyClient['materials.retryDeletion']>(),
    'system.search': vi
      .fn<StudyClient['system.search']>()
      .mockReturnValue(Effect.succeed({ semantic: false, hits: [] })),
    'materials.materialVersions': vi
      .fn<StudyClient['materials.materialVersions']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'materials.exportMaterialVersion': vi.fn<StudyClient['materials.exportMaterialVersion']>(),
    'settings.workspacePreferences': vi
      .fn<StudyClient['settings.workspacePreferences']>()
      .mockReturnValue(Effect.succeed(defaultWorkspacePreferences)),
    'sources.previewHistory': vi.fn<StudyClient['sources.previewHistory']>().mockReturnValue(
      Effect.succeed({
        sourceId: importedSource.id,
        name: importedSource.name,
        keepLatest: 1,
        token: 'a'.repeat(64),
        candidates: [],
        blockedSnapshotIds: [],
        semantics: 'retire_extractions_keep_original_revisions'
      })
    ),
    'sources.retireHistory': vi.fn<StudyClient['sources.retireHistory']>(),
    'sources.previewDeletion': vi.fn<StudyClient['sources.previewDeletion']>().mockReturnValue(
      Effect.succeed({
        sourceId: importedSource.id,
        name: importedSource.name,
        revisionCount: 1n,
        extractionCount: 1n,
        blockedBy: [],
        retainedCopies: 'authored_outputs_and_raw_session_records'
      })
    ),
    'sources.deleteSource': vi.fn<StudyClient['sources.deleteSource']>(),
    'sources.findSource': vi.fn<StudyClient['sources.findSource']>(),
    'sources.sources': vi
      .fn<StudyClient['sources.sources']>()
      .mockReturnValue(Effect.succeed({ items: [], next: null })),
    'sources.addLink': vi
      .fn<StudyClient['sources.addLink']>()
      .mockReturnValue(Effect.succeed(importedSource)),
    'sources.createSource': vi.fn<StudyClient['sources.createSource']>(),
    'sources.source': vi
      .fn<StudyClient['sources.source']>()
      .mockReturnValue(Effect.succeed(importedSource)),
    'sources.extractions': vi
      .fn<StudyClient['sources.extractions']>()
      .mockReturnValue(Effect.succeed({ items: [], next: null })),
    'sources.currentExtraction': vi.fn<StudyClient['sources.currentExtraction']>(),
    'sources.extraction': vi
      .fn<StudyClient['sources.extraction']>()
      .mockImplementation(({ sourceId, revision, snapshotId }) =>
        Effect.succeed({
          sourceId,
          revision,
          snapshotId,
          name: importedSource.name,
          document: exactDocument(101n).document
        })
      ),
    'sources.exportRevision': vi.fn<StudyClient['sources.exportRevision']>(),
    'sources.sourceExport': vi.fn<StudyClient['sources.sourceExport']>(),
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
