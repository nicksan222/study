import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';

function workspace(filename: string) {
  const marker = filename.match(/^(.*)\/(?:packages\/integrations|apps\/server)\//);

  return marker?.[1];
}

function fixtureProblems(root: string): string[] {
  const path = join(root, 'apps/server/test/integrations');
  const manifest = join(path, 'providers.json');
  const dockerfile = join(path, 'Dockerfile');

  if (!existsSync(manifest) || !existsSync(dockerfile))
    return ['Add the shared Dockerfile and providers.json.'];

  const fixtures = JSON.parse(readFileSync(manifest, 'utf8')) as Record<
    string,
    { scenario?: string; executable?: string }
  >;
  const docker = readFileSync(dockerfile, 'utf8');
  const providers = readdirSync(join(root, 'packages/integrations/src/providers'), {
    withFileTypes: true
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const problems = dockerfileProblems(path, dockerfile);

  for (const id of new Set([...providers, ...Object.keys(fixtures)])) {
    const fixture = fixtures[id];

    if (!providers.includes(id) || !fixture) {
      problems.push(`Provider ${id} must have exactly one shared-image fixture.`);
      continue;
    }

    problems.push(...providerProblems(path, id, fixture, docker));
  }

  return problems;
}

function dockerfileProblems(path: string, dockerfile: string) {
  const problems: string[] = [];

  for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
    if (/dockerfile/i.test(entry.name) && join(entry.parentPath, entry.name) !== dockerfile)
      problems.push(
        'Use the shared integrations Dockerfile; provider-specific Dockerfiles are forbidden.'
      );
  }

  return problems;
}

function providerProblems(
  path: string,
  id: string,
  fixture: { scenario?: string; executable?: string },
  docker: string
) {
  const problems: string[] = [];

  if (
    fixture.scenario !== `providers/${id}/scenario.ts` ||
    !existsSync(join(path, fixture.scenario))
  )
    problems.push(`Provider ${id} needs providers/${id}/scenario.ts.`);

  if (!fixture.executable?.startsWith(`/opt/${id}/`))
    problems.push(`Provider ${id} needs an executable installed below /opt/${id}/.`);

  if (
    !new RegExp(`^FROM .+ AS integration-${id}$`, 'mi').test(docker) ||
    !new RegExp(`^COPY --from=integration-${id} /opt/${id} /opt/${id}$`, 'm').test(docker)
  )
    problems.push(
      `Install ${id} in stage integration-${id} and copy /opt/${id} into the shared image.`
    );

  return problems;
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep provider scenarios and installations in one shared disposable integration image.'
    },
    messages: {
      environment: '{{reason}}',
      image:
        'Build integration environments from apps/server/test/integrations/Dockerfile using a literal path.',
      runtime:
        'Only test/integrations/environment.ts may build or start Testcontainers; use the shared integrations Dockerfile.'
    }
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const root = workspace(filename);

    if (!root) return {};

    const edges = moduleEdges(context, (node, source) => {
      if (
        filename.includes('/test/integrations/') &&
        !filename.endsWith('/environment.ts') &&
        source === 'testcontainers'
      )
        context.report({ node, messageId: 'runtime' });
    });

    return {
      ...edges,
      CallExpression(node) {
        edges.CallExpression(node);

        if (
          filename.endsWith('/test/integrations/environment.ts') &&
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'fromDockerfile' &&
          node.arguments[1]?.value !== 'apps/server/test/integrations/Dockerfile'
        )
          context.report({ node, messageId: 'image' });
      },
      Program(node) {
        if (filename === join(root, 'packages/integrations/src/index.ts')) {
          for (const reason of fixtureProblems(root))
            context.report({ node, messageId: 'environment', data: { reason } });
        }
      }
    };
  }
});
