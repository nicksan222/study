import { pageIdSchema } from '@study/contracts/ids';
import { pageVersionIdSchema } from '@study/contracts/ids';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';

import { notePageOptions } from '../features/note-workspace';
import { PageReaderPage } from '../features/pages';
import { pageVersionOptions } from '../lib/study-client/pages.queries';
import { sidebarOwner } from '../lib/study-client/sidebar-owner.queries';

export const Route = createFileRoute('/pages/$pageId')({
  staticData: {
    title: 'SourcePage',
    section: 'pages',
    scope: 'project',
    sidebar: {
      owner: sidebarOwner(pageIdSchema, ({ pageId }) => pageId, notePageOptions)
    }
  },
  beforeLoad: ({ params }) => {
    Schema.decodeUnknownSync(pageIdSchema)(BigInt(params.pageId));
  },
  loaderDeps: ({ search }) => ({ pageVersion: search.pageVersion }),
  loader: ({ context, params, deps }) =>
    Promise.all([
      context.queryClient.prefetchQuery(
        notePageOptions(Schema.decodeUnknownSync(pageIdSchema)(BigInt(params.pageId)))
      ),
      deps.pageVersion
        ? context.queryClient.prefetchQuery(
            pageVersionOptions(
              Schema.decodeUnknownSync(pageVersionIdSchema)(BigInt(deps.pageVersion))
            )
          )
        : undefined
    ]),
  component: PageReaderPage
});
