export const healthData = (workersRunning: boolean) => ({
  protocolVersion: 1,
  workersRunning,
  testMode: false
});
