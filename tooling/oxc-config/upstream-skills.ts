// Preserve vendored skill snapshots without exempting Study's own skills.
const manifest = JSON.parse(
  await Bun.file(new URL('../../.agents/skills/upstream-lock.json', import.meta.url)).text()
) as { skills: { name: string }[] };

export const upstreamSkillPatterns = manifest.skills.flatMap(({ name }) => [
  `.agents/skills/${name}/**`,
  `.claude/skills/${name}/**`
]);
