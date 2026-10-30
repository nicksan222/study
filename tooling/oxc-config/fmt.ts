import type { UserConfig } from 'vite-plus';

type FmtConfig = NonNullable<UserConfig['fmt']>;

export const fmt = {
  endOfLine: 'lf',
  sortPackageJson: {},
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'none',
  sortImports: { newlinesBetween: true, partitionByNewline: false },
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.astro/**',
    '**/generated/**',
    '**/routeTree.gen.ts',
    'packages/db/drizzle/**',
    'target/**'
  ]
} satisfies FmtConfig;
