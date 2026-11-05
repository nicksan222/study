import { testStable } from '@study/testing/vitest';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stringifySearchWith
} from '@tanstack/react-router';
import { expect } from 'vite-plus/test';

import { canonicalProjectHref, projectUrlRewrite } from './project-urls';
import { validateSearch } from './route-contract';

const url = (path: string) => new URL(path, 'http://localhost');

testStable.each([
  'sessions',
  'documents',
  'practice',
  'flashcards',
  'sources/3',
  'materials/4',
  'documents/5',
  'session/6'
])('puts project scope in the path for %s while retaining other URL state', (path) => {
  expect(canonicalProjectHref(`/${path}?project=9007199254740993&documentVersion=8#heading`)).toBe(
    `/projects/9007199254740993/${path}?documentVersion=8#heading`
  );
});

testStable(
  'uses the path project over a conflicting query, without applying the prefix twice',
  () => {
    expect(canonicalProjectHref('/projects/2/documents?project=3&documentVersion=8')).toBe(
      '/projects/2/documents?documentVersion=8'
    );
    const internal = projectUrlRewrite.input({
      url: url('/projects/2/documents/4?project=3&documentVersion=8#note')
    })!;

    expect(internal.pathname).toBe('/documents/4');
    expect(internal.searchParams.get('project')).toBe('2');
    expect(internal.searchParams.get('documentVersion')).toBe('8');
    expect(internal.hash).toBe('#note');
  }
);

testStable.each(['0', '-1', '1.5', 'wrong', '9223372036854775808', '0002'])(
  'does not decode an invalid project identity %s into a global document route',
  (project) => {
    const external = url(`/projects/${project}/documents`);

    expect(projectUrlRewrite.input({ url: external })).toBeUndefined();
    expect(external.pathname).toBe(`/projects/${project}/documents`);
    expect(canonicalProjectHref(`/documents?project=${project}`)).toBe(
      `/documents?project=${project}`
    );
  }
);

testStable('leaves global destinations alone and supports project-root links', () => {
  expect(canonicalProjectHref('/documents?documentVersion=8#note')).toBe(
    '/documents?documentVersion=8#note'
  );
  expect(canonicalProjectHref('/projects')).toBe('/projects');
  expect(canonicalProjectHref('/?project=2')).toBe('/projects/2');
  expect(projectUrlRewrite.input({ url: url('/projects/2') })?.pathname).toBe('/projects');
});

testStable(
  'matches direct project paths, publishes scoped links, switches projects, and restores scope on back',
  async () => {
    const root = createRootRoute({ validateSearch });
    const index = createRoute({ getParentRoute: () => root, path: '/documents' });
    const detail = createRoute({ getParentRoute: () => root, path: '/documents/$documentId' });
    const history = createMemoryHistory({
      initialEntries: ['/projects/9007199254740993/documents/4?documentVersion=8']
    });
    const router = createRouter({
      routeTree: root.addChildren([index, detail]),
      history,
      rewrite: projectUrlRewrite,
      parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
      stringifySearch: stringifySearchWith(String)
    });

    await router.load();
    expect(router.state.matches.at(-1)?.routeId).toBe('/documents/$documentId');
    expect(router.state.location.search).toEqual({
      project: '9007199254740993',
      documentVersion: '8'
    });
    expect(router.buildLocation({ to: '/documents', search: { project: '2' } }).publicHref).toBe(
      '/projects/2/documents'
    );
    await router.navigate({ to: '/documents', search: { project: '2' } });
    expect(history.location.href).toBe('/projects/2/documents');
    expect(router.state.location.search.project).toBe('2');
    history.back();
    await router.load();
    expect(router.state.location.search.project).toBe('9007199254740993');
    expect(router.state.location.search.documentVersion).toBe('8');
  }
);
