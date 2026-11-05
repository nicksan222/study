import type { SidebarOwnerResolver } from '../study-client/sidebar-owner.queries';
import type { PageMetadata } from './route-contract';

export type SidebarContent = 'workspace' | 'documents' | 'practice';

/** Routes provide their canonical owner query; the shell only consumes membership. */
export type SidebarRouteConfig = {
  content?: SidebarContent;
  owner?: SidebarOwnerResolver;
};

const sectionContent: Record<PageMetadata['section'], SidebarContent> = {
  sessions: 'workspace',
  documents: 'documents',
  pipelines: 'workspace',
  practice: 'practice'
};

export function sidebarContent(metadata: PageMetadata): SidebarContent {
  return metadata.sidebar?.content ?? sectionContent[metadata.section];
}

const contentRoutes = {
  workspace: '/sessions',
  documents: '/documents',
  practice: '/practice'
} as const;

function sidebarIndex(metadata: PageMetadata) {
  return contentRoutes[sidebarContent(metadata)];
}

/** Owned pages return to their section index when the user changes subjects. */
export function sidebarSubjectDestination(metadata: PageMetadata, owned: boolean) {
  if (owned) return sidebarIndex(metadata);

  return metadata.scope === 'global' ? '/sessions' : '.';
}
