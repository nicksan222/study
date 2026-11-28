import type { SidebarOwnerResolver } from '../study-client/sidebar-owner.queries';
import type { PageMetadata } from './route-contract';

/** Routes provide their canonical owner query; the shell only consumes membership. */
export type SidebarRouteConfig = {
  owner?: SidebarOwnerResolver;
};

const sectionRoutes = {
  notes: '/notes',
  assistant: '/assistant',
  uploads: '/uploads',
  practice: '/practice'
} as const satisfies Record<PageMetadata['section'], string>;

/** Owned pages return to their section index when the user changes subjects. */
export function sidebarSubjectDestination(metadata: PageMetadata, owned: boolean) {
  if (owned || metadata.section === 'assistant' || metadata.section === 'uploads')
    return sectionRoutes[metadata.section];

  return metadata.scope === 'global' ? '/notes' : '.';
}
