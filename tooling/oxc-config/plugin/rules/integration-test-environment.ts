/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keep provider integrations in one shared disposable image.                         │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents provider-specific Docker runtimes and incomplete installation fixtures.         │
 * │ Validates shared fixtures at the integrations entrypoint; only environment.ts launches   │
 * │ Docker.                                                                                  │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // tooling/testing/integrations/environment.ts                                         │
 * │   Bun.spawn(['docker', 'build', '--file',                                                │
 * │     'tooling/testing/integrations/Dockerfile', '.']);                                    │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // tooling/testing/integrations/providers/obsidian/import.integration.test.ts          │
 * │   Bun.spawn(['docker', 'run', 'private-image']);                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Path } from 'effect';
import { defineRule } from 'vite-plus/lint/plugins';

import { imported } from '../lexical-bindings.ts';
import { bunOperation } from '../process-operations.ts';
import { property } from './effect-lifecycle-syntax.ts';
import { resolveValue } from './module-factories.ts';

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

function workspace(filename: string) {
  const marker = filename.match(
    /^(.*)\/(?:packages\/integrations|apps\/server|tooling\/testing)\//
  );

  return marker?.[1];
}

const roots = new Set([process.cwd()]);

for (const arg of process.argv) {
  const match = /^(.*)\/(?:apps|packages)(?:\/|$)/.exec(arg.replaceAll('\\', '/'));

  if (match) roots.add(match[1]!);
}

const problemsByRoot = new Map<string, string[]>();

for (const root of roots) problemsByRoot.set(root, await fixtureProblems(root));

type Fixture = { executable?: string };

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

  const tests = await Array.fromAsync(
    new Bun.Glob(`providers/${id}/**/*.integration.test.ts`).scan({ cwd: directory })
  );

  if (!tests.length) problems.push(`Provider ${id} needs ordinary *.integration.test.ts files.`);

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
  const directory = join(root, 'tooling/testing/integrations');
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

function commandArguments(context: any, input: any): any[] {
  const value = resolveValue(context, input);
  const command =
    value?.type === 'ObjectExpression' ? resolveValue(context, property(value, 'cmd')) : value;

  return command?.type === 'ArrayExpression' ? command.elements : [];
}

function processCall(context: any, node: any): boolean {
  const operation = bunOperation(context, node);

  return (
    operation === 'spawn' ||
    operation === 'spawnSync' ||
    imported(context, resolveValue(context, node), /^@study\/testing\/process$/)
  );
}

function dockerArguments(context: any, node: any, shared: boolean): any[] | null {
  const helper = shared && node.callee.type === 'Identifier' && node.callee.name === 'docker';

  if (!helper && !processCall(context, node.callee)) return null;

  const args = commandArguments(context, node.arguments[0]);

  if (helper) return args;

  return args[0]?.value === 'docker' ? args.slice(1) : null;
}

function sharedDockerfile(args: any[]): boolean {
  const index = args.findIndex((arg) => arg?.type === 'Literal' && arg.value === '--file');
  const file = args[index + 1];

  return (
    index >= 0 &&
    file?.type === 'Literal' &&
    file.value === 'tooling/testing/integrations/Dockerfile'
  );
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep provider tests and installations in one shared disposable integration image.'
    },
    messages: {
      environment: '{{reason}}',
      image:
        'Build integration environments from tooling/testing/integrations/Dockerfile using a literal path.',
      runtime:
        'Only testing/integrations/environment.ts may launch Docker; use the shared integration environment.'
    }
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const root = workspace(filename);

    if (!root) return {};

    const shared = filename.endsWith('/testing/integrations/environment.ts');

    return {
      CallExpression(node) {
        const args = dockerArguments(context, node, shared);

        if (!args) return;

        if (!shared) context.report({ node, messageId: 'runtime' });
        else if (args[0]?.value === 'build' && !sharedDockerfile(args))
          context.report({ node, messageId: 'image' });
      },
      TaggedTemplateExpression(node) {
        if (
          !shared &&
          bunOperation(context, node.tag) === '$' &&
          /^\s*docker\s/.test(node.quasi.quasis[0]?.value.cooked ?? '')
        )
          context.report({ node, messageId: 'runtime' });
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
