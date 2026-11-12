import type { TestProject } from 'vite-plus/test/node';

import { workflowName } from './identity.ts';

/** Native collection runs before workers, even when execution is filtered to one title. */
export default async function setup(project: TestProject): Promise<void> {
  const specifications = (await project.vitest.globTestSpecifications()).filter(
    (specification) =>
      specification.project === project && !specification.moduleId.includes('/harness/')
  );
  const modules = await project.vitest.parseSpecifications(specifications);
  const identities = new Map<string, string>();
  const titles = new Map<string, string>();

  for (const module of modules) {
    if (!module.ok()) throw new Error(`Cannot collect E2E identities: ${module.moduleId}`);

    for (const test of module.children.allTests()) {
      // Native static collection retains literal escapes; only punctuation escapes preserve identity.
      const title = test.name.replace(/\\(.)/gs, (_, character: string) => {
        if (!['"', "'", '\\'].includes(character))
          throw new Error(`Unsupported escape in E2E title: ${module.moduleId}: ${test.name}`);

        return character;
      });
      const identity = workflowName(title);
      const location = `${module.moduleId}: ${test.name}`;
      const previous = identities.get(identity);

      if (previous)
        throw new Error(`Baseline identity collision "${identity}": ${previous} and ${location}`);

      identities.set(identity, location);
      titles.set(identity, title);
    }
  }

  if (process.env.E2E_UPDATE) {
    const workflow = process.env.E2E_UPDATE.split('/')[0]!;
    const title = titles.get(workflow);

    if (!title) throw new Error(`Unknown E2E workflow: ${workflow}`);

    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    project.config.testNamePattern = new RegExp(`^(?:\\[stable\\] )?${escaped}$`);
  }
}
