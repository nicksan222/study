/** One timing and worker budget for the repository test runners. */
export const testPolicy = {
  asyncTimeout: 5000,
  processStartupTimeout: 30000,
  processTimeout: 120000,
  processShutdownTimeout: 1000,
  workers: { ci: 1, local: 2 }
} as const;
