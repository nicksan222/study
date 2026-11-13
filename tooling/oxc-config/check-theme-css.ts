import { cssColorViolations } from './plugin/theme-color-values.ts';

const root = Bun.fileURLToPath(new URL('../../', import.meta.url));

let failed = false;

for (const directory of ['apps/client/src', 'packages/ui/src']) {
  for await (const path of new Bun.Glob('**/*.css').scan({
    cwd: `${root}${directory}`,
    absolute: true
  })) {
    const relative = path.slice(root.length);

    if (relative === 'packages/ui/src/theme.css') continue;

    for (const violation of cssColorViolations(await Bun.file(path).text())) {
      process.stderr.write(`${relative}: use a theme color: ${violation}\n`);
      failed = true;
    }
  }
}

if (failed) process.exitCode = 1;
