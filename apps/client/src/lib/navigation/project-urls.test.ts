import { test } from '@study/testing';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stringifySearchWith
} from '@tanstack/react-router';

import { canonicalProjectHref, projectUrlRewrite } from './project-urls';
import { validateSearch } from './route-contract';

const url = (path: string) => new URL(path, 'http://localhost');

test.stable.each([
  'notes',
  'pages',
  'practice',
  'flashcards',
  'sources/3',
  'materials/4',
  'pages/5',
  'note/6'
])('puts project scope in the path for %s while retaining other URL state', (path) => {
  test
    .expect(canonicalProjectHref(`/${path}?project=9007199254740993&pageVersion=8#heading`))
    .toBe(`/projects/9007199254740993/${path}?pageVersion=8#heading`);
});

test.stable(
  'uses the path project over a conflicting query, without applying the prefix twice',
  () => {
    test
      .expect(canonicalProjectHref('/projects/2/pages?project=3&pageVersion=8'))
      .toBe('/projects/2/pages?pageVersion=8');
    const internal = projectUrlRewrite.input({
      url: url('/projects/2/pages/4?project=3&pageVersion=8#note')
    })!;

    test.expect(internal.pathname).toBe('/pages/4');
    test.expect(internal.searchParams.get('project')).toBe('2');
    test.expect(internal.searchParams.get('pageVersion')).toBe('8');
    test.expect(internal.hash).toBe('#note');
  }
);

test.stable.each(['0', '-1', '1.5', 'wrong', '9223372036854775808', '0002'])(
  'does not decode an invalid project identity %s into a global document route',
  (project) => {
    const external = url(`/projects/${project}/pages`);

    test.expect(projectUrlRewrite.input({ url: external })).toBeUndefined();
    test.expect(external.pathname).toBe(`/projects/${project}/pages`);
    test
      .expect(canonicalProjectHref(`/pages?project=${project}`))
      .toBe(`/pages?project=${project}`);
  }
);

test.stable('leaves global destinations alone and supports project-root links', () => {
  test.expect(canonicalProjectHref('/pages?pageVersion=8#note')).toBe('/pages?pageVersion=8#note');
  test.expect(canonicalProjectHref('/projects')).toBe('/projects');
  test.expect(canonicalProjectHref('/?project=2')).toBe('/projects/2');
  test.expect(projectUrlRewrite.input({ url: url('/projects/2') })?.pathname).toBe('/projects');
});

test.stable(
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
    test.expect(router.state.matches.at(-1)?.routeId).toBe('/pages/$pageId');
    test.expect(router.state.location.search).toEqual({
      project: '9007199254740993',
      pageVersion: '8'
    });
    test
      .expect(router.buildLocation({ to: '/pages', search: { project: '2' } }).publicHref)
      .toBe('/projects/2/pages');
    await router.navigate({ to: '/pages', search: { project: '2' } });
    test.expect(history.location.href).toBe('/projects/2/pages');
    test.expect(router.state.location.search.project).toBe('2');
    history.back();
    await router.load();
    test.expect(router.state.location.search.project).toBe('9007199254740993');
    test.expect(router.state.location.search.pageVersion).toBe('8');
  }
);
