import { resolve } from 'node:path';

/** Shared default for the browser development runtime and destructive seed command. */
export function developmentDatabasePath() {
  return (
    process.env.STUDY_DATABASE ?? resolve(import.meta.dirname, '../../target/web/study.sqlite')
  );
}
