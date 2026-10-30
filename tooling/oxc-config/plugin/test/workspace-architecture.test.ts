import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dependencyIdentity, workspaceArchitecture } from '../../workspace-architecture.ts';

const valid = {
  'apps/server': {
    name: '@study/server',
    dependencies: { effect: '4.0.7', ai: '6.0.316', '@study/contracts': '*' }
  },
  'packages/contracts': {
    name: '@study/contracts',
    exports: { '.': './src/index.ts' },
    dependencies: { effect: '4.0.7' }
  },
  'packages/db': {
    name: '@study/db',
    dependencies: { 'drizzle-orm': '1.0.0-rc.5' },
    devDependencies: { 'drizzle-kit': '1.0.0-rc.5' }
  }
};

test('the lockfile cannot split Effect schema identity or Drizzle instances', () => {
  const packages = {
    'node_modules/effect': { version: '4.0.7' },
    'node_modules/drizzle-orm': { version: '1.0.0-rc.5' }
  };

  assert.deepEqual(dependencyIdentity(packages, '4.0.7'), []);
  assert.equal(
    dependencyIdentity(
      {
        ...packages,
        'apps/server/node_modules/effect': { version: '4.1.0' },
        'packages/db/node_modules/drizzle-orm': { version: '1.0.0-rc.5' }
      },
      '4.0.7'
    ).length,
    3
  );
});

test('workspace ownership permits the target design and rejects retired packages even when unused', () => {
  assert.deepEqual(workspaceArchitecture(valid), []);
  const issues = workspaceArchitecture({
    ...valid,
    'packages/ai': { name: '@study/ai' },
    'apps/web': {
      name: '@study/web',
      optionalDependencies: { '@study/ai': '*', '@ai-sdk/openai': '3.0.132', 'drizzle-orm': '1' }
    }
  });

  assert.equal(issues.length, 4, issues.join('\n'));
});

test('contracts expose browser-safe explicit entrypoints and cannot gain implementation dependencies', () => {
  const issues = workspaceArchitecture({
    ...valid,
    'packages/contracts': {
      name: '@study/contracts',
      dependencies: { '@study/server': '*', '@study/db': '*', zod: '4' },
      exports: { './*': './src/*' }
    }
  });

  assert.equal(issues.length, 4, issues.join('\n'));
  assert.ok(
    workspaceArchitecture({ 'apps/server': valid['apps/server'] }).some((issue) =>
      issue.includes('packages/contracts')
    )
  );
});

test('Effect consumers share an exact v4 version and AI dependencies stay in the server', () => {
  const issues = workspaceArchitecture({
    ...valid,
    'apps/web': { dependencies: { effect: '^4.0.7', ai: '6' } },
    'packages/contracts': { ...valid['packages/contracts'], dependencies: { effect: '4.0.5' } }
  });

  assert.equal(issues.length, 3, issues.join('\n'));
});

test('retired transport dependencies are rejected in every manifest section', () => {
  const issues = workspaceArchitecture({
    ...valid,
    'apps/web': {
      dependencies: { '@trpc/client': '1', superjson: '1' },
      devDependencies: { '@trpc/server': '1' }
    }
  });

  assert.equal(issues.length, 3, issues.join('\n'));
});
