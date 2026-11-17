import type { Path } from 'effect';

/** Matches a pinned download request to an already-installed local test model. */
export function localModelFile<File extends { readonly name?: string }>(
  files: readonly File[],
  url: string,
  path: Pick<Path.Path, 'basename'>
): File | undefined {
  const pathname = new URL(url).pathname;

  return files.find(
    (candidate) =>
      candidate.name !== undefined && pathname.endsWith('/' + path.basename(candidate.name))
  );
}
