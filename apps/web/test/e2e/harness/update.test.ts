import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

testStable(
  'updater accepts shared safe names and rejects unsafe or unscoped selections',
  async () => {
    for (const scope of [
      '2-notes-survive-reload/editing_state',
      '2',
      'notes',
      'notes/editing',
      '',
      'notes/',
      '../editing',
      'notes/editing/extra',
      '-notes',
      'notes/../editing',
      'a'.repeat(81)
    ]) {
      const child = Bun.spawn(
        [process.execPath, Bun.fileURLToPath(new URL('./update.ts', import.meta.url)), scope],
        {
          env: { ...process.env, CI: '1' },
          stdout: 'pipe',
          stderr: 'pipe'
        }
      );
      const error = await new Response(child.stderr).text();

      expect(await child.exited).toBe(1);
      if (['2-notes-survive-reload/editing_state', '2', 'notes', 'notes/editing'].includes(scope))
        expect(error).toContain('Baseline updates are forbidden in CI');
      else expect(error).toMatch(/Supply one workflow|Unsafe screenshot name/);
    }
  }
);
