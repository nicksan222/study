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

  for (const module of modules) {
    if (!module.ok()) throw new Error(`Cannot collect E2E identities: ${module.moduleId}`);

    for (const test of module.children.allTests()) {
      const identity = workflowName(test.name);
      const location = `${module.moduleId}: ${test.name}`;
      const previous = identities.get(identity);

      if (previous)
        throw new Error(`Baseline identity collision "${identity}": ${previous} and ${location}`);

      identities.set(identity, location);
    }
  }
}
