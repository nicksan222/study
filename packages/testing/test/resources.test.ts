import { test } from '@study/testing';

test.unit.stable(
  'resource disposal runs every cleanup in reverse order after a failure',
  async ({ createTestResources, expect }) => {
    const resources = createTestResources();
    const released: string[] = [];

    resources.defer(() => released.push('directory'));
    resources.defer(() => {
      released.push('connection');

      throw new Error('close failed');
    });
    resources.defer(() => released.push('server'));

    await expect(resources.close()).rejects.toThrow('close failed');
    expect(released).toEqual(['server', 'connection', 'directory']);
    await resources.close();
    expect(released).toHaveLength(3);
  }
);

test.unit.stable(
  'managed resources share an in-flight close and retry failed early closes',
  async ({ createTestResources, expect }) => {
    await using resources = createTestResources();
    const gate = Promise.withResolvers<void>();
    let attempts = 0;
    const resource = resources.manage({
      async close() {
        attempts++;

        if (attempts === 1) {
          await gate.promise;

          throw new Error('early close failed');
        }
      }
    });

    const first = resource.close();

    expect(resource.close()).toBe(first);
    gate.resolve();
    await expect(first).rejects.toThrow('early close failed');
    await resources.close();
    await resource.close();
    expect(attempts).toBe(2);
  }
);

test.unit.stable(
  'managed synchronous resources can close early without double disposal',
  async ({ createTestResources, expect }) => {
    await using resources = createTestResources();
    let closed = 0;
    const resource = resources.manage({
      close: () => {
        closed++;
      }
    });

    resource.close();
    await resources.close();
    expect(closed).toBe(1);
  }
);

test.unit.stable(
  'temporary fixtures support an owned parent directory',
  async ({ temporaryDirectory, expect }) => {
    await using parent = await temporaryDirectory();
    await using child = await temporaryDirectory({ directory: parent.path, prefix: 'browser-' });

    expect(child.path.startsWith(`${parent.path}/browser-`)).toBe(true);
  }
);

test.unit.stable(
  'successful setup transfers resources without closing them before use',
  async ({ expect, createTestResources }) => {
    let closed = false;

    async function acquire({
      createTestResources
    }: Pick<test.unit.Context, 'createTestResources'>) {
      await using setup = createTestResources();

      setup.defer(() => {
        closed = true;
      });

      return setup.move();
    }

    const resources = await acquire({ createTestResources });

    expect(closed).toBe(false);
    await resources.close();
    expect(closed).toBe(true);
  }
);

test.unit.stable(
  'concurrent fixture closes await the same complete disposal',
  async ({ createTestResources, expect }) => {
    const resources = createTestResources();
    const gate = Promise.withResolvers<void>();

    resources.defer(() => gate.promise);
    const first = resources.close();
    const second = resources.close();

    gate.resolve();
    await Promise.all([first, second]);
    expect(second).toBe(first);
  }
);

test.unit.stable(
  'closed fixtures reject acquisition before opening another resource',
  async ({ createTestResources, expect }) => {
    const resources = createTestResources();

    await resources.close();
    let opened = false;

    await expect(
      resources.acquire(async () => {
        opened = true;

        return { close() {} };
      })
    ).rejects.toThrow('disposed');
    expect(opened).toBe(false);
  }
);

test.unit.stable(
  'closing during acquisition waits for and releases the resource',
  async ({ createTestResources, expect }) => {
    const resources = createTestResources();
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    let closed = false;
    const acquiring = resources.acquire(async () => {
      started.resolve();
      await gate.promise;

      return {
        close() {
          closed = true;
        }
      };
    });
    const result = acquiring.then(
      () => 'unexpected success',
      () => 'disposed'
    );

    await started.promise;
    const closing = resources.close();

    gate.resolve();
    await closing;
    expect(await result).toBe('disposed');
    expect(closed).toBe(true);
  }
);
