import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Path } from 'effect';
import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

function workspace(filename: string) {
  const marker = filename.match(/^(.*)\/(?:packages\/integrations|apps\/server)\//);

  return marker?.[1];
}

const roots = new Set([process.cwd()]);

for (const arg of process.argv) {
  const match = /^(.*)\/(?:apps|packages)(?:\/|$)/.exec(arg.replaceAll('\\', '/'));

  if (match) roots.add(match[1]!);
}

const problemsByRoot = new Map<string, string[]>();

for (const root of roots) problemsByRoot.set(root, await fixtureProblems(root));

type Fixture = { scenario?: string; executable?: string };

async function providerDirectories(root: string): Promise<Set<string>> {
  const directory = join(root, 'packages/integrations/src/providers');
  const providers = new Set<string>();

  for (const entry of await Effect.runPromise(fs.readDirectory(directory))) {
    if ((await Effect.runPromise(fs.lstat(join(directory, entry)))).type === 'Directory')
      providers.add(entry);
  }

  return providers;
}

async function extraDockerfiles(directory: string): Promise<string[]> {
  const problems: string[] = [];

  for await (const entry of new Bun.Glob('**/*').scan({ cwd: directory })) {
    if (/dockerfile/i.test(entry.split('/').at(-1)!) && entry !== 'Dockerfile')
      problems.push(
        'Use the shared integrations Dockerfile; provider-specific Dockerfiles are forbidden.'
      );
  }

  return problems;
}

async function providerProblems(
  directory: string,
  id: string,
  fixture: Fixture,
  docker: string
): Promise<string[]> {
  const problems: string[] = [];

  if (
    fixture.scenario !== `providers/${id}/scenario.ts` ||
    !(await Bun.file(join(directory, fixture.scenario)).exists())
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

async function fixtureProblems(root: string): Promise<string[]> {
  const directory = join(root, 'apps/server/test/integrations');
  const manifest = Bun.file(join(directory, 'providers.json'));
  const dockerfile = Bun.file(join(directory, 'Dockerfile'));

  if (!(await manifest.exists()) || !(await dockerfile.exists()))
    return ['Add the shared Dockerfile and providers.json.'];

  const fixtures = (await manifest.json()) as Record<string, Fixture>;
  const docker = await dockerfile.text();
  const providers = await providerDirectories(root);
  const problems = await extraDockerfiles(directory);

  for (const id of new Set([...providers, ...Object.keys(fixtures)])) {
    const fixture = fixtures[id];

    if (!providers.has(id) || !fixture) {
      problems.push(`Provider ${id} must have exactly one shared-image fixture.`);
      continue;
    }

    problems.push(...(await providerProblems(directory, id, fixture, docker)));
  }

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
        const dockerfile = node.arguments[1];

        if (
          filename.endsWith('/test/integrations/environment.ts') &&
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'fromDockerfile' &&
          (dockerfile?.type !== 'Literal' ||
            dockerfile.value !== 'apps/server/test/integrations/Dockerfile')
        )
          context.report({ node, messageId: 'image' });
      },
      Program(node) {
        if (filename === join(root, 'packages/integrations/src/index.ts')) {
          for (const reason of problemsByRoot.get(root) ?? ['Cannot inspect integration fixtures.'])
            context.report({ node, messageId: 'environment', data: { reason } });
        }
      }
    };
  }
});
