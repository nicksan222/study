export {};

const repetitions = Number(process.argv[2] ?? 3);

const workers = Number(process.argv[3] ?? 1);

if (
  !Number.isInteger(repetitions) ||
  repetitions < 1 ||
  repetitions > 100 ||
  ![1, 2, 4].includes(workers)
)
  throw new Error('Use 1–100 repetitions and 1, 2 or 4 workers');

const results: { wallMs: number; exitCode: number }[] = [];

for (let index = 0; index < repetitions; index++) {
  const start = performance.now();
  const child = Bun.spawn(['bun', 'run', 'web:e2e:compare', '--maxWorkers', String(workers)], {
    stdout: 'inherit',
    stderr: 'inherit'
  });
  const exitCode = await child.exited;

  results.push({ wallMs: performance.now() - start, exitCode });
}

await Bun.write(
  `test-results/capacity-${Date.now()}.json`,
  JSON.stringify({ workers, repetitions, results }, null, 2)
);
process.exit(results.some((result) => result.exitCode !== 0) ? 1 : 0);
