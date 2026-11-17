import type { UserConfig } from 'vite-plus';

import { upstreamSkillPatterns } from './upstream-skills.ts';

type LintConfig = NonNullable<UserConfig['lint']>;

const noServerMocks =
  'Server tests must exercise real procedures and dependencies without mocking.';

const declarations = [
  'interface',
  'type',
  'function',
  'function-overload',
  'class',
  'enum',
  { selector: 'ExportNamedDeclaration[declaration], ExportDefaultDeclaration' },
  { selector: 'Program > VariableDeclaration' }
];

const classifiedTestBlocks = ['unit', 'server', 'browser'].flatMap((environment) => [
  `test.${environment}.stable`,
  `test.${environment}.stable.extend`,
  `test.${environment}.stable.each`,
  `test.${environment}.stable.for`,
  `test.${environment}.stable.concurrent`,
  `test.${environment}.regression`,
  `test.${environment}.migration`,
  `test.${environment}.characterization`
]);

export const lint = {
  plugins: [
    'eslint',
    'typescript',
    'unicorn',
    'oxc',
    'react',
    'jsx-a11y',
    'import',
    'node',
    'vitest'
  ],
  jsPlugins: [
    { name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' },
    { name: '@stylistic', specifier: '@stylistic/eslint-plugin' },
    { name: 'study', specifier: './tooling/oxc-config/plugin/index.ts' }
  ],
  categories: { correctness: 'error' },
  // Dedicated tsc checks own type analysis; lint checks syntax and architecture.
  options: { typeAware: false, typeCheck: false, reportUnusedDisableDirectives: 'error' },
  ignorePatterns: [
    ...upstreamSkillPatterns,
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.astro/**',
    '**/generated/**',
    '**/routeTree.gen.ts',
    'packages/db/drizzle/**',
    // Bundled source bytes are imported as data, including code examples.
    'tooling/scripts/seed/fixtures/files/**',
    'target/**'
  ],
  rules: {
    // Readability and rendering safety beyond the correctness category.
    'eslint/max-depth': ['error', 3],
    'eslint/max-nested-callbacks': ['error', 3],
    'react/rules-of-hooks': 'error',
    'react/no-array-index-key': 'error',
    'react/no-unstable-nested-components': 'error',
    'oxc/no-accumulating-spread': 'error',
    'unicorn/no-useless-spread': 'error',

    // Server construction, feature architecture and test harnesses.
    'study/effect-function-harness': 'error',
    'study/service-access': 'error',
    'study/validated-mutation': 'error',
    'study/cleanup-harness': 'error',
    'study/build-artifact-ownership': 'error',
    'study/activity-harness': 'error',
    'study/definition-generators': 'error',
    'study/feature-orchestration': 'error',
    'study/native-clock': 'error',
    'study/metric-cardinality': 'error',
    'study/context-identity': 'error',
    'study/service-definition': 'error',
    'study/module-factories': 'error',
    'study/operation-conventions': 'error',
    'study/structured-logging': 'error',
    'study/workflow-boundary': 'error',
    'study/workflow-persistence-boundary': 'error',
    'study/feature-persistence-boundary': 'error',
    'study/harness-boundary': 'error',
    'study/test-classification': 'error',
    'study/test-infrastructure': 'error',
    'study/web-e2e-harness': 'error',
    'study/assertion-boundary': 'error',
    'study/test-guard-assertions': 'error',
    'study/feature-layout': 'error',
    'study/server-layer-boundary': 'error',
    'study/ai-boundary': 'error',
    'study/contract-schema': 'error',
    'study/agent-definition': 'error',
    'study/no-double-assertion': 'error',
    'study/effect-lazy-boundary': 'error',
    'study/environment-boundary': 'error',
    'study/no-deep-relative-imports': 'error',
    'study/application-transactions': 'error',
    'study/guarded-mutations': 'error',
    'study/executed-query': 'error',
    'study/sql-null-comparison': 'error',

    // Effect lifecycles, persistence integrity and typed failure handling.
    'study/drizzle-boundary': 'error',
    'study/effect-scoped-fibers': 'error',
    'study/effect-no-native-timers': 'error',
    'study/effect-bounded-concurrency': 'error',
    'study/effect-bounded-retries': 'error',
    'study/effect-abort-signal': 'error',

    'study/effect-no-discarded': 'error',
    'study/effect-runtime-boundary': 'error',
    'study/effect-try-promise': 'error',
    'study/effect-no-throw': 'error',
    'study/effect-no-or-die': 'error',
    'study/effect-no-swallowed-failures': 'error',
    'study/no-lossy-ids': 'error',
    'study/decode-persisted-json': 'error',
    'study/parameterized-sql': 'error',
    'study/no-non-null-query-results': 'error',
    'study/synchronous-transactions': 'error',
    'study/transaction-no-io': 'error',
    'study/no-error-message-matching': 'error',
    'study/preserve-error-cause': 'error',

    // Module ownership and shared browser presentation.
    'study/server-file-description': 'error',
    'study/lint-rule-description': 'error',
    'study/server-no-mocks': 'error',
    'study/package-root-exports': 'error',
    'study/effect-native-combinators': 'error',
    'study/database-ownership': 'error',
    'study/library-ownership': 'error',
    'study/browser-boundary': 'error',
    'study/package-boundary': 'error',
    'study/feature-preview-boundary': 'error',
    'study/integration-test-environment': 'error',
    'study/theme-colors': 'error',
    'study/shared-ui-variants': 'error',
    'study/shared-ui-patterns': 'error',
    'study/icon-aliases': 'error',
    'study/ai-readiness': 'error',
    'study/shared-loading': 'error',
    'study/shared-error-state': 'error',
    'study/web-presentation': 'error',
    'study/web-boundaries': 'error',
    'study/dictation-boundary': 'error',
    'study/web-page-contract': 'error',
    'study/web-presentation-purity': 'error',
    'study/web-query-contract': 'error',
    'study/web-router-loaders': 'error',
    'study/web-router-navigation': 'error',

    // Bindings, import conventions and statement layout.
    'eslint/no-unused-vars': [
      'error',
      { args: 'all', argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }
    ],
    'typescript/consistent-type-exports': 'error',
    'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
    'typescript/no-import-type-side-effects': 'error',
    'typescript/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'separate-type-imports' }
    ],
    'vite-plus/prefer-vite-plus-imports': 'error',
    '@stylistic/padding-line-between-statements': [
      'error',
      {
        blankLine: 'always',
        prev: { selector: 'BlockStatement > VariableDeclaration' },
        next: '*'
      },
      {
        blankLine: 'any',
        prev: { selector: 'BlockStatement > VariableDeclaration' },
        next: { selector: 'BlockStatement > VariableDeclaration' }
      },
      {
        blankLine: 'always',
        prev: '*',
        next: ['return', 'throw', 'if', 'for', 'while', 'do', 'switch', 'try']
      },
      { blankLine: 'always', prev: ['if', 'for', 'while', 'do', 'switch', 'try'], next: '*' },
      { blankLine: 'always', prev: '*', next: declarations },
      { blankLine: 'always', prev: declarations, next: '*' }
    ],
    '@stylistic/lines-between-class-members': [
      'error',
      {
        enforce: [
          { blankLine: 'always', prev: '*', next: 'method' },
          { blankLine: 'always', prev: 'method', next: '*' }
        ]
      }
    ],

    // Test registration and assertion safety.
    'vitest/padding-around-test-blocks': 'error',
    'vitest/no-standalone-expect': [
      'error',
      { additionalTestBlockFunctions: classifiedTestBlocks }
    ],
    'vitest/valid-expect': ['error', { maxArgs: 2 }],
    'vitest/no-focused-tests': 'error',
    'vitest/no-disabled-tests': 'error',

    // Explicit exceptions to the correctness category.
    // Mock signatures are irrelevant to server tests, which forbid mock APIs.
    'vitest/require-mock-type-parameters': 'off',
    // Shared widgets use ARIA roles where native tags do not match their interactions.
    'jsx-a11y/prefer-tag-over-role': 'off',
    // Error tests may assert typed failures without coupling to message wording.
    'vitest/require-to-throw-message': 'off',
    // Ref-backed shared controls need a separate React Compiler compatibility audit.
    'react/refs': 'off',
    // Oxlint does not recognize classified registrations such as test.unit.stable for this rule.
    'vitest/no-conditional-expect': 'off'
  },
  overrides: [
    {
      files: ['**/packages/testing/test/vitest.test.ts'],
      rules: {
        'vitest/no-standalone-expect': [
          'error',
          {
            additionalTestBlockFunctions: [
              ...classifiedTestBlocks,
              'prepared.stable',
              'prepared.regression'
            ]
          }
        ]
      }
    },
    {
      files: ['**/apps/server/**/*.{ts,tsx}'],
      rules: {
        'react/rules-of-hooks': 'off',
        'typescript/array-type': ['error', { default: 'array' }],
        'eslint/no-restricted-properties': ['error', { property: 'mock', message: noServerMocks }],
        'eslint/no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'node:test', importNames: ['mock'], message: noServerMocks },
              { name: 'vitest', importNames: ['vi', 'vitest'], message: noServerMocks },
              { name: 'vite-plus/test', importNames: ['vi', 'vitest'], message: noServerMocks },
              { name: '@jest/globals', importNames: ['jest'], message: noServerMocks },
              { name: 'jest-mock', message: noServerMocks }
            ],
            patterns: [
              {
                regex: '^\\.\\./',
                message:
                  'Use extensionless #server/* or #testing/* package imports across directories.'
              }
            ]
          }
        ]
      }
    }
  ]
} satisfies LintConfig;
