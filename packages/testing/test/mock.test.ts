import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { test } from '@study/testing';
import { Effect, FileSystem, Path } from 'effect';

import { createMockScope } from '../src/mock.ts';
import type * as MockDependency from './mock-dependency.ts';

test.stable(
  'closed mock scopes reject registrations before changing modules or methods',
  ({ mock, expect }) => {
    const dependency = new URL('./mock-dependency.ts', import.meta.url);
    const original = () => 'original';
    const target = { original };

    mock.close();
    expect(() => mock(dependency, () => ({ value: 'leaked' }))).toThrow(ReferenceError);
    expect(() => mock.spyOn(target, 'original')).toThrow(ReferenceError);
    expect(target.original).toBe(original);
  }
);

test.stable(
  'rejected closed-scope registration leaves the original module available',
  async ({ expect }) => {
    const subject = await import('./mock-subject.ts');

    expect(subject.read()).toBe('original');
  }
);

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const paths = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

test.stable(
  'mock fixture scopes dynamic module mocks and clears the module cache',
  async ({ mock, expect }) => {
    const dependency = new URL('./mock-dependency.ts', import.meta.url);

    mock(dependency, () => ({ value: 'first test' }));
    const subject = await import('./mock-subject.ts');

    expect(subject.read()).toBe('first test');
  }
);

test.stable(
  'mock fixture restores the original module for the next test',
  async ({ mock, expect }) => {
    const subject = await import('./mock-subject.ts');

    const helper = mock.fn(() => 'helper');
    const spy = mock.spyOn(subject, 'read').mockReturnValue('scoped spy');

    expect(helper()).toBe('helper');
    expect(subject.read()).toBe('scoped spy');
    expect(spy).toHaveBeenCalledOnce();
  }
);

test.stable(
  'mock scopes resolve owner aliases and support native partial factories',
  async ({ task: _task, expect }) => {
    const source = '#testing/mock-dependency';
    using mock = createMockScope({
      resolve: (requested) =>
        requested === source
          ? Bun.fileURLToPath(new URL('./mock-dependency.ts', import.meta.url))
          : requested
    });

    mock(source, async (importOriginal) => {
      const original = await importOriginal<typeof MockDependency>();

      expect(original.value).toBe('original');

      return { ...original, value: 'owner override' };
    });

    const subject = await import('./mock-subject.ts');

    expect(subject.read()).toBe('owner override');
  }
);

test.stable(
  'mock fixture cleans module mocks after a failed test callback',
  async ({ task: _task, temporaryDirectory, spawnTestProcess, expect }) => {
    await using directory = await temporaryDirectory({ prefix: 'study-mock-scope-' });
    const fixture = paths.join(directory.path, 'mock-scope.test.mjs');
    const config = paths.join(directory.path, 'vite.config.mjs');
    const restored = paths.join(directory.path, 'restored');
    const runner = Bun.fileURLToPath(
      new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)
    );
    const setup = Bun.fileURLToPath(
      new URL('../../../apps/server/test/testing/setup.ts', import.meta.url)
    );

    await Effect.runPromise(
      fs.symlink(
        Bun.fileURLToPath(new URL('../../../node_modules', import.meta.url)),
        paths.join(directory.path, 'node_modules')
      )
    );
    await Bun.write(
      paths.join(directory.path, 'dependency.mjs'),
      `export const value = 'original';`
    );
    await Bun.write(
      paths.join(directory.path, 'subject.mjs'),
      `import { value } from './dependency.mjs'; export const read = () => value;`
    );
    await Bun.write(
      config,
      `export default { test: { fsModuleCache: false, include: ['*.test.mjs'], setupFiles: [${JSON.stringify(setup)}], reporters: ['verbose'], maxWorkers: 1 } };`
    );
    await Bun.write(
      fixture,
      `import { test } from '@study/testing';
test.stable('first test fails with a mock active', async ({ mock, expect }) => {
  mock(new URL('./dependency.mjs', import.meta.url), () => ({ value: 'mocked' }));
  const subject = await import('./subject.mjs');
  expect(subject.read()).toBe('mocked');
  throw new Error('intentional failure with mock active');
});
test.stable('following test sees the original module', async ({ mock, expect }) => {
  const subject = await import('./subject.mjs');
  expect(subject.read()).toBe('original');
  await Bun.write(${JSON.stringify(restored)}, 'original');
});`
    );

    const child = spawnTestProcess(
      [process.execPath, '--bun', runner, 'run', '--root', directory.path, '--config', config],
      { stdout: 'pipe', stderr: 'pipe' }
    );
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);
    const output = stdout + stderr;

    expect(status).toBe(1);
    expect(output).toContain('intentional failure with mock active');
    expect(await Bun.file(restored).text()).toBe('original');
  }
);
