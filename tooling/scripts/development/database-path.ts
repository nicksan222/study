/** Shared default for the browser development runtime and destructive seed command. */
export function developmentDatabasePath() {
  return (
    process.env.STUDY_DATABASE ??
    Bun.fileURLToPath(new URL('../../../target/web/study.sqlite', import.meta.url))
  );
}
