import {
  StudyError,
  materialDetailSchema,
  materialSummarySchema,
  materialVersionDetailSchema,
  defaultWorkspacePreferences,
  sourceSchema
} from '@study/contracts';
import { configureRpcTransport } from '@study/contracts/react';
import { rpcHandlersTransport } from '@study/contracts/react/testing';
import type { StudyClient } from '@study/contracts/react/testing';
import { test } from '@study/testing';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import { Effect, Option, Schema } from 'effect';

import { Providers } from '#client/app/providers.tsx';
import { createAppRouter } from '#client/app/router.ts';
import { authoredPage } from '#client/features/document-editing/test-support.ts';

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
    kind: 'flashcards',
    content: { kind: 'flashcards', cards: [{ cardId: 1n, front: text, back: 'Answer' }] }
  });
}
/** Canonical snapshot fixture, independent of authored or learning identities. */

function exactDocument(id = 101n, text = 'Historical extraction') {
  const version = authoredPage(41n, text, id).version!;

  return { id: version.snapshotId, document: version.document };
}

function material(id = 41n) {
  const version = learningVersion(102n, id, `Current extraction ${id}`);

  return Schema.decodeUnknownSync(materialDetailSchema)({
    id,
    title: `Material ${id}`,
    kind: 'flashcards',
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
    'pages.count': test.vi.fn<StudyClient['pages.count']>().mockReturnValue(Effect.succeed(0n)),
    'materials.count': test.vi
      .fn<StudyClient['materials.count']>()
      .mockReturnValue(Effect.succeed(1n)),
    'pages.create': test.vi.fn<StudyClient['pages.create']>(),
    'pages.pages': test.vi
      .fn<StudyClient['pages.pages']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'pages.page': test.vi.fn<StudyClient['pages.page']>().mockReturnValue(
      Effect.succeed({
        ...authoredPage(41n, 'Historical extraction', 101n),
        title: 'Material 41'
      })
    ),
    'pages.version': test.vi
      .fn<StudyClient['pages.version']>()
      .mockImplementation(({ id }) =>
        Effect.succeed(authoredPage(41n, 'Historical extraction', id).version!)
      ),
    'pages.versions': test.vi
      .fn<StudyClient['pages.versions']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'pages.updateMetadata': test.vi.fn<StudyClient['pages.updateMetadata']>(),
    'pages.annotations': test.vi
      .fn<StudyClient['pages.annotations']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'pages.assessments': test.vi
      .fn<StudyClient['pages.assessments']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'pages.exportFile': test.vi.fn<StudyClient['pages.exportFile']>(),
    'pages.exportVersion': test.vi.fn<StudyClient['pages.exportVersion']>(),
    'materials.activeMaterialGenerations': test.vi
      .fn<StudyClient['materials.activeMaterialGenerations']>()
      .mockReturnValue(Effect.succeed([])),
    'materials.materials': test.vi
      .fn<StudyClient['materials.materials']>()
      .mockReturnValue(Effect.succeed({ items: [summary()], nextCursor: null })),
    'materials.material': test.vi
      .fn<StudyClient['materials.material']>()
      .mockReturnValue(Effect.succeed(material())),
    'materials.materialVersion': test.vi
      .fn<StudyClient['materials.materialVersion']>()
      .mockImplementation(({ id }) =>
        Effect.succeed(
          learningVersion(id, 41n, id === 101n ? 'Historical extraction' : 'Current extraction 41')
        )
      ),
    'materials.deletion': test.vi
      .fn<StudyClient['materials.deletion']>()
      .mockReturnValue(Effect.fail(new StudyError('not_found', 'No deletion'))),
    'materials.retryDeletion': test.vi.fn<StudyClient['materials.retryDeletion']>(),
    'system.search': test.vi
      .fn<StudyClient['system.search']>()
      .mockReturnValue(Effect.succeed({ hits: [] })),
    'materials.materialVersions': test.vi
      .fn<StudyClient['materials.materialVersions']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'materials.exportMaterialVersion': test.vi.fn<StudyClient['materials.exportMaterialVersion']>(),
    'settings.workspacePreferences': test.vi
      .fn<StudyClient['settings.workspacePreferences']>()
      .mockReturnValue(Effect.succeed(defaultWorkspacePreferences)),
    'sources.previewHistory': test.vi.fn<StudyClient['sources.previewHistory']>().mockReturnValue(
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
    'sources.retireHistory': test.vi.fn<StudyClient['sources.retireHistory']>(),
    'sources.previewDeletion': test.vi.fn<StudyClient['sources.previewDeletion']>().mockReturnValue(
      Effect.succeed({
        sourceId: importedSource.id,
        name: importedSource.name,
        revisionCount: 1n,
        extractionCount: 1n,
        blockedBy: [],
        retainedCopies: 'authored_outputs_and_raw_note_records'
      })
    ),
    'sources.deleteSource': test.vi.fn<StudyClient['sources.deleteSource']>(),
    'sources.findSource': test.vi.fn<StudyClient['sources.findSource']>(),
    'sources.sources': test.vi
      .fn<StudyClient['sources.sources']>()
      .mockReturnValue(Effect.succeed({ items: [], next: null })),
    'sources.addLink': test.vi
      .fn<StudyClient['sources.addLink']>()
      .mockReturnValue(Effect.succeed(importedSource)),
    'sources.createSource': test.vi.fn<StudyClient['sources.createSource']>(),
    'sources.source': test.vi
      .fn<StudyClient['sources.source']>()
      .mockReturnValue(Effect.succeed(importedSource)),
    'sources.extractions': test.vi
      .fn<StudyClient['sources.extractions']>()
      .mockReturnValue(Effect.succeed({ items: [], next: null })),
    'sources.currentExtraction': test.vi.fn<StudyClient['sources.currentExtraction']>(),
    'sources.extraction': test.vi
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
    'sources.exportRevision': test.vi.fn<StudyClient['sources.exportRevision']>(),
    'sources.sourceExport': test.vi.fn<StudyClient['sources.sourceExport']>(),
    'projects.findProject': test.vi
      .fn<StudyClient['projects.findProject']>()
      .mockReturnValue(Effect.succeed(Option.none())),
    'projects.projects': test.vi
      .fn<StudyClient['projects.projects']>()
      .mockReturnValue(Effect.succeed({ items: [], next: null })),
    // Settings remains the production route; leave its unrelated appearance request pending.
    'settings.appSettings': test.vi.fn().mockReturnValue(Effect.never),
    'themes.selectedTheme': test.vi.fn().mockReturnValue(Effect.never),
    'settings.appearancePreferences': test.vi.fn().mockReturnValue(Effect.never)
  };
}

export function mountLibraryRoute(initial = '/pages', rpc = materialRpc()) {
  const harness = rpcHandlersTransport(rpc);

  configureRpcTransport(harness.transport);
  const history = createMemoryHistory({ initialEntries: [initial] });
  const router = createAppRouter(history);
  const view = render(
    <Providers transport={harness.transport}>
      <RouterProvider router={router} />
    </Providers>
  );

  return { ...view, rpc, notify: harness.notify, history, router };
}

export async function locationIs(router: ReturnType<typeof createAppRouter>, pathname: string) {
  await waitFor(() => {
    if (router.state.location.pathname !== pathname || router.state.status !== 'idle') {
      throw new Error(`Waiting for ${pathname}`);
    }
  });
}
