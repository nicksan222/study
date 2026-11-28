import { pageIdSchema, pageVersionIdSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';

import { PageReaderPage } from '../features/pages';
import { sidebarOwner } from '../lib/study-client/sidebar-owner.queries';

export const Route = createFileRoute('/practice/study-notes/$pageId')({
  staticData: {
    title: 'SourcePage',
    section: 'practice',
    scope: 'project',
    sidebar: {
      owner: sidebarOwner(pageIdSchema, ({ pageId }) => pageId, 'page')
    }
  },
  beforeLoad: ({ params }) => {
    Schema.decodeUnknownSync(pageIdSchema)(BigInt(params.pageId));
  },
  loaderDeps: ({ search }) => ({ pageVersion: search.pageVersion }),
  loader: ({ params, deps }) =>
    Promise.all([
      rpc.pages.get.read({ id: pageIdSchema.make(BigInt(params.pageId)) }).catch(() => undefined),
      deps.pageVersion
        ? rpc.pages.version
            .read({ id: pageVersionIdSchema.make(BigInt(deps.pageVersion)) })
            .catch(() => undefined)
        : undefined
    ]),
  component: PageReaderPage
});
