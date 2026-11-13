import { createBiology } from './projects/biology.ts';
import { createComputerScience } from './projects/computer-science.ts';
import { createEnvironment } from './projects/environment.ts';
import { createHistory } from './projects/history.ts';
import { createStatistics } from './projects/statistics.ts';

/** Add a project creator here; the reset and persistence harnesses need no changes. */
export const demoProjects = [
  createBiology,
  createStatistics,
  createHistory,
  createComputerScience,
  createEnvironment
];
