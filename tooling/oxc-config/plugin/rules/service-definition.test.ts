import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('service factories use the domain identity in service and index entries', () => {
  const diagnostics = lintRule('service-definition', {
    'src/features/projects/service/index.ts':
      "import { defineService as define } from '#server/platform/definitions/define-service'; export const Projects = define('study/Projects', make);",
    'src/features/reading-list/index.ts':
      "import * as factories from '#server/platform/definitions/define-service'; export const ReadingList = factories.defineService('study/ReadingList', make);",
    'src/features/sources/service/index.ts':
      "import { defineService } from '#server/platform/definitions/define-service'; export const Sources = defineService('study/Wrong', make);",
    'src/features/jobs/index.ts':
      "import { Context } from 'effect'; export class Jobs extends Context.Service()('study/Jobs') {}",
    'src/features/empty/index.ts': "export { type Input } from './service/index.ts';",
    'src/features/themes/index.ts': "export { Themes } from './service/index.ts';",
    'src/domains/projects/store.ts': 'export function helper() {}'
  });

  assert.deepEqual(diagnostics.map((d) => d.filename.split('/apps/server/')[1]).sort(), [
    'src/features/empty/index.ts',
    'src/features/jobs/index.ts',
    'src/features/sources/service/index.ts'
  ]);
});

test('service identity checks follow aliases without accepting shadowed factories', () => {
  const diagnostics = lintRule('service-definition', {
    'src/features/auth/service/index.ts':
      "import { defineService as factory } from '#server/platform/definitions/define-service'; const alias = factory; const service = alias('study/Auth', make); export { service as Auth };",
    'src/features/jobs/service/index.ts':
      "import { defineService } from '#server/platform/definitions/define-service'; function build(defineService) { return defineService('study/Jobs', make); } export const Jobs = build(custom);"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.match(diagnostics[0].filename, /jobs\/service\/index.ts/);
});

test('feature service uses canonical platform factory and identity', () => {
  const diagnostics = lintRule('service-definition', {
    'src/features/source/service/index.ts':
      "import { defineService as factory } from '#server/platform/definitions/define-service'; export const SourceService = factory('study/Wrong', make);",
    'src/features/project/service/index.ts':
      "import { defineService } from '#server/platform/definitions/define-service'; export const ProjectService = defineService('study/Project', make);"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});
