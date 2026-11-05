import { projectIdSchema } from '@study/contracts/ids';
import type { LocationRewrite } from '@tanstack/react-router';
import { Schema } from 'effect';

const validProject = Schema.is(projectIdSchema);

function projectIdentity(value: string | null | undefined) {
  return value && /^[1-9][0-9]{0,18}$/.test(value) && validProject(BigInt(value))
    ? value
    : undefined;
}

function projectPath(pathname: string) {
  const match = /^\/projects\/([^/]+)(\/.*)?$/.exec(pathname);
  const project = projectIdentity(match?.[1]);

  return project ? { project, pathname: match?.[2] ?? '/' } : undefined;
}

/** One public project prefix for every scoped link, redirect and history entry. */
export const projectUrlRewrite = {
  input: ({ url }) => {
    const path = projectPath(url.pathname);

    if (!path) return;

    url.pathname = path.pathname;
    url.searchParams.set('project', path.project);

    return url;
  },
  output: ({ url }) => {
    const path = projectPath(url.pathname);
    const project = path?.project ?? projectIdentity(url.searchParams.get('project'));

    if (!project) return;

    const pathname = path?.pathname ?? url.pathname;

    url.pathname = `/projects/${project}${pathname === '/' ? '' : pathname}`;
    url.searchParams.delete('project');

    return url;
  }
} satisfies LocationRewrite;

/** Normalize bookmarked query URLs before the router reads its first history entry. */
export function canonicalProjectHref(href: string) {
  const url = projectUrlRewrite.output({ url: new URL(href, 'http://localhost') });

  return url ? url.pathname + url.search + url.hash : href;
}
