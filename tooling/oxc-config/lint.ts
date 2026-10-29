import type { UserConfig } from 'vite-plus';

type LintConfig = NonNullable<UserConfig['lint']>;

const noServerMocks =
  'Server tests must exercise real procedures and dependencies without mocking.';

const effectV4Imports = [
  {
    regex: '^effect/unstable(/|$)',
    message: 'Effect v4 moved these modules to effect/*; remove the unstable segment.'
  },
  {
    regex: '^@effect/(platform|rpc)(/|$)',
    message: 'Effect v4 merged this package into effect; use the corresponding effect module.'
  }
];

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
  // tsc owns type checking; Oxlint also uses type information for correctness rules.
  options: { typeAware: true, typeCheck: false },
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.astro/**',
    '**/generated/**',
    '**/routeTree.gen.ts',
    'packages/db/drizzle/**',
    'target/**'
  ],
  rules: {
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

    'study/server-no-mocks': 'error',
    'study/effect-v4-api': 'error',
    'eslint/no-restricted-imports': ['error', { patterns: effectV4Imports }],
    'study/database-ownership': 'error',
    'study/procedure-test': 'error',
    'study/procedure-contract': 'error',
    'study/browser-boundary': 'error',
    'study/package-boundary': 'error',
    'study/theme-colors': 'error',
    'study/shared-ui-variants': 'error',
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
    'vitest/padding-around-test-blocks': 'error',
    // Keep the same explicit exceptions as Groam's shared Oxlint policy.
    'vitest/require-mock-type-parameters': 'off',
    'typescript/no-misused-spread': 'off',
    'typescript/unbound-method': 'off',
    'jsx-a11y/prefer-tag-over-role': 'off',
    'vitest/require-to-throw-message': 'off',
    'react/refs': 'off',
    'vitest/no-conditional-expect': 'off',
    'typescript/restrict-template-expressions': 'off',
    'eslint/no-unused-vars': [
      'error',
      { args: 'all', argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }
    ],
    'react/rules-of-hooks': 'error',
    'typescript/consistent-type-exports': 'error',
    'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
    'typescript/no-import-type-side-effects': 'error',
    'typescript/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'separate-type-imports' }
    ],
    'vitest/no-focused-tests': 'error',
    'vitest/no-disabled-tests': 'error'
  },
  overrides: [
    {
      files: ['**/apps/server/**/*.{ts,tsx}'],
      rules: {
        'typescript/switch-exhaustiveness-check': [
          'error',
          { considerDefaultExhaustiveForUnions: false }
        ],
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
              ...effectV4Imports,
              {
                regex: '^\\.\\./',
                message:
                  'Use extensionless #server/* or #testing/* package imports across directories.'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['**/*.test.{ts,tsx,js,mjs,cjs}'],
      rules: {
        // Node's test runner owns registration promises and reports callback failures.
        'typescript/no-floating-promises': [
          'error',
          {
            allowForKnownSafeCalls: [
              { from: 'package', package: 'node:test', name: ['test', 'it', 'describe'] }
            ]
          }
        ]
      }
    }
  ]
} satisfies LintConfig;
