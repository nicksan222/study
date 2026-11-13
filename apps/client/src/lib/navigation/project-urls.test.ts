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
  'notes',
  'pages',
  'practice',
  'flashcards',
  'sources/3',
  'materials/4',
  'pages/5',
  'note/6'
])('puts project scope in the path for %s while retaining other URL state', (path) => {
  expect(canonicalProjectHref(`/${path}?project=9007199254740993&pageVersion=8#heading`)).toBe(
    `/projects/9007199254740993/${path}?pageVersion=8#heading`
  );
});

testStable(
  'uses the path project over a conflicting query, without applying the prefix twice',
  () => {
    expect(canonicalProjectHref('/projects/2/pages?project=3&pageVersion=8')).toBe(
      '/projects/2/pages?pageVersion=8'
    );
    const internal = projectUrlRewrite.input({
      url: url('/projects/2/pages/4?project=3&pageVersion=8#note')
    })!;

    expect(internal.pathname).toBe('/pages/4');
    expect(internal.searchParams.get('project')).toBe('2');
    expect(internal.searchParams.get('pageVersion')).toBe('8');
    expect(internal.hash).toBe('#note');
  }
);

testStable.each(['0', '-1', '1.5', 'wrong', '9223372036854775808', '0002'])(
  'does not decode an invalid project identity %s into a global document route',
  (project) => {
    const external = url(`/projects/${project}/pages`);

    expect(projectUrlRewrite.input({ url: external })).toBeUndefined();
    expect(external.pathname).toBe(`/projects/${project}/pages`);
    expect(canonicalProjectHref(`/pages?project=${project}`)).toBe(`/pages?project=${project}`);
  }
);

testStable('leaves global destinations alone and supports project-root links', () => {
  expect(canonicalProjectHref('/pages?pageVersion=8#note')).toBe('/pages?pageVersion=8#note');
  expect(canonicalProjectHref('/projects')).toBe('/projects');
  expect(canonicalProjectHref('/?project=2')).toBe('/projects/2');
  expect(projectUrlRewrite.input({ url: url('/projects/2') })?.pathname).toBe('/projects');
});

testStable(
  'matches direct project paths, publishes scoped links, switches projects, and restores scope on back',
  async () => {
    const root = createRootRoute({ validateSearch });
    const index = createRoute({ getParentRoute: () => root, path: '/pages' });
    const detail = createRoute({ getParentRoute: () => root, path: '/pages/$pageId' });
    const history = createMemoryHistory({
      initialEntries: ['/projects/9007199254740993/pages/4?pageVersion=8']
    });
    const router = createRouter({
      routeTree: root.addChildren([index, detail]),
      history,
      rewrite: projectUrlRewrite,
      parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
      stringifySearch: stringifySearchWith(String)
    });

    await router.load();
    expect(router.state.matches.at(-1)?.routeId).toBe('/pages/$pageId');
    expect(router.state.location.search).toEqual({
      project: '9007199254740993',
      pageVersion: '8'
    });
    expect(router.buildLocation({ to: '/pages', search: { project: '2' } }).publicHref).toBe(
      '/projects/2/pages'
    );
    await router.navigate({ to: '/pages', search: { project: '2' } });
    expect(history.location.href).toBe('/projects/2/pages');
    expect(router.state.location.search.project).toBe('2');
    history.back();
    await router.load();
    expect(router.state.location.search.project).toBe('9007199254740993');
    expect(router.state.location.search.pageVersion).toBe('8');
  }
);
