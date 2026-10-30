import { projectIdSchema } from '@study/contracts/ids';
import type { StaticMessageKey } from '@study/localization';
import { Schema } from 'effect';

export type Section = 'sessions' | 'library' | 'practice' | 'pipelines';

export type PageMetadata = {
  title: StaticMessageKey;
  section: Section;
  scope: 'global' | 'project';
};

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    title?: StaticMessageKey;
    section?: Section;
    scope?: 'global' | 'project';
  }
}

export type AppSearch = {
  project?: string;
  id?: string;
  material?: string;
};

function decimalId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    Schema.is(projectIdSchema)(BigInt(value))
  );
}

export function validateSearch(search: Record<string, unknown>): AppSearch {
  return {
    ...(decimalId(search.project) ? { project: search.project } : {}),
    ...(decimalId(search.id) ? { id: search.id } : {}),
    ...(decimalId(search.material) ? { material: search.material } : {})
  };
}
