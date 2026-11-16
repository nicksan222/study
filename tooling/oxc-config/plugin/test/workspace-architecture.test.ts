import { test } from '@study/testing';

import {
  dependencyIdentity,
  workspaceArchitecture
} from '#tooling/oxc-config/workspace-architecture';

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
    exports: { '.': './src/index.ts' },
    dependencies: { 'drizzle-orm': '1.0.0-rc.5' },
    devDependencies: { 'drizzle-kit': '1.0.0-rc.5' }
  }
};

test.stable(
  'the lockfile cannot split Effect schema identity or Drizzle instances',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const packages = {
      effect: ['effect@4.0.7'],
      'drizzle-orm': ['drizzle-orm@1.0.0-rc.5']
    };

    expect(dependencyIdentity(packages, '4.0.7')).toStrictEqual([]);
    assert.strictEqual(
      dependencyIdentity(
        {
          ...packages,
          'apps/server/effect': ['effect@4.1.0'],
          'packages/db/drizzle-orm': ['drizzle-orm@1.0.0-rc.5']
        },
        '4.0.7'
      ).length,
      3
    );
  }
);

test.stable(
  'workspace ownership rejects misplaced AI providers and Drizzle dependencies',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(workspaceArchitecture(valid)).toStrictEqual([]);
    const issues = workspaceArchitecture({
      ...valid,
      'apps/client': {
        name: '@study/client',
        optionalDependencies: { '@ai-sdk/openai': '3.0.132', 'drizzle-orm': '1' }
      }
    });

    assert.strictEqual(issues.length, 2, issues.join('\n'));
  }
);

test.stable(
  'shared AI mocks may implement the provider protocol without owning real providers',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      workspaceArchitecture({
        ...valid,
        'packages/testing': {
          exports: { '.': './src/index.ts' },
          dependencies: { '@ai-sdk/provider': '3.0.19' }
        }
      })
    ).toStrictEqual([]);

    const issues = workspaceArchitecture({
      ...valid,
      'packages/testing': {
        exports: { '.': './src/index.ts' },
        dependencies: { ai: '6.0.316', '@ai-sdk/openai': '3.0.132' }
      },
      'apps/client': { dependencies: { '@ai-sdk/provider': '3.0.19' } }
    });

    assert.strictEqual(issues.length, 3, issues.join('\n'));
  }
);

test.stable(
  'contracts expose browser-safe explicit entrypoints and cannot gain implementation dependencies',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const issues = workspaceArchitecture({
      ...valid,
      'packages/contracts': {
        name: '@study/contracts',
        dependencies: { '@study/server': '*', '@study/db': '*', zod: '4' },
        exports: { './*': './src/*' }
      }
    });

    expect(issues.filter((issue) => issue.includes('packages/contracts'))).toHaveLength(5);
    assert.ok(
      workspaceArchitecture({ 'apps/server': valid['apps/server'] }).some((issue) =>
        issue.includes('packages/contracts')
      )
    );
  }
);

test.stable(
  'Effect consumers share an exact v4 version and AI dependencies stay in the server',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const issues = workspaceArchitecture({
      ...valid,
      'apps/client': { dependencies: { effect: '^4.0.7', ai: '6' } },
      'packages/contracts': { ...valid['packages/contracts'], dependencies: { effect: '4.0.5' } }
    });

    assert.strictEqual(issues.length, 3, issues.join('\n'));
  }
);

test.stable('optional contract React bindings use official Effect state', ({ expect }) => {
  expect(
    workspaceArchitecture({
      ...valid,
      'packages/contracts': {
        ...valid['packages/contracts'],
        dependencies: { effect: '4.0.7', '@effect/atom-react': '4.0.7' },
        peerDependencies: { react: '^19.3.1' }
      }
    })
  ).toEqual([]);
});

test.stable(
  'package manifests expose root APIs and only explicit approved facets',
  ({ expect }) => {
    const issues = workspaceArchitecture({
      ...valid,
      'packages/ui': {
        name: '@study/ui',
        exports: { './*': './src/components/*.tsx', './private': './src/private.ts' }
      },
      'packages/testing': {
        name: '@study/testing',
        exports: { './vitest': './src/vitest.ts', './process': './src/process.ts' }
      },
      'apps/server': {
        ...valid['apps/server'],
        exports: { '.': './src/index.ts', './client': './src/client/index.ts' }
      }
    });

    expect(issues.some((issue) => issue.includes('packages/ui'))).toBe(true);
    expect(issues.some((issue) => issue.includes('packages/testing'))).toBe(true);
    expect(issues.some((issue) => issue.includes('apps/server'))).toBe(true);
  }
);
