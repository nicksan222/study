import { temporaryDirectory } from '@study/testing/resources';
import { $ } from 'bun';

export async function integrationFixture(mode = 'success') {
  const temporary = await temporaryDirectory({ executable: true });
  const directory = temporary.path;
  const root = `${directory}/workspace`;

  for (const file of [
    'package.json',
    'bun.lock',
    'vite.config.ts',
    'packages/fixture.txt',
    'tooling/package.json',
    'apps/server/package.json',
    'tooling/testing/integrations/Dockerfile',
    'apps/client/package.json',
    'apps/desktop/package.json'
  ])
    await Bun.write(`${root}/${file}`, '{}');

  await Bun.write(
    `${directory}/docker`,
    `#!${process.execPath}
const base = ${JSON.stringify(directory)};
const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
const command = args[0];
if (command === 'build') {
  if (mode === 'build-failure') { console.error('fixture build failure'); process.exit(19); }
  await Bun.write(base + '/image', 'owned');
} else if (command === 'create') {
  await Bun.write(base + '/container', 'owned');
  if (mode === 'create-failure') process.exit(23);
} else if (command === 'start') {
  console.log('✓ imports a fixture note');
  await Bun.write(base + '/started', 'ready');
  if (mode === 'interrupt') await new Promise(() => setInterval(() => {}, 100));
  if (mode === 'test-failure') process.exit(7);
  if (mode === 'start-failure') process.exit(125);
} else if (command === 'inspect') {
  console.log(mode === 'start-failure' ? 'created 0' : mode === 'test-failure' ? 'exited 7' : 'exited 0');
} else if (command === 'cp') {
  if (mode === 'report-failure') process.exit(11);
  const target = args.at(-1);
  await Bun.write(target + '/vitest/integrations.xml', '<testsuite name="provider imports"/>');
  await Bun.write(target + '/integrations/provider.log', 'provider diagnostics');
} else if (command === 'ps' || command === 'images') {
  if (await Bun.file(base + (command === 'ps' ? '/container' : '/image')).exists()) console.log('owned');
} else if (command === 'rm') {
  await Bun.file(base + '/container').delete();
} else if (command === 'rmi') {
  await Bun.file(base + '/image').delete();
} else if (command !== 'stop') process.exit(99);
`
  );
  await $`chmod +x ${directory}/docker`.quiet();
  const previousPath = process.env.PATH;

  process.env.PATH = `${directory}:${previousPath}`;

  return {
    root,
    directory,
    async [Symbol.asyncDispose]() {
      process.env.PATH = previousPath;
      await temporary[Symbol.asyncDispose]();
    }
  };
}
