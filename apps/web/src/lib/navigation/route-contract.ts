import {
  materialVersionIdSchema,
  contentSnapshotIdSchema,
  studyDocumentVersionIdSchema,
  projectIdSchema
} from '@study/contracts/ids';
import type { StaticMessageKey } from '@study/localization';
import { Schema } from 'effect';

import type { SidebarRouteConfig } from './sidebar-config';

export type Section = 'sessions' | 'documents' | 'practice';

export type PageMetadata = {
  title: StaticMessageKey;
  section: Section;
  scope: 'global' | 'project';
  sidebar?: SidebarRouteConfig;
};

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    title?: StaticMessageKey;
    section?: Section;
    scope?: 'global' | 'project';
    sidebar?: SidebarRouteConfig;
  }
}

export type AppSearch = {
  project?: string;
  id?: string;
  material?: string;
  version?: string;
  documentVersion?: string;
  sourceRevision?: string;
  sourceSnapshot?: string;
};

function decimalId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    Schema.is(projectIdSchema)(BigInt(value))
  );
}

function versionReference(value: unknown, valid: (id: bigint) => boolean) {
  if (value === undefined) return undefined;

  if (!decimalId(value) || !valid(BigInt(value))) throw new Error('Invalid version identity');

  return value;
}

export function validateSearch(search: Record<string, unknown>): AppSearch {
  const version = versionReference(search.version, Schema.is(materialVersionIdSchema));
  const documentVersion = versionReference(
    search.documentVersion,
    Schema.is(studyDocumentVersionIdSchema)
  );
  const sourceSnapshot = versionReference(
    search.sourceSnapshot,
    Schema.is(contentSnapshotIdSchema)
  );
  const sourceRevision = versionReference(search.sourceRevision, (revision) => revision > 0n);

  if ((sourceSnapshot === undefined) !== (sourceRevision === undefined))
    throw new Error('Incomplete source extraction identity');

  return {
    ...(sourceSnapshot && sourceRevision ? { sourceSnapshot, sourceRevision } : {}),
    ...(documentVersion ? { documentVersion } : {}),
    ...(decimalId(search.project) ? { project: search.project } : {}),
    ...(decimalId(search.id) ? { id: search.id } : {}),
    ...(version ? { version } : {}),
    ...(decimalId(search.material) ? { material: search.material } : {})
  };
}
