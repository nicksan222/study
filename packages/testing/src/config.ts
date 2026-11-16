/** One timing and worker budget for the repository test runners. */
export const testPolicy = {
  asyncTimeout: 5000,
  processStartupTimeout: 30000,
  processTimeout: 120000,
  processShutdownTimeout: 1000,
  suiteTimeout: 900000,
  hookTimeout: 30000,
  tests: { unit: 30000, server: 180000, integration: 60000, browser: 120000 },
  workers: { ci: 1, local: 2 }
} as const;
