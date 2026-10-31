import { readFileSync } from 'node:fs';

// Preserve vendored skill snapshots without exempting Study's own skills.
const manifest = JSON.parse(
  readFileSync(new URL('../../.agents/skills/upstream-lock.json', import.meta.url), 'utf8')
) as { skills: { name: string }[] };

export const upstreamSkillPatterns = manifest.skills.map(({ name }) => `.agents/skills/${name}/**`);
