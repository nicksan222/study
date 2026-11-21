import { test } from '@study/testing';

const gallery = new URL('./materials-gallery.ts', import.meta.url);

test.unit.stable(
  'the Materials gallery rejects missing live images even when all reference names exist',
  async ({ temporaryDirectory, spawnTestProcess, expect }) => {
    await using temporary = await temporaryDirectory();
    const root = temporary.path;
    const input = `${root}/shards`;
    const output = `${root}/gallery`;
    const command = [process.execPath, Bun.fileURLToPath(gallery), input, output];

    await Bun.write(`${input}/web-e2e-materials-1/.keep`, '');
    const { exited, stderr } = spawnTestProcess(command, { stdout: 'ignore', stderr: 'pipe' });

    expect(await exited).not.toBe(0);
    expect(await new Response(stderr).text()).toContain(
      'Missing review screenshot: material-formats-render-on-desktop-and-phone/bin-desktop-dark.png'
    );
    expect(await Bun.file(`${output}/index.html`).exists()).toBe(false);
  }
);
