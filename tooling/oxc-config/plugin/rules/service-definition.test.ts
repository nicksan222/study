import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable('service factories use the domain identity in service and index entries', async () => {
  const diagnostics = await lintRule('service-definition', {
    'src/features/projects/service/index.ts': String.raw`import { defineService as define } from "#server/platform/definitions/define-service";
export const Projects = define("study/Projects", make);`,
    'src/features/reading-list/index.ts': String.raw`import * as factories from "#server/platform/definitions/define-service";
export const ReadingList = factories.defineService("study/ReadingList", make);`,
    'src/features/sources/service/index.ts': String.raw`import { defineService } from "#server/platform/definitions/define-service";
export const Sources = defineService("study/Wrong", make);`,
    'src/features/jobs/index.ts': String.raw`import { Context } from "effect";
export class Jobs extends Context.Service()("study/Jobs") {}`,
    'src/features/empty/index.ts': "export { type Input } from './service/index.ts';",
    'src/features/themes/index.ts': "export { Themes } from './service/index.ts';",
    'src/domains/projects/store.ts': 'export function helper() {}'
  });

  test
    .expect(diagnostics.map((d) => d.filename.split('/apps/server/')[1]).sort())
    .toStrictEqual([
      'src/features/empty/index.ts',
      'src/features/jobs/index.ts',
      'src/features/sources/service/index.ts'
    ]);
});

test.stable(
  'service identity checks follow aliases without accepting shadowed factories',
  async () => {
    const diagnostics = await lintRule('service-definition', {
      'src/features/auth/service/index.ts': String.raw`import { defineService as factory } from "#server/platform/definitions/define-service";
const alias = factory;
const service = alias("study/Auth", make);
export { service as Auth };`,
      'src/features/jobs/service/index.ts': String.raw`import { defineService } from "#server/platform/definitions/define-service";
function build(defineService) {
  return defineService("study/Jobs", make);
}
export const Jobs = build(custom);`
    });

    test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    test.assert.match(diagnostics[0].filename, /jobs\/service\/index.ts/);
  }
);

test.stable('feature service uses canonical platform factory and identity', async () => {
  const diagnostics = await lintRule('service-definition', {
    'src/features/source/service/index.ts': String.raw`import { defineService as factory } from "#server/platform/definitions/define-service";
export const SourceService = factory("study/Wrong", make);`,
    'src/features/project/service/index.ts': String.raw`import { defineService } from "#server/platform/definitions/define-service";
export const ProjectService = defineService("study/Project", make);`
  });

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});
